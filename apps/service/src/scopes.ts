import type {
  AcceptanceBody,
  AcceptanceView,
  ScopeBody,
  ScopeView,
  TransitionParams,
} from '@alloy-works/api-contract';
import {
  acceptRevision,
  loadFactsFor,
  pendingAcceptances,
  readScopes,
  setScope,
  type PendingAcceptance,
  type TenantTransaction,
} from '@alloy-works/db';
import { decide, scopeSchema, type Scope } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { refused } from './wire-codes.js';

/**
 * Scopes (workflow.md, "Scopes"; the R15 plan, R15-B): the condition axis values a component's or
 * document's next revision is effective for, each with its accepting party, set on `edit` and shown to
 * whoever reads it.
 */

type Party = { readonly kind: 'principal' | 'group'; readonly id: string };

/** Each party's name: a person's display name, a group's name; and what waits on acceptance. */
async function viewOf(
  trx: TenantTransaction,
  scope: Scope,
  waiting: readonly PendingAcceptance[],
): Promise<ScopeView> {
  const parties: Party[] = [
    ...scope.flatMap((each) => (each.party === null ? [] : [each.party])),
    ...waiting.map((each) => each.party),
  ];
  const principals = parties.flatMap((each) => (each.kind === 'principal' ? [each.id] : []));
  const groups = parties.flatMap((each) => (each.kind === 'group' ? [each.id] : []));
  const people = new Map(
    principals.length === 0
      ? []
      : (
          await trx
            .selectFrom('principal')
            .select(['id', 'display_name'])
            .where('id', 'in', principals)
            .execute()
        ).map((row) => [row.id, row.display_name]),
  );
  const named = new Map(
    groups.length === 0
      ? []
      : (
          await trx
            .selectFrom('access_group')
            .select(['id', 'name'])
            .where('id', 'in', groups)
            .execute()
        ).map((row) => [row.id, row.name]),
  );
  const nameOf = (party: Party) =>
    (party.kind === 'principal' ? people.get(party.id) : named.get(party.id)) ?? null;
  return {
    scope: scope.map((each) => ({
      axis: each.axis,
      value: each.value,
      party: each.party === null ? null : { ...each.party, name: nameOf(each.party) },
    })),
    pending: waiting.map((each) => ({
      ...each,
      party: { ...each.party, name: nameOf(each.party) },
    })),
  };
}

/** A component's or document's scope, and what waits on acceptance, for its view as `by` reads it. */
export async function scopeView(
  trx: TenantTransaction,
  id: string,
  by: string,
): Promise<{ scope: ScopeView }> {
  return {
    scope: await viewOf(
      trx,
      (await readScopes(trx, [id])).get(id)?.scope ?? [],
      await pendingAcceptances(trx, id, by),
    ),
  };
}

/** Whether a party is somebody, or a group, who may read the artifact (R15-E). */
async function partyMayRead(
  trx: TenantTransaction,
  party: NonNullable<Scope[number]['party']>,
  id: string,
): Promise<boolean> {
  if (party.kind === 'group') {
    const group = await trx
      .selectFrom('access_group')
      .select('id')
      .where('id', '=', party.id)
      .executeTakeFirst();
    return group !== undefined;
  }
  const person = await trx
    .selectFrom('principal')
    .select('id')
    .where('id', '=', party.id)
    .executeTakeFirst();
  const facts = person ? (await loadFactsFor(trx, party.id, [id])).get(id) : undefined;
  return facts !== undefined && decide('read', facts).allowed;
}

/** `PUT /v1/{components|documents}/{id}/scope`, decided on `edit` by the route. */
export function scopeHandlers() {
  const setting =
    (kind: 'component' | 'document') =>
    async (request: FastifyRequest, { trx, principalId }: Authorised): Promise<ScopeView> => {
      const { id } = request.params as TransitionParams;
      const body = request.body as ScopeBody;
      const parsed = scopeSchema.safeParse(body.scope);
      if (!parsed.success) throw refused(400, 'scope.invalid', 'Each axis value is named once.');
      for (const each of parsed.data) {
        if (each.party !== null && !(await partyMayRead(trx, each.party, id))) {
          throw refused(400, 'party.invalid', 'A party is somebody, or a group, who may read it.');
        }
      }
      const answer = await setScope(trx, {
        artifactId: id,
        kind,
        scope: parsed.data,
        by: principalId,
      });
      switch (answer.answer) {
        case 'artifact.missing':
          throw notFound();
        case 'artifact.archived':
          throw refused(409, 'artifact.archived', 'It is archived, and keeps its scope.');
        case 'scope.unknown':
          throw refused(
            400,
            'scope.unknown',
            `No condition axis declares ${answer.unknown.join(', ')}.`,
          );
        case 'set':
        case 'unchanged':
          return (await scopeView(trx, id, principalId)).scope;
      }
    };
  const accepting =
    (kind: 'component' | 'document') =>
    async (request: FastifyRequest, { trx, principalId }: Authorised): Promise<AcceptanceView> => {
      const { id } = request.params as TransitionParams;
      const body = request.body as AcceptanceBody;
      const answer = await acceptRevision(trx, { artifactId: id, kind, ...body, by: principalId });
      switch (answer.answer) {
        case 'revision.missing':
        case 'scope.missing':
          throw notFound();
        case 'party.not':
          throw refused(
            403,
            'acceptance.not_party',
            'Only the person, or a member of the group, named for this scope accepts it.',
          );
        case 'accepted':
        case 'unchanged':
          return { ...body, accepted: true };
      }
    };
  return {
    setComponentScope: setting('component'),
    setDocumentScope: setting('document'),
    acceptComponentRevision: accepting('component'),
    acceptDocumentRevision: accepting('document'),
  };
}
