import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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
