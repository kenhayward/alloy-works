import type {
  GrantBody,
  GrantList,
  GrantListQuery,
  GrantMade,
  GrantParams,
  GrantRemoved,
  GrantView,
  PrincipalList,
  PrincipalListQuery,
  RoleList,
  RoleListQuery,
} from '@alloy-works/api-contract';
import {
  grant,
  listGrants,
  listPrincipals,
  listRoles,
  readGrant,
  removeGrant,
  type GrantRefusal,
  type ListedGrant,
} from '@alloy-works/db';
import { formatLevel } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { afterCursor, cursorAfter, pageLimit } from './components.js';
import { AppError } from './errors.js';
import { wireCode } from './wire-codes.js';

/** A grant as the API shows it: its level spelled as a target, and its times as ISO strings. */
export function grantView(listed: ListedGrant): GrantView {
  return {
    id: listed.id,
    role: listed.role,
    subject: listed.subject,
    level: formatLevel(listed.level),
    effect: listed.effect,
    expiresAt: listed.expiresAt && listed.expiresAt.toISOString(),
    extends: listed.extends,
    grantedBy: listed.grantedBy,
    grantedAt: listed.grantedAt.toISOString(),
  };
}

/** What each refusal says, for a person managing access rather than for somebody reading the code. */
const REFUSALS = new Map<GrantRefusal | 'grant.last_administrator', string>([
  ['grant.duplicate', 'That role is already granted to that person here, with that effect.'],
  [
    'grant.allow_without_read',
    'A role that does not include read can only be denied, not allowed.',
  ],
  [
    'grant.administer_denied_at_tenant',
    'A role that includes administer cannot be denied across the whole environment.',
  ],
  ['grant.role_missing', 'There is no such role in this environment.'],
  ['grant.subject_missing', 'There is no such person in this environment.'],
  [
    'grant.external_at_tenant',
    'Someone from outside the organisation can be granted access to a space or an item, never the whole environment.',
  ],
  [
    'grant.external_capped',
    'Someone from outside the organisation cannot be allowed a role that edits, creates, approves, publishes, designs, manages definitions or administers.',
  ],
  [
    'grant.external_past_cap',
    'That expiry is later than this environment allows for someone from outside the organisation.',
  ],
  [
    'grant.last_administrator',
    'This is the last grant that lets anyone administer this environment, so it cannot be removed.',
  ],
]);

/** A refusal where a grant is made or removed, as 409 with the wire's spelling of the store's answer. */
function refuse(refusal: GrantRefusal | 'grant.last_administrator'): AppError {
  return new AppError(409, wireCode(refusal), REFUSALS.get(refusal)!);
}

/**
 * The handlers for managing grants. Each runs in the transaction `administer` was decided in, at the
 * level the request names - the query's, the body's, or the level the grant to be removed was made at.
 */
export function managingAccessHandlers() {
  return {
    listGrants: async (
      request: FastifyRequest,
      { trx, target }: Authorised,
    ): Promise<GrantList> => {
      const query = request.query as GrantListQuery;
      const after = afterCursor(query.cursor);
      const page = await listGrants(trx, target, {
        ...(after === undefined ? {} : { after }),
        limit: pageLimit(query.limit),
      });
      return { items: page.items.map(grantView), next: cursorAfter(page.after) };
    },

    listRoles: async (request: FastifyRequest, { trx }: Authorised): Promise<RoleList> => {
      const query = request.query as RoleListQuery;
      const after = afterCursor(query.cursor);
      const page = await listRoles(trx, {
        ...(after === undefined ? {} : { after }),
        limit: pageLimit(query.limit),
      });
      return {
        items: page.items.map((role) => ({ ...role, permissions: [...role.permissions] })),
        next: cursorAfter(page.after),
      };
    },

    listPrincipals: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<PrincipalList> => {
      const query = request.query as PrincipalListQuery;
      const after = afterCursor(query.cursor);
      const page = await listPrincipals(trx, {
        ...(after === undefined ? {} : { after }),
        limit: pageLimit(query.limit),
      });
      return { items: [...page.items], next: cursorAfter(page.after) };
    },

    makeGrant: async (
      request: FastifyRequest,
      { trx, principalId, target }: Authorised,
    ): Promise<GrantMade> => {
      const body = request.body as GrantBody;
      const answer = await grant(trx, {
        roleId: body.role,
        subject: { principal: body.subject.principal },
        level: target,
        effect: body.effect,
        grantedBy: principalId,
      });
      if ('refused' in answer) throw refuse(answer.refused);
      const made = await readGrant(trx, answer.granted.id);
      if (!made) throw new Error('A grant made in this transaction was not there to read');
      return { grant: grantView(made) };
    },

    removeGrant: async (request: FastifyRequest, { trx }: Authorised): Promise<GrantRemoved> => {
      const { id } = request.params as GrantParams;
      const answer = await removeGrant(trx, id);
      if ('refused' in answer) {
        if (answer.refused === 'grant.missing') throw notFound();
        throw refuse(answer.refused);
      }
      return { removed: answer.removed.id };
    },
  };
}
