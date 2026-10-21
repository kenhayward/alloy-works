import type {
  ChangeServiceIdentityBody,
  CreateServiceIdentityBody,
  CreateTokenBody,
  ServiceIdentityList,
  ServiceIdentityListQuery,
  ServiceIdentityParams,
  ServiceIdentityView,
  TokenIssued,
} from '@alloy-works/api-contract';
import {
  changeServiceIdentity,
  createServiceIdentity,
  disableServiceIdentity,
  listServiceIdentities,
  notifyTenant,
  serviceIdentity,
  type ServiceIdentity,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { afterCursor, cursorAfter, pageLimit } from './components.js';
import { AppError } from './errors.js';
import { issueChecked, newTokenSecret, tokenView } from './tokens.js';

function view(identity: ServiceIdentity): ServiceIdentityView {
  return {
    id: identity.id,
    name: identity.name,
    description: identity.description,
    createdBy: identity.createdBy,
    createdAt: identity.createdAt.toISOString(),
    disabledAt: identity.disabledAt && identity.disabledAt.toISOString(),
    tokens: identity.tokens,
  };
}

/**
 * Service identities (IAM-033; the G8 plan, G8-G and G8-H), each run in the transaction `administer`
 * at the tenant was decided in, with a session alone.
 */
export function serviceIdentityHandlers() {
  return {
    listServiceIdentities: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<ServiceIdentityList> => {
      const query = request.query as ServiceIdentityListQuery;
      const after = afterCursor(query.cursor);
      const page = await listServiceIdentities(trx, {
        ...(after === undefined ? {} : { after }),
        limit: pageLimit(query.limit),
      });
      return { items: page.items.map(view), next: cursorAfter(page.after) };
    },

    createServiceIdentity: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<ServiceIdentityView> => {
      const body = request.body as CreateServiceIdentityBody;
      return view(
        await createServiceIdentity(trx, {
          name: body.name,
          description: body.description,
          by: principalId,
        }),
      );
    },

    changeServiceIdentity: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<ServiceIdentityView> => {
      const { id } = request.params as ServiceIdentityParams;
      const body = request.body as ChangeServiceIdentityBody;
      const changed = await changeServiceIdentity(trx, id, {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.description === undefined ? {} : { description: body.description }),
      });
      if (!changed) throw notFound();
      return view(changed);
    },

    disableServiceIdentity: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<ServiceIdentityView> => {
      const { id } = request.params as ServiceIdentityParams;
      const disabled = await disableServiceIdentity(trx, id);
      if (!disabled) throw notFound();
      // Every replica stops what each token was doing within two seconds (IAM-082, D7-I).
      for (const token of disabled.revoked) {
        await notifyTenant(trx, { kind: 'credential_ended', token });
      }
      return view(disabled.identity);
    },

    issueServiceIdentityToken: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<TokenIssued> => {
      const { id } = request.params as ServiceIdentityParams;
      const body = request.body as CreateTokenBody;
      const held = await serviceIdentity(trx, id, { lock: true });
      if (!held) throw notFound();
      if (held.disabledAt !== null) {
        throw new AppError(
          409,
          'service_identity_disabled',
          'This service identity is disabled, so it is issued nothing.',
          'IAM-033',
        );
      }
      const secret = newTokenSecret();
      const issued = await issueChecked(trx, id, body, new Date(body.expiresAt), secret);
      // The secret, once: app.ts answers it `no-store`, and the route takes no idempotency key.
      return { ...tokenView(issued), secret };
    },
  };
}
