import { closeSync, openSync, writeSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EXPORT_PARTS,
  exportPage,
  failTenantExport,
  finishTenantExport,
  readTenantExport,
  type TenantDatabase,
} from '@alloy-works/db';
import type { ObjectStores } from '@alloy-works/objects';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { JobRefused } from '../refusal.js';
import type { JobHandler } from '../worker.js';

/**
 * **The tenant's export written** (API-044; the R21 plan, R21-B): one ZIP archive, built on disk and
 * never whole in memory - a JSON Lines file for each part, read a page at a time, each page in a
 * transaction of its own; the bytes each asset version and publication output names, once each, as
 * `objects/<sha256>`; and `manifest.json`, saying what it holds and what it leaves out. Kept in the
 * tenant's store and recorded on its row; writing it records nothing, since asking for it was the
 * event, and each download is.
 */

/** A ZIP without its 64-bit extension holds at most this many entries and this many bytes. */
const MOST_ENTRIES = 65_000;
const MOST_BYTES = 4_000_000_000;

/** What an export never holds, said in its manifest so a reader knows it is not whole (R21-B). */
export const LEFT_OUT = [
  'The audit log: exported from Administration > Audit log.',
  'Credentials, keys and secrets: never exported.',
  'People, groups, roles, grants and invitations.',
  'Sessions and personal tokens.',
  'Comments, threads, suggestions and notifications.',
  'Iterations not yet saved as versions, and previews.',
  "Stored results' rows: each dataset version's provenance is exported among the versions.",
];

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
        const path = join(folder, 'export.zip');
        const fd = openSync(path, 'w');
        let open = true;
        const close = () => {
          if (open) closeSync(fd);
          open = false;
        };
        let failure: Error | null = null;
        const counts: Record<string, number> = {};
        try {
          let finished!: () => void;
          const done = new Promise<void>((resolve) => (finished = resolve));
          const zip = new Zip((error, chunk, final) => {
            if (error) failure = error;
            else writeSync(fd, chunk);
            if (final || error) finished();
          });
          let entries = 0;
          const text = (name: string) => {
            const entry = new ZipDeflate(name, { level: 6 });
            zip.add(entry);
            entries += 1;
            return entry;
          };
          const objects = new Set<string>();
          for (const part of EXPORT_PARTS) {
            const entry = text(`${part}.jsonl`);
            let after: string | undefined;
            let count = 0;
            for (;;) {
              const page = await deps.db.withTenant(tenant, (trx) =>
                exportPage(trx, asked, part, after),
              );
              if (page.lines.length > 0) {
                entry.push(
                  Buffer.from(
                    page.lines.map((line) => `${JSON.stringify(line)}\n`).join(''),
                    'utf8',
                  ),
                );
              }
              count += page.lines.length;
              for (const key of page.objects) objects.add(key);
              if (page.next === null) break;
              after = page.next;
            }
            entry.push(new Uint8Array(), true);
            counts[part] = count;
          }
          if (entries + objects.size + 1 > MOST_ENTRIES) {
            throw new JobRefused(
              'export_too_large',
              'The export holds more files than one archive may.',
            );
          }
          // Each object once, by its hash, as stored: already a PNG, a JPEG or a PDF, so not deflated.
          const missing: string[] = [];
          for (const key of [...objects].sort()) {
            const sha256 = key.slice(key.lastIndexOf('/') + 1);
            let bytes: Buffer;
            try {
              bytes = await store.get(key);
            } catch {
              missing.push(sha256);
              continue;
            }
            const entry = new ZipPassThrough(`objects/${sha256}`);
            zip.add(entry);
            entry.push(bytes, true);
          }
          counts['objects'] = objects.size - missing.length;
          const manifest = {
            format: 1,
            export: asked.id,
            requestedAt: asked.requestedAt.toISOString(),
            asOf: 'The version chain and publications as committed when the export was asked for; the rest as made by then.',
            parts: Object.fromEntries(EXPORT_PARTS.map((part) => [`${part}.jsonl`, counts[part]])),
            objects: {
              folder: 'objects/',
              named: 'by the SHA-256 of their bytes',
              count: counts['objects'],
              missing,
            },
            leftOut: LEFT_OUT,
          };
          text('manifest.json').push(
            Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
            true,
          );
          zip.end();
          await done;
        } finally {
          close();
        }
        if (failure) throw failure;
        if ((await stat(path)).size > MOST_BYTES) {
          throw new JobRefused('export_too_large', 'The export is larger than one archive may be.');
        }
        const kept = await store.putFile(path, 'application/zip');
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
