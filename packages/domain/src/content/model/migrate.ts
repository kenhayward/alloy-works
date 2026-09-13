import { CURRENT_SCHEMA_VERSION, parseContentDocument, type ContentDocument } from './document.js';

/**
 * A migration from one schema version to the next. Total and pure: it takes whatever was stored at
 * `from` and returns whatever `from + 1` expects, and it reads nothing outside its argument.
 */
type Migration = (value: Record<string, unknown>) => Record<string, unknown>;

/**
 * Empty while there is one schema version. It exists now rather than when it is needed, because the
 * first schema change is the moment a chain nobody built is discovered to be missing - and by then
 * there is stored content that needs it.
 */
const migrations: Record<number, Migration> = {};

/**
 * Migration is a READ-TIME PROJECTION, never a rewrite. Version rows take inserts only and
 * `content_hash` is the hash of what was written, so migrating a stored version would either
 * invalidate its hash or need a version row nobody authored. The stored bytes never change.
 */
export function migrate(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('schemaVersion' in value)) {
    throw new Error('Stored content records no schema version, so it cannot be migrated (CNT-011)');
  }
  const record = { ...(value as Record<string, unknown>) };
  const from = record.schemaVersion;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) {
    throw new Error(
      `Stored content records a schema version that is not a version: ${String(from)}`,
    );
  }
  if (from > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Stored content was written against schema version ${from}, which is newer than this build's ${CURRENT_SCHEMA_VERSION}`,
    );
  }

  let migrated = record;
  for (let version = from; version < CURRENT_SCHEMA_VERSION; version += 1) {
    const step = migrations[version];
    if (!step) throw new Error(`No migration from schema version ${version} to ${version + 1}`);
    migrated = step(migrated);
    migrated.schemaVersion = version + 1;
  }
  return migrated;
}

export type ReadOutcome =
  | { ok: true; document: ContentDocument }
  | { ok: false; artifact: string; version: string; failure: string };

/**
 * CNT-013: content that fails validation on read-back is quarantined and reported, never silently
 * coerced or partially loaded. A typed outcome rather than an exception, so there is no path that
 * yields half a document - a generic error swallowed by a handler is the coercion CNT-013 forbids
 * with extra steps.
 */
export function readContent(
  value: unknown,
  context: { artifact: string; version: string },
): ReadOutcome {
  try {
    return { ok: true, document: parseContentDocument(migrate(value)) };
  } catch (error) {
    return {
      ok: false,
      artifact: context.artifact,
      version: context.version,
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}
