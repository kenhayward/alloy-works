/**
 * A migration from one schema version to the next. Total and pure: it takes whatever was stored at
 * `from` and returns whatever `from + 1` expects, and it reads nothing outside its argument.
 */
export type Migration = (value: Record<string, unknown>) => Record<string, unknown>;

/** One kind of stored payload's chain: what it is called in an error, where it stands, its steps. */
export type MigrationChain = {
  readonly subject: string;
  readonly current: number;
  readonly migrations: Readonly<Record<number, Migration>>;
};

/**
 * Migration is a READ-TIME PROJECTION, never a rewrite. Version rows take inserts only and each
 * digest is over what was written, so migrating a stored payload would either invalidate its digest
 * or need a version row nobody authored. The stored bytes never change, and neither does the argument.
 */
export function migrateStored(value: unknown, chain: MigrationChain): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || !('schemaVersion' in value)) {
    throw new Error(`Stored ${chain.subject} records no schema version, so it cannot be migrated`);
  }
  const record = { ...(value as Record<string, unknown>) };
  const from = record.schemaVersion;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) {
    throw new Error(
      `Stored ${chain.subject} records a schema version that is not a version: ${String(from)}`,
    );
  }
  if (from > chain.current) {
    throw new Error(
      `Stored ${chain.subject} was written against schema version ${from}, which is newer than this build's ${chain.current}`,
    );
  }

  let migrated = record;
  for (let version = from; version < chain.current; version += 1) {
    const step = chain.migrations[version];
    if (!step) {
      throw new Error(
        `No migration for ${chain.subject} from schema version ${version} to ${version + 1}`,
      );
    }
    migrated = { ...step(migrated), schemaVersion: version + 1 };
  }
  return migrated;
}
