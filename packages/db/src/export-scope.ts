import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { carriedTables, EXPORT_NOT_CARRIED_COLUMNS, EXPORT_TABLES } from './export-tables.js';
import { readableArtifactsAs } from './readable-artifacts.js';
import type { TenantTransaction } from './tables.js';
import { readExportCatalogue, type ExportCatalogue, type ExportCut } from './tenant-export.js';

/**
 * **A part of a tenant exported** (IMP-024, IMP-038, IMP-040, ADM-005; EI-R): a space, a document, a
 * publication or the configuration. A carried table is one of three things here. Content follows the
 * artifacts in scope through its foreign keys. Referenced rows are those the content names. The
 * configuration is whole, in that scope alone. Anything else, audit first, stays out.
 */

export type ExportScope = 'tenant' | 'configuration' | 'space' | 'document' | 'publication';

/** Tables that follow an artifact: a row is in when every row of these it needs is in. */
export const PARTIAL_CONTENT: ReadonlySet<string> = new Set([
  'artifact',
  'artifact_archival',
  'artifact_dates',
  'artifact_line',
  'artifact_scope',
  'artifact_version',
  'asset_rights',
  'baseline',
  'baseline_binding',
  'baseline_pin',
  'baseline_supersession',
  'bibliography_entry_status',
  'bibliography_identity',
  'bibliography_key',
  'binding_resolution',
  'binding_revision',
  'connection_credential',
  'dataset',
  'dataset_name',
  'dataset_take',
  'definition_name',
  'document_template',
  'document_template_move',
  'line_closed',
  'line_return',
  'machine_draft',
  'publication',
  'publication_asset',
  'publication_binding',
  'publication_check',
  'publication_check_given_up',
  'publication_input',
  'publication_output',
  'publication_request',
  'publication_request_asset',
  'publication_request_binding',
  'publication_request_occurrence',
  'publication_request_rights',
  'reference',
  'relationship',
  'review_round',
  'review_round_event',
  'review_round_reviewer',
  'revision_acceptance',
  'revision_designation',
  'revision_effected',
  'revision_effective',
  'revision_scope',
  'section_waiver',
  'source_change',
  'suggestion',
  'suggestion_resolution',
  'thread',
  'thread_comment',
  'thread_comment_text',
  'thread_resolution',
  'translation_state',
  'version_definition',
  'workflow_approval',
  'workflow_transition',
]);

/** Tables holding only the rows content names: who wrote it, where, and under which workflow. */
export const PARTIAL_REFERENCED: ReadonlySet<string> = new Set([
  'principal',
  'space',
  'translation_policy_change',
  'workflow_definition',
]);

/** Whole, in the configuration scope alone (ADM-005). Access is not here: an import never gives it. */
export const PARTIAL_CONFIGURATION: ReadonlySet<string> = new Set([
  'access_policy',
  'bridge_settings',
  'bridge_unlisted_property',
  'component_type_default',
  'data_policy',
  'editing_policy',
  'extension',
  'extension_credential',
  'extension_version',
  'generation_budget',
  'generation_limit',
  'google_domain',
  'guardrail',
  'identity_provider',
  'images_policy',
  'import_policy',
  'layout_default',
  'model_credential',
  'model_endpoint',
  'model_route',
  'profile',
  'prompt_library_default',
  'reference_source_policy',
  'role',
  'service_identity',
  'session_settings',
  'theme_default',
  'translation_policy',
  'translation_policy_change',
  'webhook_subscription',
  'workflow_definition',
]);

/** A publication stands alone: what its document went on to be is not in it. */
const NOT_IN_A_PUBLICATION: ReadonlySet<string> = new Set([
  'baseline',
  'machine_draft',
  'relationship',
  'review_round',
  'suggestion',
  'thread',
  'translation_state',
]);

/** A person, as content names one: enough to find them elsewhere, and no more (EI-F). */
const PARTIAL_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  principal: ['id', 'kind', 'issuer', 'subject', 'display_name'],
};

const WHY_NOT_PARTIAL = 'Held only by an export of the whole environment.';

export interface ExportRequestScope {
  readonly scope: Exclude<ExportScope, 'tenant'>;
  readonly id: string | null;
  readonly followReferences: boolean;
  readonly requestedBy: string;
}

