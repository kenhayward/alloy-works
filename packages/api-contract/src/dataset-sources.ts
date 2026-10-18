import { provenanceSchema } from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { DatasetParams } from './bindings.js';
import { DataProblemsRefusal, SampleBody, SampleView } from './connections.js';
import { pageQuery, nextCursor } from './listing.js';
import { ErrorBody } from './schemas.js';

/** A page of stored results a query may take as its source (DAT-094; the R21 plan, R21-A). */
export const DatasetSourceQuery = z.object(pageQuery);
export type DatasetSourceQuery = z.infer<typeof DatasetSourceQuery>;

export const DatasetSourceView = z.object({
  id: z.string(),
  name: z
    .string()
    .describe(
      "Its name, or its query definition's title where nobody named it and the caller may read the definition",
    ),
  definition: z
    .object({ id: z.string(), title: z.string() })
    .nullable()
    .describe('Its query definition, or null where the caller may not read it'),
  latest: z.object({ id: z.string(), at: z.string(), rowCount: z.number().int() }),
  columns: z
    .array(provenanceSchema.shape.columns.element.pick({ name: true, type: true }))
    .describe(
      "Its latest version's columns, each its name and type: what a query over it may select",
    ),
});

export const DatasetSourceList = z.object({
  items: z.array(DatasetSourceView),
  next: nextCursor,
});
export type DatasetSourceList = z.infer<typeof DatasetSourceList>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;

export const datasetSourceRoutes = {
  listDatasetSources: {
    operationId: 'listDatasetSources',
    method: 'GET',
    path: '/v1/datasets',
    summary: 'The stored results the caller may read, to query as a source of their own',
    tenantScoped: true,
    access: { check: 'session' },
    query: DatasetSourceQuery,
    responses: {
      200: { description: 'A page of stored results, by name', schema: DatasetSourceList },
      400: { description: 'A limit or a cursor that is not one', schema: ErrorBody },
      401: unauthenticated,
    },
  },
  sampleDataset: {
    operationId: 'sampleDataset',
    method: 'POST',
    path: '/v1/datasets/{id}/sample',
    summary: 'Run a draft query over a stored result against sample values, storing nothing',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: DatasetParams,
    body: SampleBody,
    idempotencyKey: false,
    responses: {
      200: {
        description:
          'Run: the first 100 rows, how many there were, the checksum and the stored result read, or one named failure with its attribution',
        schema: SampleView,
      },
      400: {
        description:
          '`definition_invalid`: the draft fails a rule, each problem named, or queries another stored result; `parameter_invalid`: a value fails its declaration',
        schema: DataProblemsRefusal,
      },
      401: unauthenticated,
      403: {
        description: 'Never answered: a stored result the caller may not read is not found',
        schema: ErrorBody,
      },
      404: { description: 'No such stored result the caller may read', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
