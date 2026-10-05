import { queryDefinitionSchema } from '@alloy-works/domain';
import { z } from 'zod';
import { SpaceParams, VersionSummary } from './components.js';
import { QueryDefinitionUsesView } from './bindings.js';
import { SqlRefusal } from './connections.js';
import type { RouteContract } from './contract.js';
import { FacetCountView, idsFilter, listingQuery, listingTotal, nextCursor } from './listing.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

export const QueryDefinitionParams = z.object({ id: LowercaseUuid });
export type QueryDefinitionParams = z.infer<typeof QueryDefinitionParams>;

/**
 * A query definition version (data.md, "What a query definition version holds"; the D2 plan, task 1),
 * the domain's own shape: checked at the door by its shape, and by its rules once the handler runs.
 */
export const QueryDefinitionBody = queryDefinitionSchema;

export const CreateQueryDefinitionBody = z.strictObject({ definition: queryDefinitionSchema });
export type CreateQueryDefinitionBody = z.infer<typeof CreateQueryDefinitionBody>;

/** A definition's next version: the whole definition, from the version it was opened at (API-037). */
export const QueryDefinitionVersionBody = z.strictObject({
  openedFrom: LowercaseUuid,
  definition: queryDefinitionSchema,
});
export type QueryDefinitionVersionBody = z.infer<typeof QueryDefinitionVersionBody>;

export const QueryDefinitionView = z.object({
  id: z.string(),
  space: z.object({ id: z.string(), name: z.string() }),
  version: VersionSummary,
  definition: queryDefinitionSchema,
  connection: z
    .object({
      id: z.string(),
      name: z
        .string()
        .nullable()
        .describe('Its name, or null where the caller may not read the connection'),
      identity: z
        .enum(['service', 'endUser'])
        .describe('Whose identity the connection runs a query as'),
      retired: z.boolean(),
    })
    .nullable()
    .describe('The connection it names, at its latest version'),
  mayEdit: z
    .boolean()
    .describe(
      'Whether the caller may cut its next version: edit on it and use connection on its connection, and for SQL write SQL there as well',
    ),
  mayRun: z
    .boolean()
    .describe(
      'Whether the caller may describe and sample its query against its connection: use connection there, and for SQL write SQL as well',
    ),
});
export type QueryDefinitionView = z.infer<typeof QueryDefinitionView>;

export const QueryDefinitionSummary = z.object({
  id: z.string(),
  title: z.string(),
  space: z.object({ id: z.string(), name: z.string() }),
  connection: z
    .object({
      id: z.string(),
      name: z
        .string()
        .nullable()
        .describe('Its latest name, or null where the caller may not read the connection'),
      identity: z
        .enum(['service', 'endUser'])
        .describe(
          'Whose identity the connection runs a query as, told to every reader of the definition',
        ),
    })
    .nullable()
    .describe('The connection it names'),
  retired: z.boolean(),
  version: z.object({ id: z.string(), number: z.string() }),
  changedAt: z.string().describe('When its latest version was made'),
});
export const QueryDefinitionList = z.object({
  items: z.array(QueryDefinitionSummary),
  next: nextCursor,
  total: listingTotal,
  facets: z
    .object({ spaces: z.array(FacetCountView) })
    .describe(
      'Each filter the listing takes, counted with the others in force and its own left out',
    ),
});
export type QueryDefinitionList = z.infer<typeof QueryDefinitionList>;

export const QueryDefinitionListQuery = z.object({
  ...listingQuery(['title', 'changed'], 'title'),
  spaces: idsFilter.optional().describe('Only query definitions in these spaces, by id'),
  connection: LowercaseUuid.optional().describe('Only query definitions naming this connection'),
});
export type QueryDefinitionListQuery = z.infer<typeof QueryDefinitionListQuery>;

/**
 * A definition refused: by its rules (`definition_invalid`), each problem named, or the definition as
 * it now stands where the version it was opened at is no longer the latest (`version_precondition`),
 * or SQL refused on its connection (`sql_not_permitted`), with why.
 */