/** What a partial archive names and does not hold, or holds because it was asked to follow (IMP-038). */
export interface ExportReference {
  readonly table: string;
  readonly id: string;
  readonly how: 'by_value' | 'by_identity';
}

interface Kept {
  /** Every value seen, per column another row refers by. */
  readonly columns: Map<string, Set<string>>;
  /** Every combination seen, per set of columns a foreign key refers by. */
  readonly combinations: Map<string, Set<string>>;
}

const text = (value: unknown) => String(value);

/** What the asker may read that the scope starts from, read before the cut, which is read-only. */
export async function readableForExport(
  trx: TenantTransaction,
  principalId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof loadReadableSet>>> | undefined> {
  return loadReadableSet(trx, principalId);
}

async function seedArtifacts(
  trx: TenantTransaction,
  asked: ExportRequestScope,
  readable: NonNullable<Awaited<ReturnType<typeof readableForExport>>>,
): Promise<{
  seeded: Set<string>;
  followed: Set<string>;
  publication: string | undefined;
  request: string | undefined;
}> {
  const seeded = new Set<string>();
  // Definitions always come: a version's digest names them, so it cannot stand without them (EI-R).
  const { rows: definitions } = await sql<{ id: string }>`
    select id from artifact where space_id is null`.execute(trx);
  for (const { id } of definitions) seeded.add(id);
  let publication: string | undefined;
  let request: string | undefined;
  const named = (ids: readonly { id: string }[]) => ids.forEach(({ id }) => seeded.add(id));
  const scoped = readableArtifactsAs('a', readable);
  if (asked.scope === 'space') {
    const { rows } = await sql<{ id: string }>`
      select a.id from artifact a where a.space_id = ${asked.id} and ${scoped}`.execute(trx);
    named(rows);
  } else if (asked.scope === 'document') {
    const { rows } = await sql<{ id: string }>`
      select a.id from artifact a where a.id = ${asked.id} and ${scoped}`.execute(trx);
    named(rows);
  } else if (asked.scope === 'publication') {
    const { rows } = await sql<{ id: string; request_id: string }>`
      select a.id, p.request_id from publication p
        join artifact a on a.id = p.document_id
       where p.id = ${asked.id} and ${scoped}`.execute(trx);
    named(rows);
    if (rows[0]) {
      publication = asked.id ?? undefined;
      request = rows[0].request_id;
      // What it was made from is what it is: its inputs always come.
      const { rows: inputs } = await sql<{ id: string }>`
        select distinct v.artifact_id as id from publication_input i
          join artifact_version v on v.id = i.version_id
          join artifact a on a.id = v.artifact_id
         where i.publication_id = ${asked.id} and ${scoped}`.execute(trx);
      named(inputs);
    }
  }
  const followed = new Set<string>();
  if (asked.followReferences && asked.scope !== 'configuration') {
    for (let grew = true; grew;) {
      grew = false;
      const ids = [...seeded];
      const { rows } = await sql<{ id: string }>`
        select distinct a.id from artifact a
         where ${scoped} and a.id in (
           select r.to_id from reference r where r.from_id = any(${ids}::uuid[])
           union select p.artifact_id from baseline_pin p
             join baseline b on b.id = p.baseline_id where b.document_id = any(${ids}::uuid[])
           union select v.artifact_id from publication_input i
             join publication d on d.id = i.publication_id
             join artifact_version v on v.id = i.version_id
            where d.document_id = any(${ids}::uuid[]))`.execute(trx);
      for (const { id } of rows) {
        if (!seeded.has(id)) {
          seeded.add(id);
          followed.add(id);
          grew = true;
        }
      }
    }
  }
  return { seeded, followed, publication, request };
}

/**
 * The rows of one scope to `lines`, in one read-only cut as a whole export's are. A row needing a row
 * outside the archive through a required key stays out, and one through a key it can do without comes.
 * Either way the row it names is listed in `references` (IMP-038).
 */
export async function readPartialCut(
  trx: TenantTransaction,
  asked: ExportRequestScope,
  readable: NonNullable<Awaited<ReturnType<typeof readableForExport>>>,
  lines: (table: string, lines: readonly string[]) => Promise<void>,
  pageSize = 500,
): Promise<ExportCut & { readonly references: readonly ExportReference[] }> {
  const catalogue = await readExportCatalogue(trx);
  const { seeded, followed, publication, request } = await seedArtifacts(trx, asked, readable);
  const rows: Record<string, number> = {};
  const schema: Record<string, ExportCut['schema'][string]> = {};
  const secrets: { reference: string; kind: string; table: string; holder: string }[] = [];
  const objects = new Set<string>();
  const references = new Map<string, ExportReference>();
  const named = new Map<string, Map<string, Set<string>>>();
  const name = (table: string, column: string, value: string) => {
    const columns = named.get(table) ?? new Map<string, Set<string>>();
    named.set(table, columns);
    const values = columns.get(column) ?? new Set<string>();
    columns.set(column, values);
    values.add(value);
  };
  const kept = new Map<string, Kept>();
  const emit = async (table: string, found: readonly string[]) => {
    for (let at = 0; at < found.length; at += pageSize) {
      await lines(table, found.slice(at, at + pageSize));
    }
    rows[table] = (rows[table] ?? 0) + found.length;
  };

  // Rows reach here through their own keys, so a table's parents are read before it (EI-C).
  const order = insertOrder(catalogue).filter(([table]) => {
    if (!PARTIAL_CONTENT.has(table)) return false;
    return asked.scope !== 'publication' || !NOT_IN_A_PUBLICATION.has(table);
  });
  for (const [table, census] of order) {
    const described = describe(catalogue, table);
    schema[table] = described;
    const parents = catalogue.foreignKeys.filter(
      (fk) =>
        fk.table === table &&
        fk.refers !== table &&
        kept.has(fk.refers) &&
        !fk.columns.some(
          (column) =>
            census.breaksCycleAt?.includes(column) || census.deferredAt?.includes(column),
        ),
    );
    const found = await candidates(trx, catalogue, table, parents, kept, seeded, {
      publication,
      request,
    });
    const keptHere: string[] = [];
    const parsedHere: Record<string, unknown>[] = [];
    for (const { line } of found) {
      const row = JSON.parse(line) as Record<string, unknown>;
      let stays = true;
      for (const fk of parents) {
        const values = fk.columns.map((column) => row[column]);
        if (values.some((value) => value === null || value === undefined)) continue;
        const key = values.map(text).join('\u0000');
        if (kept.get(fk.refers)!.combinations.get(fk.refersBy.join())?.has(key)) continue;
        references.set(`${fk.refers}:${key}`, {
          table: fk.refers,
          id: values.map(text).join(' '),
          how: 'by_identity',
        });
        if (!fk.nullable) stays = false;
      }
      if (!stays) continue;
      keptHere.push(line);
      parsedHere.push(row);
    }
    remember(kept, catalogue, table, parsedHere);
    await emit(table, keptHere);
    if (rows[table] === undefined) rows[table] = 0;
    for (const row of parsedHere) {
      for (const column of census.objects ?? []) {
        if (typeof row[column] === 'string') objects.add(row[column]);
      }
      if (table === 'artifact_version' && row['kind'] === 'asset') {
        const object = (row['content'] as { object?: unknown } | null)?.object;
        if (typeof object === 'string') objects.add(object);
      }
      nameParents(catalogue, table, row, name);
    }
    if (census.secrets) {
      const held = await holdersOf(trx, table, census.secrets, parsedHere, catalogue);
      secrets.push(...held);
    }
  }

  if (asked.scope === 'configuration') {
    for (const [table, census] of carriedTables()) {
      if (!PARTIAL_CONFIGURATION.has(table)) continue;
      schema[table] = describe(catalogue, table);
      const found = await sql<{ line: string }>`
        select (to_jsonb(t) ${dropping(schema[table].notCarried)})::text as line
          from ${sql.id(table)} t order by 1`.execute(trx);
      const parsed = found.rows.map(({ line }) => JSON.parse(line) as Record<string, unknown>);
      await emit(
        table,
        found.rows.map(({ line }) => line),
      );
      rows[table] = found.rows.length;
      for (const row of parsed) nameParents(catalogue, table, row, name);
      if (census.secrets) {
        secrets.push(...(await holdersOf(trx, table, census.secrets, parsed, catalogue)));
      }
    }
  }

  // What was named, parents of parents last: a space names who archived it.
  for (const table of ['space', 'workflow_definition', 'translation_policy_change', 'principal']) {
    if (asked.scope === 'configuration' && PARTIAL_CONFIGURATION.has(table)) continue;
    const columns = named.get(table);
    schema[table] = describe(catalogue, table);
    const ids = columns ? [...new Set([...columns.values()].flatMap((each) => [...each]))] : [];
    const found =
      ids.length === 0
        ? { rows: [] as { line: string }[] }
        : await sql<{ line: string }>`
            select (to_jsonb(t) ${dropping(schema[table].notCarried)})::text as line
              from ${sql.id(table)} t where t.id = any(${ids}::uuid[]) order by 1`.execute(trx);
    for (const { line } of found.rows) {
      nameParents(catalogue, table, JSON.parse(line) as Record<string, unknown>, name);
    }
    await emit(
      table,
      found.rows.map(({ line }) => line),
    );
    rows[table] = found.rows.length;
  }

  for (const id of followed) {
    references.set(`artifact:${id}`, { table: 'artifact', id, how: 'by_value' });
  }
  const facts = await sql<{ cut_at: string; last_migration: string }>`
    select now()::text as cut_at, (select max(version) from schema_migration)::text as last_migration
  `.execute(trx);
  return {
    cutAt: new Date(facts.rows[0]!.cut_at).toISOString(),
    lastMigration: facts.rows[0]!.last_migration,
    rows,
    schema,
    secrets,
    objects: [...objects].sort(),
    references: [...references.values()].sort((a, b) =>
      `${a.table} ${a.id}` < `${b.table} ${b.id}` ? -1 : 1,
    ),
  };
}

/** Every carried table a partial export of this scope does not hold, with why (IMP-020). */
export function partialLeftOut(scope: Exclude<ExportScope, 'tenant'>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [table] of carriedTables()) {
    const holds =
      PARTIAL_CONTENT.has(table) ||
      PARTIAL_REFERENCED.has(table) ||
      (scope === 'configuration' && PARTIAL_CONFIGURATION.has(table));
    if (!holds) out[table] = WHY_NOT_PARTIAL;
  }
  return out;
}

