import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EXPORT_FORMAT,
  EXPORT_NOT_CARRIED_COLUMNS,
  EXPORT_TABLES,
  readExportCatalogue,
  type ExportCatalogue,
  RestoreRefused,
  applyWholeRestore,
  carriedTables,
  PARTIAL_CONFIGURATION,
  PARTIAL_CONTENT,
  PARTIAL_REFERENCED,
  importPart,
  lastMigration,
  previewPartialImport,
  readRestoration,
  recordRestorationPlan,
  refuseRestoration,
  recordEvent,
  tenantIsEmpty,
  versionDigests,
  type RestorationAnswers,
  type RestorationPlan,
  type RestorerDatabase,
  type RestoreSource,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  parseContentDocument,
  parseOutlineDocument,
  type VersionSubstance,
} from '@alloy-works/domain';
import type { ObjectStores } from '@alloy-works/objects';
import { sha256OfFile, tablePages, unpackArchive } from '../archive.js';
import { JobRefused } from '../refusal.js';
import type { JobHandler } from '../worker.js';

/**
 * **A restoration's job** (IMP-039; EI-K, EI-L): run by the `restorer` process alone. While `checking`
 * it reads the upload as untrusted input, every digest and every object's hash recomputed, and says
 * what would happen. While `applying` it does so, in one transaction as the tenant's owner.
 */

interface Manifest {
  readonly format: number;
  readonly scope: string;
  readonly cutAt: string;
  readonly lastMigration: string;
  readonly tables: Readonly<Record<string, { rows: number; bytes: number; file: string }>>;
  readonly objects: { readonly missing: readonly string[] };
  readonly rebuilt: Readonly<Record<string, string>>;
  readonly leftOut: Readonly<Record<string, string>>;
}

const SCOPES: ReadonlySet<string> = new Set([
  'tenant',
  'configuration',
  'space',
  'document',
  'publication',
]);

/** A row no table here would take: the archive's fault, and the same every time it is tried. */
const unfit = (error: unknown) => {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^(22|23)/.test(code);
};

interface ArchiveSchema {
  readonly tables: Readonly<Record<string, { readonly columns: readonly { name: string }[] }>>;
}

const invalid = (message: string) => new JobRefused('export_invalid', message);

/** More than any manifest, schema or list of secrets holds: read whole, so held to a size. */
const MAX_WHOLE_BYTES = 64 * 1024 * 1024;

const whole = (path: string) => {
  if (statSync(path).size > MAX_WHOLE_BYTES) {
    throw invalid('The archive is not one this product wrote.');
  }
  return readFileSync(path, 'utf8');
};

const json = <T>(path: string): T => {
  try {
    return JSON.parse(whole(path)) as T;
  } catch {
    throw invalid('The archive is not one this product wrote.');
  }
};

function sourceOver(folder: string, manifest: Manifest, schema: ArchiveSchema): RestoreSource {
  return {
    columns: (table) => schema.tables[table]?.columns.map((column) => column.name),
    pages: (table) => {
      const declared = manifest.tables[table];
      if (!declared) return (async function* () {})();
      return tablePages(join(folder, 'tables', `${table}.jsonl.gz`), declared.bytes);
    },
  };
}

const substanceOf = (
  version: Record<string, unknown>,
  definitions: readonly { kind: string; id: string; version: string }[],
): VersionSubstance => {
  const kind = version['kind'] as string;
  const values = version['metadata_values'] as Record<string, unknown>;
  if (kind === 'component') {
    return {
      kind,
      content: parseContentDocument(version['content']),
      values,
      notCarried: version['not_carried'],
      definitions,
    } as unknown as VersionSubstance;
  }
  if (kind === 'document') {
    return {
      kind,
      content: parseOutlineDocument(version['content']),
      values,
      ...(version['parameters'] ? { parameters: version['parameters'] } : {}),
    } as unknown as VersionSubstance;
  }
  return { kind, content: version['content'] } as unknown as VersionSubstance;
};

