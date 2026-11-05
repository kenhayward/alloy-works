import type { AuditContext } from '@alloy-works/domain';
import { sql } from 'kysely';
import { auditContextSetting, AUDIT_SETTING, recordEvent } from './audit.js';
import { insertOrder } from './export-scope.js';
import { EXPORT_TABLES } from './export-tables.js';
import { assertTenantRole } from './names.js';
import type { Tenant } from './provision.js';
import type { RestorationAnswers, RestoreSource, RestorerDatabase } from './restoring.js';
import { finishRestoration, recordRestorationReport, switchExtensionsOff } from './restoring.js';
import { reindexArtifacts } from './search.js';
import type { TenantTransaction } from './tables.js';
import { readExportCatalogue } from './tenant-export.js';

/**
 * **A part of a tenant imported into one in use** (IMP-039, IMP-041; EI-C, EI-F). Nothing here is
 * overwritten: a row already here is left and counted, and a row whose requirements are not here is
 * skipped and counted. One transaction as the owner, on the tables the archive holds alone, so writers to
 * those wait while it runs. Natural and renumbered ids are mapped, and every reference to them follows.
 * The preview runs this same code and rolls back, so it says what would happen.
 */

export interface ImportReport {
  /** Rows this import added, by table. */
  readonly added: Readonly<Record<string, number>>;
  /** Rows already here, identical or matched, and left: by table. */
  readonly already: Readonly<Record<string, number>>;
  /** The first hundred rows here by the archive's id, with other content, left as they are. */
  readonly conflicts: readonly { readonly table: string; readonly id: string }[];
  readonly conflictCount: number;
  /** Rows needing what neither the archive nor this tenant holds: left out, by table. */
  readonly skipped: Readonly<Record<string, number>>;
  /** Optional references to what is not here, written empty, by table. */
  readonly cleared: Readonly<Record<string, number>>;
  /** This tenant's settings, which an import leaves as they are. */
  readonly settingsLeft: readonly string[];
}

const CREDENTIALS: ReadonlySet<string> = new Set([
  'connection_credential',
  'extension_credential',
  'model_credential',
]);

const DEFINITIONS: ReadonlySet<string> = new Set(['field', 'metadataSchema', 'componentType']);

const headOf = async (trx: TenantTransaction, artifact: string) => {
  const { rows } = await sql<{ id: string; content_hash: string }>`
    select id, content_hash from artifact_version where artifact_id = ${artifact}
     order by revision_no desc, version_no desc limit 1`.execute(trx);
  return rows[0]!;
};

const bump = (counts: Record<string, number>, table: string) => {
  counts[table] = (counts[table] ?? 0) + 1;
};

interface Input {
  readonly tenant: Tenant;
  readonly restorationId: string;
  readonly answers: RestorationAnswers;
  readonly source: RestoreSource;
  readonly auditContext: AuditContext;
}

