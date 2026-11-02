import { sql } from 'kysely';
import { lockAccessForChange } from './access-facts.js';
import { labelled, labels, recordEvent } from './audit.js';
import { disablePrincipal, enablePrincipal } from './disablement.js';
import { erasedIn } from './erasure.js';
import { recordMembershipEvent } from './groups.js';
import { createServiceIdentity, disableServiceIdentity } from './service-identities.js';
import type { TenantTransaction } from './tables.js';

/**
 * SCIM's store (identity.md, "SCIM"; the ID plan, IDc): the people and groups one provider pushes,
 * through a service identity of its own. Nothing here reaches a service, a Google account or another
 * provider's principal: every read and write names the provider. The wire's shapes are
 * `apps/service/src/scim.ts`'s.
 */

/** A provider's claim that equals SCIM's `externalId` (IN-E). */
export type ScimClaim = 'sub' | 'oid';

export interface ScimAct {
  readonly resource: 'user' | 'group';
  readonly act: 'created' | 'replaced' | 'patched' | 'deleted';
}

/** Says what changed, by resource, and never a value (the plan's `scim.provisioned`). */
const provisioned = (
  trx: TenantTransaction,
  { resource, act }: ScimAct,
  subject: string,
  name: string | null,
) =>
  recordEvent(
    trx,
    {
      kind: 'scim.provisioned',
      subject: { kind: resource === 'user' ? 'principal' : 'group', id: subject },
      detail: { resource, act },
    },
    labels(labelled('subject', name, subject)),
  );

/**
 * Turns provisioning on for an open provider: its service identity, made once and holding nothing, and
 * the claim its people are linked by. Run again it only sets the claim. A disabled identity is replaced.
 */
export async function turnScimOn(
  trx: TenantTransaction,
  providerId: string,
  claim: ScimClaim,
  by: string,
): Promise<{ readonly identity: string } | 'provider.missing'> {
  const provider = await trx
    .selectFrom('identity_provider')
    .select(['name', 'scim_identity', 'scim_claim'])
    .where('id', '=', providerId)
    .where('closed_at', 'is', null)
    .forUpdate()
    .executeTakeFirst();
  if (!provider) return 'provider.missing';
  let identity = provider.scim_identity;
  if (identity === null) {
    const made = await createServiceIdentity(trx, {
      name: `SCIM: ${provider.name}`.slice(0, 80),
      description: 'Provisions people and groups from this identity provider.',
      by,
    });
    identity = made.id;
  }
  if (identity !== provider.scim_identity || claim !== provider.scim_claim) {
    await trx
      .updateTable('identity_provider')
      .set({ scim_identity: identity, scim_claim: claim })
      .where('id', '=', providerId)
      .execute();
    await recordEvent(trx, {
      kind: 'sign_in.configured',
      subject: { kind: 'sign_in_route' },
      detail: { change: 'scim_on', provider: providerId },
    });
  }
  return { identity };
}

/**
 * Turns provisioning off: its identity disabled and its tokens revoked, which are answered for the
 * caller to tell every replica. Those it pushed stay, and sign in as anybody of the provider does.
 */
export async function turnScimOff(
  trx: TenantTransaction,
  providerId: string,
): Promise<{ readonly tokens: readonly string[] } | 'provider.missing'> {
  const provider = await trx
    .selectFrom('identity_provider')
    .select('scim_identity')
    .where('id', '=', providerId)
    .forUpdate()
    .executeTakeFirst();
  if (!provider) return 'provider.missing';
  if (provider.scim_identity === null) return { tokens: [] };
  const disabled = await disableServiceIdentity(trx, provider.scim_identity);
  await trx
    .updateTable('identity_provider')
    .set({ scim_identity: null })
    .where('id', '=', providerId)
    .execute();
  await recordEvent(trx, {
    kind: 'sign_in.configured',
    subject: { kind: 'sign_in_route' },
    detail: { change: 'scim_off', provider: providerId },
  });
  return { tokens: disabled?.revoked ?? [] };
}

/** The open provider a token's holder provisions for, or undefined for any other holder. */
export async function providerProvisionedBy(
  trx: TenantTransaction,
  identity: string,
): Promise<{ readonly id: string } | undefined> {
  return trx
    .selectFrom('identity_provider')
    .select('id')
    .where('scim_identity', '=', identity)
    .where('closed_at', 'is', null)
    .executeTakeFirst();
}

