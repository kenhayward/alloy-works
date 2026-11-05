import type {
  ExtensionBody,
  ExternalAccessList,
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
  RoleBody,
  RoleMade,
  RoleListQuery,
} from '@alloy-works/api-contract';
import {
  extendGrant,
  grantInForce,
  listExternalReach,
  grant,
  listGrants,
  countPrincipals,
  listPrincipals,
  createRole,
  listRoles,
  readGrant,
  removeGrant,
  type GrantRefusal,
  type ListedGrant,
} from '@alloy-works/db';
import { formatLevel } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { refuseBeyondHolding } from './grant-limits.js';
import { afterCursor, cursorAfter, pageLimit } from './components.js';
import type { AppError } from './errors.js';
import { refused } from './wire-codes.js';

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
const REFUSALS = new Map<
  | GrantRefusal
  | 'grant.last_administrator'
  | 'grant.last_way_in'
  | 'grant.last_holder'
  | 'grant.not_external'
  | 'grant.not_later',
  string
>([
  [
    'grant.not_external',
    'Only an allow to someone from outside the organisation is extended this way; grant anybody else a new role.',
  ],
  ['grant.not_later', 'An extension ends later than now, and later than the grant it extends.'],
  ['grant.expiry_past', 'That expiry has already passed, so the grant would confer nothing.'],
  [
    'grant.duplicate',
    'That role is already granted to that person or group here, with that effect.',
  ],
  [
    'grant.allow_without_read',
    'A role that does not include read can only be denied, not allowed.',
  ],
  [
    'grant.administer_denied_at_tenant',
    'A role that includes administer or configure services cannot be denied across the whole environment.',
  ],
  ['grant.role_missing', 'There is no such role in this environment.'],
  ['grant.role_fixed', 'That role is granted only by sharing a publication.'],
  ['grant.subject_missing', 'There is no such person or group in this environment.'],
  ['grant.subject_erased', 'That person was erased, and is granted nothing again.'],
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
  [
    'grant.last_holder',
    'Nobody would hold an administrative permission of this role then, and nobody could give it again, so this grant cannot be removed.',
  ],
  [
    'grant.last_way_in',
    'Nobody who can still sign in would hold administer then, so this grant cannot be removed.',
  ],
]);

/** A refusal where a grant is made or removed, as 409 with the wire's spelling of the store's answer. */
/** What a role's refusals say; the contract already holds a body to some permissions, each named. */
const ROLE_REFUSALS = new Map([
  ['role.name_taken', 'There is already a role with that name.'],
  ['role.empty', 'A role must hold at least one permission.'],
  ['role.unknown_permission', 'A role can only hold the permissions the product has.'],
  ['role.repeated_permission', 'A role holds each permission once.'],
] as const);

function refuse(
  refusal:
    | GrantRefusal
    | 'grant.last_administrator'
    | 'grant.last_way_in'
    | 'grant.last_holder'
    | 'grant.not_external'
    | 'grant.not_later',
): AppError {
  return refused(409, refusal, REFUSALS.get(refusal)!);
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

    createRole: async (
      request: FastifyRequest,
      { trx, facts, target }: Authorised,
    ): Promise<RoleMade> => {
      const body = request.body as RoleBody;
      refuseBeyondHolding(body.permissions, facts, target);
      const answer = await createRole(trx, body.name, body.permissions);
      if ('refused' in answer) {
        throw refused(409, answer.refused, ROLE_REFUSALS.get(answer.refused)!);
      }
      return { role: { ...answer.role, permissions: [...answer.role.permissions] } };
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
      return {
        items: [...page.items],
        next: cursorAfter(page.after),
        total: await countPrincipals(trx),
      };
    },

    makeGrant: async (
      request: FastifyRequest,
      { trx, principalId, target, facts }: Authorised,
    ): Promise<GrantMade> => {
      const body = request.body as GrantBody;
      const role = await trx
        .selectFrom('role')
        .select('permissions')
        .where('id', '=', body.role)
        .executeTakeFirst();
      if (role) refuseBeyondHolding(role.permissions, facts, target);
      const answer = await grant(trx, {
        roleId: body.role,
        subject: body.subject,
        level: target,
        effect: body.effect,
        // As asked (IAM-049; the R13 plan, R13-E): held to the cap where it reaches outside.
        ...(body.expiresAt === undefined
          ? {}
          : { expiresAt: new Date(body.expiresAt), refusePast: true }),
        grantedBy: principalId,
      });
      if ('refused' in answer) throw refuse(answer.refused);
      const made = await readGrant(trx, answer.granted.id);
      if (!made) throw new Error('A grant made in this transaction was not there to read');
      return { grant: grantView(made) };
    },

    /** A positive act by an administrator of where it stands (IAM-050; the R13 plan, R13-E). */
    extendGrant: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<GrantMade> => {
      const { id } = request.params as GrantParams;
      const body = request.body as ExtensionBody;
      const answer = await extendGrant(trx, {
        grant: id,
        ...(body.expiresAt === undefined ? {} : { expiresAt: new Date(body.expiresAt) }),
        by: principalId,
      });
      if ('refused' in answer) {
        if (answer.refused === 'grant.missing') throw notFound();
        throw refuse(answer.refused);
      }
      const made = await readGrant(trx, answer.granted.id);
      if (!made) throw new Error('A grant made in this transaction was not there to read');
      return { grant: grantView(made) };
    },

    /** Who from outside can reach what (IAM-051; the R13 plan, R13-F). */
    listExternalAccess: async (
      _request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<ExternalAccessList> => ({
      items: (await listExternalReach(trx)).map((each) => ({
        principal: { ...each.principal },
        grants: each.grants.map((grant) => ({
          ...grant,
          role: { ...grant.role },
          expiresAt: grant.expiresAt?.toISOString() ?? null,
          group: grant.group && { ...grant.group },
          on: grant.on && { ...grant.on },
        })),
        reads: {
          spaces: each.reads.spaces.map((space) => ({ ...space })),
          included: [...each.reads.included],
          excluded: [...each.reads.excluded],
        },
      })),
    }),

    removeGrant: async (
      request: FastifyRequest,
      { trx, facts, target }: Authorised,
    ): Promise<GrantRemoved> => {
      const { id } = request.params as GrantParams;
      // Taking an allow away is open; taking a denial away gives back what it denied (GL-D).
      const removing = await grantInForce(trx, id);
      if (removing?.effect === 'deny') refuseBeyondHolding(removing.permissions, facts, target);
      const answer = await removeGrant(trx, id);
      if ('refused' in answer) {
        if (answer.refused === 'grant.missing') throw notFound();
        throw refuse(answer.refused);
      }
      return { removed: answer.removed.id };
    },
  };
}
