// `pnpm environment:setup`: see environment-setup.ts and deploy/README.md.
import { readEnvironmentSettings, setUpEnvironment } from './environment-setup.js';

try {
  const settings = readEnvironmentSettings(process.env);
  const done = await setUpEnvironment(settings);
  console.log(
    done.created
      ? `Created environment ${settings.tenant.id} at ${settings.hostname}`
      : `Environment ${settings.tenant.id} is up to date`,
  );
} catch (error) {
  // The message alone: a stack or a driver's error object is no place to risk a connection string.
  console.error(error instanceof Error ? error.message : 'Environment setup failed');
  process.exitCode = 1;
}