/** A person as SCIM sees them. */
export interface ScimUser {
  readonly id: string;
  readonly externalId: string;
  readonly userName: string;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly active: boolean;
  readonly createdAt: Date;
}

const USER_COLUMNS = [
  'id',
  'provider_key',
  'scim_user_name',
  'display_name',
  'email',
  'disabled_at',
  'created_at',
] as const;

const userOf = (row: {
  id: string;
  provider_key: string | null;
  scim_user_name: string | null;
  display_name: string | null;
  email: string | null;
  disabled_at: Date | null;
  created_at: Date;
}): ScimUser => ({
  id: row.id,
  externalId: row.provider_key ?? '',
  userName: row.scim_user_name ?? '',
  displayName: row.display_name,
  email: row.email,
  active: row.disabled_at === null,
  createdAt: row.created_at,
});

/** Who a provider has pushed: never anybody else, and nobody erased. */
const pushed = (trx: TenantTransaction, providerId: string) =>
  trx
    .selectFrom('principal')
    .where('provider_id', '=', providerId)
    .where('provisioned_at', 'is not', null)
    .where(sql<boolean>`erased_at is null`);

export async function scimUser(
  trx: TenantTransaction,
  providerId: string,
  id: string,
): Promise<ScimUser | undefined> {
  const row = await pushed(trx, providerId)
    .select(USER_COLUMNS)
    .where('id', '=', id)
    .executeTakeFirst();
  return row && userOf(row);
}

export type ScimFilter = { readonly userName: string } | { readonly externalId: string };

/** A page of those pushed, in the order of their ids, and how many there are in all. */
export async function scimUsers(
  trx: TenantTransaction,
  providerId: string,
  page: { readonly offset: number; readonly limit: number; readonly filter?: ScimFilter },
): Promise<{ readonly items: readonly ScimUser[]; readonly total: number }> {
  const filtered = () => {
    const all = pushed(trx, providerId);
    if (page.filter === undefined) return all;
    return 'userName' in page.filter
      ? all.where(sql<boolean>`lower(scim_user_name) = lower(${page.filter.userName})`)
      : all.where('provider_key', '=', page.filter.externalId);
  };
  const rows = await filtered()
    .select(USER_COLUMNS)
    .orderBy('id')
    .offset(page.offset)
    .limit(page.limit)
    .execute();
  const counted = await filtered()
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .executeTakeFirstOrThrow();
  return { items: rows.map(userOf), total: Number(counted.count) };
}

export type ScimRefusal = 'scim.taken' | 'scim.erased' | 'scim.missing' | 'scim.unknown_member';

const userNameTaken = async (
  trx: TenantTransaction,
  providerId: string,
  userName: string,
  other?: string,
) =>
  (await pushed(trx, providerId)
    .select('id')
    .where(sql<boolean>`lower(scim_user_name) = lower(${userName})`)
    .$if(other !== undefined, (query) => query.where('id', '<>', other!))
    .executeTakeFirst()) !== undefined;

/** What a push says of a person, every field present: a patch reads the rest from what stands. */
export interface ScimUserFields {
  readonly externalId: string;
  readonly userName: string;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly active: boolean;
}

/**
 * Says to the caller what ended with a person, as a disablement answers it; empty for anything else.
 * Active false disables, whoever else may have (IN-G). Active true enables only somebody SCIM itself
 * disabled, since a provider's replay of a person it holds active must not undo an administrator's act.
 */
async function applyActive(
  trx: TenantTransaction,
  id: string,
  active: boolean,
): Promise<{ readonly sessions: readonly string[]; readonly tokens: readonly string[] }> {
  if (!active) {
    const answer = await disablePrincipal(trx, id, 'scim');
    return 'refused' in answer ? { sessions: [], tokens: [] } : answer;
  }
  const held = await trx
    .selectFrom('principal')
    .select('disabled_by')
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  if (held.disabled_by === 'scim') await enablePrincipal(trx, id, 'scim');
  return { sessions: [], tokens: [] };
}

