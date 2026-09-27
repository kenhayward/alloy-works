import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { DocumentParams } from './documents.js';
import { ErrorBody } from './schemas.js';

/**
 * What the editor sets a component's text in (themes.md, "The theme in the editor", ET-A and ET-B): a
 * theme version as stored, with each catalogue version it names, for the renderer to read by the same
 * reader the publisher reads it by (STY-035); and the two lengths of the layout's page an image style's
 * are shares of. Nothing else of the layout's page reaches the renderer.
 */
export const PresentationView = z.object({
  theme: z.object({
    versionId: z.string(),
    number: z.string().describe('The theme version, as VER-009 presents it'),
    content: z
      .record(z.string(), z.unknown())
      .describe('The theme version as stored, naming its catalogues by version'),
    catalogues: z
      .array(
        z.object({
          versionId: z.string(),
          content: z.record(z.string(), z.unknown()).describe('The catalogue version as stored'),
        }),
      )
      .describe('Each catalogue version the theme names'),
  }),
  frame: z
    .object({
      measure: z.number().describe("The width of the layout's text block, in points"),
      textHeight: z.number().describe("The height of the layout's text block, in points"),
    })
    .describe("The layout's page, as far as an image style's lengths are shares of it"),
});
export type PresentationView = z.infer<typeof PresentationView>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;

export const presentationRoutes = {
  getPresentation: {
    operationId: 'getPresentation',
    method: 'GET',
    path: '/v1/presentation',
    summary: "The environment's theme and layout, which a component on its own is shown in",
    tenantScoped: true,
    access: { check: 'session' },
    responses: {
      200: { description: 'The theme and the frame', schema: PresentationView },
      401: unauthenticated,
    },
  },
  getDocumentPresentation: {
    operationId: 'getDocumentPresentation',
    method: 'GET',
    path: '/v1/documents/{id}/presentation',
    summary: "The theme and layout a document is published under, which its text is shown in",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: DocumentParams,
    responses: {
      200: { description: 'The theme and the frame', schema: PresentationView },
      401: unauthenticated,
      403: {
        description: 'Never answered: a document the caller may read is one they may see set',
        schema: ErrorBody,
      },
      404: { description: 'No such document, or not one the caller may read', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
