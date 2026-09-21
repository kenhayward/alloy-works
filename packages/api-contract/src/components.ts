import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/** A component, by the id its artifact carries. */
export const ComponentParams = z.object({ id: z.uuid() });
export type ComponentParams = z.infer<typeof ComponentParams>;

/** A space, by the id it carries. */
export const SpaceParams = z.object({ space: LowercaseUuid });
export type SpaceParams = z.infer<typeof SpaceParams>;

export const SpaceList = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      mayCreate: z.boolean().describe('Whether the caller may create a component in this space'),
    }),
  ),
});
export type SpaceList = z.infer<typeof SpaceList>;

export const ComponentTypeList = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      isDefault: z.boolean().describe("The environment's default, preselected (MET-011, MET-012)"),
    }),
  ),
});
export type ComponentTypeList = z.infer<typeof ComponentTypeList>;

/**
 * What creating takes. The language is checked here against the same rule the content model applies
 * (`contentDocumentSchema`, packages/domain/src/content/model/document.ts) - repeated rather than
 * imported, because the contract cannot import a piece of the domain's schema - so a tag that would
 * be refused deep inside `parseContentDocument` is refused at the door with a message about the tag
 * rather than about the document.
 */
export const CreateComponentBody = z.strictObject({
  title: z.string().min(1).max(200),
  language: z
    .string()
    .regex(
      /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?(-[a-z0-9]{5,8})*$/,
      'not a BCP 47 tag',
    ),
  direction: z.enum(['ltr', 'rtl']),
  componentType: LowercaseUuid.optional().describe("Absent: the environment's default (MET-011)"),
});
export type CreateComponentBody = z.infer<typeof CreateComponentBody>;

export const ComponentListQuery = z.object({
  cursor: z.string().optional().describe('Where the previous page ended; absent for the first'),
  limit: z
    .string()
    .regex(/^(?:[1-9]|[1-9][0-9]|100)$/, 'Expected a whole number from 1 to 100')
    .optional()
    .describe('At most this many, 50 when absent'),
  spaces: z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:,[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){0,49}$/,
      'Expected 1 to 50 space ids, separated by commas',
    )
    .optional()
    .describe(
      'Only the components in these spaces, by id, separated by commas; every space when absent',
    ),
});
export type ComponentListQuery = z.infer<typeof ComponentListQuery>;

export const VersionSummary = z.object({
  id: z.string(),
  number: z.string().describe('`revision.version`, as `0.2`'),
  author: z.string().nullable().describe('The principal who cut it; null for a starter definition'),
  createdAt: z.string(),
  note: z.string().nullable(),
});

export const Lock = z.object({
  holder: z.object({ id: z.string(), name: z.string().nullable() }),
  expectedRelease: z.string().describe('When it lapses unless the holder saves again'),
  yours: z.boolean().describe('Whether the caller holds it, from this session or another'),
  session: z.string().nullable().describe('The holding session, told only to its own principal'),
});

export const ComponentList = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      space: z.object({ id: z.string(), name: z.string() }),
      version: z.string().describe('`revision.version` of the latest version'),
      type: z
        .string()
        .nullable()
        .describe('The component type it was written against, by name; null for none'),
      language: z.string().describe('Its base language, a BCP 47 tag'),
      changedAt: z.string().describe('When its latest version was made'),
      changedBy: z
        .object({ id: z.string(), name: z.string().nullable() })
        .nullable()
        .describe('Who made its latest version; null for a version nobody authored'),
    }),
  ),
  next: z.string().nullable().describe('The cursor for the next page, or null at the end'),
  total: z.number().int().describe('How many there are in all, in the spaces asked for'),
  spaces: z
    .array(z.object({ id: z.string(), name: z.string(), count: z.number().int() }))
    .describe('Every space the caller may read a component in, with how many: what to filter by'),
});
export type ComponentList = z.infer<typeof ComponentList>;

export const ComponentView = z.object({
  id: z.string(),
  space: z.object({ id: z.string(), name: z.string() }),
  version: VersionSummary,
  content: z
    .record(z.string(), z.unknown())
    .describe("The latest version's content document (content-model.md), exactly as stored"),
  mayEdit: z.boolean().describe('Whether the caller may take the lock and write'),
  lock: Lock.nullable(),
});
export type ComponentView = z.infer<typeof ComponentView>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;

/** Finding and opening components (the editor plan's decision 9, and component-editor.md, "The API"). */
export const componentRoutes = {
  listComponents: {
    operationId: 'listComponents',
    method: 'GET',
    path: '/v1/components',
    summary: 'The components the caller may read, a page at a time',
    tenantScoped: true,
    access: { check: 'session' },
    query: ComponentListQuery,
    responses: {
      200: { description: 'A page of components', schema: ComponentList },
      400: {
        description:
          'A cursor this listing did not give out, a limit outside 1 to 100, or spaces that are not a list of ids',
        schema: ErrorBody,
      },
      401: unauthenticated,
    },
  },
  listSpaces: {
    operationId: 'listSpaces',
    method: 'GET',
    path: '/v1/spaces',
    summary: 'The spaces the caller may read, and whether they may create a component in each',
    tenantScoped: true,
    access: { check: 'session' },
    responses: {
      200: { description: 'The spaces', schema: SpaceList },
      401: unauthenticated,
    },
  },
  listComponentTypes: {
    operationId: 'listComponentTypes',
    method: 'GET',
    path: '/v1/spaces/{space}/component-types',
    summary: 'The component types a component created here may take, with the default marked',
    tenantScoped: true,
    // A definition is read through what uses it (access.md), extended to creating: whoever may create
    // here, and only they, may see what they may create. Editor 1's finding 4.
    access: { check: 'permission', permission: 'create', target: { space: 'space' } },
    params: SpaceParams,
    responses: {
      200: { description: 'The component types', schema: ComponentTypeList },
      401: unauthenticated,
      403: {
        description: 'The caller may read the space but may not create in it',
        schema: ErrorBody,
      },
      404: {
        description: 'No such space in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
  createComponent: {
    operationId: 'createComponent',
    method: 'POST',
    path: '/v1/spaces/{space}/components',
    summary: 'Create a component in this space, at version 0.1',
    tenantScoped: true,
    access: { check: 'permission', permission: 'create', target: { space: 'space' } },
    params: SpaceParams,
    body: CreateComponentBody,
    responses: {
      // 200, not 201: a permission-checked handler is given no reply and cannot set a status, which
      // is the guard that stops it sending before its transaction commits (app.ts). Every other
      // permission-checked write answers 200 too.
      200: { description: 'Created, at version 0.1', schema: ComponentView },
      400: {
        description: 'The title, language or direction is not one the content model accepts',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the space but may not create in it',
        schema: ErrorBody,
      },
      404: {
        description: 'No such space in this environment, or none the caller may read',
        schema: ErrorBody,
      },
      409: {
        description: 'component_type_missing: no such component type in this environment',
        schema: ErrorBody,
      },
    },
  },
  getComponent: {
    operationId: 'getComponent',
    method: 'GET',
    path: '/v1/components/{id}',
    summary: 'A component at its latest version, whether the caller may edit it, and its lock',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: ComponentParams,
    responses: {
      200: { description: 'The component', schema: ComponentView },
      401: unauthenticated,
      403: {
        description: 'Never answered: a component the caller may read is one they may open',
        schema: ErrorBody,
      },
      404: {
        description: 'No such component in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