export const QueryDefinitionRefusal = SqlRefusal.extend({
  problems: z
    .array(
      z.object({
        rule: z.literal('definition_invalid'),
        path: z.string().describe('The member refused, dotted, as `columns.2.name`'),
        message: z.string(),
      }),
    )
    .optional(),
  current: QueryDefinitionView.optional(),
});
export type QueryDefinitionRefusal = z.infer<typeof QueryDefinitionRefusal>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const notFound = {
  description: 'No such query definition in this environment, or none the caller may read',
  schema: ErrorBody,
} as const;
const definitionRefused = {
  description:
    '`definition_invalid`: the definition fails a rule, each problem named, or names no connection the caller may read',
  schema: QueryDefinitionRefusal,
} as const;
const onTheConnection = {
  description:
    '`connection_retired`: the connection it names is retired; `sql_not_permitted`: for SQL, the connection has not been tested clean ' +
    'at its latest version and credential, or its account was found able to write, and SQL is refused on it. A built query is never refused this way',
  schema: QueryDefinitionRefusal,
} as const;

/**
 * Query definitions (data.md, "Routes"; the D2 plan, task 4; the D4 plan, D4-J): `edit` in the space
 * makes and changes one, with `use_connection` on the connection it names and, for SQL, `write_sql`,
 * decided at the connection by each version's own fetch; `read` shows one.
 */
export const queryDefinitionRoutes = {
  listQueryDefinitions: {
    operationId: 'listQueryDefinitions',
    method: 'GET',
    path: '/v1/query-definitions',
    summary: 'The query definitions the caller may read, each with its space and connection',
    tenantScoped: true,
    access: { check: 'session' },
    query: QueryDefinitionListQuery,
    responses: {
      200: { description: 'A page of query definitions', schema: QueryDefinitionList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
    },
  },
  createQueryDefinition: {
    operationId: 'createQueryDefinition',
    method: 'POST',
    path: '/v1/spaces/{space}/query-definitions',
    summary: 'Make a query definition in this space, at version 0.1',
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: { space: 'space' } },
    params: SpaceParams,
    body: CreateQueryDefinitionBody,
    responses: {
      200: { description: 'Made, at version 0.1', schema: QueryDefinitionView },
      400: definitionRefused,
      401: unauthenticated,
      403: {
        description:
          'The caller may not edit in the space, or does not hold use connection on the connection, or for SQL write SQL there',
        schema: ErrorBody,
      },
      404: {
        description: 'No such space in this environment, or none the caller may read',
        schema: ErrorBody,
      },
      409: onTheConnection,
    },
  },
  getQueryDefinition: {
    operationId: 'getQueryDefinition',
    method: 'GET',
    path: '/v1/query-definitions/{id}',
    summary: 'A query definition at its latest version, with the connection it names',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: QueryDefinitionParams,
    responses: {
      200: { description: 'The query definition', schema: QueryDefinitionView },
      401: unauthenticated,
      403: {
        description: 'Never answered: a definition the caller may not read is not found',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
  recordQueryDefinitionVersion: {
    operationId: 'recordQueryDefinitionVersion',
    method: 'POST',
    path: '/v1/query-definitions/{id}/versions',
    summary:
      "Cut a query definition's next version from the one the caller opened; retiring among them",
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: { artifact: 'id' } },
    params: QueryDefinitionParams,
    body: QueryDefinitionVersionBody,
    responses: {
      200: {
        description:
          'The definition at its latest version: the one cut, or the one before where nothing changed',
        schema: QueryDefinitionView,
      },
      400: definitionRefused,
      401: unauthenticated,
      403: {
        description:
          'The caller may read the definition but may not edit it, or does not hold use connection on the connection, or for SQL write SQL there',
        schema: ErrorBody,
      },
      404: notFound,
      409: {
        description:
          '`version_precondition`: the definition has a newer version than the one named, answered with it; ' +
          onTheConnection.description,
        schema: QueryDefinitionRefusal,
      },
    },
  },
  getQueryDefinitionUses: {
    operationId: 'getQueryDefinitionUses',
    method: 'GET',
    path: '/v1/query-definitions/{id}/uses',
    summary:
      'Where a query definition is used: the components binding it and the documents resolving them',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: QueryDefinitionParams,
    responses: {
      200: {
        description:
          'The components whose latest versions bind it, and the documents holding a result of it: those the caller may read, and how many more',
        schema: QueryDefinitionUsesView,
      },
      401: unauthenticated,
      403: {
        description: 'Never answered: a definition the caller may not read is not found',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
} as const satisfies Record<string, RouteContract>;
