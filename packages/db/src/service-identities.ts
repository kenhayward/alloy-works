import { sql } from 'kysely';
import { labelled, labels, recordEvent } from './audit.js';
import { checkedPage, isPageCursor, paged, type Page, type PageRequest } from './paging.js';
import type { TenantTransaction } from './tables.js';
import { disableIdentitySubscriptions } from './webhooks.js';

/**
 * A service identity (IAM-033; the G8 plan, G8-G): a principal of kind `service` an administrator
 * made, with no issuer, subject or address, so no sign-in finds it and no invitation claims it (0138).
 */
export interface ServiceIdentity {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly createdBy: string | null;
  readonly createdAt: Date;
  readonly disabledAt: Date | null;
  /** Its tokens that have not been revoked, expired ones included. */
  readonly tokens: number;
}

function query(trx: TenantTransaction) {
  return trx
    .selectFrom('service_identity as s')
    .innerJoin('principal as p', 'p.id', 's.principal_id')
    .select([
      's.principal_id as id',
      'p.display_name as name',
      's.description',
      's.created_by',
      's.created_at',
      's.disabled_at',
    ])
    .select(
      sql<string>`(select count(*) from api_token t where t.principal_id = s.principal_id)`.as(
        'tokens',
      ),
    );
}

type Row = Awaited<ReturnType<ReturnType<typeof query>['executeTakeFirstOrThrow']>>;

function identity(row: Row): ServiceIdentity {
  return {
    id: row.id,
    name: row.name ?? '',
    description: row.description,
    createdBy: row.created_by,
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
    tokens: Number(row.tokens),
  };
}

async function record(
  trx: TenantTransaction,
  kind: 'service_identity.created' | 'service_identity.renamed' | 'service_identity.disabled',
  id: string,
  name: string,
  detail: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  await recordEvent(
    trx,
    { kind, subject: { kind: 'principal', id }, detail },
    labels(labelled('subject', name, id)),
  );
}

/** Makes a service identity: its principal, then its row, recorded as the caller's act. */
export async function createServiceIdentity(
  trx: TenantTransaction,
  input: { readonly name: string; readonly description: string; readonly by: string | null },
): Promise<ServiceIdentity> {
  const principal = await trx
    .insertInto('principal')
    .values({ issuer: null, subject: null, email: null, display_name: input.name, kind: 'service' })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('service_identity')
    .values({
      principal_id: principal.id,
      description: input.description,
      created_by: input.by,
    })
    .execute();
  await record(trx, 'service_identity.created', principal.id, input.name);
  return (await serviceIdentity(trx, principal.id))!;
}

/** One service identity, or undefined where this tenant holds none by that id. */
export async function serviceIdentity(
  trx: TenantTransaction,
  id: string,
  options: { readonly lock?: boolean } = {},
): Promise<ServiceIdentity | undefined> {
  let found = query(trx).where('s.principal_id', '=', id);
  if (options.lock === true) found = found.forUpdate('s');
  const row = await found.executeTakeFirst();
  return row ? identity(row) : undefined;
}

/** The tenant's service identities, a page at a time, by id. */
export async function listServiceIdentities(
  trx: TenantTransaction,
  request: PageRequest,
): Promise<Page<ServiceIdentity>> {
  const page = checkedPage(request);
  if (page.after !== undefined && !isPageCursor(page.after)) return { items: [], after: null };
  const rows = await query(trx)
    .$if(page.after !== undefined, (each) => each.where('s.principal_id', '>', page.after!))
    .orderBy('s.principal_id')
    .limit(page.limit + 1)
    .execute();
  return paged(rows.map(identity), page.limit);
}

/** Renames a service identity or changes its description; undefined where there is none. */
export async function changeServiceIdentity(
  trx: TenantTransaction,
  id: string,
  change: { readonly name?: string; readonly description?: string },
): Promise<ServiceIdentity | undefined> {
  const held = await serviceIdentity(trx, id, { lock: true });
  if (!held) return undefined;
  if (change.name !== undefined && change.name !== held.name) {
    await trx
      .updateTable('principal')
      .set({ display_name: change.name })
      .where('id', '=', id)
      .execute();
  }
  if (change.description !== undefined && change.description !== held.description) {
    await trx
      .updateTable('service_identity')
      .set({ description: change.description })
      .where('principal_id', '=', id)
      .execute();
  }
  const changed = (await serviceIdentity(trx, id))!;
  if (changed.name !== held.name || changed.description !== held.description) {
    await record(trx, 'service_identity.renamed', id, changed.name);
  }
  return changed;
}

/**
 * Disables a service identity: every token it holds revoked at once (IAM-035), recorded each as a
 * revocation, and no more issued. The principal stays, for the audit and its grants' history. The ids
 * of the tokens revoked, for the caller to tell every replica; undefined where there is none.
 */
export async function disableServiceIdentity(
  trx: TenantTransaction,
  id: string,
): Promise<
  { readonly identity: ServiceIdentity; readonly revoked: readonly string[] } | undefined
> {
  const held = await serviceIdentity(trx, id, { lock: true });
  if (!held) return undefined;
  if (held.disabledAt !== null) return { identity: held, revoked: [] };
  const tokens = await trx
    .selectFrom('api_token')
    .select(['id', 'name'])
    .where('principal_id', '=', id)
    .forUpdate()
    .execute();
  for (const token of tokens) {
    await recordEvent(
      trx,
      { kind: 'token.revoked', subject: { kind: 'token', id: token.id } },
      labels(labelled('subject', token.name, id), labelled('holder', held.name, id)),
    );
  }
  await trx.deleteFrom('api_token').where('principal_id', '=', id).execute();
  await trx
    .updateTable('service_identity')
    .set({ disabled_at: sql<Date>`now()` })
    .where('principal_id', '=', id)
    .execute();
  await record(trx, 'service_identity.disabled', id, held.name, { tokens: tokens.length });
  // Its subscriptions with it: it receives nothing more (the WB plan, WB-B).
  await disableIdentitySubscriptions(trx, id);
  return { identity: (await serviceIdentity(trx, id))!, revoked: tokens.map((each) => each.id) };
}
