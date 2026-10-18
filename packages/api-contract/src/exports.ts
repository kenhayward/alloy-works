import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { nextCursor, pageQuery } from './listing.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/** The tenant's export (API-044; the R21 plan, R21-B). */
export const TenantExportParams = z.object({ id: LowercaseUuid });
export type TenantExportParams = z.infer<typeof TenantExportParams>;

export const TenantExportQuery = z.object(pageQuery);
export type TenantExportQuery = z.infer<typeof TenantExportQuery>;

export const TenantExportView = z.object({
  id: z.string(),
  state: z
    .enum(['queued', 'done', 'failed', 'expired'])
    .describe(
      'queued while its job writes it; done once it can be downloaded; expired once its seven days are past and its archive is gone',
    ),
  requestedAt: z.string(),
  requestedBy: z.string().nullable(),
  finishedAt: z.string().nullable(),
  expiresAt: z
    .string()
    .nullable()
    .describe('When its archive is removed: seven days after it was written'),
  bytes: z.number().int().nullable(),
  sha256: z.string().nullable(),
  counts: z
    .record(z.string(), z.number().int())
    .nullable()
    .describe('How many of each part it holds, and of the objects its bytes are kept as'),
});
export type TenantExportView = z.infer<typeof TenantExportView>;

export const TenantExportMade = z.object({ export: TenantExportView });
export type TenantExportMade = z.infer<typeof TenantExportMade>;

export const TenantExportList = z.object({
  items: z.array(TenantExportView),
  next: nextCursor,
});
export type TenantExportList = z.infer<typeof TenantExportList>;

export const TenantExportDownload = z.object({
  download: z
    .string()
    .describe(
      'A link to its ZIP archive - a JSON Lines file a part, the bytes it names by hash and its manifest - signed for five minutes',
    ),
});
export type TenantExportDownload = z.infer<typeof TenantExportDownload>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const forbidden = {
  description: 'The caller may not administer this environment',
  schema: ErrorBody,
} as const;
const ADMINISTER = {
  check: 'permission',
  permission: 'administer',
  target: { tenant: true },
} as const;

export const exportRoutes = {
  requestTenantExport: {
    operationId: 'requestTenantExport',
    method: 'POST',
    path: '/v1/exports',
    summary: "Export the environment's content as it stands now, as a job",
    tenantScoped: true,
    access: ADMINISTER,
    responses: {
      200: { description: 'Asked for: queued, and written by a job', schema: TenantExportMade },
      401: unauthenticated,
      403: forbidden,
    },
  },
  listTenantExports: {
    operationId: 'listTenantExports',
    method: 'GET',
    path: '/v1/exports',
    summary: "The environment's exports, the newest first, a page at a time",
    tenantScoped: true,
    access: ADMINISTER,
    query: TenantExportQuery,
    responses: {
      200: { description: 'A page of exports', schema: TenantExportList },
      400: { description: 'A limit or a cursor that is not one', schema: ErrorBody },
      401: unauthenticated,
      403: forbidden,
    },
  },
  getTenantExport: {
    operationId: 'getTenantExport',
    method: 'GET',
    path: '/v1/exports/{id}',
    summary: 'An export of the environment: whether it is ready, and what it holds',
    tenantScoped: true,
    access: ADMINISTER,
    params: TenantExportParams,
    responses: {
      200: { description: 'The export', schema: TenantExportMade },
      401: unauthenticated,
      403: forbidden,
      404: { description: 'No such export in this environment', schema: ErrorBody },
    },
  },
  downloadTenantExport: {
    operationId: 'downloadTenantExport',
    method: 'GET',
    path: '/v1/exports/{id}/download',
    summary: 'A link to download an export of the environment; each one handed out is recorded',
    tenantScoped: true,
    access: ADMINISTER,
    params: TenantExportParams,
    responses: {
      200: { description: 'A link to the export', schema: TenantExportDownload },
      401: unauthenticated,
      403: forbidden,
      404: { description: 'No such export in this environment', schema: ErrorBody },
      409: {
        description: '`export_not_ready`: the export is not written yet, failed, or has expired',
        schema: ErrorBody,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
