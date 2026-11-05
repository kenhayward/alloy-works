// `pnpm environment:setup`, after the database's: see environment-setup.ts and deploy/README.md.
import { environmentDatabaseUrl, readEnvironmentSettings, tenantNames } from '@alloy-works/db';
import { readStoreEnvironment, setUpEnvironmentStore } from './environment-setup.js';

try {
  const environment = readEnvironmentSettings(process.env);
  const { settings, admin } = readStoreEnvironment(process.env);
  const names = tenantNames(environment.tenant.id);
  const { issued } = await setUpEnvironmentStore({
    settings,
    admin,
    sealingKey: environment.sealingKey,
    adminUrl: environmentDatabaseUrl(environment),
    tenant: { id: environment.tenant.id, schema: names.schema, role: names.role },
  });
  console.log(
    issued
      ? `Gave ${environment.tenant.id} a credential for ${settings.bucket}/${names.role}/`
      : `${environment.tenant.id} keeps its store credential`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Store setup failed');
  process.exitCode = 1;
}