export type ScimUserAnswer =
  | {
      readonly user: ScimUser;
      readonly ended: { readonly sessions: readonly string[]; readonly tokens: readonly string[] };
    }
  | { readonly refused: ScimRefusal };

/**
 * Takes a person pushed (identity.md, "A person pushed"): the provider's principal holding this key, so
 * somebody who signed in before SCIM was on is the one provisioned and not a second, or a new one with
 * the key and no subject, bound at their first sign-in. Email is never the link (IN-E). One pushed
 * already is refused as taken, as RFC 7644 has it; one deleted comes back.
 */
export async function createScimUser(
  trx: TenantTransaction,
  providerId: string,
  fields: ScimUserFields,
): Promise<ScimUserAnswer> {
  const held = await trx
    .selectFrom('principal')
    .select(['id', 'provisioned_at'])
    .select(erasedIn().as('erased'))
    .where('provider_id', '=', providerId)
    .where('provider_key', '=', fields.externalId)
    .forUpdate()
    .executeTakeFirst();
  if (held?.erased) return { refused: 'scim.erased' };
  if (held && held.provisioned_at !== null) return { refused: 'scim.taken' };
  if (await userNameTaken(trx, providerId, fields.userName, held?.id)) {
    return { refused: 'scim.taken' };
  }
  const values = {
    display_name: fields.displayName,
    email: fields.email,
    scim_user_name: fields.userName,
    provisioned_at: sql<Date>`now()`,
  };
  const id = held
    ? (await trx.updateTable('principal').set(values).where('id', '=', held.id).execute(), held.id)
    : (
        await trx
          .insertInto('principal')
          .values({
            issuer: null,
            subject: null,
            email: fields.email,
            display_name: fields.displayName,
            kind: 'user',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
  if (!held) {
    await trx
      .updateTable('principal')
      .set({
        ...values,
        provider_id: providerId,
        provider_key: fields.externalId,
      })
      .where('id', '=', id)
      .execute();
  }
  await provisioned(trx, { resource: 'user', act: 'created' }, id, fields.displayName);
  const ended = await applyActive(trx, id, fields.active);
  return { user: (await scimUser(trx, providerId, id))!, ended };
}

/** Writes a person's fields as a replacement or a patch has them. */
export async function changeScimUser(
  trx: TenantTransaction,
  providerId: string,
  id: string,
  fields: ScimUserFields,
  act: 'replaced' | 'patched',
): Promise<ScimUserAnswer> {
  const held = await pushed(trx, providerId)
    .select('id')
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!held) return { refused: 'scim.missing' };
  if (await userNameTaken(trx, providerId, fields.userName, id)) return { refused: 'scim.taken' };
  const keyHeld = await trx
    .selectFrom('principal')
    .select('id')
    .where('provider_id', '=', providerId)
    .where('provider_key', '=', fields.externalId)
    .where('id', '<>', id)
    .executeTakeFirst();
  if (keyHeld) return { refused: 'scim.taken' };
  await trx
    .updateTable('principal')
    .set({
      display_name: fields.displayName,
      email: fields.email,
      scim_user_name: fields.userName,
      provider_key: fields.externalId,
    })
    .where('id', '=', id)
    .execute();
  await provisioned(trx, { resource: 'user', act }, id, fields.displayName);
  const ended = await applyActive(trx, id, fields.active);
  return { user: (await scimUser(trx, providerId, id))!, ended };
}

/**
 * Deletes a person as SCIM has it: disabled, and no longer among those pushed, the principal kept so
 * authorship and the audit still name them (IN-G). Their memberships of the provider's groups go.
 */
export async function deleteScimUser(
  trx: TenantTransaction,
  providerId: string,
  id: string,
): Promise<
  | { readonly sessions: readonly string[]; readonly tokens: readonly string[] }
  | { readonly refused: 'scim.missing' }
> {
  const held = await pushed(trx, providerId)
    .select('display_name')
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!held) return { refused: 'scim.missing' };
  const ended = await applyActive(trx, id, false);
  await provisioned(trx, { resource: 'user', act: 'deleted' }, id, held.display_name);
  await trx.deleteFrom('scim_group_member').where('principal_id', '=', id).execute();
  await trx.updateTable('principal').set({ provisioned_at: null }).where('id', '=', id).execute();
  await settleProviderGroups(trx, providerId);
  return ended;
}

/** A group as SCIM sees it: its own record, whether or not a group here stands for it. */
export interface ScimGroup {
  readonly id: string;
  readonly displayName: string;
  readonly externalId: string | null;
  readonly members: readonly { readonly id: string; readonly name: string | null }[];
  readonly createdAt: Date;
}

async function membersOf(trx: TenantTransaction, groupIds: readonly string[]) {
  const found = new Map<string, { id: string; name: string | null }[]>();
  if (groupIds.length === 0) return found;
  const rows = await trx
    .selectFrom('scim_group_member as m')
    .innerJoin('principal as p', 'p.id', 'm.principal_id')
    .select(['m.scim_group_id', 'p.id', 'p.display_name'])
    .where('m.scim_group_id', 'in', [...groupIds])
    .orderBy('p.id')
    .execute();
  for (const row of rows) {
    const list = found.get(row.scim_group_id) ?? [];
    list.push({ id: row.id, name: row.display_name });
    found.set(row.scim_group_id, list);
  }
  return found;
}

export async function scimGroup(
  trx: TenantTransaction,
  providerId: string,
  id: string,
): Promise<ScimGroup | undefined> {
  const row = await trx
    .selectFrom('scim_group')
    .select(['id', 'display_name', 'external_id', 'created_at'])
    .where('provider_id', '=', providerId)
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) return undefined;
  const members = await membersOf(trx, [row.id]);
  return {
    id: row.id,
    displayName: row.display_name,
    externalId: row.external_id,
    members: members.get(row.id) ?? [],
    createdAt: row.created_at,
  };
}

