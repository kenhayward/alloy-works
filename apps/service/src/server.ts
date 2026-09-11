// The process: read the configuration, connect, listen, and close cleanly when asked to stop. Every
// decision it relies on lives in modules with tests of their own; this file only wires them.
import { createTenantDatabase } from '@alloy-works/db';
import { buildApp } from './app.js';
import { describeConfig, loadConfig } from './config.js';

const config = loadConfig(process.env);
const db = createTenantDatabase(config.databaseUrl);
const app = buildApp({ db, logLevel: config.logLevel });

const stop = async (signal: string) => {
  app.log.info({ signal }, 'stopping');
  await app.close();
  await db.close();
};
process.once('SIGINT', () => void stop('SIGINT'));
process.once('SIGTERM', () => void stop('SIGTERM'));

app.log.info({ config: describeConfig(config) }, 'starting');
await app.listen({ port: config.port, host: config.host });
