import { formatLevel } from '@alloy-works/domain';

import { loadReadableSet } from './access-facts.js';
import { erasedIn } from './erasure.js';
import { levelOf } from './grants.js';
import type { TenantTransaction } from './tables.js';

/** One grant reaching somebody from outside: directly, or through a group they are in. */
export interface ExternalGrant {
  readonly id: string;
  readonly role: { readonly id: string; readonly name: string };
  readonly level: string;
  readonly effect: 'allow' | 'deny';
  readonly expiresAt: Date | null;
  readonly extends: string | null;
  readonly group: { readonly id: string; readonly name: string } | null;
}

/** Everybody from outside, with what reaches them and what it lets them read (IAM-051). */
export interface ExternalReach {
  readonly principal: {
    readonly id: string;
    readonly name: string | null;
    readonly email: string | null;
  };
  readonly grants: readonly ExternalGrant[];
  readonly reads: {
    readonly spaces: readonly { readonly id: string; readonly name: string }[];
    /** Artifacts read by a grant on themselves, outside what those spaces hold. */
    readonly included: readonly string[];
    /** Artifacts in those spaces refused by a grant on themselves. */
    readonly excluded: readonly string[];
  };
}

/**
 * **Who from outside can reach what** (IAM-051; access.md; the R13 plan, R13-F): IAM-029 asked from
 * the other end. Every principal from outside who is not erased, each grant reaching them - directly or
 * through a group - with its level and expiry, and the readable set those grants make, decided as every
 * read is. Read as an administrator of the tenant, which is the caller's to decide first.
 */
export async function listExternalReach(trx: TenantTransaction): Promise<ExternalReach[]> {
  const people = await trx
    .selectFrom('principal as p')
    .select(['p.id', 'p.display_name', 'p.email'])
    .where('p.kind', '=', 'external')
    .where(erasedIn('p'), '=', false)
    .orderBy('p.display_name')
    .orderBy('p.id')
    .execute();
  if (people.length === 0) return [];
  const ids = people.map((each) => each.id);
  const direct = await trx
    .selectFrom('access_grant as g')
    .innerJoin('role as r', 'r.id', 'g.role_id')
    .select([
      'g.id',
      'g.role_id',
      'r.name as role_name',
      'g.level',
      'g.space_id',
      'g.artifact_id',
      'g.effect',
      'g.expires_at',
      'g.extends',
      'g.principal_id as reached',
    ])
    .where('g.principal_id', 'in', ids)
    .execute();
  const grouped = await trx
    .selectFrom('access_grant as g')
    .innerJoin('role as r', 'r.id', 'g.role_id')
    .innerJoin('group_member as m', 'm.group_id', 'g.group_id')
    .innerJoin('access_group as a', 'a.id', 'g.group_id')
    .select([
      'g.id',
      'g.role_id',
      'r.name as role_name',
      'g.level',
      'g.space_id',
      'g.artifact_id',
      'g.effect',
      'g.expires_at',
      'g.extends',
      'm.principal_id as reached',
      'a.id as group_id',
      'a.name as group_name',
    ])
    .where('m.principal_id', 'in', ids)
    .execute();
  const spaceNames = new Map(
    (await trx.selectFrom('space').select(['id', 'name']).execute()).map((row) => [
      row.id,
      row.name,
    ]),
  );
  const grantOf = (
    row: (typeof direct)[number] & { group_id?: string; group_name?: string },
  ): ExternalGrant => ({
    id: row.id,
    role: { id: row.role_id, name: row.role_name },
    level: formatLevel(levelOf(row)),
    effect: row.effect,
    expiresAt: row.expires_at,
    extends: row.extends,
    group: row.group_id === undefined ? null : { id: row.group_id, name: row.group_name ?? '' },
  });
  const answer: ExternalReach[] = [];
  for (const person of people) {
    const readable = await loadReadableSet(trx, person.id);
    answer.push({
      principal: { id: person.id, name: person.display_name, email: person.email },
      grants: [
        ...direct.filter((row) => row.reached === person.id).map(grantOf),
        ...grouped.filter((row) => row.reached === person.id).map(grantOf),
      ],
      reads: {
        spaces: (readable?.spaces ?? [])
          .map((id) => ({ id, name: spaceNames.get(id) ?? '' }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        included: [...(readable?.included ?? [])],
        excluded: [...(readable?.excluded ?? [])],
      },
    });
  }
  return answer;
}
