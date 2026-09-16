import { migrateStored, type MigrationChain } from '../../stored/migrate.js';

import { CURRENT_SCHEMA_VERSION, parseContentDocument, type ContentDocument } from './document.js';

/**
 * Empty while there is one schema version. It exists now rather than when it is needed, because the
 * first schema change is the moment a chain nobody built is discovered to be missing - and by then
 * there is stored content that needs it.
 */
export const contentMigrationChain: MigrationChain = {
  subject: 'content',
  current: CURRENT_SCHEMA_VERSION,
  migrations: {},
};

/** Content's chain, through the harness every stored payload in this package shares. */
export function migrate(value: unknown): unknown {
  return migrateStored(value, contentMigrationChain);
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
