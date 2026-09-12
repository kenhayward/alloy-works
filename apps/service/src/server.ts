// The process: read the configuration, connect, listen, and close cleanly when asked to stop. Every
// decision it relies on lives in modules with tests of their own; this file only wires them.
import { createTenantDatabase, listenToTenants } from '@alloy-works/db';
import { buildApp } from './app.js';
import { describeConfig, loadConfig } from './config.js';
import { createObjectStores, sealingKey } from '@alloy-works/objects';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';

const config = loadConfig(process.env);
const db = createTenantDatabase(config.databaseUrl);
const events = listenToTenants(config.databaseUrl);
const secrets = environmentSecrets(process.env);
const objects = config.objectStore
  ? createObjectStores(config.objectStore, sealingKey(secrets.get('object_store_key') ?? ''))
  : undefined;
const app = buildApp({
  db,
  logLevel: config.logLevel,
  oidc: createOidcClient({ allowInsecureIssuers: config.allowInsecureIssuers }),
  secrets,
  events,
  ...(config.google ? { google: config.google } : {}),
  ...(objects ? { objects } : {}),
  ...(config.rendererRoot ? { rendererRoot: config.rendererRoot } : {}),
});

const stop = async (signal: string) => {
  app.log.info({ signal }, 'stopping');
  await app.close();
  await events.close();
  await db.close();
};
process.once('SIGINT', () => void stop('SIGINT'));
process.once('SIGTERM', () => void stop('SIGTERM'));

app.log.info({ config: describeConfig(config) }, 'starting');
await app.listen({ port: config.port, host: config.host });
