import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assistantEvents, buildAsyncApi, streamEvents } from './events.js';
import { buildOpenApi } from './openapi.js';
import { allRoutes } from './routes.js';

describe('the committed openapi.json', () => {
  it('is exactly what the contracts generate - run `pnpm --filter @alloy-works/api-contract generate` if not', () => {
    const committed: unknown = JSON.parse(
      readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'),
    );
    const generated = buildOpenApi(allRoutes);
    // The texts first: a deep comparison of the whole document took CI past five seconds under load
    // (issue #689), so it runs only where they differ, to say how - and to pass where only the order
    // of a key differs, as it always has.
    if (JSON.stringify(committed) !== JSON.stringify(generated)) {
      expect(committed).toEqual(generated);
    }
  }, 30_000);
});

describe('the committed asyncapi.json', () => {
  it('API-015 is exactly what the stream events generate - run `pnpm --filter @alloy-works/api-contract generate` if not', () => {
    const committed: unknown = JSON.parse(
      readFileSync(new URL('../asyncapi.json', import.meta.url), 'utf8'),
    );
    expect(committed).toEqual(buildAsyncApi());
  });

  it('API-017 states plainly that events are not replayed, and that every connection begins with a snapshot', () => {
    const { info, components } = buildAsyncApi();
    expect(info.description).toContain('Every connection begins with `snapshot`');
    expect(info.description).toContain('events are not replayed, so a reconnect is a connect');
    expect(Object.keys(components.messages)).toContain('snapshot');
  });

  it('API-063 specifies presence, locks and notifications apart from OpenAPI, each a message of its own', () => {
    const { components } = buildAsyncApi();
    for (const name of ['presence', 'presence_left', 'lock', 'inbox']) {
      expect(components.messages, name).toHaveProperty(name);
    }
    expect(components.messages.inbox?.summary).toMatch(/notification/);
  });

  it('names a message for every event and a schema for each', () => {
    const document = buildAsyncApi();
    expect(Object.keys(document.components.messages).sort()).toEqual(
      [
        ...Object.keys(streamEvents),
        ...Object.keys(assistantEvents).map((name) => `assistant_${name}`),
      ].sort(),
    );
    for (const message of Object.values(document.components.messages)) {
      expect(message.payload).toBeTypeOf('object');
    }
  });
});
