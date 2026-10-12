import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody } from './schemas.js';

/** A component or a document, by the id its artifact carries. */
export const ArchivalParams = z.object({ id: z.uuid() });
export type ArchivalParams = z.infer<typeof ArchivalParams>;

export const ArchivalView = z.object({
  archived: z
    .boolean()
    .describe(
      'Whether it is archived now: left out of ordinary listings and search, still readable',
    ),
});
export type ArchivalView = z.infer<typeof ArchivalView>;

const retire = { check: 'permission', permission: 'retire', target: { artifact: 'id' } } as const;

const responses = (kind: 'component' | 'document', done: string) =>
  ({
    200: { description: `${done}, or already so, which changes nothing`, schema: ArchivalView },
    401: { description: 'No session, or not one this environment issued', schema: ErrorBody },
    403: {
      description: `The caller may read the ${kind} but may not retire it`,
      schema: ErrorBody,
    },
    404: {
      description: `No such ${kind} in this environment, or none the caller may read`,
      schema: ErrorBody,
    },
  }) as const;

/** Archiving and unarchiving a component or a document (lifecycle.md; the AH plan, AH-A to AH-E). */
export const archivalRoutes = {
  archiveComponent: {
    operationId: 'archiveComponent',
    method: 'POST',
    path: '/v1/components/{id}/archive',
    summary: 'Archive a component',
    tenantScoped: true,
    access: retire,
    params: ArchivalParams,
    responses: responses('component', 'Archived'),
  },
  unarchiveComponent: {
    operationId: 'unarchiveComponent',
    method: 'POST',
    path: '/v1/components/{id}/unarchive',
    summary: 'Unarchive a component',
    tenantScoped: true,
    access: retire,
    params: ArchivalParams,
    responses: responses('component', 'Unarchived'),
  },
  archiveDocument: {
    operationId: 'archiveDocument',
    method: 'POST',
    path: '/v1/documents/{id}/archive',
    summary: 'Archive a document',
    tenantScoped: true,
    access: retire,
    params: ArchivalParams,
    responses: responses('document', 'Archived'),
  },
  unarchiveDocument: {
    operationId: 'unarchiveDocument',
    method: 'POST',
    path: '/v1/documents/{id}/unarchive',
    summary: 'Unarchive a document',
    tenantScoped: true,
    access: retire,
    params: ArchivalParams,
    responses: responses('document', 'Unarchived'),
  },
} as const satisfies Record<string, RouteContract>;