function describe(catalogue: ExportCatalogue, table: string): ExportCut['schema'][string] {
  const census = EXPORT_TABLES[table];
  if (census?.fate !== 'carried') throw new Error(`${table} is not carried`);
  const own = catalogue.columns.filter((column) => column.table === table);
  const only = PARTIAL_COLUMNS[table];
  const notCarried = own
    .filter(
      (column) =>
        column.generated ||
        EXPORT_NOT_CARRIED_COLUMNS.includes(column.name) ||
        census.secrets?.columns.includes(column.name) ||
        (only !== undefined && !only.includes(column.name)),
    )
    .map((column) => column.name);
  return {
    columns: own
      .filter((column) => !notCarried.includes(column.name))
      .map(({ name, type, nullable }) => ({ name, type, nullable })),
    primaryKey: catalogue.primaryKeys.get(table) ?? [],
    foreignKeys: catalogue.foreignKeys
      .filter((fk) => fk.table === table)
      .map((fk) => ({ columns: fk.columns, refers: fk.refers })),
    notCarried,
    identity: census.identity,
  };
}

const dropping = (columns: readonly string[]) =>
  sql.join(
    columns.map((column) => sql`- ${sql.lit(column)}::text`),
    sql` `,
  );

/** The tables in an order where each comes after every table its unbroken keys need. */
export function insertOrder(
  catalogue: ExportCatalogue,
): readonly (readonly [string, Extract<(typeof EXPORT_TABLES)[string], { fate: 'carried' }>])[] {
  const left = new Map(carriedTables());
  const order: (readonly [string, Extract<(typeof EXPORT_TABLES)[string], { fate: 'carried' }>])[] =
    [];
  while (left.size > 0) {
    const ready = [...left].filter(
      ([table, census]) =>
        !catalogue.foreignKeys.some(
          (fk) =>
            fk.table === table &&
            fk.refers !== table &&
            left.has(fk.refers) &&
            !fk.columns.some(
              (column) =>
                census.breaksCycleAt?.includes(column) || census.deferredAt?.includes(column),
            ),
        ),
    );
    if (ready.length === 0) throw new Error(`No order among ${[...left.keys()].join(', ')}`);
    for (const entry of ready) {
      order.push(entry);
      left.delete(entry[0]);
    }
  }
  return order;
}

