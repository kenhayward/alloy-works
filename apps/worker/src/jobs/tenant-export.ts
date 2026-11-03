import { createHash } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import {
  EXPORT_FORMAT,
  EXPORT_NOT_CARRIED_COLUMNS,
  EXPORT_TABLES,
  failTenantExport,
  finishTenantExport,
  partialLeftOut,
  readExportCut,
  readPartialCut,
  readTenantExport,
  readableForExport,
  type ExportCut,
  type ExportReference,
  type ExportScope,
  type TenantDatabase,
} from '@alloy-works/db';
import type { ObjectStores } from '@alloy-works/objects';
import { JobRefused } from '../refusal.js';
import { tarWriter } from '../tar.js';
import type { JobHandler } from '../worker.js';

const zipped = promisify(gzip);

/**
 * **The tenant's export written** (IMP-018, API-044; EI-A, EI-O): one tar archive, built on disk and
 * never whole in memory. `manifest.json` comes first, then `schema.json`, `secrets.jsonl`, a gzipped
 * JSON Lines file for each carried table, and `objects/<sha256>`, the bytes the rows name. Every table
 * is read in one transaction, which is the cut. Kept in the tenant's store and recorded on its row;
 * writing it records nothing, since asking for it was the event, and each download is.
 */

const omitted = (fate: 'rebuilt' | 'leftOut') =>
  Object.fromEntries(
    Object.entries(EXPORT_TABLES).flatMap(([name, table]) =>
      table.fate === fate ? [[name, table.why]] : [],
    ),
  );

export function tenantExportJob(deps: {
  readonly db: TenantDatabase;
  readonly stores: ObjectStores;
}): JobHandler {
  return {
    async run(tenant, job) {
      if (job.subjectId === null) return;
      const id = job.subjectId;
      const asked = await deps.db.withTenant(tenant, (trx) => readTenantExport(trx, id));
      // Nothing to do: another attempt already finished it.
      if (!asked || asked.state !== 'queued') return;
      const store = await deps.db.withTenant(tenant, (trx) => deps.stores.forTenant(trx, tenant));
      const folder = await mkdtemp(join(tmpdir(), 'aw-export-'));
      try {
        const tables = join(folder, 'tables');
        const objects = join(folder, 'objects');
        await mkdir(tables);
        await mkdir(objects);
        const file = (table: string) => join(tables, `${table}.jsonl.gz`);
        const bytes = new Map<string, number>();
        const write = async (table: string, lines: readonly string[]) => {
          // Gzip's members concatenate, so each page is written and forgotten.
          bytes.set(
            table,
            (bytes.get(table) ?? 0) +
              lines.reduce((total, line) => total + Buffer.byteLength(line) + 1, 0),
          );
          await appendFile(file(table), await zipped(`${lines.join('\n')}\n`));
        };
        const whole = asked.scope === 'tenant';
        // What the asker may read is read first: reading it takes a lock a read-only cut cannot.
        const readable =
          whole || asked.requestedBy === null
            ? undefined
            : await deps.db.withTenant(tenant, (trx) => readableForExport(trx, asked.requestedBy!));
        if (!whole && !readable) {
          throw new JobRefused('export_invalid', 'Whoever asked for this export has gone.');
        }
        const cut: ExportCut & { references?: readonly ExportReference[] } =
          await deps.db.withTenant(
            tenant,
            (trx) =>
              whole
                ? readExportCut(trx, write)
                : readPartialCut(
                    trx,
                    {
                      scope: asked.scope as Exclude<ExportScope, 'tenant'>,
                      id: asked.scopeId,
                      followReferences: asked.followReferences,
                      requestedBy: asked.requestedBy!,
                    },
                    readable!,
                    write,
                  ),
            undefined,
            { isolation: 'repeatable read', readOnly: true },
          );

        // Each object once, by its hash, checked. One the store has lost or holds wrongly is named,
        // rather than making the tenant impossible to export when it most needs to leave (IMP-020).
        const hashes = new Set<string>();
        const missing: string[] = [];
        for (const key of cut.objects) {
          const sha256 = key.slice(key.lastIndexOf('/') + 1);
          if (hashes.has(sha256)) continue;
          try {
            const bytes = await store.get(key);
            if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
              missing.push(sha256);
              continue;
            }
            await writeFile(join(objects, sha256), bytes);
            hashes.add(sha256);
          } catch {
            missing.push(sha256);
          }
        }

        const names = Object.keys(cut.rows).sort();
        const manifest = {
          format: EXPORT_FORMAT,
          export: asked.id,
          scope: asked.scope,
          ...(whole
            ? {}
            : {
                scopeId: asked.scopeId,
                followReferences: asked.followReferences,
                references: { file: 'references.jsonl', count: cut.references?.length ?? 0 },
              }),
          requestedAt: asked.requestedAt.toISOString(),
          cutAt: cut.cutAt,
          lastMigration: cut.lastMigration,
          guide: 'docs/guides/export-format.md in the product repository',
          tables: Object.fromEntries(
            names.map((name) => [
              name,
              {
                file: `tables/${name}.jsonl.gz`,
                rows: cut.rows[name] ?? 0,
                bytes: bytes.get(name) ?? 0,
              },
            ]),
          ),
          objects: {
            folder: 'objects/',
            named: 'by the SHA-256 of their bytes',
            count: hashes.size,
            missing,
          },
          secrets: {
            file: 'secrets.jsonl',
            count: cut.secrets.length,
            holds: 'A reference to each secret, never its value.',
          },
          rebuilt: omitted('rebuilt'),
          leftOut: {
            ...omitted('leftOut'),
            ...(whole ? {} : partialLeftOut(asked.scope as Exclude<ExportScope, 'tenant'>)),
          },
          columnsNeverCarried: {
            columns: EXPORT_NOT_CARRIED_COLUMNS,
            why: "A database's own transaction numbers, which mean nothing in another.",
          },
        };

        const path = join(folder, 'export.tar');
        const fd = openSync(path, 'w');
        try {
          const tar = tarWriter(fd);
          const json = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
          tar.bytes('manifest.json', json(manifest));
          tar.bytes('schema.json', json({ format: EXPORT_FORMAT, tables: cut.schema }));
          tar.bytes(
            'secrets.jsonl',
            Buffer.from(cut.secrets.map((each) => `${JSON.stringify(each)}\n`).join('')),
          );
          if (!whole) {
            tar.bytes(
              'references.jsonl',
              Buffer.from(
                (cut.references ?? []).map((each) => `${JSON.stringify(each)}\n`).join(''),
              ),
            );
          }
          for (const name of names) {
            // A table with no rows has no file on disk, and an empty one in the archive.
            if ((cut.rows[name] ?? 0) === 0) {
              tar.bytes(`tables/${name}.jsonl.gz`, await zipped(''));
            } else {
              await tar.file(`tables/${name}.jsonl.gz`, file(name));
            }
          }
          for (const sha256 of [...hashes].sort()) {
            await tar.file(`objects/${sha256}`, join(objects, sha256));
          }
          tar.end();
        } finally {
          closeSync(fd);
        }
        const kept = await store.putFile(path, 'application/x-tar');
        const counts = { ...cut.rows, objects: hashes.size };
        await deps.db.withTenant(tenant, (trx) => finishTenantExport(trx, id, kept, counts));
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    },

    async failed(tenant, job) {
      if (job.subjectId === null) return;
      await deps.db.withTenant(tenant, (trx) => failTenantExport(trx, job.subjectId!));
    },
  };
}
