import { ConfigurationRefused, takeConnectorConfig } from './config.js';
import { createConnectorServer } from './server.js';
import { IsolationRefused, verifyChildIsolation } from './supervisor.js';

/**
 * The connector's process (the D1 plan, task 4): the configuration read once and its keys deleted
 * from the environment, a child spawned as every child is to prove it runs as a user of its own that
 * cannot read this process's environment (the D1 fix, C1), then the interface on `connector-private`.
 * Thin: every decision is in `config.ts`, `server.ts` and the supervisor.
 */
let config;
try {
  config = takeConnectorConfig(process.env);
  await verifyChildIsolation();
} catch (error) {
  // The refusal names the variable, or the isolation missing, and never a value.
  const known = error instanceof ConfigurationRefused || error instanceof IsolationRefused;
  process.stderr.write(`${known ? error.message : 'The configuration could not be read'}\n`);
  process.exit(1);
}

const server = createConnectorServer({ config });
server.listen(config.port, config.host, () => {
  process.stdout.write(
    `${JSON.stringify({ at: new Date().toISOString(), listening: config.port })}\n`,
  );
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
