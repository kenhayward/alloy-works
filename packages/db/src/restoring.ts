import { starterRoles, type AuditContext } from '@alloy-works/domain';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { holdObject, objectInUse } from './assets.js';
import { auditContextSetting, AUDIT_SETTING, recordEvent } from './audit.js';
import { insertOrder } from './export-scope.js';
import type { ImportReport } from './restoring-part.js';
import { EXPORT_TABLES, type CarriedTable } from './export-tables.js';
import { assertTenantRole } from './names.js';
import { createPool } from './pool.js';
import type { Tenant } from './provision.js';
import { enqueueJob } from './queue.js';
import { reindexSearch } from './search.js';
import type { TenantTransaction } from './tables.js';
import { readExportCatalogue } from './tenant-export.js';

/**
 * **A tenant restored from its export** (IMP-039, IMP-052, ADM-054; EI-D to EI-N). An administrator
 * uploads an archive, a job checks it and says what it would do, the administrator answers for each
 * secret and each identity, and a job applies all of it or nothing. Only the `restorer` process holds
 * the login that can become a tenant's owner, which is what lets history past the live triggers.
 */

export type RestorationState =
  'awaiting_archive' | 'checking' | 'previewed' | 'refused' | 'applying' | 'restored' | 'failed';

/** What the check found, shown before anything is changed. */
export interface RestorationPlan {
  readonly format: number;
  readonly scope: string;
  readonly cutAt: string;
  readonly tables: Readonly<Record<string, number>>;
  readonly missingObjects: readonly string[];
  /** Each secret's holder: every one needs an answer (ADM-054). */
  readonly secrets: readonly { readonly reference: string; readonly kind: string }[];
  /** Each issuer the archive's people sign in by, and how many (IMP-046). */
  readonly issuers: readonly { readonly issuer: string; readonly people: number }[];
  readonly groups: number;
  readonly externals: number;
  readonly serviceIdentities: number;
  readonly leftOut: Readonly<Record<string, string>>;
  readonly rebuilt: Readonly<Record<string, string>>;
  /** A part's dry run: what it would add and leave in this tenant as it stood. */
  readonly would?: ImportReport;
}

/** What the administrator answered. */
export interface RestorationAnswers {
  /** Every issuer: another this tenant has, or null to keep it, those people unable to sign in. */
  readonly issuers: Readonly<Record<string, string | null>>;
  /** Every reference named here arrives switched off, with no credential. */
  readonly switchedOff: readonly string[];
}

export interface TenantRestoration {
  readonly id: string;
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly state: RestorationState;
  readonly objectKey: string | null;
  readonly sha256: string | null;
  readonly plan: RestorationPlan | null;
  readonly answers: RestorationAnswers | null;
  readonly refusal: { readonly code: string; readonly message: string } | null;
  readonly report: ImportReport | null;
  readonly finishedAt: Date | null;
}

interface Row {
  id: string;
  requested_by: string;
  requested_at: Date;
  state: RestorationState;
  object_key: string | null;
  sha256: string | null;
  plan: RestorationPlan | null;
  answers: RestorationAnswers | null;
  refusal: TenantRestoration['refusal'];
  report: ImportReport | null;
  finished_at: Date | null;
}

