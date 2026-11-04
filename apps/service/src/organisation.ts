import type {
  OrganisationTenantParams,
  OrganisationTenants,
  Suspended,
  SuspensionBody,
} from '@alloy-works/api-contract';
import {
  cancelClosureFromOrganisation,
  hasOrganisationToLift,
  liftFromOrganisation,
  organisationTenants,
  suspendFromOrganisation,
  suspendTenant,
  TenantStateRefused,
  type Tenant,
  type TenantTransaction,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import type { Authorised } from './access.js';
import { AppError } from './errors.js';

/**
 * **Stopping a tenant** (tenant-lifecycle.md, TL-D, TL-L). From inside it, where somebody outside can
 * lift it; from its organisation's tenant, which reaches it through functions returning metadata and
 * writes both logs.
 */

const missing = () =>
  new AppError(404, 'not_found', 'There is no such tenant in this organisation.', 'IAM-069');
const refused = (message: string) => new AppError(409, 'tenant_state_refused', message, 'ADM-028');
const noOrganisation = () =>
  new AppError(
    409,
    'no_organisation_to_lift',
    'Nobody could lift this: suspending stops everyone here, and this environment has no organisation administering it.',
    'ADM-028',
  );

const listed = async (trx: TenantTransaction): Promise<OrganisationTenants> => ({
  items: (await organisationTenants(trx)).map((each) => ({
    id: each.id,
    name: each.name,
    state: each.state,
    since: each.since.toISOString(),
    closedBy: each.closingBy,
    graceEndsAt: each.graceEndsAt?.toISOString() ?? null,
    hostnames: [...each.hostnames],
  })),
});

const asked = async (
  trx: TenantTransaction,
  work: () => Promise<'done' | 'missing'>,
): Promise<OrganisationTenants> => {
  try {
    if ((await work()) === 'missing') throw missing();
  } catch (error) {
    if (error instanceof TenantStateRefused) throw refused(error.message);
    throw error;
  }
  return listed(trx);
};

export function organisationHandlers(tenantOf: (request: FastifyRequest) => Tenant) {
  const target = (request: FastifyRequest) => (request.params as OrganisationTenantParams).id;
  return {
    suspendEnvironment: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<Suspended> => {
      if (!(await hasOrganisationToLift(trx))) throw noOrganisation();
      try {
        await suspendTenant(trx, tenantOf(request), (request.body as SuspensionBody).reason);
      } catch (error) {
        if (error instanceof TenantStateRefused) throw refused(error.message);
        throw error;
      }
      return { state: 'suspended' };
    },

    listOrganisationTenants: (_request: FastifyRequest, { trx }: Authorised) => listed(trx),

    suspendOrganisationTenant: (request: FastifyRequest, { trx }: Authorised) =>
      asked(trx, () =>
        suspendFromOrganisation(trx, target(request), (request.body as SuspensionBody).reason),
      ),

    liftOrganisationSuspension: (request: FastifyRequest, { trx }: Authorised) =>
      asked(trx, () => liftFromOrganisation(trx, target(request))),

    cancelOrganisationClosure: (request: FastifyRequest, { trx }: Authorised) =>
      asked(trx, () => cancelClosureFromOrganisation(trx, target(request))),
  };
}
