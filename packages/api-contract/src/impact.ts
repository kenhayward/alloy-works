import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

export const ArtifactParams = z.object({ id: z.uuid() });
export type ArtifactParams = z.infer<typeof ArtifactParams>;

export const ImpactQuery = z.object({
  depth: z
    .string()
    .regex(/^(?:[1-9]|10)$/, 'Expected a whole number from 1 to 10')
    .describe('How many hops to walk, 1 to 10: there is no default (REL-017)'),
});
export type ImpactQuery = z.infer<typeof ImpactQuery>;

const Artifact = z.object({
  id: LowercaseUuid,
  kind: z.string().describe('component, document, queryDefinition, asset, template, ...'),
  title: z.string().describe('Its title or name now'),
});

/** What a change to an artifact reaches (relationships.md, "Impact"; the R2 plan, R2-C). */
export const ImpactView = z.object({
  reached: z
    .array(
      Artifact.extend({
        depth: z.number().int().describe('The fewest hops it is reached in'),
        via: LowercaseUuid.describe(
          'The artifact it references or relates to, one hop nearer the start',
        ),
        hard: z
          .boolean()
          .describe(
            'Reached by a chain of references alone, which a change would break or change; false where a declared relationship reaches it, which is informational',
          ),
      }),
    )
    .describe('Nearest first, each once'),
  cut: z
    .boolean()
    .describe(
      'Whether the walk met something the caller may not read, and went no further that way: never what',
    ),
  more: z.boolean().describe('Whether it stopped at 1,000 with more to say'),
});
export type ImpactView = z.infer<typeof ImpactView>;

/** What an artifact uses, one hop forwards (SCH-024; R2-E). */
export const ReferencesView = z.object({
  references: z
    .array(Artifact)
    .describe('What its latest version references that the caller may read'),
  unreadable: z.boolean().describe('Whether it references something the caller may not read too'),
});
export type ReferencesView = z.infer<typeof ReferencesView>;

const read = { check: 'permission', permission: 'read', target: { artifact: 'id' } } as const;
const refusals = {
  401: { description: 'No session, or not one this environment issued', schema: ErrorBody },
  403: {
    description: 'Never answered: an artifact the caller may not read is not found',
    schema: ErrorBody,
  },
  404: { description: 'No such artifact the caller may read', schema: ErrorBody },
} as const;

/** Impact and what an artifact uses (relationships.md; the R2 plan, Task 1). */
export const impactRoutes = {
  getArtifactImpact: {
    operationId: 'getArtifactImpact',
    method: 'GET',
    path: '/v1/artifacts/{id}/impact',
    summary: 'What a change to an artifact reaches, to a depth',
    tenantScoped: true,
    access: read,
    params: ArtifactParams,
    query: ImpactQuery,
    responses: {
      200: {
        description:
          'The artifacts whose latest versions reference it or that relate to it, and so on, to the depth asked: nearest first, at most 1,000',
        schema: ImpactView,
      },
      400: { description: 'A depth missing, or not from 1 to 10', schema: ErrorBody },
      ...refusals,
    },
  },
  getArtifactReferences: {
    operationId: 'getArtifactReferences',
    method: 'GET',
    path: '/v1/artifacts/{id}/references',
    summary: 'What an artifact uses: what its latest version references',
    tenantScoped: true,
    access: read,
    params: ArtifactParams,
    responses: {
      200: {
        description:
          'What its latest version references, the caller may read, and whether there is more',
        schema: ReferencesView,
      },
      ...refusals,
    },
  },
} as const satisfies Record<string, RouteContract>;