async function candidates(
  trx: TenantTransaction,
  catalogue: ExportCatalogue,
  table: string,
  parents: ExportCatalogue['foreignKeys'],
  kept: ReadonlyMap<string, Kept>,
  seeded: ReadonlySet<string>,
  only: { readonly publication: string | undefined; readonly request: string | undefined },
): Promise<readonly { readonly line: string }[]> {
  const dropped = dropping(describe(catalogue, table).notCarried);
  const select = sql`select (to_jsonb(t) ${dropped})::text as line from ${sql.id(table)} t`;
  if (table === 'artifact') {
    const { rows } = await sql<{ line: string }>`
      ${select} where t.id = any(${[...seeded]}::uuid[]) order by t.id`.execute(trx);
    return rows;
  }
  const required = parents.find((fk) => !fk.nullable);
  // A row needs at least one parent to belong here. With none required it has no way in (the test).
  if (!required) return [];
  const column = required.columns[0]!;
  const by = required.refersBy[0]!;
  const values = [...(kept.get(required.refers)!.columns.get(by) ?? [])];
  if (values.length === 0) return [];
  const type = catalogue.columns.find((each) => each.table === table && each.name === column)!.type;
  const extra =
    table === 'publication' && only.publication
      ? sql`and t.id = ${only.publication}`
      : table === 'thread'
        ? sql`and not exists (select from thread_internal i where i.thread_id = t.id)`
        : sql``;
  const { rows } = await sql<{ line: string }>`
    ${select} where t.${sql.id(column)} = any(${values}::${sql.raw(type)}[]) ${extra} order by 1`.execute(
    trx,
  );
  if (table === 'publication_request' && only.request) {
    return rows.filter(({ line }) => (JSON.parse(line) as { id: string }).id === only.request);
  }
  return rows;
}

