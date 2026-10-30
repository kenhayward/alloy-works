import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { BridgeSettingsBody, BridgeSettingsView } from './bridge-settings.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';
import { TokenIssued } from './tokens.js';

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

/** Connecting a space: whose identity CT Studio acts as, and what deliveries there become. */
export const CtStudioConnectBody = z.strictObject({
  space: LowercaseUuid.describe('The space deliveries go to'),
  identity: z
    .union([
      z.strictObject({ make: z.literal(true) }),
      z.strictObject({
        adopt: LowercaseUuid.describe("A service identity made by hand, to be CT Studio's"),
        token: LowercaseUuid.describe('Which of its tokens CT Studio holds'),
      }),
    ])
    .nullable()
    .describe(
      'The first time, `make` one or `adopt` one made by hand; afterwards null, reusing the recorded one',
    ),
  settings: BridgeSettingsBody.describe(
    "The space's bridge settings, as PUT bridge-settings takes them",
  ),
  address: z
    .string()
    .url()
    .refine((value) => value.startsWith('https://'), { message: 'An https address' })
    .describe('The address CT Studio reaches this environment at, without `/bridge`'),
  sinkId: z
    .string()
    .regex(/^[a-z0-9-]{1,64}$/)
    .describe('The id CT Studio registers this sink under: lowercase letters, digits and hyphens'),
});
export type CtStudioConnectBody = z.infer<typeof CtStudioConnectBody>;

export const CtStudioConnected = z.object({
  status: CtStudioStatus,
  issued: TokenIssued.nullable().describe(
    "CT Studio's new token, with its secret shown this once; none when the identity was reused or adopted",
  ),
  space: z.object({ id: z.string(), name: z.string() }),
  settings: BridgeSettingsView,
});
export type CtStudioConnected = z.infer<typeof CtStudioConnected>;

export const CtStudioTokenBody = z.strictObject({
  replaceIdentity: z
    .boolean()
    .describe(
      'Make a new identity in place of a disabled one, granted Author at every connected space, and issue its token',
    ),
});
export type CtStudioTokenBody = z.infer<typeof CtStudioTokenBody>;

export const CtStudioTokenIssued = z.object({
  status: CtStudioStatus,
  issued: TokenIssued.describe("CT Studio's new token, with its secret shown this once"),
});
export type CtStudioTokenIssued = z.infer<typeof CtStudioTokenIssued>;

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
/** Connecting grants CT Studio's identity Author, so the transaction changes access. */
const CHANGES_ACCESS = { ...ADMINISTER, changesAccess: true } as const;

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
  connectCtStudio: {
    operationId: 'connectCtStudio',
    method: 'POST',
    path: '/v1/ct-studio/connections',
    summary:
      'Connect a space to CT Studio: its identity, its Author grant, its token and its settings',
    tenantScoped: true,
    access: CHANGES_ACCESS,
    // A token's secret is answered once and never kept, so no answer is remembered for a replay.
    idempotencyKey: false,
    body: CtStudioConnectBody,
    responses: {
      200: {
        description: 'Connected, with a new token shown this once',
        schema: CtStudioConnected,
      },
      401: unauthenticated,
      403: notAdministering,
      404: { description: 'No such space, or no such identity to adopt', schema: ErrorBody },
      409: {
        description:
          '`ct_studio_not_set_up`: no identity is recorded to reuse; `ct_studio_already_set_up`: one is, so none is made or adopted; `ct_studio_identity_disabled`: the identity is disabled; or a refusal PUT bridge-settings gives',
        schema: ErrorBody,
      },
      422: {
        description:
          "`ct_studio_token_unusable`: the token to adopt is not the identity's, cannot both create and edit, or is revoked or expired; or `bridge_settings_invalid` as PUT bridge-settings gives it. Nothing is made",
        schema: ErrorBody,
      },
      503: { description: 'As PUT bridge-settings, turning data on', schema: ErrorBody },
    },
  },
  issueCtStudioToken: {
    operationId: 'issueCtStudioToken',
    method: 'POST',
    path: '/v1/ct-studio/tokens',
    summary: 'Issue CT Studio a new token, or a new identity in place of a disabled one',
    tenantScoped: true,
    access: CHANGES_ACCESS,
    // A token's secret is answered once and never kept, so no answer is remembered for a replay.
    idempotencyKey: false,
    body: CtStudioTokenBody,
    responses: {
      200: { description: 'Issued, with its secret shown this once', schema: CtStudioTokenIssued },
      401: unauthenticated,
      403: notAdministering,
      409: {
        description:
          '`ct_studio_not_set_up`: there is no CT Studio identity; `ct_studio_identity_disabled`: it is disabled and was not asked to be replaced; `ct_studio_identity_enabled`: it was asked to be replaced while still enabled',
        schema: ErrorBody,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
