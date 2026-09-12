// Rewrites the types from the committed OpenAPI document. The output is committed too, so a change
// to the API is a change in a diff a reviewer reads, and generated.test.ts fails when they drift.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import openapiTypeScript, { astToString } from 'openapi-typescript';

const document = new URL('../../api-contract/openapi.json', import.meta.url);
const out = new URL('../src/generated/schema.d.ts', import.meta.url);
const ast = await openapiTypeScript(document);
writeFileSync(out, astToString(ast));
console.log(`Wrote ${fileURLToPath(out)}`);
