import {
  SUPPORT_READ_HEADER,
  type RouteContract,
  type SupportAccessBody,
  type SupportAccessGranted,
  type SupportAccessList,
  type SupportAccessParams,
  type SupportAccessView,
} from '@alloy-works/api-contract';
import {
  grantSupport,
  listSupport,
  recordSupportRead,
  recordSupportUse,
  revokeSupport,
  type StoredSupport,
  type SupportRefusal,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { supportReaches, type AccessFacts, type SupportGrant } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { contextOf } from './audit.js';
import { AppError } from './errors.js';
import { invitationView } from './invitations.js';
import { refused } from './wire-codes.js';

/**
 * Support access (docs/design/support.md; the SA plan, SA-D to SA-G): its routes, and the route hook
 * that holds a support principal to their scope.
 */

/** The writes a support principal may still make: signing out, their own sessions, presence, inbox. */
const SUPPORT_WRITES: ReadonlySet<string> = new Set([
  'signOut',
  'endSession',
  'endOtherSessions',
  'beatPresence',
  'leavePresence',
  'markNotificationRead',
  'deleteNotification',
  'setInboxPreferences',
]);

/** What a support principal needs to work at all, whatever its scope: the stream and their own inbox. */
const SUPPORT_READS: ReadonlySet<string> = new Set([
  'openStream',
  'listInbox',
  'getInboxPreferences',
]);

const supportScope = (message: string) =>
  new AppError(403, 'support_scope', message).refusing({
    permission: null,
    target: null,
    reason: 'support',
    level: null,
    hidden: false,
  });

const supportReadRequired = () =>
  new AppError(
    403,
    'support_read_required',
    'Reading content as support is a deliberate act: say why in a Support-Read header.',
  ).refusing({ permission: null, target: null, reason: 'support', level: null, hidden: false });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Why a support person reads content: the `Support-Read` header, trimmed, or undefined for none. */
function readPurpose(request: FastifyRequest): string | undefined {
  const header = request.headers[SUPPORT_READ_HEADER];
  const value = (Array.isArray(header) ? header[0] : header)?.trim();
  return value === undefined || value.length === 0 ? undefined : value.slice(0, 500);
}

/**
 * Holds a support principal to their grant before the route runs (SA-E, SA-F): every write is refused
 * but their own sessions, presence and inbox, and so is a token's making; a read their scope does not
 * reach is refused; a content read needs a `Support-Read` header. What is let through is still decided
 * as every request is - the decision reads the same grant, so a space it does not name is not found.
 * The use is recorded once a day, and each content read with its purpose (ADM-024).
 */
export async function holdToSupport(
  db: TenantDatabase,
  tenant: Tenant,
  request: FastifyRequest,
  route: RouteContract,
  support: SupportGrant,
): Promise<void> {
  const operation = route.operationId;
  if (route.method !== 'GET' && !SUPPORT_WRITES.has(operation)) {
    throw supportScope('Support access reads and changes nothing here.');
  }
  const diagnostics =
    route.access.check === 'permission' && route.access.permission === 'read_diagnostics';
  if (
    !diagnostics &&
    !SUPPORT_READS.has(operation) &&
    !supportReaches(support.scope, route.reads)
  ) {
    throw supportScope('Your support access does not reach this.');
  }
  const purpose = route.reads === 'content' ? readPurpose(request) : undefined;
  if (route.reads === 'content' && purpose === undefined) throw supportReadRequired();
  const params = (request.params ?? {}) as Record<string, unknown>;
  const on = Object.fromEntries(
    Object.entries(params).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && UUID.test(entry[1]),
    ),
  );
  await db.withTenant(
    tenant,
    async (trx) => {
      await recordSupportUse(trx, support);
      if (purpose !== undefined) {
        await recordSupportRead(trx, support, { route: operation, on, purpose });
      }
    },
    contextOf(request),
  );
}

/** The spaces a support principal's diagnostics reads may name, or undefined for anybody else. */
export function supportSpaces(facts: AccessFacts): readonly string[] | undefined {
  return facts.support?.spaces;
}

function view(support: StoredSupport): SupportAccessView {
  return {
    id: support.id,
    person: { ...support.principal },
    scope: support.scope,
    spaces: [...support.spaces],
    purpose: support.purpose,
    expiresAt: support.expiresAt.toISOString(),
    grantedBy: { ...support.grantedBy },
    grantedAt: support.grantedAt.toISOString(),
    revokedAt: support.revokedAt && support.revokedAt.toISOString(),
    revokedBy: support.revokedBy && { ...support.revokedBy },
    active: support.active,
  };
}

const REFUSALS: Readonly<Record<SupportRefusal, string>> = {
  'support.member':
    'That address is somebody in the organisation. Support access is for somebody from outside.',
  'support.erased': 'The person with that address was erased.',
  'support.active': 'They hold support access already. Revoke it first to give them another.',
  'support.expiry_past': 'Choose an end that is still to come.',
  'support.past_cap':
    'That is later than this environment lets access from outside last. Choose an earlier end.',
  'support.spaces_required': 'Name at least one space for support to look at.',
  'support.space_missing': 'One of those spaces is not in this environment.',
};

/** The routes, each run in the transaction its permission at the tenant was decided in. */
export function supportHandlers() {
  return {
    listSupportAccess: async (
      _request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<SupportAccessList> => {
      const items = (await listSupport(trx)).map(view);
      return { items, active: items.filter((each) => each.active).length };
    },

    grantSupportAccess: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<SupportAccessGranted> => {
      const body = request.body as SupportAccessBody;
      const answer = await grantSupport(trx, {
        email: body.email,
        scope: body.scope,
        spaces: body.spaces,
        purpose: body.purpose,
        expiresAt: new Date(body.expiresAt),
        grantedBy: principalId,
      });
      if ('refused' in answer) throw refused(409, answer.refused, REFUSALS[answer.refused]);
      return {
        support: view(answer.granted),
        invitation: answer.invitation && invitationView(answer.invitation, new Date()),
      };
    },

    revokeSupportAccess: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<SupportAccessView> => {
      const { id } = request.params as SupportAccessParams;
      const answer = await revokeSupport(trx, id, principalId);
      if ('refused' in answer) {
        if (answer.refused === 'support.missing') throw notFound();
        throw refused(409, 'support.revoked', 'That support access was revoked already.');
      }
      return view(answer.revoked);
    },
  };
}