export async function scimGroups(
  trx: TenantTransaction,
  providerId: string,
  page: {
    readonly offset: number;
    readonly limit: number;
    readonly filter?: { readonly displayName: string } | { readonly externalId: string };
  },
): Promise<{ readonly items: readonly ScimGroup[]; readonly total: number }> {
  const filtered = () => {
    const all = trx.selectFrom('scim_group').where('provider_id', '=', providerId);
    if (page.filter === undefined) return all;
    return 'displayName' in page.filter
      ? all.where('display_name', '=', page.filter.displayName)
      : all.where('external_id', '=', page.filter.externalId);
  };
  const rows = await filtered()
    .select(['id', 'display_name', 'external_id', 'created_at'])
    .orderBy('id')
    .offset(page.offset)
    .limit(page.limit)
    .execute();
  const members = await membersOf(
    trx,
    rows.map((row) => row.id),
  );
  const counted = await filtered()
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .executeTakeFirstOrThrow();
  return {
    items: rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      externalId: row.external_id,
      members: members.get(row.id) ?? [],
      createdAt: row.created_at,
    })),
    total: Number(counted.count),
  };
}

/** Whether each named is somebody this provider pushed. */
const allPushed = async (trx: TenantTransaction, providerId: string, ids: readonly string[]) => {
  if (ids.length === 0) return true;
  const found = await pushed(trx, providerId)
    .select('id')
    .where('id', 'in', [...ids])
    .execute();
  return found.length === new Set(ids).size;
};

async function writeMembers(trx: TenantTransaction, groupId: string, members: readonly string[]) {
  await trx.deleteFrom('scim_group_member').where('scim_group_id', '=', groupId).execute();
  const wanted = [...new Set(members)];
  if (wanted.length > 0) {
    await trx
      .insertInto('scim_group_member')
      .values(wanted.map((principal) => ({ scim_group_id: groupId, principal_id: principal })))
      .execute();
  }
}

export type ScimGroupAnswer = { readonly group: ScimGroup } | { readonly refused: ScimRefusal };

export async function createScimGroup(
  trx: TenantTransaction,
  providerId: string,
  fields: {
    readonly displayName: string;
    readonly externalId: string | null;
    readonly members: readonly string[];
  },
): Promise<ScimGroupAnswer> {
  if (!(await allPushed(trx, providerId, fields.members))) {
    return { refused: 'scim.unknown_member' };
  }
  const made = await trx
    .insertInto('scim_group')
    .values({
      provider_id: providerId,
      display_name: fields.displayName,
      external_id: fields.externalId,
    })
    .onConflict((conflict) => conflict.doNothing())
    .returning('id')
    .executeTakeFirst();
  if (!made) return { refused: 'scim.taken' };
  await writeMembers(trx, made.id, fields.members);
  await provisioned(trx, { resource: 'group', act: 'created' }, made.id, fields.displayName);
  await settleProviderGroups(trx, providerId);
  return { group: (await scimGroup(trx, providerId, made.id))! };
}