/** Everything that can be known from the archive alone. Nothing here touches the tenant. */
async function checkArchive(
  folder: string,
  names: readonly string[],
  currentMigration: string,
  catalogue: ExportCatalogue,
) {
  if (names[0] !== 'manifest.json') throw invalid('The archive does not begin with its manifest.');
  const manifest = json<Manifest>(join(folder, 'manifest.json'));
  const schema = json<ArchiveSchema>(join(folder, 'schema.json'));
  if (typeof manifest.format !== 'number' || manifest.format > EXPORT_FORMAT) {
    throw new JobRefused(
      'export_format_newer',
      'This archive was written by a newer release. Upgrade first.',
    );
  }
  if (manifest.format < EXPORT_FORMAT) {
    throw new JobRefused(
      'export_invalid',
      `An archive in format ${manifest.format} cannot be restored.`,
    );
  }
  if (manifest.lastMigration > currentMigration) {
    throw new JobRefused(
      'export_format_newer',
      'This archive was written by a newer release. Upgrade first.',
    );
  }
  for (const [table, declared] of Object.entries(manifest.tables ?? {})) {
    const census = EXPORT_TABLES[table];
    if (census?.fate !== 'carried') throw invalid(`The archive holds an unknown table, ${table}.`);
    if (!names.includes(`tables/${table}.jsonl.gz`)) {
      throw invalid(`The archive lacks the table ${table}.`);
    }
    if (!Number.isSafeInteger(declared.bytes) || declared.bytes < 0) {
      throw invalid(`The manifest does not say how large ${table} is.`);
    }
    const holds = schema.tables?.[table]?.columns.map((column) => column.name) ?? [];
    const secret = census.secrets?.columns.find((column) => holds.includes(column));
    if (secret) throw invalid(`The archive holds a secret in ${table}.`);
    // Only what an export writes: a column of this schema that travels. This tenant's owner runs it.
    const known = new Set(
      catalogue.columns
        .filter(
          (column) => column.table === table && !EXPORT_NOT_CARRIED_COLUMNS.includes(column.name),
        )
        .map((column) => column.name),
    );
    const stranger = holds.find((column) => !known.has(column));
    if (stranger) throw invalid(`The archive holds an unknown column, ${table}.${stranger}.`);
  }
  const source = sourceOver(folder, manifest, schema);
  const count = async (table: string, each?: (row: Record<string, unknown>) => void) => {
    let rows = 0;
    for await (const page of source.pages(table)) {
      rows += page.length;
      if (each) for (const line of page) each(JSON.parse(line) as Record<string, unknown>);
    }
    return rows;
  };
  const tables: Record<string, number> = {};
  for (const [table, declared] of Object.entries(manifest.tables ?? {})) {
    const allowed = new Set(source.columns(table) ?? []);
    const rows = await count(table, (row) => {
      for (const column of Object.keys(row)) {
        if (!allowed.has(column)) throw invalid(`A row of ${table} holds ${column}.`);
      }
    });
    if (rows !== declared.rows) throw invalid(`${table} does not hold what its manifest says.`);
    tables[table] = rows;
  }

  // Every version as it was written (VER-042), and every content row as valid as a paste (IMP-017).
  const definitions = new Map<string, { kind: string; id: string; version: string }[]>();
  await count('version_definition', (row) => {
    const held = definitions.get(row['version_id'] as string) ?? [];
    held.push({
      kind: row['definition_kind'] as string,
      id: row['definition_artifact_id'] as string,
      version: row['definition_version_id'] as string,
    });
    definitions.set(row['version_id'] as string, held);
  });
  const hashes = new Set<string>();
  await count('artifact_version', (version) => {
    let digests: ReturnType<typeof versionDigests>;
    try {
      digests = versionDigests(
        substanceOf(version, definitions.get(version['id'] as string) ?? []),
      );
    } catch {
      throw invalid(`The version ${String(version['id'])} is not valid content.`);
    }
    if (digests.versionDigest !== version['version_digest']) {
      throw invalid(`The version ${String(version['id'])} has been changed.`);
    }
    if (digests.contentHash !== version['content_hash']) {
      throw invalid(`The version ${String(version['id'])} has been changed.`);
    }
    const object = (version['content'] as { object?: unknown } | null)?.object;
    if (version['kind'] === 'asset' && typeof object === 'string') {
      hashes.add(object.slice(object.lastIndexOf('/') + 1));
    }
  });

  // Every object is what its name says. One lost before the export is named by its manifest.
  const objects = existsSync(join(folder, 'objects')) ? await readdir(join(folder, 'objects')) : [];
  for (const name of objects) {
    if ((await sha256OfFile(join(folder, 'objects', name))) !== name) {
      throw invalid('An object in the archive does not match its hash.');
    }
  }
  const missing = manifest.objects?.missing ?? [];
  for (const hash of hashes) {
    if (!objects.includes(hash) && !missing.includes(hash)) {
      throw invalid('A version names an object the archive lacks and does not say so.');
    }
  }

  const issuers = new Map<string, number>();
  let externals = 0;
  let services = 0;
  await count('principal', (row) => {
    const issuer = row['issuer'];
    if (typeof issuer === 'string') issuers.set(issuer, (issuers.get(issuer) ?? 0) + 1);
    if (row['kind'] === 'service') services += 1;
    if (row['kind'] === 'external') externals += 1;
  });
  const secrets: { reference: string; kind: string }[] = [];
  if (!names.includes('secrets.jsonl')) throw invalid('The archive lacks its list of secrets.');
  for (const line of whole(join(folder, 'secrets.jsonl')).split('\n')) {
    if (line !== '') {
      const { reference, kind } = JSON.parse(line) as { reference: string; kind: string };
      secrets.push({ reference, kind });
    }
  }
  const scope = manifest.scope;
  if (!SCOPES.has(scope)) throw invalid('The archive does not say what it holds.');
  if (scope === 'tenant') {
    // A restore wipes what was seeded, so an archive short of a table would leave a tenant without it.
    for (const [table] of carriedTables()) {
      if (!manifest.tables?.[table]) throw invalid(`The archive lacks the table ${table}.`);
    }
  }
  if (scope !== 'tenant') {
    // Never access, and never the log, whatever its manifest claims (EI-D, EI-F).
    for (const table of Object.keys(manifest.tables ?? {})) {
      const carried =
        PARTIAL_CONTENT.has(table) ||
        PARTIAL_REFERENCED.has(table) ||
        (scope === 'configuration' && PARTIAL_CONFIGURATION.has(table));
      if (!carried) throw invalid(`A part cannot hold ${table}.`);
    }
  }
  const plan: RestorationPlan = {
    format: manifest.format,
    scope: manifest.scope,
    cutAt: manifest.cutAt,
    tables,
    missingObjects: missing,
    secrets,
    issuers: [...issuers].map(([issuer, people]) => ({ issuer, people })),
    groups: tables['access_group'] ?? 0,
    externals,
    serviceIdentities: services,
    leftOut: manifest.leftOut ?? {},
    rebuilt: manifest.rebuilt ?? {},
  };
  return { manifest, schema, plan, source, objects };
}

