import { sql } from 'kysely';
import { lockAccessForChange } from './access-facts.js';
import { labelled, labels, principalLabel, recordEvent } from './audit.js';
import {
  accessPolicy,
  externalRefusal,
  recordGrantsRevoked,
  type ExternalRefusal,
} from './grants.js';
import { checkedPage, isPageCursor, paged, type Page, type PageRequest } from './paging.js';
import type { TenantTransaction } from './tables.js';

/**
 * A group (access.md, "Groups"): the environment's own, whose members an administrator names, or one
 * standing for a value the organisation's provider asserts, whose members the sign-ins decide.
 */
export interface Group {
  readonly id: string;
  readonly name: string;
  readonly source: 'tenant' | 'provider';
  /** The value a provider's claim carries for this group; null for the environment's own. */
  readonly providerValue: string | null;
}

/** A group as a listing shows it: with its members by name, so a page of groups needs no second read. */
export interface ListedGroup extends Group {
  readonly members: readonly {
    readonly id: string;
    readonly name: string | null;
    readonly email: string | null;
  }[];
}

export type GroupAnswer =
  { readonly group: Group } | { readonly refused: 'group.name_taken' | 'group.value_taken' };

/**
 * Makes a group: the environment's own by name, or, given `providerValue`, one standing for that value
 * of the provider's claim (GP-C). A name, or a value, another group already has is refused. Changes no
 * fact a decision reads - a new group holds nothing and has no members - so takes no lock.
 */
export async function createGroup(
  trx: TenantTransaction,
  name: string,
  options: { readonly providerValue?: string } = {},
): Promise<GroupAnswer> {
  const providerValue = options.providerValue ?? null;
  const row = await trx
    .insertInto('access_group')
    .values({
      name,
      source: providerValue === null ? 'tenant' : 'provider',
      provider_value: providerValue,
    })
    .onConflict((conflict) => conflict.doNothing())
    .returning(['id', 'name', 'source', 'provider_value'])
    .executeTakeFirst();
  if (row) {
    await recordEvent(trx, { kind: 'group.made', subject: { kind: 'group', id: row.id } }, [
      { role: 'subject', text: row.name, refersTo: row.id },
    ]);
    return { group: groupOf(row) };
  }
  const named = await trx
    .selectFrom('access_group')
    .select('id')
    .where('name', '=', name)
    .executeTakeFirst();
  return { refused: named ? 'group.name_taken' : 'group.value_taken' };
}

function groupOf(row: {
  id: string;
  name: string;
  source: 'tenant' | 'provider';
  provider_value: string | null;
}): Group {
  return { id: row.id, name: row.name, source: row.source, providerValue: row.provider_value };
}

