import { z } from 'zod';
import { nextCursor, pageQuery } from './listing.js';
import type { RouteContract } from './contract.js';
import { ErrorBody } from './schemas.js';

export const PeopleList = z.object({
  items: z.array(z.object({ id: z.string(), name: z.string() })),
  next: nextCursor,
});
export const PeopleQuery = z.object(pageQuery);
export type PeopleQuery = z.infer<typeof PeopleQuery>;
export type PeopleList = z.infer<typeof PeopleList>;

/**
 * The environment's people, for a `user` field's picker (definitions.md, DE-J): everybody who has signed
 * in, a page at a time by when each first signed in, to anybody signed in. `GET /v1/principals` stays the administrators',
 * since it also lists who was invited and has not come.
 */
export const peopleRoutes = {
  listPeople: {
    operationId: 'listPeople',
    method: 'GET',
    path: '/v1/people',
    summary: "The environment's people, by name, for a user field",
    tenantScoped: true,
    access: { check: 'session' },
    query: PeopleQuery,
    responses: {
      200: {
        description: 'A page of the people, by when each first signed in',
        schema: PeopleList,
      },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: { description: 'No session, or not one this environment issued', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