export function restorationJob(deps: {
  readonly db: TenantDatabase;
  readonly restorer: RestorerDatabase;
  readonly stores: ObjectStores;
}): JobHandler {
  return {
    async run(tenant, job) {
      if (job.subjectId === null) return;
      const id = job.subjectId;
      const asked = await deps.db.withTenant(tenant, (trx) => readRestoration(trx, id));
      if (!asked || (asked.state !== 'checking' && asked.state !== 'applying')) return;
      const store = await deps.db.withTenant(tenant, (trx) => deps.stores.forTenant(trx, tenant));
      const folder = await mkdtemp(join(tmpdir(), 'aw-restore-'));
      const refuse = async (code: string, message: string) => {
        await deps.db.withTenant(
          tenant,
          async (trx) => {
            // A second attempt finding the first already finished has refused nothing.
            if (!(await refuseRestoration(trx, id, { code, message }, 'refused'))) return;
            await recordEvent(trx, {
              kind: 'import.refused',
              subject: { kind: 'restoration', id },
              detail: { restoration: id, code },
            });
          },
          { actorKind: 'person', actor: asked.requestedBy },
        );
      };
      try {
        const path = join(folder, 'upload.tar');
        await store.getFile(asked.objectKey!, path);
        const unpacked = join(folder, 'archive');
        let checked: Awaited<ReturnType<typeof checkArchive>>;
        try {
          const names = unpackArchive(path, unpacked);
          const [current, catalogue] = await deps.db.withTenant(
            tenant,
            async (trx) => [await lastMigration(trx), await readExportCatalogue(trx)] as const,
          );
          checked = await checkArchive(unpacked, names, current, catalogue);
          if (checked.plan.scope === 'tenant') {
            const here = await deps.db.withTenant(tenant, (trx) =>
              tenantIsEmpty(trx, asked.requestedBy),
            );
            if (here !== 'empty') {
              throw new JobRefused(
                'tenant_not_empty',
                `A whole environment goes only into an empty one, and this holds ${here}.`,
              );
            }
          }
        } catch (error) {
          if (!(error instanceof JobRefused)) throw error;
          await refuse(error.code, error.message);
          return;
        }

        const whole = checked.plan.scope === 'tenant';
        const partInput = (answers: RestorationAnswers) => ({
          tenant,
          restorationId: id,
          answers,
          source: checked.source,
          auditContext: { actorKind: 'person' as const, actor: asked.requestedBy },
        });

        if (asked.state === 'checking') {
          let plan = checked.plan;
          if (!whole) {
            try {
              plan = {
                ...plan,
                would: await previewPartialImport(
                  deps.restorer,
                  partInput({ issuers: {}, switchedOff: [] }),
                ),
              };
            } catch (error) {
              if (!unfit(error)) throw error;
              await refuse('export_invalid', 'A row in this archive cannot be kept here.');
              return;
            }
          }
          await deps.db.withTenant(
            tenant,
            async (trx) => {
              await recordRestorationPlan(trx, id, plan);
              await recordEvent(trx, {
                kind: 'import.previewed',
                subject: { kind: 'restoration', id },
                detail: { restoration: id },
              });
            },
            { actorKind: 'person', actor: asked.requestedBy },
          );
          return;
        }

        // The objects first: named by hash, a retry finds them there (EI-L).
        for (const name of checked.objects) {
          await store.putFile(join(unpacked, 'objects', name), 'application/octet-stream');
        }
        try {
          if (!whole) {
            await importPart(deps.restorer, partInput(asked.answers!));
            return;
          }
          await deps.restorer.asOwner(tenant, (trx) =>
            applyWholeRestore(trx, {
              tenant,
              restorationId: id,
              restorer: asked.requestedBy,
              answers: asked.answers!,
              source: checked.source,
              auditContext: { actorKind: 'person', actor: asked.requestedBy },
            }),
          );
        } catch (error) {
          if (unfit(error)) {
            await refuse('export_invalid', 'A row in this archive cannot be kept here.');
            return;
          }
          if (!(error instanceof RestoreRefused)) throw error;
          await refuse(error.code, error.message);
        }
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    },

    async failed(tenant, job) {
      if (job.subjectId === null) return;
      await deps.db.withTenant(tenant, (trx) =>
        refuseRestoration(
          trx,
          job.subjectId!,
          { code: 'restore_failed', message: 'It could not be finished. Nothing was changed.' },
          'failed',
        ),
      );
    },
  };
}
