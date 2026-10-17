import { scopeSchema, type Scope, type ScopedRevision } from '@alloy-works/domain';
import { sql } from 'kysely';
import { isArchived } from './archival.js';
import { artifactPlace, recordEvent } from './audit.js';
import { axesByKey } from './definitions.js';
import { isDeleted } from './deletion.js';
import type { TenantTransaction } from './tables.js';
import { lockArtifact } from './versions.js';

/**
 * **Scopes** (workflow.md, "Scopes"; the R15 plan, R15-A to R15-E): the condition axis values a
 * component's or document's next revision is effective for, set as acts; fixed into the revision as a
 * gate designates it; and each revision's scopes as `effectiveRevision` reads them.
 */

const scopesKnown = new WeakMap<TenantTransaction, boolean>();

/** Whether this schema has 0111's tables: migration tests run this code on older ones. */
export async function scopesStored(trx: TenantTransaction): Promise<boolean> {
  const known = scopesKnown.get(trx);
  if (known !== undefined) return known;
  const { rows } = await sql<{
    present: boolean;
  }>`select to_regclass('revision_scope') is not null as present`.execute(trx);
  const present = rows[0]?.present === true;
  scopesKnown.set(trx, present);
  return present;
}

export interface ArtifactScope {
  readonly scope: Scope;
  readonly by: string;
  readonly at: Date;
}

/** Each of these artifacts' scope now, where one was ever set. */
export async function readScopes(
  trx: TenantTransaction,
  artifactIds: readonly string[],
): Promise<Map<string, ArtifactScope>> {
  if (artifactIds.length === 0 || !(await scopesStored(trx))) return new Map();
  const rows = await trx
    .selectFrom('artifact_scope')
    .distinctOn('artifact_id')
    .select(['artifact_id', 'scope', 'by', 'at'])
    .where('artifact_id', 'in', [...artifactIds])
    .orderBy('artifact_id')
    .orderBy('id', 'desc')
    .execute();
  return new Map(
    rows.map((row) => [
      row.artifact_id,
      { scope: scopeSchema.parse(row.scope), by: row.by, at: row.at },
    ]),
  );
}

export type SetScopeAnswer =
  | { readonly answer: 'set' | 'unchanged'; readonly scope: ArtifactScope | null }
  | { readonly answer: 'artifact.missing' | 'artifact.archived' }
  | { readonly answer: 'scope.unknown'; readonly unknown: readonly string[] };

/**
 * Sets the axis values a component's or document's next revision is effective for (LIF-042; R15-B),
 * under its lock, as an act, audited `scope.set`: each a declared axis's declared value. The caller has
 * decided they may edit it, and that each party may read it. The same scope again changes nothing.
 */
export async function setScope(
  trx: TenantTransaction,
  input: {
    readonly artifactId: string;
    readonly kind: 'component' | 'document';
    readonly scope: Scope;
    readonly by: string;
  },
): Promise<SetScopeAnswer> {
  const scope = scopeSchema.parse(input.scope);
  await lockArtifact(trx, input.artifactId);
  const artifact = await trx
    .selectFrom('artifact')
    .select('kind')
    .where('id', '=', input.artifactId)
    .executeTakeFirst();
  if (artifact?.kind !== input.kind || (await isDeleted(trx, input.artifactId))) {
    return { answer: 'artifact.missing' };
  }
  if (await isArchived(trx, input.artifactId)) return { answer: 'artifact.archived' };
  const axes = await axesByKey(trx);
  const unknown = scope
    .filter((each) => !axes.get(each.axis)?.values.some((value) => value.key === each.value))
    .map((each) => `${each.axis}.${each.value}`);
  if (unknown.length > 0) return { answer: 'scope.unknown', unknown };
  const was = (await readScopes(trx, [input.artifactId])).get(input.artifactId) ?? null;
  if (JSON.stringify(was?.scope ?? []) === JSON.stringify(scope)) {
    return { answer: 'unchanged', scope: was };
  }
  await trx
    .insertInto('artifact_scope')
    .values({
      artifact_id: input.artifactId,
      kind: input.kind,
      scope: JSON.stringify(scope),
      by: input.by,
    })
    .execute();
  const place = await artifactPlace(trx, input.artifactId);
  await recordEvent(
    trx,
    {
      kind: 'scope.set',
      subject: { kind: input.kind, id: input.artifactId, version: place.version },
      space: place.space,
      detail: { kind: input.kind, scope },
    },
    place.labels,
  );
  return {
    answer: 'set',
    scope: (await readScopes(trx, [input.artifactId])).get(input.artifactId)!,
  };
}

/**
 * As a gate designates a revision (R15-B): the artifact's scope now, fixed into it, one row a value.
 * Answers what it fixed, for `revision.designated`'s detail.
 */
export async function fixScope(
  trx: TenantTransaction,
  input: { readonly artifactId: string; readonly version: string },
): Promise<Scope> {
  if (!(await scopesStored(trx))) return [];
  const scope = (await readScopes(trx, [input.artifactId])).get(input.artifactId)?.scope ?? [];
  if (scope.length === 0) return [];
  await trx
    .insertInto('revision_scope')
    .values(
      scope.map((each) => ({
        version_id: input.version,
        artifact_id: input.artifactId,
        axis: each.axis,
        value: each.value,
        party_principal: each.party?.kind === 'principal' ? each.party.id : null,
        party_group: each.party?.kind === 'group' ? each.party.id : null,
      })),
    )
    .execute();
  return scope;
}

