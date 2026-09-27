import {
  componentTypeDefinitionSchema,
  fieldDefinitionSchema,
  metadataSchemaDefinitionSchema,
} from '@alloy-works/domain';
import { z } from 'zod';
import { VersionSummary } from './components.js';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

export const DefinitionParams = z.object({ id: LowercaseUuid });
export type DefinitionParams = z.infer<typeof DefinitionParams>;

export const DefinitionKind = z.enum(['field', 'metadataSchema', 'componentType']);

/** An identifier a payload is checked with, and never stored: the service allocates the real one. */
const PLACEHOLDER = '00000000-0000-4000-8000-000000000000';

const payloadSchemas = {
  field: fieldDefinitionSchema,
  metadataSchema: metadataSchemaDefinitionSchema,
  componentType: componentTypeDefinitionSchema,
} as const;

/**
 * A definition to make: its kind, and its payload without an `id` (definitions.md, DE-B), read by that
 * kind's own schema - the domain's, never restated - with a placeholder where the identifier will be.
 */
export const CreateDefinitionBody = z
  .strictObject({
    kind: DefinitionKind,
    definition: z.record(z.string(), z.unknown()),
  })
  .superRefine((body, context) => {
    if ('id' in body.definition) {
      context.addIssue({
        code: 'custom',
        path: ['definition', 'id'],
        message: 'A definition is identified by the service, not the caller',
      });
    } else if (
      !payloadSchemas[body.kind].safeParse({ ...body.definition, id: PLACEHOLDER }).success
    ) {
      context.addIssue({
        code: 'custom',
        path: ['definition'],
        message: 'Not a definition of this kind',
      });
    }
  });
export type CreateDefinitionBody = z.infer<typeof CreateDefinitionBody>;

/**
 * A definition's next version: the whole payload, from the version it was opened at (API-037). Its
 * kind is the definition's own, so the payload is read against it by the service.
 */
export const DefinitionVersionBody = z.strictObject({
  openedFrom: LowercaseUuid,
  definition: z.record(z.string(), z.unknown()),
});
export type DefinitionVersionBody = z.infer<typeof DefinitionVersionBody>;

export const DefinitionView = z.object({
  id: z.string(),
  kind: DefinitionKind,
  version: VersionSummary,
  definition: z
    .record(z.string(), z.unknown())
    .describe('The latest version\'s payload (metadata.md, "Definitions"), as stored'),
});
export type DefinitionView = z.infer<typeof DefinitionView>;

export const DefinitionList = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      kind: DefinitionKind,
      name: z.string(),
      version: z.object({ id: z.string(), number: z.string() }),
    }),
  ),
});
export type DefinitionList = z.infer<typeof DefinitionList>;

const Failure = z.object({
  code: z.string(),
  field: z.string(),
  rule: z.string(),
  schemas: z.array(z.string()),
  detail: z.string(),
});

/** A definition refused (definitions.md, "Making and changing"), each member naming what refused it. */
export const DefinitionRefusal = ErrorBody.extend({
  missing: z
    .array(z.string())
    .optional()
    .describe('definition_unresolved: what it names that is not there'),
  failures: z
    .array(Failure)
    .optional()
    .describe(
      "definition_unresolved, definition_invalid and assignment_conflict: each failure in MET-022's shape",
    ),
  holder: z
    .object({ id: z.string(), name: z.string() })
    .optional()
    .describe('definition_name_taken: the definition of its kind holding the name'),
  conflicts: z
    .array(
      z.object({
        field: z.string(),
        other: z.string(),
        places: z.array(z.record(z.string(), z.unknown())),
      }),
    )
    .optional()
    .describe('schema_conflict: each field, the schema beside it and every place the two meet'),
  broken: z
    .array(
      z.object({ schema: z.string(), default: z.unknown(), rule: z.string(), detail: z.string() }),
    )
    .optional()
    .describe("field_breaks_default: each schema whose default the field's next version refuses"),
  current: DefinitionView.optional().describe(
    'version_precondition: the definition as it now stands',
  ),
});
export type DefinitionRefusal = z.infer<typeof DefinitionRefusal>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const refusedDefinition = {
  description:
    '`definition_unresolved`, `definition_invalid`, `definition_name_taken` (MET-031), ' +
    '`assignment_conflict` (MET-008), `schema_conflict` (MET-040) or `field_breaks_default` ' +
    '(MET-037); or `invalid_request`, a payload that is not a definition of its kind',
  schema: DefinitionRefusal,
} as const;

/**
 * Fields, metadata schemas and component types (definitions.md, "Routes"): made and changed by
 * `manage_definitions` at the tenant (MET-024), read by `read` as access.md reads a definition.
 */
export const definitionRoutes = {
  listDefinitions: {
    operationId: 'listDefinitions',
    method: 'GET',
    path: '/v1/definitions',
    summary: 'Every field, metadata schema and component type at its latest version',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { tenant: true } },
    responses: {
      200: { description: 'The definitions, by kind and then name', schema: DefinitionList },
      401: unauthenticated,
      403: { description: 'The caller may not read the environment', schema: ErrorBody },
    },
  },
  createDefinition: {
    operationId: 'createDefinition',
    method: 'POST',
    path: '/v1/definitions',
    summary: 'Make a field, a metadata schema or a component type, at version 0.1',
    tenantScoped: true,
    access: { check: 'permission', permission: 'manage_definitions', target: { tenant: true } },
    body: CreateDefinitionBody,
    responses: {
      200: { description: 'Made, at version 0.1', schema: DefinitionView },
      400: refusedDefinition,
      401: unauthenticated,
      403: { description: 'The caller may not manage definitions', schema: ErrorBody },
    },
  },
  getDefinition: {
    operationId: 'getDefinition',
    method: 'GET',
    path: '/v1/definitions/{id}',
    summary: 'A definition at its latest version',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: DefinitionParams,
    responses: {
      200: { description: 'The definition', schema: DefinitionView },
      401: unauthenticated,
      403: {
        description: 'Never answered: a definition the caller may not read is not found',
        schema: ErrorBody,
      },
      404: {
        description: 'No such definition in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
  recordDefinitionVersion: {
    operationId: 'recordDefinitionVersion',
    method: 'POST',
    path: '/v1/definitions/{id}/versions',
    summary: "Cut a definition's next version from the one the caller opened",
    tenantScoped: true,
    access: {
      check: 'permission',
      permission: 'manage_definitions',
      target: { artifact: 'id' },
    },
    params: DefinitionParams,
    body: DefinitionVersionBody,
    responses: {
      200: {
        description:
          'The definition at its latest version: the one cut, or the one before where nothing changed',
        schema: DefinitionView,
      },
      400: refusedDefinition,
      401: unauthenticated,
      403: {
        description: 'The caller may read the definition but not manage it',
        schema: ErrorBody,
      },
      404: {
        description: 'No such definition in this environment, or none the caller may read',
        schema: ErrorBody,
      },
      409: {
        description:
          '`version_precondition`: the definition has a newer version than the one named',
        schema: DefinitionRefusal,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