export async function changeScimGroup(
  trx: TenantTransaction,
  providerId: string,
  id: string,
  fields: {
    readonly displayName: string;
    readonly externalId: string | null;
    readonly members: readonly string[];
  },
  act: 'replaced' | 'patched',
): Promise<ScimGroupAnswer> {
  const held = await trx
    .selectFrom('scim_group')
    .select('id')
    .where('provider_id', '=', providerId)
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!held) return { refused: 'scim.missing' };
  if (!(await allPushed(trx, providerId, fields.members))) {
    return { refused: 'scim.unknown_member' };
  }
  const taken = await trx
    .selectFrom('scim_group')
    .select('id')
    .where('provider_id', '=', providerId)
    .where('display_name', '=', fields.displayName)
    .where('id', '<>', id)
    .executeTakeFirst();
  if (taken) return { refused: 'scim.taken' };
  await trx
    .updateTable('scim_group')
    .set({ display_name: fields.displayName, external_id: fields.externalId })
    .where('id', '=', id)
    .execute();
  await writeMembers(trx, id, fields.members);
  await provisioned(trx, { resource: 'group', act }, id, fields.displayName);
  await settleProviderGroups(trx, providerId);
  return { group: (await scimGroup(trx, providerId, id))! };
}

/** Deletes SCIM's group, its members leaving any group here it stood for; that group itself stays. */
export async function deleteScimGroup(
  trx: TenantTransaction,
  providerId: string,
  id: string,
): Promise<'deleted' | 'scim.missing'> {
  const held = await trx
    .deleteFrom('scim_group')
    .where('provider_id', '=', providerId)
    .where('id', '=', id)
    .returning('display_name')
    .executeTakeFirst();
  if (!held) return 'scim.missing';
  await provisioned(trx, { resource: 'group', act: 'deleted' }, id, held.display_name);
  await settleProviderGroups(trx, providerId);
  return 'deleted';
}

/**
 * Brings a provisioning provider's groups into line with what SCIM holds (identity.md, "Groups"): each
 * of its groups here matched by value to a SCIM group's `externalId`, else its `displayName`, has that
 * group's members, and one matching none has none. Only differences are written, each recorded as the
 * provider's. A group made later picks its members up here. The caller has taken the access epoch.
 */
export async function settleProviderGroups(
  trx: TenantTransaction,
  providerId: string,
): Promise<void> {
  const provisions = await trx
    .selectFrom('identity_provider')
    .select('scim_identity')
    .where('id', '=', providerId)
    .executeTakeFirst();
  if (provisions?.scim_identity == null) return;
  await lockAccessForChange(trx);
  const groups = await trx
    .selectFrom('access_group')
    .select(['id', 'provider_value'])
    .where('source', '=', 'provider')
    .where('provider_id', '=', providerId)
    .orderBy('id')
    .execute();
  if (groups.length === 0) return;
  const held = await trx
    .selectFrom('scim_group')
    .select(['id', 'display_name', 'external_id'])
    .where('provider_id', '=', providerId)
    .execute();
  const members = await membersOf(
    trx,
    held.map((row) => row.id),
  );
  for (const group of groups) {
    const source =
      held.find((row) => row.external_id === group.provider_value) ??
      held.find((row) => row.display_name === group.provider_value);
    const wanted = new Set((source && members.get(source.id))?.map((each) => each.id) ?? []);
    const current = await trx
      .selectFrom('group_member')
      .select('principal_id')
      .where('group_id', '=', group.id)
      .execute();
    const holding = new Set(current.map((row) => row.principal_id));
    const leaving = [...holding].filter((each) => !wanted.has(each));
    const joining = [...wanted].filter((each) => !holding.has(each));
    for (const principal of leaving) {
      await recordMembershipEvent(
        trx,
        'group.member_removed',
        { group: group.id, principal },
        'provider',
      );
    }
    if (leaving.length > 0) {
      await trx
        .deleteFrom('group_member')
        .where('group_id', '=', group.id)
        .where('principal_id', 'in', leaving)
        .execute();
    }
    if (joining.length > 0) {
      await trx
        .insertInto('group_member')
        .values(
          joining.map((principal) => ({
            group_id: group.id,
            principal_id: principal,
            asserted_at: sql<Date>`now()`,
          })),
        )
        .execute();
    }
    for (const principal of joining) {
      await recordMembershipEvent(
        trx,
        'group.member_added',
        { group: group.id, principal },
        'provider',
      );
    }
  }
}

