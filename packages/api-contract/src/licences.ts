import { licenceDefinitionSchema } from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

export const LicenceParams = z.object({ id: LowercaseUuid });
export type LicenceParams = z.infer<typeof LicenceParams>;

const VersionNumber = z.object({ id: z.string(), number: z.string() });

/** A licence at its latest version (the AL plan, AL-B), the domain's own shape. */
export const LicenceView = z.object({
  id: z.string(),
  version: VersionNumber,
  licence: licenceDefinitionSchema,
});
export type LicenceView = z.infer<typeof LicenceView>;

export const LicenceList = z.object({ items: z.array(LicenceView) });
export type LicenceList = z.infer<typeof LicenceList>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const signedIn = { check: 'session' } as const;

/**
 * Licences (the AL plan, AL-B): read by anyone signed in, since an uploader declares the one an image
 * is held under; written through `/v1/definitions` by `manage_definitions` at the tenant.
 */
export const licenceRoutes = {
  listLicences: {
    operationId: 'listLicences',
    method: 'GET',
    path: '/v1/licences',
    summary: "The environment's licences, each at its latest version",
    tenantScoped: true,
    access: signedIn,
    responses: {
      200: { description: 'Every licence, by name', schema: LicenceList },
      401: unauthenticated,
    },
  },
  getLicence: {
    operationId: 'getLicence',
    method: 'GET',
    path: '/v1/licences/{id}',
    summary: 'A licence at its latest version',
    tenantScoped: true,
    access: signedIn,
    params: LicenceParams,
    responses: {
      200: { description: 'The licence', schema: LicenceView },
      401: unauthenticated,
      404: { description: 'No such licence in this environment', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
