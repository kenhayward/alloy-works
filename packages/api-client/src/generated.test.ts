import { readFile } from 'node:fs/promises';
import openapiTypeScript, { astToString } from 'openapi-typescript';
import { describe, expect, it } from 'vitest';

describe('the generated types', () => {
  it('are what the committed document generates', async () => {
    const document = new URL('../../api-contract/openapi.json', import.meta.url);
    const committed = await readFile(new URL('./generated/schema.d.ts', import.meta.url), 'utf8');
    expect(astToString(await openapiTypeScript(document))).toBe(committed);
  });
});
