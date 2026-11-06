import type {
  ComponentGroupList,
  ComponentGroupListQuery,
  ComponentGroupParams,
  ComponentGroupVersionBody,
  ComponentGroupView,
  CreateComponentGroupBody,
  SpaceParams,
} from '@alloy-works/api-contract';
import {
  createComponentGroup,
  listComponentGroups,
  memberViews,
  readComponentGroup,
  recordComponentGroupVersion,
  type ComponentGroupAnswer,
  type StoredComponentGroup,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { decide, type AccessFacts } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { versionView } from './components.js';
import { cursorFor, languageOf, pageAsked } from './listing.js';
import type { SessionPrincipal } from './sessions.js';
import { refused } from './wire-codes.js';
import { workflowView } from './workflows.js';

/**
 * The component group routes (the CG plan, CG-A to CG-D, CG-K): listed, made, read and versioned.
 * Their workflow moves are the workflow routes', under the component workflow; placing one is the
 * document routes'.
 */

async function groupView(
  trx: TenantTransaction,
  principalId: string,
  stored: StoredComponentGroup,
  facts: AccessFacts,
): Promise<ComponentGroupView> {
  return {
    id: stored.id,
    title: stored.group.title,
    space: stored.space,
    version: versionView(stored.version),
    members: (await memberViews(trx, principalId, stored.group)).map((each) => ({
      component: each.component && { ...each.component },
      version: { ...each.version },
      newest: each.newest && { ...each.newest },
    })),
    mayEdit: decide('edit', facts).allowed,
    archived: stored.archived,
    ...(await workflowView(trx, stored.id, facts, principalId)),
  };
}

async function answered(
  trx: TenantTransaction,
  principalId: string,
  answer: ComponentGroupAnswer,
  facts: AccessFacts,
): Promise<ComponentGroupView> {
  switch (answer.answer) {
    case 'created':
    case 'recorded':
    case 'version.unchanged':
      return groupView(trx, principalId, answer.group, facts);
    case 'version.precondition':
      throw refused(
        409,
        'version.precondition',
        'This group has a newer version than the one this page opened.',
        { current: await groupView(trx, principalId, answer.current, facts) },
      );
    case 'member.invalid':
      // One sentence whatever was wrong, as a refused reference gets: nothing is learnt of what exists.
      throw refused(
        400,
        'group.member_invalid',
        'A member is not a component you may place in a group, or not at a version of its own.',
        { index: answer.index },
      );
    case 'space.missing':
    case 'group.missing':
      throw notFound();
  }
}

/** A listed group's state: every group has one, as every component does. */
function standing<T extends object>(id: string, state: T | null): T {
  if (state === null) throw new Error(`${id} has no workflow state`);
  return { ...state };
}

export function componentGroupHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
) {
  return {
    listComponentGroups: async (request: FastifyRequest): Promise<ComponentGroupList> => {
      const query = request.query as ComponentGroupListQuery;
      const asked = pageAsked('componentGroups', query, languageOf(request));
      const listed = await db.withTenant(tenantOf(request), (trx) =>
        listComponentGroups(
          trx,
          principalOf(request).principalId,
          asked,
          query.space === undefined ? {} : { space: query.space },
        ),
      );
      if (!listed) throw new Error('A signed-in principal is not in its own tenant');
      return {
        items: listed.items.map((item) => ({
          id: item.id,
          title: item.title,
          space: { ...item.space },
          version: {
            id: item.version.id,
            number: `${item.version.revision}.${item.version.version}`,
          },
          members: item.members,
          changedAt: item.changedAt.toISOString(),
          state: standing(item.id, item.state),
        })),
        next: cursorFor(
          'componentGroups',
          asked.sort,
          asked.order,
          listed.snapshot,
          listed.next,
          asked.language,
        ),
      };
    },

    createComponentGroup: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ) => {
      const { space } = request.params as SpaceParams;
      const body = request.body as CreateComponentGroupBody;
      // Decided at the space, which a new group inherits from.
      return answered(
        trx,
        principalId,
        await createComponentGroup(trx, {
          author: principalId,
          spaceId: space,
          title: body.title,
          members: body.members,
        }),
        facts,
      );
    },

    getComponentGroup: async (request: FastifyRequest, { trx, principalId, facts }: Authorised) => {
      const { id } = request.params as ComponentGroupParams;
      const stored = await readComponentGroup(trx, id);
      if (!stored) throw notFound();
      return groupView(trx, principalId, stored, facts);
    },

    recordComponentGroupVersion: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ) => {
      const { id } = request.params as ComponentGroupParams;
      const body = request.body as ComponentGroupVersionBody;
      return answered(
        trx,
        principalId,
        await recordComponentGroupVersion(trx, {
          author: principalId,
          id,
          openedFrom: body.openedFrom,
          title: body.title,
          members: body.members,
        }),
        facts,
      );
    },
  };
}
