import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody } from './schemas.js';

/**
 * Connecting CT Studio (docs/design/ct-studio-connect.md; API-074): what Administration's CT Studio
 * section shows and does. The signing key is a deployment secret: only whether one is set is said.
 */
export const CtStudioStatus = z.object({
  bridgeOn: z
    .boolean()
    .describe('Whether the service was started with a signing key, so `/bridge` answers CT Studio'),
  identity: z
    .object({
      id: z.string().describe('The service identity, by its principal'),
      name: z.string(),
      disabled: z.boolean().describe('Disabled identities are refused every delivery'),
    })
    .nullable()
    .describe("CT Studio's identity; none before the first connection"),
  token: z
    .object({ id: z.string(), name: z.string(), expiresAt: z.string() })
    .nullable()
    .describe(
      'The token CT Studio holds; none once revoked, or for an adopted identity whose token was not named',
    ),
  spaces: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        granted: z
          .boolean()
          .describe(
            "Whether CT Studio's identity holds Author here; without it deliveries are refused",
          ),
        data: z.boolean().describe('Whether data packages are delivered here'),
      }),
    )
    .describe('Every space with CT Studio settings, by name'),
  hostnames: z.array(z.string()).describe('The hostnames this environment answers at'),
  address: z.string().nullable().describe('The address the hand-off page last gave CT Studio'),
  sinkId: z.string().nullable().describe('The sink id the hand-off page last gave CT Studio'),
});
export type CtStudioStatus = z.infer<typeof CtStudioStatus>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const notAdministering = {
  description:
    'forbidden: the caller may not administer this environment; or token_not_allowed: CT Studio is connected with a signed-in session, never a token',
  schema: ErrorBody,
} as const;
const ADMINISTER = {
  check: 'permission',
  permission: 'administer',
  target: { tenant: true },
  credential: 'session',
} as const;

export const ctStudioRoutes = {
  getCtStudio: {
    operationId: 'getCtStudio',
    method: 'GET',
    path: '/v1/ct-studio',
    summary: "The environment's CT Studio: its identity, its token, and the spaces it delivers to",
    tenantScoped: true,
    access: ADMINISTER,
    responses: {
      200: { description: 'What is connected', schema: CtStudioStatus },
      401: unauthenticated,
      403: notAdministering,
    },
  },
} as const satisfies Record<string, RouteContract>;
