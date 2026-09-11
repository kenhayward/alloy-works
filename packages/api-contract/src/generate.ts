// Rewrites openapi.json from the route contracts. The file is committed so that a change to the API
// is a change in a diff a reviewer reads, and spec.test.ts fails when the two drift apart.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildOpenApi } from './openapi.js';
import { allRoutes } from './routes.js';

const file = new URL('../openapi.json', import.meta.url);
writeFileSync(file, `${JSON.stringify(buildOpenApi(allRoutes), null, 2)}\n`);
console.log(`Wrote ${fileURLToPath(file)}`);
