import {
  readableSet,
  type AccessFacts,
  type AccessGrant,
  type Level,
  type ReadableSet,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/**
 * Every stored fact a decision reads, as `table` or `table.column`. `access-epoch.test.ts` holds this
 * list against the writes that take the epoch's lock, and fails for a fact no write locks - so a fact
 * added to a loader in this file is added here, and the test then asks for its trigger.
 */
export const accessFactSources = [
  'access_grant',
  'artifact.space_id',
  'group_member',
  'principal.kind',
  'role.permissions',
] as const;

export type AccessFactSource = (typeof accessFactSources)[number];

/**
 * Takes the access epoch FOR UPDATE, before a change reads anything a decision also reads
 * (decisions.md, finding 7: "a change takes the epoch FOR UPDATE before deciding"). A write path that
 * checked a fact and then wrote without this would race a concurrent change to the same fact: each
 * reads what the other has not yet committed, and both writes land even though together they break a
 * rule either alone would have been refused for. Call this before the first read in any function that
 * decides whether to write a grant or a group membership.
 */
export async function lockAccessForChange(trx: TenantTransaction): Promise<void> {
  await sql`select singleton from access_epoch for update`.execute(trx);
}

/**
 * Takes the epoch FOR SHARE, and answers the transaction's own clock (IAM-063). Every loader starts
 * here, so no decision reads a fact an uncommitted change to access could be about to replace. FOR
 * SHARE, not FOR UPDATE: any number of decisions may hold the epoch together, and only a change
 * (`lockAccessForChange`, FOR UPDATE) has to wait for all of them to finish.
 */
async function holdAccess(trx: TenantTransaction): Promise<Date> {
  const { rows } = await sql<{ now: Date }>`
    select now() as now from access_epoch for share
  `.execute(trx);
  const row = rows[0];
  if (!row) throw new Error('The tenant has no access epoch row; its migrations are incomplete');
  return row.now;
}

async function principalOf(trx: TenantTransaction, principalId: string) {
  const principal = await trx
    .selectFrom('principal')
    .select(['id', 'kind'])
    .where('id', '=', principalId)
    .executeTakeFirst();
  if (!principal) return undefined;
  const groups = await trx
    .selectFrom('group_member')
    .select('group_id')
    .where('principal_id', '=', principalId)
    .orderBy('group_id')
    .execute();
  return { principal, groups: groups.map((row) => row.group_id) };
}

/** The target and every level above it, or undefined when the tenant holds no such target. */
async function chainOf(trx: TenantTransaction, target: Level): Promise<Level[] | undefined> {
  if (target.kind === 'tenant') return [target];
  if (target.kind === 'space') {
    const space = await trx
      .selectFrom('space')
      .select('id')
      .where('id', '=', target.id)
      .executeTakeFirst();
    return space && [target, { kind: 'tenant' }];
  }
  const artifact = await trx
    .selectFrom('artifact')
    .select('space_id')
    .where('id', '=', target.id)
    .executeTakeFirst();
  if (!artifact) return undefined;
  return [
    target,
    ...(artifact.space_id === null ? [] : [{ kind: 'space', id: artifact.space_id } as const]),
    { kind: 'tenant' },
  ];
}

type GrantRow = {
  id: string;
  role_id: string;
  role_name: string;
  permissions: AccessGrant['role']['permissions'];
  principal_id: string | null;
  group_id: string | null;
  level: Level['kind'];
  space_id: string | null;
  artifact_id: string | null;
  effect: 'allow' | 'deny';
  expires_at: Date | null;
};

function grantOf(row: GrantRow): AccessGrant {
  const level: Level =
    row.level === 'tenant'
      ? { kind: 'tenant' }
      : row.level === 'space'
        ? { kind: 'space', id: row.space_id! }
        : { kind: 'artifact', id: row.artifact_id! };
  return {
    id: row.id,
    role: { id: row.role_id, name: row.role_name, permissions: row.permissions },
    subject: row.principal_id !== null ? { principal: row.principal_id } : { group: row.group_id! },
    level,
    effect: row.effect,
    expiresAt: row.expires_at,
  };
}

/** Every unexpired grant to the principal or one of their groups, at the levels given or at all. */
async function grantsReaching(
  trx: TenantTransaction,
  principalId: string,
  groups: readonly string[],
  levels?: readonly Level[],
): Promise<AccessGrant[]> {
  let query = trx
    .selectFrom('access_grant as g')
    .innerJoin('role as r', 'r.id', 'g.role_id')
    .select([
      'g.id',
      'g.role_id',
      'r.name as role_name',
      'r.permissions',
      'g.principal_id',
      'g.group_id',
      'g.level',
      'g.space_id',
      'g.artifact_id',
      'g.effect',
      'g.expires_at',
    ])
    .where((eb) =>
      eb.or([
        eb('g.principal_id', '=', principalId),
        ...(groups.length > 0 ? [eb('g.group_id', 'in', groups)] : []),
      ]),
    )
    .where((eb) =>
      eb.or([eb('g.expires_at', 'is', null), eb('g.expires_at', '>', sql<Date>`now()`)]),
    );
  if (levels) {
    const spaces = levels.flatMap((level) => (level.kind === 'space' ? [level.id] : []));
    const artifacts = levels.flatMap((level) => (level.kind === 'artifact' ? [level.id] : []));
    query = query.where((eb) =>
      eb.or([
        eb('g.level', '=', 'tenant'),
        ...(spaces.length > 0 ? [eb('g.space_id', 'in', spaces)] : []),
        ...(artifacts.length > 0 ? [eb('g.artifact_id', 'in', artifacts)] : []),
      ]),
    );
  }
  const rows = await query.orderBy('g.granted_at').orderBy('g.id').execute();
  return rows.map(grantOf);
}

/**
 * The facts `decide` needs for a principal and a target, read under the epoch's shared lock in the
 * transaction of the act they authorise; undefined when the tenant holds no such principal or target.
 * Several statements rather than one query: the lock, not a snapshot, is what keeps them consistent,
 * since no change to access can commit while it is held.
 */
export async function loadFacts(
  trx: TenantTransaction,
  principalId: string,
  target: Level,
): Promise<AccessFacts | undefined> {
  const now = await holdAccess(trx);
  const who = await principalOf(trx, principalId);
  const chain = who && (await chainOf(trx, target));
  if (!who || !chain) return undefined;
  const grants = await grantsReaching(trx, principalId, who.groups, chain);
  return { principal: who.principal, groups: who.groups, chain, grants, now };
}

/**
 * The readable set for a principal (access.md, "The readable set"), from every grant reaching them,
 * under the same lock; undefined when the tenant holds no such principal.
 */
export async function loadReadableSet(
  trx: TenantTransaction,
  principalId: string,
): Promise<ReadableSet | undefined> {
  const now = await holdAccess(trx);
  const who = await principalOf(trx, principalId);
  if (!who) return undefined;
  const grants = await grantsReaching(trx, principalId, who.groups);
  const spaces = await trx.selectFrom('space').select('id').orderBy('id').execute();
  const named = [
    ...new Set(
      grants.flatMap((reached) => (reached.level.kind === 'artifact' ? [reached.level.id] : [])),
    ),
  ];
  const artifacts =
    named.length === 0
      ? []
      : await trx
          .selectFrom('artifact')
          .select(['id', 'space_id'])
          .where('id', 'in', named)
          .orderBy('id')
          .execute();
  return readableSet({
    principal: who.principal,
    groups: who.groups,
    spaces: spaces.map((row) => row.id),
    artifacts: new Map(artifacts.map((row) => [row.id, row.space_id])),
    grants,
    now,
  });
}