/** The part, in the transaction `asOwner` opened. Throw afterwards, and nothing happened. */
export async function applyPartialImport(
  trx: TenantTransaction,
  input: Input,
): Promise<{ readonly report: ImportReport; readonly artifacts: readonly string[] }> {
  const { source, answers, tenant } = input;
  const catalogue = await readExportCatalogue(trx);
  const order = insertOrder(catalogue).filter(
    ([table]) => source.columns(table) !== undefined && !CREDENTIALS.has(table),
  );
  // A writer holding one of these for long is a job to try again, not a tenant stopped.
  await sql`set local lock_timeout = '30s'`.execute(trx);
  for (const [table] of order) {
    await sql`alter table ${sql.id(table)} disable trigger user`.execute(trx);
  }
  await sql`set constraints all deferred`.execute(trx);

  const typeOf = (table: string, column: string) =>
    catalogue.columns.find((each) => each.table === table && each.name === column)?.type ?? 'text';
  const { rows: identities } = await sql<{ table_name: string; column_name: string }>`
    select table_name, column_name from information_schema.columns
     where table_schema = current_schema() and identity_generation is not null`.execute(trx);
  const generated = new Set(identities.map((each) => `${each.table_name}.${each.column_name}`));
  for (const column of catalogue.columns) {
    if (column.generated) generated.add(`${column.table}.${column.name}`);
  }

  const added: Record<string, number> = {};
  const already: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  const cleared: Record<string, number> = {};
  const conflicts: { table: string; id: string }[] = [];
  let conflictCount = 0;
  const settingsLeft: string[] = [];

  /** From the archive's value of a key to this tenant's, for references that follow it. */
  const maps = new Map<string, Map<string, string>>();
  const mapped = (table: string, column: string, value: unknown) =>
    maps.get(`${table}.${column}`)?.get(String(value));
  const remember = (table: string, column: string, from: unknown, to: unknown) => {
    const key = `${table}.${column}`;
    const map = maps.get(key) ?? new Map<string, string>();
    map.set(String(from), String(to));
    maps.set(key, map);
  };

  /** What this import itself wrote: a row hanging on anything else was there before, or is not new. */
  const wrote = new Set<string>();
  const found = new Map<string, boolean>();
  const holds = async (table: string, columns: readonly string[], values: readonly unknown[]) => {
    const key = `${table}|${columns.join()}|${values.map(String).join('|')}`;
    const known = found.get(key);
    if (known !== undefined) return known;
    const matching = sql.join(
      columns.map(
        (column, at) =>
          sql`${sql.id(column)} = ${String(values[at])}::${sql.raw(typeOf(table, column))}`,
      ),
      sql` and `,
    );
    const { rows } = await sql<{ here: boolean }>`
      select exists (select from ${sql.id(table)} where ${matching}) as here`.execute(trx);
    found.set(key, rows[0]!.here);
    return rows[0]!.here;
  };

  /** Each definition's current version before anything arrived in its chain. */
  const heads = new Map<string, { readonly id: string; readonly content_hash: string }>();

  const pending: {
    readonly table: string;
    readonly key: readonly string[];
    readonly keyValues: readonly unknown[];
    readonly columns: readonly string[];
    readonly refers: string;
    readonly refersBy: readonly string[];
    readonly values: readonly unknown[];
  }[] = [];

  for (const [table, census] of order) {
    if (census.identity === 'singleton') {
      settingsLeft.push(table);
      continue;
    }
    const pk = catalogue.primaryKeys.get(table) ?? [];
    const fks = catalogue.foreignKeys.filter((fk) => fk.table === table);
    const named = source.columns(table)!.filter((column) => !generated.has(`${table}.${column}`));
    const held = sql.join(named.map((column) => sql.id(column)));
    for await (const page of source.pages(table)) {
      for (const line of page) {
        const row = JSON.parse(line) as Record<string, unknown>;
        const original = { ...row };
        for (const column of census.pointsOut ?? []) row[column] = null;
        rewriteKeys(tenant, row);
        if (table === 'principal') {
          const to = answers.issuers[row['issuer'] as string];
          if (to != null) row['issuer'] = to;
        } else if (table === 'webhook_subscription') {
          row['disabled_at'] = new Date().toISOString();
          row['disabled_reason'] = 'restored';
        } else if (table === 'identity_provider') {
          row['closed_at'] = new Date().toISOString();
          row['scim_identity'] = null;
          row['shared'] = false;
          row['managed_by_organisation'] = false;
        }

        let drop = false;
        const later: (typeof pending)[number][] = [];
        const repeat = { hanging: false };
        for (const fk of fks) {
          const mappedValues = fk.columns.map((column, at) => {
            const value = row[column];
            if (value === null || value === undefined) return null;
            return mapped(fk.refers, fk.refersBy[at]!, value) ?? value;
          });
          if (mappedValues.some((value) => value === null)) continue;
          const breaking = fk.columns.some((column) => census.breaksCycleAt?.includes(column));
          if (breaking || fk.refers === table) {
            later.push({
              table,
              key: pk,
              keyValues: [],
              columns: fk.columns,
              refers: fk.refers,
              refersBy: fk.refersBy,
              values: fk.columns.map((column) => original[column]),
            });
            if (fk.nullable) for (const column of fk.columns) row[column] = null;
            continue;
          }
          fk.columns.forEach((column, at) => {
            row[column] = mappedValues[at];
          });
          if (fk.columns.some((column) => census.deferredAt?.includes(column))) continue;
          if (!(await holds(fk.refers, fk.refersBy, mappedValues))) {
            if (fk.nullable) {
              for (const column of fk.columns) row[column] = null;
              bump(cleared, table);
            } else {
              drop = true;
              break;
            }
          } else if (
            !fk.nullable &&
            census.identity === 'renumbered' &&
            EXPORT_TABLES[fk.refers]?.fate === 'carried' &&
            (EXPORT_TABLES[fk.refers] as { identity?: string }).identity === 'kept' &&
            !wrote.has(`${fk.refers}|${mappedValues.map(String).join('|')}`)
          ) {
            repeat.hanging = true;
          }
        }
        if (drop) {
          bump(skipped, table);
          continue;
        }
        // Numbered anew, so only what hangs on what this import wrote is new (EI-C).
        if (repeat.hanging) {
          bump(already, table);
          continue;
        }

        if (census.identity === 'natural') {
          const key = census.key!;
          if (key.every((column) => row[column] !== null && row[column] !== undefined)) {
            const matching = sql.join(
              key.map(
                (column) =>
                  sql`${sql.id(column)} = ${String(row[column])}::${sql.raw(typeOf(table, column))}`,
              ),
              sql` and `,
            );
            const { rows: match } = await sql<Record<string, unknown>>`
              select * from ${sql.id(table)} where ${matching} limit 1`.execute(trx);
            if (match[0]) {
              for (const column of pk) remember(table, column, original[column], match[0][column]);
              bump(already, table);
              continue;
            }
          }
        }

        const { rows: made } = await sql<Record<string, unknown>>`
          insert into ${sql.id(table)} (${held})
          select ${held} from jsonb_populate_record(null::${sql.id(table)}, ${JSON.stringify(row)}::jsonb)
          on conflict do nothing returning *`.execute(trx);
        let written = made[0];
        const here =
          !written && table === 'artifact_version'
            ? (
                await sql<{ here: string }>`
                select version_digest as here from artifact_version where id = ${String(row['id'])}`.execute(
                  trx,
                )
              ).rows[0]?.here
            : undefined;
        // Every tenant seeds the same definitions under its own version ids, and a digest names the
        // id. So a definition's version takes the next number in this chain, and this tenant's
        // current one is put back on top below if it says anything else (EI-S).
        if (
          !written &&
          table === 'artifact_version' &&
          here === undefined &&
          DEFINITIONS.has(String(row['kind']))
        ) {
          const artifact = String(row['artifact_id']);
          if (!heads.has(artifact)) heads.set(artifact, await headOf(trx, artifact));
          const { rows: next } = await sql<{ next: number }>`
            select coalesce(max(version_no), 0)::int + 1 as next from artifact_version
             where artifact_id = ${artifact} and revision_no = ${Number(row['revision_no'])}`.execute(
            trx,
          );
          const renumbered = { ...row, version_no: next[0]!.next };
          const { rows: placed } = await sql<Record<string, unknown>>`
            insert into artifact_version (${held})
            select ${held} from jsonb_populate_record(null::artifact_version, ${JSON.stringify(renumbered)}::jsonb)
            returning *`.execute(trx);
          written = placed[0];
        }
        if (!written) {
          // Here by this id: the same, or not. Either way it is left (EI-C).
          const differs = table === 'artifact_version' && here !== row['version_digest'];
          if (differs) {
            conflictCount += 1;
            if (conflicts.length < 100) conflicts.push({ table, id: String(row['id']) });
          } else {
            bump(already, table);
          }
          continue;
        }
        bump(added, table);
        for (const column of pk) remember(table, column, original[column], written[column]);
        wrote.add(`${table}|${pk.map((column) => String(written[column])).join('|')}`);
        found.set(
          `${table}|${pk.join()}|${pk.map((column) => String(written[column])).join('|')}`,
          true,
        );
        for (const each of later) {
          pending.push({ ...each, keyValues: pk.map((column) => written[column]) });
        }
      }
    }
  }

  // A definition's current version stays what this tenant had, should what arrived say otherwise.
  for (const [artifact, head] of heads) {
    const top = await headOf(trx, artifact);
    if (top.content_hash === head.content_hash) continue;
    await sql`
      insert into artifact_version (artifact_id, kind, revision_no, version_no, author_id, note,
        schema_version, content, content_hash, metadata_values, not_carried, version_digest)
      select artifact_id, kind, revision_no,
             (select max(version_no) + 1 from artifact_version a
               where a.artifact_id = v.artifact_id and a.revision_no = v.revision_no),
             author_id, note, schema_version, content, content_hash, metadata_values, not_carried,
             version_digest
        from artifact_version v where id = ${head.id}`.execute(trx);
    bump(added, 'artifact_version');
  }

  // The second pass: what a cycle kept out of the first, where what it names has arrived (EI-C).
  for (const each of pending) {
    const values = each.values.map(
      (value, at) => mapped(each.refers, each.refersBy[at]!, value) ?? value,
    );
    if (!(await holds(each.refers, each.refersBy, values))) continue;
    const assignments = sql.join(
      each.columns.map(
        (column, at) =>
          sql`${sql.id(column)} = ${String(values[at])}::${sql.raw(typeOf(each.table, column))}`,
      ),
    );
    const matching = sql.join(
      each.key.map(
        (column, at) =>
          sql`${sql.id(column)} = ${String(each.keyValues[at])}::${sql.raw(typeOf(each.table, column))}`,
      ),
      sql` and `,
    );
    await sql`update ${sql.id(each.table)} set ${assignments} where ${matching}`.execute(trx);
  }

  await sql`set constraints all immediate`.execute(trx);
  for (const [table] of order) {
    await sql`alter table ${sql.id(table)} enable trigger user`.execute(trx);
  }

  const artifacts = [...(maps.get('artifact.id')?.values() ?? [])].filter((id) =>
    wrote.has(`artifact|${id}`),
  );
  const extensions = [...(maps.get('extension.id')?.values() ?? [])].filter((id) =>
    wrote.has(`extension|${id}`),
  );
  await switchExtensionsOff(trx, extensions);
  return {
    report: {
      added,
      already,
      conflicts,
      conflictCount,
      skipped,
      cleared,
      settingsLeft,
    },
    artifacts,
  };
}

