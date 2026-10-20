import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody } from './schemas.js';

const Endpoint = z
  .object({
    id: z.string(),
    name: z.string(),
    boundary: z.enum(['inside', 'outside']),
    retired: z.boolean(),
  })
  .nullable();

export const EmbeddingView = z.object({
  serving: z
    .object({ model: z.string(), dims: z.number().int(), endpoint: Endpoint })
    .nullable()
    .describe('The model meaning is searched by now; null where none serves'),
  pending: z
    .object({
      model: z.string(),
      dims: z.number().int().nullable().describe('Learned from a sample as it is confirmed'),
      endpoint: Endpoint,
      confirmed: z
        .boolean()
        .describe('Whether an administrator confirmed it: nothing is embedded for it before'),
      texts: z.number().int().nonnegative().describe('The latest versions’ distinct block texts'),
      missing: z.number().int().nonnegative().describe('Of those, how many it has no vector for'),
      estimate: z
        .object({
          tokens: z.number().int().nonnegative(),
          cost: z.string().nullable(),
          currency: z.string().nullable(),
        })
        .describe(
          'What embedding the texts it lacks would cost, approximately: about four characters a token, at its endpoint’s input price',
        ),
    })
    .nullable()
    .describe(
      'The model embedding is routed to that does not serve yet: shown with its cost, and embedding nothing until confirmed; the one serving answers searches until it has every text',
    ),
});

export const EmbeddingConfirmationBody = z.object({
  model: z.string().min(1).max(200).describe('The pending model, as the view names it'),
});
export type EmbeddingConfirmationBody = z.infer<typeof EmbeddingConfirmationBody>;

const administer = {
  check: 'permission',
  permission: 'administer',
  target: { tenant: true },
} as const;
const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const forbidden = {
  description: 'The caller does not administer this environment',
  schema: ErrorBody,
} as const;

/**
 * Embedding a corpus (generation.md, "Meaning"; the G7 plan, G7-J; GEN-044): the model serving
 * meaning, the one waiting with what it would cost, and confirming it, before anything is embedded.
 */
export const embeddingRoutes = {
  getEmbedding: {
    operationId: 'getEmbedding',
    method: 'GET',
    path: '/v1/embedding',
    summary: 'The embedding model serving meaning, and one waiting, with what it would cost',
    tenantScoped: true,
    access: administer,
    responses: {
      200: { description: 'The models', schema: EmbeddingView },
      401: unauthenticated,
      403: forbidden,
    },
  },
  confirmEmbedding: {
    operationId: 'confirmEmbedding',
    method: 'POST',
    path: '/v1/embedding/confirmation',
    summary: 'Confirm the waiting embedding model, its cost seen, so the corpus is embedded',
    tenantScoped: true,
    access: administer,
    body: EmbeddingConfirmationBody,
    responses: {
      200: { description: 'Confirmed, and every text queued', schema: EmbeddingView },
      401: unauthenticated,
      403: forbidden,
      409: {
        description:
          '`embedding_not_pending`: no such model waits; `endpoint_unusable`: its endpoint is retired or has no key; `embedding_unavailable`: the model did not answer a sample; `embedding_dimensions_unsupported`: its vectors are not 384, 768, 1024, 1536 or 3072 long',
        schema: ErrorBody,
      },
      503: { description: '`connector_unavailable`', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