/** A revision's scopes as `effectiveRevision` reads them: each value, pending until its party accepts. */
export async function revisionScopes(
  trx: TenantTransaction,
  artifactIds: readonly string[],
): Promise<Map<string, ScopedRevision['scopes']>> {
  if (artifactIds.length === 0 || !(await scopesStored(trx))) return new Map();
  const { rows } = await sql<{
    version_id: string;
    axis: string;
    value: string;
    pending: boolean;
  }>`
    select s.version_id, s.axis, s.value,
           ((s.party_principal is not null or s.party_group is not null) and a.version_id is null)
             as pending
      from revision_scope s
      left join revision_acceptance a
        on a.version_id = s.version_id and a.axis = s.axis and a.value = s.value
     where s.artifact_id = any(${[...artifactIds]}::uuid[])
     order by s.version_id, s.axis, s.value`.execute(trx);
  const scopes = new Map<string, { axis: string; value: string; pending: boolean }[]>();
  for (const row of rows) {
    scopes.set(row.version_id, [
      ...(scopes.get(row.version_id) ?? []),
      { axis: row.axis, value: row.value, pending: row.pending },
    ]);
  }
  return scopes;
}

export type AcceptAnswer = {
  readonly answer: 'accepted' | 'unchanged' | 'scope.missing' | 'party.not' | 'revision.missing';
};

/**
 * A revision accepted in one scope by its party (LIF-047; R15-E), under the artifact's lock, audited
 * `revision.accepted`: the person named, or a member of the group named, and nobody else; once.
 * Whether they may read it is the caller's to have decided.
 */
export async function acceptRevision(
  trx: TenantTransaction,
  input: {
    readonly artifactId: string;
    readonly kind: 'component' | 'document';
    readonly revision: number;
    readonly axis: string;
    readonly value: string;
    readonly by: string;
  },
): Promise<AcceptAnswer> {
  await lockArtifact(trx, input.artifactId);
  const designated = await trx
    .selectFrom('revision_designation')
    .select('version_id')
    .where('artifact_id', '=', input.artifactId)
    .where('kind', '=', input.kind)
    .where('revision_no', '=', input.revision)
    .executeTakeFirst();
  if (!designated) return { answer: 'revision.missing' };
  const scoped = await trx
    .selectFrom('revision_scope')
    .select(['party_principal', 'party_group'])
    .where('version_id', '=', designated.version_id)
    .where('axis', '=', input.axis)
    .where('value', '=', input.value)
    .executeTakeFirst();
  if (!scoped || (scoped.party_principal === null && scoped.party_group === null)) {
    return { answer: 'scope.missing' };
  }
  const party =
    scoped.party_principal === input.by ||
    (scoped.party_group !== null &&
      (await trx
        .selectFrom('group_member')
        .select('principal_id')
        .where('group_id', '=', scoped.party_group)
        .where('principal_id', '=', input.by)
        .executeTakeFirst()) !== undefined);
  if (!party) return { answer: 'party.not' };
  const inserted = await trx
    .insertInto('revision_acceptance')
    .values({
      version_id: designated.version_id,
      axis: input.axis,
      value: input.value,
      by: input.by,
    })
    .onConflict((conflict) => conflict.doNothing())
    .returning('version_id')
    .execute();
  if (inserted.length === 0) return { answer: 'unchanged' };
  const place = await artifactPlace(trx, input.artifactId);
  await recordEvent(
    trx,
    {
      kind: 'revision.accepted',
      subject: { kind: input.kind, id: input.artifactId, version: designated.version_id },
      space: place.space,
      detail: {
        kind: input.kind,
        revision: input.revision,
        version: designated.version_id,
        axis: input.axis,
        value: input.value,
      },
    },
    place.labels,
  );
  return { answer: 'accepted' };
}

/** A scope value whose newest revision waits on its party's acceptance (LIF-047; R15-E). */
export interface PendingAcceptance {
  readonly revision: number;
  readonly axis: string;
  readonly value: string;
  readonly party: { readonly kind: 'principal' | 'group'; readonly id: string };
  /** Whether `by` is the person named, or a member of the group named. */
  readonly mayAccept: boolean;
}

/**
 * What waits on acceptance in an artifact's scopes (LIF-047; R15-E): for each value, its newest
 * revision, where that names a party who has not accepted it; with whether `by` may accept it.
 */
export async function pendingAcceptances(
  trx: TenantTransaction,
  artifactId: string,
  by: string,
): Promise<PendingAcceptance[]> {
  if (!(await scopesStored(trx))) return [];
  const { rows } = await sql<{
    revision: number;
    axis: string;
    value: string;
    party_principal: string | null;
    party_group: string | null;
    may_accept: boolean;
  }>`
    select n.revision_no as revision, n.axis, n.value, n.party_principal, n.party_group,
           (n.party_principal = ${by}::uuid
             or exists (select 1 from group_member m
                         where m.group_id = n.party_group and m.principal_id = ${by}::uuid))
             as may_accept
      from (
        select distinct on (s.axis, s.value) s.version_id, s.axis, s.value, s.party_principal,
               s.party_group, d.revision_no
          from revision_scope s
          join revision_designation d on d.version_id = s.version_id
         where s.artifact_id = ${artifactId}::uuid
         order by s.axis, s.value, d.revision_no desc
      ) n
     where (n.party_principal is not null or n.party_group is not null)
       and not exists (select 1 from revision_acceptance a
                        where a.version_id = n.version_id and a.axis = n.axis and a.value = n.value)
     order by n.axis, n.value`.execute(trx);
  return rows.map((row) => ({
    revision: row.revision,
    axis: row.axis,
    value: row.value,
    party:
      row.party_principal !== null
        ? { kind: 'principal' as const, id: row.party_principal }
        : { kind: 'group' as const, id: row.party_group! },
    mayAccept: row.may_accept === true,
  }));
}