/** Only a version's content keeps the prefix it was written under, inside its digest (EI-P). */
function rewriteKeys(tenant: Tenant, row: Record<string, unknown>) {
  for (const column of ['object_key', 'preview_key', 'report_key']) {
    const key = row[column];
    if (typeof key === 'string' && key.includes('/sha256/')) {
      row[column] = `${tenant.role}/sha256/${key.slice(key.lastIndexOf('/') + 1)}`;
    }
  }
}

class RolledBack extends Error {
  constructor(readonly report: ImportReport) {
    super('A preview changes nothing.');
  }
}

/** What it would do, found by doing it and undoing it. */
export async function previewPartialImport(
  restorer: RestorerDatabase,
  input: Input,
): Promise<ImportReport> {
  try {
    await restorer.asOwner(input.tenant, async (trx) => {
      const { report } = await applyPartialImport(trx, input);
      throw new RolledBack(report);
    });
  } catch (error) {
    if (error instanceof RolledBack) return error.report;
    throw error;
  }
  throw new Error('A preview cannot finish');
}

/** The part, for good, then as the tenant's own role for what any other work does afterwards. */
export async function importPart(restorer: RestorerDatabase, input: Input): Promise<void> {
  await restorer.asOwner(input.tenant, async (trx) => {
    const { report, artifacts } = await applyPartialImport(trx, input);
    await sql`set local role ${sql.id(assertTenantRole(input.tenant.role))}`.execute(trx);
    await sql`select set_config(${AUDIT_SETTING}, ${auditContextSetting(input.auditContext)}, true)`.execute(
      trx,
    );
    await recordRestorationReport(trx, input.restorationId, report);
    await finishRestoration(trx, input.restorationId);
    await reindexArtifacts(trx, artifacts);
    await recordEvent(trx, {
      kind: 'import.restored',
      subject: { kind: 'restoration', id: input.restorationId },
      detail: { restoration: input.restorationId, events: 0 },
    });
  });
}
