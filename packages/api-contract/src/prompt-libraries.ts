import { promptLibrarySchema, promptSchema } from '@alloy-works/domain';
import { z } from 'zod';
import { VersionSummary } from './components.js';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

export const LibraryParams = z.object({ id: LowercaseUuid });
export type LibraryParams = z.infer<typeof LibraryParams>;

export const CreateLibraryBody = z.strictObject({ library: promptLibrarySchema });
export type CreateLibraryBody = z.infer<typeof CreateLibraryBody>;

/** A library's next version: the whole library, from the version it was opened at (API-037). */
export const LibraryVersionBody = z.strictObject({
  openedFrom: LowercaseUuid,
  library: promptLibrarySchema,
});
export type LibraryVersionBody = z.infer<typeof LibraryVersionBody>;

const space = z.object({ id: z.string(), name: z.string() });

/** One prompt a library lists, as the caller may read it (G4-F). */
export const ListedPromptView = z.discriminatedUnion('state', [
  z.object({
    id: z.string(),
    state: z.literal('approved'),
    revision: z
      .object({ number: z.number().int(), versionId: z.string() })
      .describe('Its latest approved revision: what a run of it runs'),
    prompt: promptSchema,
    space,
  }),
  z.object({
    id: z.string(),
    state: z.literal('unapproved').describe('Never approved: it runs nothing until it is'),
    title: z.string(),
    space,
  }),
  z.object({
    id: z.string(),
    state: z.literal('hidden').describe('One the caller may not read, or no prompt any more'),
  }),
]);
export type ListedPromptView = z.infer<typeof ListedPromptView>;

export const LibraryView = z.object({
  id: z.string(),
  version: VersionSummary,
  library: promptLibrarySchema,
  isDefault: z
    .boolean()
    .describe("Whether it is the environment's default, which a template naming none binds"),
  prompts: z.array(ListedPromptView).describe('Each prompt it lists, in its order'),
  mayEdit: z.boolean().describe('Whether the caller may cut its next version: design here'),
});
export type LibraryView = z.infer<typeof LibraryView>;

export const LibrarySummary = z.object({
  id: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
  prompts: z.number().int().describe('How many prompts it lists'),
  version: z.object({ id: z.string(), number: z.string() }),
});
export const LibraryList = z.object({
  items: z
    .array(LibrarySummary)
    .describe("The default first, then by name: an environment's handful"),
});
export type LibraryList = z.infer<typeof LibraryList>;

/** A library refused by its rules (`library_invalid`), each problem named, or its newer version. */
export const LibraryRefusal = ErrorBody.extend({
  problems: z
    .array(
      z.object({
        rule: z.literal('library_invalid'),
        path: z.string().describe('The member refused, dotted, as `prompts.2`'),
        message: z.string(),
      }),
    )
    .optional(),
  current: LibraryView.optional(),
});

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const notFound = {
  description: 'No such prompt library in this environment',
  schema: ErrorBody,
} as const;
const libraryRefused = {
  description:
    '`library_invalid`: the library fails a rule, each problem named: a prompt listed twice, or one newly listed that is no prompt the caller may read',
  schema: LibraryRefusal,
} as const;
const read = { check: 'permission', permission: 'read', target: { tenant: true } } as const;
const design = { check: 'permission', permission: 'design', target: { tenant: true } } as const;

/**
 * Prompt libraries (generation.md, "Prompts"; the G4 plan, G4-F): the environment's, as themes are;
 * `design` here makes and changes one, `read` shows one.
 */
export const promptLibraryRoutes = {
  listPromptLibraries: {
    operationId: 'listPromptLibraries',
    method: 'GET',
    path: '/v1/prompt-libraries',
    summary: "The environment's prompt libraries, the default first",
    tenantScoped: true,
    access: read,
    responses: {
      200: { description: 'The libraries', schema: LibraryList },
      401: unauthenticated,
      403: { description: 'The caller may not read the environment', schema: ErrorBody },
    },
  },
  createPromptLibrary: {
    operationId: 'createPromptLibrary',
    method: 'POST',
    path: '/v1/prompt-libraries',
    summary: 'Make a prompt library, at version 0.1',
    tenantScoped: true,
    access: design,
    body: CreateLibraryBody,
    responses: {
      200: { description: 'Made, at version 0.1', schema: LibraryView },
      400: libraryRefused,
      401: unauthenticated,
      403: { description: 'The caller may not design here', schema: ErrorBody },
    },
  },
  getPromptLibrary: {
    operationId: 'getPromptLibrary',
    method: 'GET',
    path: '/v1/prompt-libraries/{id}',
    summary: 'A prompt library at its latest version, with each prompt at the version it runs',
    tenantScoped: true,
    access: read,
    params: LibraryParams,
    responses: {
      200: { description: 'The library', schema: LibraryView },
      401: unauthenticated,
      403: { description: 'The caller may not read the environment', schema: ErrorBody },
      404: notFound,
    },
  },
  recordPromptLibraryVersion: {
    operationId: 'recordPromptLibraryVersion',
    method: 'POST',
    path: '/v1/prompt-libraries/{id}/versions',
    summary: "Cut a prompt library's next version from the one the caller opened",
    tenantScoped: true,
    access: design,
    params: LibraryParams,
    body: LibraryVersionBody,
    responses: {
      200: {
        description:
          'The library at its latest version: the one cut, or the one before where nothing changed',
        schema: LibraryView,
      },
      400: libraryRefused,
      401: unauthenticated,
      403: { description: 'The caller may not design here', schema: ErrorBody },
      404: notFound,
      409: {
        description:
          '`version_precondition`: the library has a newer version than the one named, answered with it',
        schema: LibraryRefusal,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
