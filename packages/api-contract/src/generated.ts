import { z } from 'zod';

import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/**
 * What of a document or a publication came from a model (generation.md, "Proposals"; the G3 plan,
 * G3-C, G3-D; GEN-026, GEN-041): each placed component version, and every suggestion a run made on it
 * and every proposal its requester discarded, with its run.
 */
export const GeneratedParams = z.object({ id: LowercaseUuid });
export type GeneratedParams = z.infer<typeof GeneratedParams>;

const Person = z.object({
  id: z.string(),
  name: z.string().nullable(),
  external: z.literal(true).optional(),
});

const GeneratedItemView = z.object({
  kind: z
    .enum(['suggestion', 'proposal', 'creation'])
    .describe(
      'A suggestion, a proposal discarded, or a component made from a proposal to make one',
    ),
  id: z.string(),
  state: z
    .enum(['accepted', 'open', 'rejected', 'withdrawn', 'discarded'])
    .describe(
      'A suggestion accepted, open, rejected or withdrawn; a proposal discarded before it was suggested',
    ),
  askedBy: Person.nullable().describe('Who ran the assistant, or null where they have been erased'),
  actedBy: Person.nullable().describe(
    'Who accepted, rejected, withdrew or discarded it, and null while it is open',
  ),
  actedAt: z.string().nullable(),
  acceptedInto: z
    .object({
      version: z.string(),
      number: z.string().describe('`revision.version`'),
      inPlaced: z
        .boolean()
        .describe(
          'Whether that version is in the history of the one placed: same line at or before it, or the main line before where it diverged',
        ),
    })
    .nullable(),
  run: z.object({
    id: z.string(),
    model: z.string().nullable().describe('The model its reply named, with its release'),
    endpoint: z.string(),
    instructions: z.string().nullable().describe("The assistant's instructions' version"),
    promptVersion: z
      .string()
      .nullable()
      .describe("A declared prompt's version; none for the assistant"),
    contextDigest: z.string().describe('SHA-256 of what the model was last given'),
  }),
});

export const GeneratedReport = z.object({
  placements: z.array(
    z.object({
      node: z.string(),
      component: z.string(),
      version: z.string(),
      number: z.string(),
      restoredFrom: z
        .string()
        .nullable()
        .describe(
          'The version the placed one was restored from, where it was: what was accepted may be gone',
        ),
      items: z.array(GeneratedItemView),
    }),
  ),
  unreadable: z
    .number()
    .int()
    .describe('How many placed components the caller may not read: counted, never named'),
});
export type GeneratedReport = z.infer<typeof GeneratedReport>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;

export const generatedRoutes = {
  getDocumentGenerated: {
    operationId: 'getDocumentGenerated',
    method: 'GET',
    path: '/v1/documents/{id}/generated',
    summary: 'Which of a document’s content came from a model, and who accepted it',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: GeneratedParams,
    responses: {
      200: {
        description: 'Each placed component with generated content, at the latest version',
        schema: GeneratedReport,
      },
      401: unauthenticated,
      403: {
        description: 'Never answered: a document the caller may read is one they may open',
        schema: ErrorBody,
      },
      404: {
        description: 'No such document in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
  getPublicationGenerated: {
    operationId: 'getPublicationGenerated',
    method: 'GET',
    path: '/v1/publications/{id}/generated',
    summary: 'Which of what a publication printed came from a model, and who accepted it',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: GeneratedParams,
    responses: {
      200: {
        description: 'Each component version it printed with generated content',
        schema: GeneratedReport,
      },
      401: unauthenticated,
      403: {
        description: 'Never answered: a publication the caller may read is one they may open',
        schema: ErrorBody,
      },
      404: {
        description:
          'No such publication in this environment, none the caller may read, or one shared with them alone',
        schema: ErrorBody,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
