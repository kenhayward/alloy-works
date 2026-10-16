import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

export const RelationshipParams = z.object({ id: z.uuid() });
export type RelationshipParams = z.infer<typeof RelationshipParams>;

const EndBody = z.strictObject({
  artifact: LowercaseUuid.describe('The artifact at this end'),
  version: LowercaseUuid.nullable()
    .optional()
    .describe('The version of it this end pins; none, or null, floats at its latest (REL-043)'),
});

/** A relationship to make (REL-001, REL-013; the R8 plan, R8-D). */
export const MakeRelationshipBody = z.strictObject({
  type: LowercaseUuid.describe('The relationship type, a definition of kind `relationshipType`'),
  from: EndBody,
  to: EndBody,
  values: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Its values for the fields its type's schemas assign, by field identifier"),
});
export type MakeRelationshipBody = z.infer<typeof MakeRelationshipBody>;

/** A relationship changed (REL-033): an end re-targeted or re-pinned, or its values, given whole. */
export const ChangeRelationshipBody = z
  .strictObject({
    from: EndBody.optional(),
    to: EndBody.optional(),
    values: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Name something to change')
  .meta({ examples: [{ values: {} }] });
export type ChangeRelationshipBody = z.infer<typeof ChangeRelationshipBody>;

const EndView = z.object({
  artifact: LowercaseUuid,
  kind: z.string().describe("The artifact's kind"),
  version: LowercaseUuid.nullable().describe('The version pinned, or null where it floats'),
});

export const RelationshipView = z.object({
  id: LowercaseUuid,
  type: LowercaseUuid,
  from: EndView,
  to: EndView,
  values: z.record(z.string(), z.unknown()),
  createdBy: LowercaseUuid,
  createdAt: z.string(),
  changedAt: z.string(),
});
export type RelationshipView = z.infer<typeof RelationshipView>;

export const RelationshipRefusal = ErrorBody.extend({
  reason: z
    .enum(['kind', 'self', 'deprecated', 'version'])
    .optional()
    .describe(
      "relationship_refused: an end's kind the type does not permit, an artifact related to itself, a deprecated type, or a version that is not the end's",
    ),
  end: z.enum(['from', 'to']).optional().describe('The end refused'),
  failures: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe('values_invalid: each field its values fail'),
});

export const NeighboursQuery = z.object({
  type: LowercaseUuid.optional().describe('Only relationships of this type'),
  direction: z
    .enum(['out', 'in'])
    .optional()
    .describe('`out`: those the artifact is the from end of; `in`: the to end of'),
  field: LowercaseUuid.optional().describe(
    'With `value`: only those whose value for this field it is',
  ),
  value: z.string().optional().describe("The field's value, as text (REL-051)"),
});
export type NeighboursQuery = z.infer<typeof NeighboursQuery>;

const Named = z.object({
  id: LowercaseUuid,
  kind: z.string().describe("The artifact's kind"),
  title: z.string().describe('Its title or name now'),
});

/** An artifact's relationships, one hop, from its end (REL-015; the R8 plan, R8-F). */
export const NeighboursView = z.object({
  relationships: z
    .array(
      z.object({
        relationship: RelationshipView,
        direction: z.enum(['out', 'in']).describe('Whether the artifact is its from or its to end'),
        other: Named.describe('The artifact at the other end'),
      }),
    )
    .describe('Oldest first, at most 1,000'),
  cut: z
    .boolean()
    .describe('Whether one leads to an artifact the caller may not read: never which'),
  more: z.boolean().describe('Whether there are more than 1,000'),
});
export type NeighboursView = z.infer<typeof NeighboursView>;

export const PathQuery = z.object({
  to: LowercaseUuid.describe('The artifact to reach'),
  depth: z
    .string()
    .regex(/^(?:[1-9]|10)$/, 'Expected a whole number from 1 to 10')
    .describe('The most hops, 1 to 10: there is no default'),
  types: z
    .string()
    .regex(
      /^[0-9a-f-]{36}(?:,[0-9a-f-]{36})*$/,
      'Expected relationship type identifiers, comma separated',
    )
    .optional()
    .describe('Only along these relationship types, comma separated, and then no reference'),
});
export type PathQuery = z.infer<typeof PathQuery>;

/** A shortest path between two artifacts (REL-029; R8-F). */
export const PathView = z.object({
  path: z
    .array(
      Named.extend({
        relationship: LowercaseUuid.nullable().describe(
          'The relationship that reached it from the one before, or null: the start, or a reference',
        ),
      }),
    )
    .nullable()
    .describe(
      'From the artifact to `to`, each step either way along a relationship or a reference; null where none is within the depth',
    ),
  cut: z
    .boolean()
    .describe('Whether the search met an artifact the caller may not read: never which'),
});
export type PathView = z.infer<typeof PathView>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const refusals = {
  400: {
    description:
      "`relationship_refused`: the type does not permit an end, as `reason` says; `values_invalid`: its values fail its type's fields; or `invalid_request`",
    schema: RelationshipRefusal,
  },
  401: unauthenticated,
  403: {
    description: 'The caller may read both ends but lacks the permission the type asks at one',
    schema: ErrorBody,
  },
  404: {
    description: 'No such type, or an end the caller may not read',
    schema: ErrorBody,
  },
  409: {
    description:
      '`relationship_cardinality`: an end already holds the one relationship of the type it may; `relationship_cycle`: the type is acyclic and this would close a cycle',
    schema: RelationshipRefusal,
  },
} as const;

const read = { check: 'permission', permission: 'read', target: { artifact: 'id' } } as const;
const readRefusals = {
  401: unauthenticated,
  403: {
    description: 'Never answered: an artifact the caller may not read is not found',
    schema: ErrorBody,
  },
  404: { description: 'No such artifact the caller may read, at either end', schema: ErrorBody },
} as const;

/** Relationships between artifacts (relationships.md; the R8 plan, R8-D, R8-E). */
export const relationshipRoutes = {
  makeRelationship: {
    operationId: 'makeRelationship',
    method: 'POST',
    path: '/v1/relationships',
    summary: 'Relate two artifacts by a declared relationship type',
    tenantScoped: true,
    access: { check: 'session' },
    body: MakeRelationshipBody,
    responses: { 200: { description: 'Made', schema: RelationshipView }, ...refusals },
  },
  getRelationship: {
    operationId: 'getRelationship',
    method: 'GET',
    path: '/v1/relationships/{id}',
    summary: 'A relationship: its type, its two ends and its values',
    tenantScoped: true,
    access: { check: 'session' },
    params: RelationshipParams,
    responses: {
      200: { description: 'The relationship', schema: RelationshipView },
      401: unauthenticated,
      404: {
        description: 'No such relationship, or one with an end the caller may not read',
        schema: ErrorBody,
      },
    },
  },
  changeRelationship: {
    operationId: 'changeRelationship',
    method: 'POST',
    path: '/v1/relationships/{id}',
    summary: 'Change a relationship: an end re-targeted or re-pinned, or its values',
    tenantScoped: true,
    access: { check: 'session' },
    params: RelationshipParams,
    body: ChangeRelationshipBody,
    responses: { 200: { description: 'Changed', schema: RelationshipView }, ...refusals },
  },
  removeRelationship: {
    operationId: 'removeRelationship',
    method: 'DELETE',
    path: '/v1/relationships/{id}',
    summary: 'Remove a relationship',
    tenantScoped: true,
    access: { check: 'session' },
    params: RelationshipParams,
    responses: {
      200: { description: 'Removed: the relationship as it was', schema: RelationshipView },
      401: unauthenticated,
      403: refusals[403],
      404: {
        description: 'No such relationship, or one with an end the caller may not read',
        schema: ErrorBody,
      },
    },
  },
  getArtifactRelationships: {
    operationId: 'getArtifactRelationships',
    method: 'GET',
    path: '/v1/artifacts/{id}/relationships',
    summary: "An artifact's relationships, by type, direction and field value",
    tenantScoped: true,
    access: read,
    params: RelationshipParams,
    query: NeighboursQuery,
    responses: {
      200: {
        description: 'Its relationships the caller may read the other end of',
        schema: NeighboursView,
      },
      400: {
        description: 'A field without a value, or a value without a field',
        schema: ErrorBody,
      },
      ...readRefusals,
    },
  },
  getArtifactPath: {
    operationId: 'getArtifactPath',
    method: 'GET',
    path: '/v1/artifacts/{id}/path',
    summary: 'A shortest path from one artifact to another, to a depth',
    tenantScoped: true,
    access: read,
    params: RelationshipParams,
    query: PathQuery,
    responses: {
      200: { description: 'One shortest path, or none within the depth', schema: PathView },
      400: { description: 'A depth missing, or not from 1 to 10', schema: ErrorBody },
      ...readRefusals,
    },
  },
} as const satisfies Record<string, RouteContract>;
