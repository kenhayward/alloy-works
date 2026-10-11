// Rewrites openapi.json from the route contracts. The file is committed so that a change to the API
// is a change in a diff a reviewer reads, and spec.test.ts fails when the two drift apart.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAsyncApi } from './events.js';
import { buildOpenApi } from './openapi.js';
import { allRoutes } from './routes.js';

const file = new URL('../openapi.json', import.meta.url);
writeFileSync(file, `${JSON.stringify(buildOpenApi(allRoutes), null, 2)}\n`);
console.log(`Wrote ${fileURLToPath(file)}`);

// And the stream's events, which OpenAPI cannot say (API-014, API-015).
const events = new URL('../asyncapi.json', import.meta.url);
writeFileSync(
  events,
  `${JSON.stringify(buildAsyncApi(), null, 2)}
`,
);
console.log(`Wrote ${fileURLToPath(events)}`);
