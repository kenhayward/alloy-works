import { templateDefinitionSchema } from '@alloy-works/domain';
import { z } from 'zod';
import { FacetCountView, idsFilter, listingQuery, listingTotal, nextCursor } from './listing.js';
import { SpaceParams, VersionSummary } from './components.js';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

export const TemplateParams = z.object({ id: LowercaseUuid });
export type TemplateParams = z.infer<typeof TemplateParams>;

/** A template's definition as a caller writes it (templates.md, "The definition"), the domain's own. */
export const CreateTemplateBody = z.strictObject({ definition: templateDefinitionSchema });
export type CreateTemplateBody = z.infer<typeof CreateTemplateBody>;

/** A template's next version: the whole definition, from the version it was opened at (API-037). */
export const TemplateVersionBody = z.strictObject({
  openedFrom: LowercaseUuid,
  definition: templateDefinitionSchema,
});
export type TemplateVersionBody = z.infer<typeof TemplateVersionBody>;

export const TemplateView = z.object({
  id: z.string(),
  space: z.object({ id: z.string(), name: z.string() }),
  version: VersionSummary,
  definition: z
    .record(z.string(), z.unknown())
    .describe('The latest version\'s definition (templates.md, "The definition"), as stored'),
  mayDesign: z.boolean().describe('Whether the caller may change the template'),
});
export type TemplateView = z.infer<typeof TemplateView>;

export const TemplateSummary = z.object({
  id: z.string(),
  name: z.string(),
  space: z.object({ id: z.string(), name: z.string() }),
  version: z.object({ id: z.string(), number: z.string() }),
  changedAt: z.string().describe('When its latest version was made'),
});
export const TemplateList = z.object({
  items: z.array(TemplateSummary),
  next: nextCursor,
  total: listingTotal,
  facets: z
    .object({ spaces: z.array(FacetCountView) })
    .describe(
      'Each filter the listing takes, counted with the others in force and its own left out',
    ),
});

export const TemplateListQuery = z.object({
  ...listingQuery(['name', 'changed'], 'name'),
  spaces: idsFilter.optional().describe('Only templates in these spaces, by id'),
});
export type TemplateListQuery = z.infer<typeof TemplateListQuery>;
export type TemplateList = z.infer<typeof TemplateList>;

/**
 * What a parameter refusal names (templates.md, "Failures"): each parameter refused by name, and for
 * `parameter_invalid` each value with the rule it breaks (TPL-045). Spread into each refusal shape a
 * route answering one carries.
 */
export const parameterRefusal = {
  parameters: z
    .array(
      z.object({
        parameter: z.string(),
        field: z.string().optional().describe('The field it seeds, where that is what is refused'),
        message: z.string().optional(),
      }),
    )
    .optional()
    .describe(
      'parameter_unused: each parameter that seeds no field and supplies no argument (TPL-068); ' +
        'parameter_field: each that seeds a field the document level does not hold, a fixed one, or ' +
        'one that does not take its type; parameter_unknown: each value for a parameter the template ' +
        'does not declare; parameter_fixed: each that may not change and was changed (TPL-021)',
    ),
  problems: z
    .array(
      z.object({
        parameter: z.string(),
        rule: z.string(),
        value: z.string(),
        field: z
          .string()
          .optional()
          .describe("The field it seeds, where the rule is that field's and not the parameter's"),
      }),
    )
    .optional()
    .describe(
      'parameter_invalid: each parameter missing a required value or given an invalid one, with ' +
        'the rule it breaks and the value (TPL-018, TPL-045)',
    ),
};

/**
 * A template refused: each reference that does not resolve (`template_unresolved`, TPL-004), each
 * parameter refused (`parameter_unused`, TPL-068; `parameter_field`), or the
 * template as it now stands where the version it was opened at is no longer the latest
 * (`version_precondition`, API-037).
 */
export const TemplateRefusal = ErrorBody.extend({
  unresolved: z
    .array(
      z.object({
        reference: z.enum(['theme', 'layout', 'schema', 'field', 'requires', 'conflict']),
        id: z.string(),
        field: z.string().optional(),
        level: z.enum(['document', 'section']).optional(),
        schemas: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  current: TemplateView.optional(),
  ...parameterRefusal,
});
export type TemplateRefusal = z.infer<typeof TemplateRefusal>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const unresolved = {
  description:
    '`template_unresolved`: a theme, layout, schema or field it names does not resolve; ' +
    '`parameter_unused`: a parameter feeds nothing; `parameter_field`: a seeded field cannot take ' +
    'its parameter; or the definition is not one the contract reads',
  schema: TemplateRefusal,
} as const;

/** Templates (templates.md, "Routes"): `design` makes and changes one, `read` shows it (TPL-006). */
export const templateRoutes = {
  listTemplates: {
    operationId: 'listTemplates',
    method: 'GET',
    path: '/v1/templates',
    summary: 'The templates the caller may read, each with its name, space and latest version',
    tenantScoped: true,
    access: { check: 'session' },
    query: TemplateListQuery,
    responses: {
      200: { description: 'A page of templates', schema: TemplateList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
    },
  },
  createTemplate: {
    operationId: 'createTemplate',
    method: 'POST',
    path: '/v1/spaces/{space}/templates',
    summary: 'Make a template in this space, at version 0.1',
    tenantScoped: true,
    access: { check: 'permission', permission: 'design', target: { space: 'space' } },
    params: SpaceParams,
    body: CreateTemplateBody,
    responses: {
      200: { description: 'Made, at version 0.1', schema: TemplateView },
      400: unresolved,
      401: unauthenticated,
      403: {
        description: 'The caller may read the space but may not design in it',
        schema: ErrorBody,
      },
      404: {
        description: 'No such space in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
  getTemplate: {
    operationId: 'getTemplate',
    method: 'GET',
    path: '/v1/templates/{id}',
    summary: 'A template at its latest version',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: TemplateParams,
    responses: {
      200: { description: 'The template', schema: TemplateView },
      401: unauthenticated,
      403: {
        description: 'Never answered: a template the caller may not read is not found',
        schema: ErrorBody,
      },
      404: {
        description: 'No such template in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
  recordTemplateVersion: {
    operationId: 'recordTemplateVersion',
    method: 'POST',
    path: '/v1/templates/{id}/versions',
    summary: "Cut a template's next version from the one the caller opened",
    tenantScoped: true,
    access: { check: 'permission', permission: 'design', target: { artifact: 'id' } },
    params: TemplateParams,
    body: TemplateVersionBody,
    responses: {
      200: {
        description:
          'The template at its latest version: the one cut, or the one before where nothing changed',
        schema: TemplateView,
      },
      400: unresolved,
      401: unauthenticated,
      403: {
        description: 'The caller may read the template but may not change it',
        schema: ErrorBody,
      },
      404: {
        description: 'No such template in this environment, or none the caller may read',
        schema: ErrorBody,
      },
      409: {
        description: '`version_precondition`: the template has a newer version than the one named',
        schema: TemplateRefusal,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
