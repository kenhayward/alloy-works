import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody } from './schemas.js';

export const PeopleList = z.object({
  items: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type PeopleList = z.infer<typeof PeopleList>;

/**
 * The environment's people, for a `user` field's picker (definitions.md, DE-J): everybody who has signed
 * in, by name, to anybody signed in. Not yet paged. `GET /v1/principals` stays the administrators',
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
    responses: {
      200: { description: 'The people, by name', schema: PeopleList },
      401: { description: 'No session, or not one this environment issued', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
