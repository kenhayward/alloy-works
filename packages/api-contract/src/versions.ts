import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { RestoreParams } from './restore.js';
import { ErrorBody } from './schemas.js';

/** A version as its page heads it: its number, who cut it and when (SCH-058). */
const VersionHeading = z.object({
  id: z.string(),
  number: z.string().describe('`revision.version`, as `0.2`'),
  createdAt: z.string(),
  note: z.string().nullable(),
  author: z
    .object({
      id: z.string(),
      name: z.string().nullable().describe('Their name now; an erased person by the erased label'),
    })
    .nullable()
    .describe('Who cut it; null for a starter definition'),
});

const Latest = z
  .object({ id: z.string(), number: z.string() })
  .describe('The latest version, which may be this one');

/** One version of a component, read only (the SV plan, SV-H). */
export const ComponentVersionView = z.object({
  component: z.string(),
  title: z.string().describe("The version's title"),
  version: VersionHeading,
  latest: Latest,
  content: z
    .record(z.string(), z.unknown())
    .describe("The version's content document (content-model.md), exactly as stored"),
  values: z.record(z.string(), z.unknown()).describe('Its metadata values, by field'),
  archived: z.boolean().describe('Whether the component is archived now'),
});
export type ComponentVersionView = z.infer<typeof ComponentVersionView>;

/** One version of a document, read only: its outline and values, never its components' text. */
export const DocumentVersionView = z.object({
  document: z.string(),
  title: z.string().describe("The version's title"),
  version: VersionHeading,
  latest: Latest,
  outline: z
    .record(z.string(), z.unknown())
    .describe(
      'Its outline, each reference to a component the caller may not read withheld, as the document view withholds one',
    ),
  titles: z
    .array(z.object({ node: z.string(), title: z.string() }))
    .describe(
      'Each reference the caller may read, by the title of the component version it places',
    ),
  values: z.record(z.string(), z.unknown()).describe('Its metadata values, by field'),
  archived: z.boolean().describe('Whether the document is archived now'),
});
export type DocumentVersionView = z.infer<typeof DocumentVersionView>;

const read = { check: 'permission', permission: 'read', target: { artifact: 'id' } } as const;
const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;

/** One earlier version, read only, of a component or a document (the SV plan, SV-H). */
export const versionRoutes = {
  getComponentVersion: {
    operationId: 'getComponentVersion',
    method: 'GET',
    path: '/v1/components/{id}/versions/{version}',
    summary: 'One version of a component, read only',
    tenantScoped: true,
    access: read,
    params: RestoreParams,
    responses: {
      200: { description: 'The version', schema: ComponentVersionView },
      401: unauthenticated,
      403: {
        description:
          'Never answered: a component the caller may read is one whose versions they may read',
        schema: ErrorBody,
      },
      404: {
        description:
          'No such component the caller may read, or a version that is not one of its versions',
        schema: ErrorBody,
      },
    },
  },
  getDocumentVersion: {
    operationId: 'getDocumentVersion',
    method: 'GET',
    path: '/v1/documents/{id}/versions/{version}',
    summary: 'One version of a document, read only',
    tenantScoped: true,
    access: read,
    params: RestoreParams,
    responses: {
      200: { description: 'The version', schema: DocumentVersionView },
      401: unauthenticated,
      403: {
        description:
          'Never answered: a document the caller may read is one whose versions they may read',
        schema: ErrorBody,
      },
      404: {
        description:
          'No such document the caller may read, or a version that is not one of its versions',
        schema: ErrorBody,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