const restorationOf = (row: Row): TenantRestoration => ({
  id: row.id,
  requestedBy: row.requested_by,
  requestedAt: row.requested_at,
  state: row.state,
  objectKey: row.object_key,
  sha256: row.sha256,
  plan: row.plan,
  answers: row.answers,
  refusal: row.refusal,
  report: row.report,
  finishedAt: row.finished_at,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function createRestoration(
  trx: TenantTransaction,
  principalId: string,
): Promise<TenantRestoration> {
  const { rows } = await sql<Row>`
    insert into restoration (requested_by) values (${principalId}) returning *`.execute(trx);
  return restorationOf(rows[0]!);
}

export async function readRestoration(
  trx: TenantTransaction,
  id: string,
): Promise<TenantRestoration | undefined> {
  if (!UUID.test(id)) return undefined;
  const { rows } = await sql<Row>`select * from restoration where id = ${id}`.execute(trx);
  return rows[0] && restorationOf(rows[0]);
}

/** The newest few, for the page to pick up where it left off. */
export async function listRestorations(trx: TenantTransaction): Promise<TenantRestoration[]> {
  const { rows } = await sql<Row>`
    select * from restoration order by requested_at desc, id desc limit 20`.execute(trx);
  return rows.map(restorationOf);
}

/** The archive is in the store: a job checks it. Once, while it waits. */
export async function receiveRestorationArchive(
  trx: TenantTransaction,
  id: string,
  stored: { readonly key: string; readonly sha256: string },
): Promise<TenantRestoration | undefined> {
  const { rows } = await sql<Row>`
    update restoration set object_key = ${stored.key}, sha256 = ${stored.sha256}, state = 'checking'
     where id = ${id} and state = 'awaiting_archive' returning *`.execute(trx);
  if (!rows[0]) return undefined;
  await enqueueJob(trx, 'restoration', id);
  return restorationOf(rows[0]);
}

export async function recordRestorationPlan(
  trx: TenantTransaction,
  id: string,
  plan: RestorationPlan,
): Promise<void> {
  await sql`update restoration set plan = ${JSON.stringify(plan)}::jsonb, state = 'previewed'
    where id = ${id} and state = 'checking'`.execute(trx);
}

export async function refuseRestoration(
  trx: TenantTransaction,
  id: string,
  refusal: { readonly code: string; readonly message: string },
  state: 'refused' | 'failed' = 'refused',
): Promise<boolean> {
  const { rows } = await sql<{ id: string }>`update restoration
       set refusal = ${JSON.stringify(refusal)}::jsonb, state = ${state}, finished_at = now()
     where id = ${id} and state in ('checking', 'applying', 'previewed') returning id`.execute(trx);
  return rows.length > 0;
}

export async function answerRestoration(
  trx: TenantTransaction,
  id: string,
  answers: RestorationAnswers,
): Promise<TenantRestoration | undefined> {
  const { rows } = await sql<Row>`
    update restoration set answers = ${JSON.stringify(answers)}::jsonb
     where id = ${id} and state = 'previewed' returning *`.execute(trx);
  return rows[0] && restorationOf(rows[0]);
}

/** Answered in full: it goes to the job, which checks everything again under its locks. */
export async function beginRestoration(
  trx: TenantTransaction,
  id: string,
): Promise<TenantRestoration | undefined> {
  const { rows } = await sql<Row>`
    update restoration set state = 'applying' where id = ${id} and state = 'previewed' returning *`.execute(
    trx,
  );
  if (!rows[0]) return undefined;
  await enqueueJob(trx, 'restoration', id);
  return restorationOf(rows[0]);
}

export async function recordRestorationReport(
  trx: TenantTransaction,
  id: string,
  report: ImportReport,
): Promise<void> {
  await sql`update restoration set report = ${JSON.stringify(report)}::jsonb where id = ${id}`.execute(
    trx,
  );
}

export async function finishRestoration(trx: TenantTransaction, id: string): Promise<void> {
  await sql`update restoration set state = 'restored', finished_at = now()
    where id = ${id} and state = 'applying'`.execute(trx);
}

/**
 * Whether a whole archive may go here: `empty`, or the first thing that is not (EI-E). Empty cannot
 * mean no events: provisioning and the restorer's own sign-in write some, and a stranger's failed
 * sign-in may. So it is what a person has done here, and that nothing has been restored before.
 */
export async function tenantIsEmpty(
  trx: TenantTransaction,
  restorer: string,
): Promise<'empty' | string> {
  const { rows } = await sql<{ why: string }>`
    select why from (
      select 'an earlier restore' as why where exists (select from tenant_restore)
      union all select 'a person other than you' where exists (
        select from principal where id <> ${restorer})
      union all select 'something made by a person' where exists (
        select from artifact_version where author_id is not null)
      union all select 'content in a space' where exists (
        select from artifact where space_id is not null)
      union all select 'a space other than General' where exists (
        select from space where name <> 'General' or archived_at is not null)
      union all select 'access given to someone else' where exists (
        select from access_grant where principal_id is distinct from ${restorer})
      union all select 'a model endpoint' where exists (select from model_endpoint)
      union all select 'a group' where exists (select from access_group)
      union all select 'a role someone made' where exists (
        select from role where name <> all(${[...starterRoles.map((each) => each.name), 'Connection user', 'Shared reader']}::text[]))
      union all select 'a token' where exists (select from api_token)
      union all select 'a webhook' where exists (select from webhook_subscription)
      union all select 'a mail channel' where exists (select from mail_channel)
      union all select 'an extension' where exists (select from extension)
      union all select 'an act by someone else' where exists (
        select from audit_event
         where actor_kind in ('person', 'token') and actor is distinct from ${restorer})
    ) found limit 1`.execute(trx);
  return rows[0]?.why ?? 'empty';
}

/** Whether this tenant was restored and nobody has yet looked at what falls due (EI-M). */
export async function restoreUnderReview(trx: TenantTransaction): Promise<boolean> {
  const { rows } = await sql<{ held: boolean }>`
    select exists (select from tenant_restore where due_reviewed_at is null) as held`.execute(trx);
  return rows[0]!.held;
}

/** The restore, and what the sweeps would act on the moment they run again. */
export async function restoreReview(trx: TenantTransaction): Promise<{
  readonly restoredAt: Date | null;
  readonly underReview: boolean;
  readonly datesPast: number;
  readonly reviewDatesPast: number;
} | null> {
  const { rows } = await sql<{
    restored_at: Date;
    due_reviewed_at: Date | null;
    dates_past: number;
    review_dates_past: number;
  }>`
    select r.restored_at, r.due_reviewed_at,
           (select count(*)::int from revision_effective e
             where e.effective_at <= now()
               and not exists (select from revision_effected d where d.version_id = e.version_id))
             as dates_past,
           (select count(*)::int from artifact_dates d where d.review_by <= now())
             as review_dates_past
      from tenant_restore r limit 1`.execute(trx);
  const row = rows[0];
  return row
    ? {
        restoredAt: row.restored_at,
        underReview: row.due_reviewed_at === null,
        datesPast: row.dates_past,
        reviewDatesPast: row.review_dates_past,
      }
    : null;
}

/** The review ended: its restoration once, where one was open. The sweeps act from now on. */
export async function endRestoreReview(
  trx: TenantTransaction,
  by: string,
): Promise<string | undefined> {
  const { rows } = await sql<{ restoration_id: string }>`
    update tenant_restore set due_reviewed_at = now(), due_reviewed_by = ${by}
     where due_reviewed_at is null returning restoration_id`.execute(trx);
  return rows[0]?.restoration_id;
}

/** Archives past their seven days (IMP-044): the keys, for the sweep to remove before forgetting. */
export async function expiredRestorationArchives(
  trx: TenantTransaction,
  now: Date,
): Promise<readonly { readonly id: string; readonly key: string; readonly sha256: string }[]> {
  const { rows } = await sql<{ id: string; key: string; sha256: string }>`
    select id, object_key as key, sha256 from restoration
     where object_key is not null and requested_at < ${now}::timestamptz - interval '7 days'
       and state not in ('checking', 'applying')`.execute(trx);
  return rows;
}

export async function forgetRestorationArchive(trx: TenantTransaction, id: string): Promise<void> {
  await sql`update restoration set object_key = null where id = ${id}`.execute(trx);
}

/**
 * A job given up with nobody to say so: the worker may be who notices, and has no handler for this
 * kind. Answers whether a row moved.
 */
export async function restorationJobGaveUp(trx: TenantTransaction, id: string): Promise<boolean> {
  const { rows } = await sql<{ id: string }>`
    update restoration
       set state = 'failed', finished_at = now(),
           refusal = ${JSON.stringify({
             code: 'restore_failed',
             message: 'It could not be finished. Nothing was changed.',
           })}::jsonb
     where id = ${id} and state in ('checking', 'applying') returning id`.execute(trx);
  return rows.length > 0;
}

/** The newest migration this tenant has run: an archive from past it cannot be read here (EI-K). */
export async function lastMigration(trx: TenantTransaction): Promise<string> {
  const { rows } = await sql<{ version: string }>`
    select max(version)::text as version from schema_migration`.execute(trx);
  return rows[0]!.version;
}

export interface RestorerDatabase {
  /** One transaction as the tenant's owner: the only way past a live trigger (EI-L). */
  asOwner<T>(tenant: Tenant, work: (trx: TenantTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Connects by `aw_restorer`, the one login that may become a tenant's owner. The worker has not it. */
export function createRestorerDatabase(url: string): RestorerDatabase {
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: createPool({ connectionString: url, max: 2 }) }),
  });
  return {
    async asOwner(tenant, work) {
      const role = assertTenantRole(tenant.role);
      const schema = assertTenantRole(tenant.schema);
      return db.transaction().execute(async (trx) => {
        await sql`set local role ${sql.id(`${role}_owner`)}`.execute(trx);
        await sql`select set_config('search_path', ${`${schema}, extensions`}, true)`.execute(trx);
        return work(trx as unknown as TenantTransaction);
      });
    },
    close: () => db.destroy(),
  };
}

/** An archive's rows, a page of JSON lines at a time, as the restorer read them from disk. */
export interface RestoreSource {
  /** The columns the archive holds of a table, as its own schema says. Undefined where it has none. */
  columns(table: string): readonly string[] | undefined;
  pages(table: string): AsyncIterable<readonly string[]>;
}

const CREDENTIALS: ReadonlySet<string> = new Set([
  'connection_credential',
  'extension_credential',
  'model_credential',
]);
/** Kept through the wipe and dealt with by hand: the restorer signed in as one of these. */
const NOT_WIPED: ReadonlySet<string> = new Set([
  'audit_event',
  'audit_label',
  'audit_restored',
  'identity_provider',
  'principal',
]);

const parse = (line: string) => JSON.parse(line) as Record<string, unknown>;

/**
 * The whole archive, in the transaction `asOwner` opened: all of it or nothing (IMP-042, EI-L). Empty
 * is read again here, under the locks that disabling triggers takes, and it is what makes the wipe
 * lose nothing, so ids stay as they were and nothing is remapped but the log's sequence (EI-H).
 */
export async function applyWholeRestore(
  trx: TenantTransaction,
  input: {
    readonly tenant: Tenant;
    readonly restorationId: string;
    readonly restorer: string;
    readonly answers: RestorationAnswers;
    readonly source: RestoreSource;
    readonly auditContext: AuditContext;
  },
): Promise<void> {
  const { source, answers, restorer } = input;
  // One idle session on one of 170 tables is a job to try again, not a tenant stopped.
  await sql`set local lock_timeout = '30s'`.execute(trx);
  const catalogue = await readExportCatalogue(trx);
  const everyTable = [...new Set(catalogue.columns.map((column) => column.table))];
  for (const table of everyTable) {
    await sql`alter table ${sql.id(table)} disable trigger user`.execute(trx);
  }
  // A rule about the row itself holds through a restore (EI-K): an erased label stays erased.
  await sql`alter table audit_label enable trigger audit_label_erased_on_write`.execute(trx);
  const empty = await tenantIsEmpty(trx, restorer);
  if (empty !== 'empty') throw new RestoreRefused('tenant_not_empty', empty);
  await sql`set constraints all deferred`.execute(trx);

  const { rows: me } = await sql<{ issuer: string | null; subject: string | null }>`
    select issuer, subject from principal where id = ${restorer}`.execute(trx);
  const { rows: providers } = await sql<LocalProvider>`
    select issuer, name, client_id, secret_name, sealed_secret, groups_claim, scim_claim, closed_at,
           managed_by_organisation
      from identity_provider`.execute(trx);

  const wipe = Object.entries(EXPORT_TABLES)
    .filter(([name, table]) => table.fate !== 'leftOut' && !NOT_WIPED.has(name))
    .map(([name]) => name);
  await sql`truncate ${sql.join(wipe.map((name) => sql.id(name)))} cascade`.execute(trx);

  // People: the restorer's fresh self gives way where the archive holds them (EI-N).
  const mappedIssuer = (issuer: string | null) =>
    issuer !== null && answers.issuers[issuer] != null ? answers.issuers[issuer]! : issuer;
  let restoredSelf: string | undefined;
  for await (const page of source.pages('principal')) {
    for (const line of page) {
      const row = parse(line);
      if (
        mappedIssuer(row['issuer'] as string | null) === me[0]?.issuer &&
        row['subject'] === me[0]?.subject
      ) {
        restoredSelf = row['id'] as string;
      }
    }
  }
  await sql`update principal set provider_id = null, provider_key = null where id = ${restorer}`.execute(
    trx,
  );
  const archiveIssuers = new Set<string>();
  for await (const page of source.pages('identity_provider')) {
    for (const line of page) archiveIssuers.add(parse(line)['issuer'] as string);
  }
  await sql`delete from identity_provider where issuer = any(${[...archiveIssuers]}::text[])`.execute(
    trx,
  );
  if (restoredSelf !== undefined) {
    await sql`update principal
         set subject = 'superseded-' || id::text
       where id = ${restorer}`.execute(trx);
    await sql`delete from session where principal_id = ${restorer}`.execute(trx);
  }

  const identityTables = new Set(
    (
      await sql<{ table_name: string }>`
        select table_name from information_schema.columns
         where table_schema = current_schema() and identity_generation is not null`.execute(trx)
    ).rows.map((row) => row.table_name),
  );

  const remapped = new Map<number, number>();
  const { rows: top } = await sql<{ top: string }>`
    select coalesce(max(sequence), 0)::text as top from audit_event`.execute(trx);
  let nextSequence = Number(top[0]!.top);

  const people = new Set<string>();
  const transform = (table: string, row: Record<string, unknown>) => {
    // Only a version's content keeps the prefix it was written under, inside its digest (EI-P).
    for (const column of ['object_key', 'preview_key', 'report_key']) {
      const key = row[column];
      if (typeof key === 'string' && key.includes('/sha256/')) {
        row[column] = `${input.tenant.role}/sha256/${key.slice(key.lastIndexOf('/') + 1)}`;
      }
    }
    if (table === 'principal') {
      row['issuer'] = mappedIssuer(row['issuer'] as string | null);
      if (row['issuer'] !== null && row['subject'] !== null) {
        const person = `${String(row['issuer'])} ${String(row['subject'])}`;
        if (people.has(person)) {
          throw new RestoreRefused(
            'issuer_mapping_collides',
            'Two people would become one by that choice of provider.',
          );
        }
        people.add(person);
      }
    } else if (table === 'identity_provider') {
      // Who signs in here is this tenant's to say: never what an archive's row says (ADM-054).
      row['scim_identity'] = null;
      // A copy arrives an ordinary closed provider (TL-M), and a mark means nothing away from its tenants.
      if (row['managed_by_organisation'] === true) row['closed_at'] = new Date().toISOString();
      row['shared'] = false;
      row['managed_by_organisation'] = false;
      row['closed_at'] ??= new Date().toISOString();
      const others = providers.filter((each) => each.issuer !== row['issuer']);
      if (others.some((each) => each.name === row['name'])) {
        row['name'] = `${String(row['name'])} (restored)`;
      }
    } else if (table === 'mail_channel') {
      row['enabled'] = false;
      // Nor is it failing here, nor was anybody here told so (the EM plan's final review).
      row['failing_since'] = null;
      row['told_at'] = null;
    } else if (table === 'webhook_subscription') {
      row['disabled_at'] = new Date().toISOString();
      row['disabled_reason'] = 'restored';
    } else if (table === 'audit_event') {
      nextSequence += 1;
      remapped.set(Number(row['sequence']), nextSequence);
      row['original_sequence'] = row['sequence'];
      row['sequence'] = nextSequence;
    } else if (table === 'audit_label') {
      const sequence = remapped.get(Number(row['sequence']));
      if (sequence === undefined) {
        throw new RestoreRefused('export_invalid', 'A label names an event the archive lacks.');
      }
      row['sequence'] = sequence;
    }
    return row;
  };

  const earlier = new Map<number, number>();
  for await (const page of source.pages('audit_restored')) {
    for (const line of page) {
      const row = parse(line);
      earlier.set(Number(row['sequence']), Number(row['original_sequence']));
    }
  }

  const order = insertOrder(catalogue);
  for (const [table, census] of order) {
    if (CREDENTIALS.has(table) || table === 'audit_restored') continue;
    const columns = source.columns(table);
    if (!columns) continue;
    const breaking = breaksOf(census);
    const list = columns.filter(
      (column) => !(table === 'audit_event' && column === 'original_sequence'),
    );
    const extra = table === 'webhook_subscription' ? ['disabled_at', 'disabled_reason'] : [];
    const written = [...new Set([...list, ...extra])];
    const named = sql.join(written.map((column) => sql.id(column)));
    for await (const page of source.pages(table)) {
      const rows = page.map((line) => {
        const row = transform(table, parse(line));
        for (const column of breaking) row[column] = null;
        return row;
      });
      await sql`insert into ${sql.id(table)} (${named})
        ${identityTables.has(table) ? sql`overriding system value` : sql``}
        select ${named} from jsonb_populate_recordset(null::${sql.id(table)}, ${JSON.stringify(rows)}::jsonb)`.execute(
        trx,
      );
      if (table === 'audit_event') {
        const restored = rows.map((row) => ({
          sequence: row['sequence'],
          original_sequence:
            earlier.get(Number(row['original_sequence'])) ?? row['original_sequence'],
          restore_id: input.restorationId,
        }));
        await sql`insert into audit_restored (sequence, original_sequence, restore_id)
          select sequence, original_sequence, restore_id
            from jsonb_populate_recordset(null::audit_restored, ${JSON.stringify(restored)}::jsonb)`.execute(
          trx,
        );
      }
    }
  }

  // The second pass: what a cycle kept out of the first (EI-C).
  for (const [table, census] of order) {
    const breaking = breaksOf(census);
    if (breaking.length === 0 || CREDENTIALS.has(table) || !source.columns(table)) continue;
    const key = catalogue.primaryKeys.get(table) ?? [];
    for await (const page of source.pages(table)) {
      const rows = page.map(parse).filter((row) => breaking.some((column) => row[column] !== null));
      if (rows.length === 0) continue;
      const assignments = sql.join(
        breaking.map((column) => sql`${sql.id(column)} = x.${sql.id(column)}`),
      );
      const matching = sql.join(
        key.map((column) => sql`t.${sql.id(column)} = x.${sql.id(column)}`),
        sql` and `,
      );
      await sql`update ${sql.id(table)} t set ${assignments}
        from jsonb_populate_recordset(null::${sql.id(table)}, ${JSON.stringify(rows)}::jsonb) x
       where ${matching}`.execute(trx);
    }
  }

  await restoreIdentities(trx, {
    answers,
    providers,
    restorer,
    restoredSelf,
    archiveIssuers,
    switchedOff: answers.switchedOff,
    me: me[0]!,
  });

  if (restoredSelf !== undefined) {
    // Superseded by who they were, the archive's record of them, which now holds their sign-in.
    await sql`update principal set disabled_at = now(), disabled_by = 'person'
       where id = ${restorer}`.execute(trx);
  }
  // Whoever did this can administer what they did it to, or none of it happened (IN-B, EI-N).
  const { rows: held } = await sql<{ holds: boolean }>`
    select exists (
      select from access_grant g
        join role r on r.id = g.role_id
        join principal p on p.id = g.principal_id
       where g.principal_id = ${restoredSelf ?? restorer}
         and g.level = 'tenant' and g.effect = 'allow'
         and (g.expires_at is null or g.expires_at > now())
         and p.disabled_at is null and p.erased_at is null
         and 'administer' = any(r.permissions)
    ) as holds`.execute(trx);
  if (!held[0]!.holds) {
    throw new RestoreRefused(
      'restorer_would_not_administer',
      'After this, you could not administer this environment, so nothing was changed.',
    );
  }
  await switchExtensionsOff(trx);

  // Every generated key goes on from where the archive stopped.
  await setSequences(trx);
  await sql`set constraints all immediate`.execute(trx);
  for (const table of everyTable) {
    await sql`alter table ${sql.id(table)} enable trigger user`.execute(trx);
  }

  // From here it is the tenant's own role, as any other work is.
  await sql`set local role ${sql.id(assertTenantRole(input.tenant.role))}`.execute(trx);
  await sql`select set_config(${AUDIT_SETTING}, ${auditContextSetting(input.auditContext)}, true)`.execute(
    trx,
  );
  await sql`insert into tenant_restore (restoration_id) values (${input.restorationId})`.execute(
    trx,
  );
  await finishRestoration(trx, input.restorationId);
  await reindexSearch(trx, 'whole');
  await recordEvent(trx, {
    kind: 'import.restored',
    subject: { kind: 'restoration', id: input.restorationId },
    detail: { restoration: input.restorationId, events: remapped.size },
  });
}

/** Refused while applying: said to the administrator, and nothing has changed. */
export class RestoreRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface LocalProvider {
  readonly issuer: string;
  readonly name: string;
  readonly client_id: string;
  readonly secret_name: string;
  readonly sealed_secret: string | null;
  readonly groups_claim: string;
  readonly scim_claim: string;
  readonly closed_at: Date | null;
  readonly managed_by_organisation: boolean;
}

/** An extension may call out with no secret at all, so its switch goes off too (ADM-054). */
export async function switchExtensionsOff(
  trx: TenantTransaction,
  only?: readonly string[],
): Promise<void> {
  await sql`insert into reference_source_policy (source, enabled)
    select 'ext:' || id::text, false from extension
     where ${only === undefined ? sql`true` : sql`id = any(${[...only]}::uuid[])`}
    on conflict (source) do update set enabled = false`.execute(trx);
}

/**
 * Whether anything else needs an archive's bytes: a key is the bytes' hash, so a restoration, an export,
 * an asset and an import of one file share it. Asked under `holdObject`.
 */
export async function archiveHeldElsewhere(
  trx: TenantTransaction,
  archive: { readonly key: string; readonly sha256: string },
  except: { readonly restoration?: string; readonly tenantExport?: string },
): Promise<boolean> {
  await holdObject(trx, archive.sha256);
  const { rows } = await sql<{ held: boolean }>`
    select exists (select from restoration where object_key = ${archive.key}
                    and id is distinct from ${except.restoration ?? null}::uuid)
        or exists (select from tenant_export where object_key = ${archive.key}
                    and id is distinct from ${except.tenantExport ?? null}::uuid)
        or exists (select from import where object_key = ${archive.key}) as held`.execute(trx);
  return (
    rows[0]!.held || (await objectInUse(trx, archive.key, '00000000-0000-0000-0000-000000000000'))
  );
}

const breaksOf = (census: CarriedTable): readonly string[] => census.breaksCycleAt ?? [];

async function restoreIdentities(
  trx: TenantTransaction,
  input: {
    readonly answers: RestorationAnswers;
    readonly providers: readonly LocalProvider[];
    readonly restorer: string;
    readonly restoredSelf: string | undefined;
    readonly archiveIssuers: ReadonlySet<string>;
    readonly switchedOff: readonly string[];
    readonly me: { readonly issuer: string | null };
  },
) {
  const { providers, restorer, restoredSelf, archiveIssuers, answers, me } = input;
  // A provider this tenant already signs in by keeps this tenant's secret: that is its binding. Any
  // other arrives closed, with none (ADM-054).
  for (const issuer of archiveIssuers) {
    const here = providers.find((each) => each.issuer === issuer);
    if (here) {
      await sql`update identity_provider
           set name = ${here.name}, client_id = ${here.client_id}, secret_name = ${here.secret_name},
               sealed_secret = ${here.sealed_secret}, groups_claim = ${here.groups_claim},
               scim_claim = ${here.scim_claim}, closed_at = ${here.closed_at},
               managed_by_organisation = ${here.managed_by_organisation}
         where issuer = ${issuer}`.execute(trx);
    } else {
      await sql`update identity_provider set closed_at = now() where issuer = ${issuer}`.execute(
        trx,
      );
    }
  }
  // Each person mapped signs in by the provider they were mapped to; an actor is never reassigned.
  for (const [from, to] of Object.entries(answers.issuers)) {
    if (to === null) continue;
    await sql`update principal
         set provider_id = (select id from identity_provider where issuer = ${to}), provider_key = null
       where issuer = ${to} and provider_id in (select id from identity_provider where issuer = ${from})`.execute(
      trx,
    );
  }
  if (restoredSelf === undefined) {
    await sql`update principal
         set provider_id = (select id from identity_provider where issuer = ${me.issuer})
       where id = ${restorer}`.execute(trx);
    // They were not in it, so they keep the environment: nobody is locked out (IN-B).
    await sql`insert into access_grant (principal_id, role_id, level, effect, granted_by)
      select ${restorer}::uuid, id, 'tenant', 'allow', ${restorer}::uuid from role
       where name = 'Administrator' and 'administer' = any(permissions)`.execute(trx);
  }
}

async function setSequences(trx: TenantTransaction) {
  const { rows } = await sql<{ table_name: string; column_name: string }>`
    select table_name, column_name from information_schema.columns
     where table_schema = current_schema() and identity_generation is not null`.execute(trx);
  for (const { table_name: table, column_name: column } of rows) {
    await sql`select setval(pg_get_serial_sequence(${table}, ${column}),
        greatest(coalesce(max(${sql.id(column)}), 0), 1), max(${sql.id(column)}) is not null)
      from ${sql.id(table)}`.execute(trx);
  }
}