export type AdmittedProvisioned = { readonly id: string } | 'erased' | 'not_provisioned';

/**
 * A provider that provisions admits only those it pushed (identity.md, "A person pushed"; IN-K): the
 * principal holding the provider's claim as its key, their subject bound at the first sign-in and held
 * to it from then on. Nothing is made and no invitation claimed; email is never the link.
 *
 * One exception, so turning SCIM on cannot lock an environment out before its first push (IN-B): somebody
 * already known by issuer and subject who holds `administer` at the environment outright is admitted,
 * as the lockout guard counts them, until they are pushed or disabled.
 */
export async function admitProvisioned(
  trx: TenantTransaction,
  providerId: string,
  identity: {
    readonly issuer: string;
    readonly subject: string;
    readonly email: string | null;
    readonly emailVerified: boolean;
    readonly name: string | null;
    readonly providerKey: string | null;
  },
): Promise<AdmittedProvisioned> {
  const held =
    identity.providerKey === null
      ? undefined
      : await trx
          .selectFrom('principal')
          .select(['id', 'subject'])
          .select(erasedIn().as('erased'))
          .where('provider_id', '=', providerId)
          .where('provider_key', '=', identity.providerKey)
          .where('provisioned_at', 'is not', null)
          .forUpdate()
          .executeTakeFirst();
  if (held) {
    if (held.erased) return 'erased';
    if (held.subject !== null && held.subject !== identity.subject) return 'not_provisioned';
    if (held.subject === null) {
      // Somebody else known by this subject is a second principal, which no sign-in can merge.
      const other = await trx
        .selectFrom('principal')
        .select('id')
        .where('issuer', '=', identity.issuer)
        .where('subject', '=', identity.subject)
        .executeTakeFirst();
      if (other) return 'not_provisioned';
    }
    await trx
      .updateTable('principal')
      .set({
        issuer: identity.issuer,
        subject: identity.subject,
        email: identity.email,
        email_verified: identity.emailVerified,
      })
      .where('id', '=', held.id)
      .execute();
    return { id: held.id };
  }
  const known = await trx
    .selectFrom('principal as p')
    .select('p.id')
    .select(sql<boolean>`p.erased_at is not null`.as('erased'))
    .where('p.issuer', '=', identity.issuer)
    .where('p.subject', '=', identity.subject)
    .where('p.kind', '<>', 'external')
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('access_grant as g')
          .innerJoin('role as r', 'r.id', 'g.role_id')
          .select('g.id')
          .whereRef('g.principal_id', '=', 'p.id')
          .where('g.level', '=', 'tenant')
          .where('g.effect', '=', 'allow')
          .where('g.expires_at', 'is', null)
          .where(sql<boolean>`'administer' = any (r.permissions)`),
      ),
    )
    .executeTakeFirst();
  if (known) return known.erased ? 'erased' : { id: known.id };
  return 'not_provisioned';
}

/**
 * Keeps the provider's claim on somebody signing in through a provider that does not provision (IN-E),
 * so turning SCIM on later finds them. A key another of the provider's people holds is left alone.
 */
export async function keepProviderKey(
  trx: TenantTransaction,
  principalId: string,
  providerId: string,
  key: string | null,
): Promise<void> {
  const held =
    key === null
      ? undefined
      : await trx
          .selectFrom('principal')
          .select('id')
          .where('provider_id', '=', providerId)
          .where('provider_key', '=', key)
          .where('id', '<>', principalId)
          .executeTakeFirst();
  await trx
    .updateTable('principal')
    .set({ provider_id: providerId, provider_key: held ? null : key })
    .where('id', '=', principalId)
    .execute();
}