/** How many groups `listGroups` lists: Administration's count (AD-A). */
export async function countGroups(trx: TenantTransaction): Promise<number> {
  const row = await trx
    .selectFrom('access_group')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

/**
 * The tenant's groups, a page at a time in the order of their ids, each with its members in the order
 * of their names. Who may see them - `administer` at the tenant - is the caller's to decide first.
 */
export async function listGroups(
  trx: TenantTransaction,
  request: PageRequest,
): Promise<Page<ListedGroup>> {
  const page = checkedPage(request);
  if (page.after !== undefined && !isPageCursor(page.after)) return { items: [], after: null };
  const rows = await trx
    .selectFrom('access_group')
    .select(['id', 'name', 'source', 'provider_value'])
    .$if(page.after !== undefined, (query) => query.where('id', '>', page.after!))
    .orderBy('id')
    .limit(page.limit + 1)
    .execute();
  const { items, after } = paged(rows, page.limit);
  const members = await membersOf(
    trx,
    items.map((each) => each.id),
  );
  return {
    items: items.map((row) => ({ ...groupOf(row), members: members.get(row.id) ?? [] })),
    after,
  };
}

/** One group as a listing shows it, or undefined when the tenant holds no such group. */
export async function readGroup(
  trx: TenantTransaction,
  id: string,
): Promise<ListedGroup | undefined> {
  const row = await trx
    .selectFrom('access_group')
    .select(['id', 'name', 'source', 'provider_value'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) return undefined;
  const members = await membersOf(trx, [row.id]);
  return { ...groupOf(row), members: members.get(row.id) ?? [] };
}

/**
 * The names of these groups, by id, read in one statement: what an explanation names a group by
 * (access.md, "Groups and Access, as W12 builds them"). A group the tenant does not hold is absent.
 */
export async function groupNames(
  trx: TenantTransaction,
  groupIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(groupIds)];
  if (ids.length === 0) return new Map();
  const rows = await trx
    .selectFrom('access_group')
    .select(['id', 'name'])
    .where('id', 'in', ids)
    .execute();
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function membersOf(
  trx: TenantTransaction,
  groupIds: readonly string[],
): Promise<Map<string, ListedGroup['members'][number][]>> {
  const found = new Map<string, ListedGroup['members'][number][]>();
  if (groupIds.length === 0) return found;
  const rows = await trx
    .selectFrom('group_member as m')
    .innerJoin('principal as p', 'p.id', 'm.principal_id')
    .select(['m.group_id', 'p.id', 'p.display_name', 'p.email'])
    .where('m.group_id', 'in', [...groupIds])
    .orderBy('p.display_name')
    .orderBy('p.email')
    .orderBy('p.id')
    .execute();
  for (const row of rows) {
    const list = found.get(row.group_id) ?? [];
    list.push({ id: row.id, name: row.display_name, email: row.email });
    found.set(row.group_id, list);
  }
  return found;
}

/**
 * Why an external principal may not join this group, if they may not: any unexpired allow the group
 * holds that could not have been made to them directly (access.md, "External principals"). A denial
 * the group holds is never a reason, so a group is never a way round those rules, nor a way to keep
 * somebody out of one.
 */
async function externalJoinRefusal(
  trx: TenantTransaction,
  groupId: string,
): Promise<ExternalRefusal | undefined> {
  const policy = await accessPolicy(trx);
  const held = await trx
    .selectFrom('access_grant as g')
    .innerJoin('role as r', 'r.id', 'g.role_id')
    .select(['r.permissions', 'g.level', 'g.effect', 'g.expires_at'])
    .where('g.group_id', '=', groupId)
    .where((eb) => eb.or([eb('g.expires_at', 'is', null), eb('g.expires_at', '>', policy.now)]))
    .execute();
  for (const grant of held) {
    const refusal = externalRefusal(
      { permissions: grant.permissions, level: grant.level },
      grant.effect,
      grant.expires_at,
      policy,
    );
    if (refusal) return refusal;
  }
  return undefined;
}

/**
 * Records a membership added or removed (ADM-002), with the group's and the member's names: before a
 * removal deletes the row. `through` is who decides it: an administrator, or the provider's claim.
 */
export async function recordMembershipEvent(
  trx: TenantTransaction,
  kind: 'group.member_added' | 'group.member_removed',
  membership: { readonly group: string; readonly principal: string },
  through: 'manual' | 'provider',
): Promise<void> {
  const group = await trx
    .selectFrom('access_group')
    .select('name')
    .where('id', '=', membership.group)
    .executeTakeFirst();
  await recordEvent(
    trx,
    {
      kind,
      subject: { kind: 'group', id: membership.group },
      detail: { group: membership.group, principal: membership.principal, through },
    },
    labels(
      labelled('subject', group?.name, membership.group),
      await principalLabel(trx, 'member', membership.principal),
    ),
  );
}

/** Records the removal of every membership of a principal or of a group, before a cascade's delete. */
export async function recordMembershipsRemoved(
  trx: TenantTransaction,
  of: { readonly principal: string } | { readonly group: string },
): Promise<void> {
  const rows = await trx
    .selectFrom('group_member as m')
    .innerJoin('access_group as g', 'g.id', 'm.group_id')
    .select(['m.group_id', 'm.principal_id', 'g.source'])
    .$if('principal' in of, (query) =>
      query.where('m.principal_id', '=', (of as { principal: string }).principal),
    )
    .$if('group' in of, (query) => query.where('m.group_id', '=', (of as { group: string }).group))
    .orderBy('m.group_id')
    .orderBy('m.principal_id')
    .execute();
  for (const row of rows) {
    await recordMembershipEvent(
      trx,
      'group.member_removed',
      { group: row.group_id, principal: row.principal_id },
      row.source === 'provider' ? 'provider' : 'manual',
    );
  }
}

export type MembershipAnswer =
  { readonly added: true } | { readonly refused: ExternalRefusal | 'group.from_provider' };

/**
 * Adds a principal to a tenant-managed group; adding one already there changes nothing, and answers
 * without running the checks below, which could otherwise refuse a no-op that changes nothing. An
 * external principal is refused where any unexpired grant the group holds could not have been made to
 * them directly (access.md, "External principals"), so a group is never a way round those rules.
 */
export async function addToGroup(
  trx: TenantTransaction,
  groupId: string,
  principalId: string,
): Promise<MembershipAnswer> {
  // Locked before the first read: a concurrent grant on the same group must not land unseen between
  // this check and the write that acts on it (finding 7).
  await lockAccessForChange(trx);

  const already = await trx
    .selectFrom('group_member')
    .select('principal_id')
    .where('group_id', '=', groupId)
    .where('principal_id', '=', principalId)
    .executeTakeFirst();
  if (already) return { added: true };

  const group = await trx
    .selectFrom('access_group')
    .select('source')
    .where('id', '=', groupId)
    .executeTakeFirstOrThrow();
  if (group.source === 'provider') return { refused: 'group.from_provider' };

  const principal = await trx
    .selectFrom('principal')
    .select('kind')
    .where('id', '=', principalId)
    .executeTakeFirstOrThrow();
  if (principal.kind === 'external') {
    const refusal = await externalJoinRefusal(trx, groupId);
    if (refusal) return { refused: refusal };
  }

  const added = await trx
    .insertInto('group_member')
    .values({ group_id: groupId, principal_id: principalId, asserted_at: null })
    .onConflict((conflict) => conflict.columns(['group_id', 'principal_id']).doNothing())
    .returning('principal_id')
    .executeTakeFirst();
  if (added) {
    await recordMembershipEvent(
      trx,
      'group.member_added',
      { group: groupId, principal: principalId },
      'manual',
    );
  }
  return { added: true };
}

export type SetMembersAnswer =
  | { readonly set: true }
  | {
      readonly refused:
        ExternalRefusal | 'group.missing' | 'group.from_provider' | 'group.member_missing';
    };

/**
 * Makes an environment's own group's members exactly the principals named, adding and removing only
 * those that differ, so naming the same members again changes no fact and takes no lock beyond this
 * one. A provider's group is refused: its members are the sign-ins' to decide (GP-C). A person the
 * tenant does not hold is refused, and so is an external principal joining where `addToGroup` would
 * refuse them; either way nothing changes. Removing a member is never refused: the lock-out guard
 * counts direct grants only (access.md, "Roles"). Who may do this - `administer` at the tenant - is the
 * caller's to decide first.
 */
export async function setGroupMembers(
  trx: TenantTransaction,
  groupId: string,
  principalIds: readonly string[],
): Promise<SetMembersAnswer> {
  // Before the first read, as addToGroup: a grant made to this group meanwhile must be seen.
  await lockAccessForChange(trx);

  const group = await trx
    .selectFrom('access_group')
    .select('source')
    .where('id', '=', groupId)
    .executeTakeFirst();
  if (!group) return { refused: 'group.missing' };
  if (group.source === 'provider') return { refused: 'group.from_provider' };

  const wanted = [...new Set(principalIds)];
  const people =
    wanted.length === 0
      ? []
      : await trx
          .selectFrom('principal')
          .select(['id', 'kind'])
          .where('id', 'in', wanted)
          .execute();
  if (people.length !== wanted.length) return { refused: 'group.member_missing' };

  const current = new Set(
    (
      await trx
        .selectFrom('group_member')
        .select('principal_id')
        .where('group_id', '=', groupId)
        .execute()
    ).map((row) => row.principal_id),
  );
  const joining = people.filter((person) => !current.has(person.id));
  const leaving = [...current].filter((id) => !wanted.includes(id));

  if (joining.some((person) => person.kind === 'external')) {
    const refusal = await externalJoinRefusal(trx, groupId);
    if (refusal) return { refused: refusal };
  }

  for (const principal of leaving) {
    await recordMembershipEvent(
      trx,
      'group.member_removed',
      { group: groupId, principal },
      'manual',
    );
  }
  if (leaving.length > 0) {
    await trx
      .deleteFrom('group_member')
      .where('group_id', '=', groupId)
      .where('principal_id', 'in', leaving)
      .execute();
  }
  if (joining.length > 0) {
    await trx
      .insertInto('group_member')
      .values(
        joining.map((person) => ({
          group_id: groupId,
          principal_id: person.id,
          asserted_at: null,
        })),
      )
      .execute();
  }
  for (const person of joining) {
    await recordMembershipEvent(
      trx,
      'group.member_added',
      { group: groupId, principal: person.id },
      'manual',
    );
  }
  return { set: true };
}

export type DeletionAnswer = { readonly deleted: string } | { readonly refused: 'group.missing' };

/**
 * Deletes a group, of either source, with its memberships and every grant it holds, which go by their
 * keys' cascades (0009, 0039). Takes the epoch first, as every change to access does. Never refused by
 * the lock-out guard, which counts direct grants only (access.md, "Roles").
 */
export async function deleteGroup(
  trx: TenantTransaction,
  groupId: string,
): Promise<DeletionAnswer> {
  await lockAccessForChange(trx);
  const group = await trx
    .selectFrom('access_group')
    .select(['id', 'name'])
    .where('id', '=', groupId)
    .forUpdate()
    .executeTakeFirst();
  if (!group) return { refused: 'group.missing' };
  // One event for each row the cascade removes, then the group's own, all before the delete
  // (the AU1 plan, AU1-H).
  await recordGrantsRevoked(trx, { group: groupId });
  await recordMembershipsRemoved(trx, { group: groupId });
  await recordEvent(trx, { kind: 'group.deleted', subject: { kind: 'group', id: group.id } }, [
    { role: 'subject', text: group.name, refersTo: group.id },
  ]);
  await trx.deleteFrom('access_group').where('id', '=', groupId).execute();
  return { deleted: group.id };
}

/**
 * Brings a principal's memberships of provider groups into line with the values the organisation's
 * provider asserted at sign-in (IAM-009, GP-A to GP-D). A value no group stands for is ignored, and a
 * value is matched exactly; no values - an absent or malformed claim - removes every provider
 * membership (GP-B). The environment's own groups are never touched.
 *
 * Only the memberships that differ are added or removed, because each takes the access epoch
 * exclusively and replacing them all would take it at every sign-in: the differences are read first,
 * and only where there are some is the epoch taken - before they are read again and acted on, so a
 * concurrent change to the same memberships is seen. Every membership the claim still carries has
 * `asserted_at` brought up to now, which no trigger watches (0010).
 *
 * Holds no lock of its own before the epoch, and so belongs in a transaction that has taken none it
 * could be waiting on - never the claim of an invitation, whose rows a withdrawal takes after the epoch.
 */
export async function syncProviderGroups(
  trx: TenantTransaction,
  principalId: string,
  values: readonly string[],
): Promise<void> {
  const asserted = [...new Set(values)];
  const differences = async () => {
    const standing =
      asserted.length === 0
        ? []
        : await trx
            .selectFrom('access_group')
            .select('id')
            .where('source', '=', 'provider')
            .where('provider_value', 'in', asserted)
            .execute();
    const held = await trx
      .selectFrom('group_member as m')
      .innerJoin('access_group as g', 'g.id', 'm.group_id')
      .select('m.group_id')
      .where('m.principal_id', '=', principalId)
      .where('g.source', '=', 'provider')
      .execute();
    const wanted = new Set(standing.map((row) => row.id));
    const holding = new Set(held.map((row) => row.group_id));
    return {
      wanted,
      joining: [...wanted].filter((id) => !holding.has(id)),
      leaving: [...holding].filter((id) => !wanted.has(id)),
    };
  };

  let found = await differences();
  if (found.joining.length > 0 || found.leaving.length > 0) {
    await lockAccessForChange(trx);
    found = await differences();
    for (const group of found.leaving) {
      await recordMembershipEvent(
        trx,
        'group.member_removed',
        { group, principal: principalId },
        'provider',
      );
    }
    if (found.leaving.length > 0) {
      await trx
        .deleteFrom('group_member')
        .where('principal_id', '=', principalId)
        .where('group_id', 'in', found.leaving)
        .execute();
    }
    if (found.joining.length > 0) {
      const joined = await trx
        .insertInto('group_member')
        .values(
          found.joining.map((groupId) => ({
            group_id: groupId,
            principal_id: principalId,
            asserted_at: sql<Date>`now()`,
          })),
        )
        .onConflict((conflict) => conflict.columns(['group_id', 'principal_id']).doNothing())
        .returning('group_id')
        .execute();
      for (const { group_id: group } of joined) {
        await recordMembershipEvent(
          trx,
          'group.member_added',
          { group, principal: principalId },
          'provider',
        );
      }
    }
  }
  if (found.wanted.size > 0) {
    await trx
      .updateTable('group_member')
      .set({ asserted_at: sql<Date>`now()` })
      .where('principal_id', '=', principalId)
      .where('group_id', 'in', [...found.wanted])
      .execute();
  }
}