function remember(
  kept: Map<string, Kept>,
  catalogue: ExportCatalogue,
  table: string,
  rows: readonly Record<string, unknown>[],
) {
  const held: Kept = { columns: new Map(), combinations: new Map() };
  const combinations = new Set(
    catalogue.foreignKeys.filter((fk) => fk.refers === table).map((fk) => fk.refersBy.join()),
  );
  for (const combination of combinations) {
    const columns = combination.split(',');
    const values = new Set<string>();
    held.combinations.set(combination, values);
    for (const row of rows) values.add(columns.map((column) => text(row[column])).join('\u0000'));
    for (const column of columns) {
      const each = held.columns.get(column) ?? new Set<string>();
      held.columns.set(column, each);
      for (const row of rows) each.add(text(row[column]));
    }
  }
  kept.set(table, held);
}

function nameParents(
  catalogue: ExportCatalogue,
  table: string,
  row: Record<string, unknown>,
  name: (table: string, column: string, value: string) => void,
) {
  for (const fk of catalogue.foreignKeys) {
    if (fk.table !== table || !PARTIAL_REFERENCED.has(fk.refers)) continue;
    const value = row[fk.columns[0]!];
    if (value !== null && value !== undefined) name(fk.refers, fk.refersBy[0]!, text(value));
  }
}

async function holdersOf(
  trx: TenantTransaction,
  table: string,
  secret: NonNullable<Extract<(typeof EXPORT_TABLES)[string], { fate: 'carried' }>['secrets']>,
  rows: readonly Record<string, unknown>[],
  catalogue: ExportCatalogue,
) {
  const holders = [...new Set(rows.map((row) => text(row[secret.holder])))];
  if (holders.length === 0) return [];
  const type = catalogue.columns.find(
    (column) => column.table === table && column.name === secret.holder,
  )!.type;
  const { rows: held } = await sql<{ holder: string }>`
    select distinct ${sql.ref(secret.holder)}::text as holder from ${sql.id(table)}
     where ${sql.ref(secret.holder)} = any(${holders}::${sql.raw(type)}[])
       and ${sql.ref(secret.columns[0]!)} is not null order by 1`.execute(trx);
  return held.map(({ holder }) => ({
    reference: `${secret.kind}:${holder}`,
    kind: secret.kind,
    table,
    holder,
  }));
}
