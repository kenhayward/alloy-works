import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildAsyncApi, streamEvents } from './events.js';
import { buildOpenApi } from './openapi.js';
import { allRoutes } from './routes.js';

describe('the committed openapi.json', () => {
  it('is exactly what the contracts generate - run `pnpm --filter @alloy-works/api-contract generate` if not', () => {
    const committed: unknown = JSON.parse(
      readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'),
    );
    expect(committed).toEqual(buildOpenApi(allRoutes));
  });
});

describe('the committed asyncapi.json', () => {
  it('API-015 is exactly what the stream events generate - run `pnpm --filter @alloy-works/api-contract generate` if not', () => {
    const committed: unknown = JSON.parse(
      readFileSync(new URL('../asyncapi.json', import.meta.url), 'utf8'),
    );
    expect(committed).toEqual(buildAsyncApi());
  });

  it('names a message for every event and a schema for each', () => {
    const document = buildAsyncApi();
    expect(Object.keys(document.components.messages).sort()).toEqual(
      Object.keys(streamEvents).sort(),
    );
    for (const message of Object.values(document.components.messages)) {
      expect(message.payload).toBeTypeOf('object');
    }
  });
});
