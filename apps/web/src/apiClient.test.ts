import { createApiClient, type ComponentView, type Me } from '@alloy-works/api-client';
import { describe, expectTypeOf, it } from 'vitest';

// These assertions are checked by `pnpm typecheck`, not by the test run: `expectTypeOf` does
// nothing at run time. They exist because the renderer imports the client's built declarations,
// and those once named a file the build never wrote - so every answer was `any` here while the
// package's own sources, checked against themselves, looked perfectly typed.
describe('the API client, as the renderer sees it', () => {
  it('names its response types from the document rather than any', () => {
    expectTypeOf<Me>().not.toBeAny();
    expectTypeOf<ComponentView>().not.toBeAny();
    expectTypeOf<Me['id']>().toEqualTypeOf<string>();
  });

  it("types a call's answer, and refuses a route the document does not declare", async () => {
    const client = createApiClient({
      baseUrl: 'http://dev.acme.localhost',
      fetch: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
    });
    const { data } = await client.GET('/v1/me');
    expectTypeOf(data).not.toBeAny();
    expectTypeOf(data).toEqualTypeOf<Me | undefined>();

    // @ts-expect-error - no such route, so no such call
    const unknown = () => client.GET('/v1/no-such-route');
    expectTypeOf(unknown).toBeFunction();
  });
});
