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
} as const satisfies Record<string, RouteContract>;
