import { z } from 'zod';
import { ErrorBody, LowercaseUuid } from './schemas.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What changed since an instant, in one scope (SCH-025): a document, a space, or a set of results. */
export const ChangesQuery = z
  .strictObject({
    since: z.iso.datetime({ offset: true }).describe('The instant, as ISO 8601'),
    document: LowercaseUuid.optional().describe(
      'A document: itself, and every component it places',
    ),
    space: LowercaseUuid.optional().describe('A space: everything in it'),
    ids: z
      .string()
      .optional()
      .describe('A set of results: up to 200 artifact identifiers, separated by commas')
      .refine(
        (value) =>
          value === undefined ||
          (value.split(',').length <= 200 && value.split(',').every((each) => UUID.test(each))),
        { message: 'Up to 200 identifiers, separated by commas' },
      ),
  })
  .refine(
    (query) =>
      [query.document, query.space, query.ids].filter((each) => each !== undefined).length === 1,
    { message: 'Name one scope: a document, a space or a set of results' },
  );
export type ChangesQuery = z.infer<typeof ChangesQuery>;

export const ChangesView = z.object({
  since: z.string(),
  recordBegins: z
    .string()
    .nullable()
    .describe("Where the record of what was asked about begins: its first version's time"),
  fromRecordStart: z
    .boolean()
    .describe(
      'Whether `since` reached back before the record, so the answer is from where it begins',
    ),
  more: z
    .boolean()
    .describe('Whether there was more than 500 of either list: the newest are answered'),
  artifacts: z.array(
    z.object({
      artifact: LowercaseUuid,
      kind: z.string(),
      title: z.string(),
      versions: z.int().describe('How many versions were cut since'),
      latest: z.object({ id: LowercaseUuid, number: z.string(), at: z.string() }),
    }),
  ),
  values: z
    .array(
      z.object({
        document: LowercaseUuid,
        node: z.string(),
        binding: z.string(),
        act: z.string(),
        at: z.string(),
      }),
    )
    .describe(
      'Each value a document in scope resolved, accepted or kept since (`resolve`, `accept`, `confirm`), or revised by hand or its revision withdrawn (`revise`, `withdraw`)',
    ),
});
export type ChangesView = z.infer<typeof ChangesView>;

/** What changed since (SCH-025, SCH-048; the CP plan, CP-I). */
export const changesRoutes = {
  listChangesSince: {
    operationId: 'listChangesSince',
    method: 'GET',
    path: '/v1/changes',
    summary: 'What changed since an instant, in a document, a space or a set of results',
    tenantScoped: true,
    access: { check: 'session' },
    query: ChangesQuery,
    responses: {
      200: { description: 'Every change the caller may read', schema: ChangesView },
      400: { description: 'No scope, or more than one', schema: ErrorBody },
      401: {
        description: 'No session, or not one this environment issued',
        schema: ErrorBody,
      },
      404: {
        description: 'No such document or space the caller may read',
        schema: ErrorBody,
      },
    },
  },
} as const;
