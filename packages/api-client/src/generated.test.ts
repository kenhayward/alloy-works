import { readFile } from 'node:fs/promises';
import openapiTypeScript, { astToString } from 'openapi-typescript';
import { describe, expect, it } from 'vitest';

/**
 * Generating the types from the whole document takes a fifth of a second on a desktop and three to
 * six seconds on CI's runner while every other suite runs beside it (issue #263): a correctness
 * check, not a budget, so it is given a minute rather than Vitest's five seconds.
 */
const GENERATION_TIMEOUT_MS = 60_000;

describe('the generated types', () => {
  it(
    'are what the committed document generates',
    async () => {
      const document = new URL('../../api-contract/openapi.json', import.meta.url);
      const committed = await readFile(new URL('./generated/schema.ts', import.meta.url), 'utf8');
      expect(astToString(await openapiTypeScript(document))).toBe(committed);
    },
    GENERATION_TIMEOUT_MS,
  );
});
