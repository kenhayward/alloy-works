import { z } from 'zod';
import { SpaceParams } from './components.js';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid, SPACE_ARCHIVED } from './schemas.js';

/** The most properties a space maps: CT Studio documents carry a handful, never hundreds. */
const MAX_MAPPED = 200;

/**
 * A space's bridge settings (docs/design/ct-studio-sink.md, "Metadata" and "Data tables"; API-071,
 * API-072): which component type and template CT Studio's deliveries take here, which of the
 * template's document fields each CT Studio property fills, and whether data packages are delivered.
 */
export const BridgeSettingsBody = z.strictObject({
  componentType: LowercaseUuid.nullable().describe(
    'The component type delivered components take; none means the environment default',
  ),
  template: LowercaseUuid.nullable().describe(
    'The template delivered documents are made from; none means a blank document, whose properties are all unmapped',
  ),
  propertyMap: z
    .record(z.string().min(1).max(200), LowercaseUuid)
    .refine((map) => Object.keys(map).length <= MAX_MAPPED, {
      message: `At most ${MAX_MAPPED} properties are mapped`,
    })
    .describe(
      "CT Studio property names to the id of the template's document field each fills; every field must be one the template gives a document",
    ),
  data: z
    .boolean()
    .describe(
      "Whether data packages are delivered to this space. Turning it on makes the environment's delivery schema and this space's connection to it, and sets the connection's credential, which no response shows; turning it off keeps the connection and the tables and stops new data deliveries",
    ),
});
export type BridgeSettingsBody = z.infer<typeof BridgeSettingsBody>;

export const BridgeSettingsView = BridgeSettingsBody.extend({
  connection: LowercaseUuid.nullable().describe(
    'The connection to the delivery store that data delivery made for this space, kept while data delivery is off; none until it was first turned on. Query definitions over the delivered tables are made on it. Its credential is never shown',
  ),
});
export type BridgeSettingsView = z.infer<typeof BridgeSettingsView>;

/** A refusal of the settings, naming each one that is refused. */
export const BridgeSettingsRefusal = ErrorBody.extend({
  problems: z
    .array(
      z.object({
        path: z
          .string()
          .describe('Where in the body: `componentType`, `template` or `propertyMap.<property>`'),
        reason: z.enum([
          'component_type_missing',
          'template_missing',
          'template_unresolved',
          'field_not_in_template',
        ]),
      }),
    )
    .optional(),
});
export type BridgeSettingsRefusal = z.infer<typeof BridgeSettingsRefusal>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;

/** The bridge settings of a space (API-071, API-072), read and written by whoever administers it. */
export const bridgeSettingsRoutes = {
  getBridgeSettings: {
    operationId: 'getBridgeSettings',
    method: 'GET',
    path: '/v1/spaces/{space}/bridge-settings',
    summary: "A space's settings for CT Studio deliveries",
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { space: 'space' } },
    params: SpaceParams,
    responses: {
      200: {
        description: 'The settings; a space never set up answers the empty ones, data delivery off',
        schema: BridgeSettingsView,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the space but may not administer it',
        schema: ErrorBody,
      },
      404: {
        description: 'No such space in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
  putBridgeSettings: {
    operationId: 'putBridgeSettings',
    method: 'PUT',
    path: '/v1/spaces/{space}/bridge-settings',
    summary: "Set a space's settings for CT Studio deliveries, and turn data delivery on or off",
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { space: 'space' } },
    params: SpaceParams,
    body: BridgeSettingsBody,
    responses: {
      200: { description: 'The settings as now stored', schema: BridgeSettingsView },
      401: unauthenticated,
      403: {
        description: 'The caller may read the space but may not administer it',
        schema: ErrorBody,
      },
      404: {
        description: 'No such space in this environment, or none the caller may read',
        schema: ErrorBody,
      },
      409: { description: SPACE_ARCHIVED, schema: ErrorBody },
      422: {
        description:
          '`bridge_settings_invalid`: a component type or template that is not here, or a property mapped to a field the template does not give a document; each is named and nothing is changed',
        schema: BridgeSettingsRefusal,
      },
      503: {
        description:
          '`delivery_store_unavailable`: this environment has no delivery store, or it did not answer; `connector_unavailable`: no connector is configured or it did not answer. Data delivery is not turned on and nothing is changed',
        schema: ErrorBody,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
