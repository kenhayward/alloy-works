import { contentMigrationChain } from '../model/migrate.js';
import { migrateStored, type MigrationChain } from '../../stored/migrate.js';

import type { ReportCollector } from './report.js';

export type StageResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: string };

/**
 * The third stage: content at an earlier schema version is brought to the current one, or refused by
 * name (CNT-134). It runs before normalise and re-identify, so they work in the current schema's terms.
 *
 * The chain is content's own, the one stored content is read through - a clipboard has no version row,
 * so the version it was written against is the one it carries (CNT-011). `chain` is a parameter only so
 * a test can stand in a second schema version before one exists.
 */
export function migrateCandidate(
  candidate: unknown,
  report: ReportCollector,
  chain: MigrationChain = contentMigrationChain,
): StageResult<Record<string, unknown>> {
  try {
    const from = (candidate as { schemaVersion?: unknown } | null)?.schemaVersion;
    const value = migrateStored(candidate, chain);
    if (typeof from === 'number' && from < chain.current) {
      report.add('migrate', 'rewritten', 'schemaVersion', { detail: String(from) });
    }
    return { ok: true, value };
  } catch (error) {
    report.add('migrate', 'refused', 'schemaVersion');
    return { ok: false, failure: error instanceof Error ? error.message : String(error) };
  }
}
