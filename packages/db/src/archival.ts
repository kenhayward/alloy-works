import { sql, type RawBuilder, type SqlBool } from 'kysely';
import { artifactPlace, recordEvent } from './audit.js';
import { visibleIn } from './listing.js';
import { flagEarlier } from './search-earlier.js';
import type { TenantTransaction } from './tables.js';
import { lockArtifact } from './versions.js';

/**
 * **Archival** (lifecycle.md; the AH plan, AH-B to AH-E): a component or a document archived leaves
 * ordinary listings, their facets and totals, search and Home's attention, and stays retrievable. The
 * filter is here, never in the shared readable set: references, the inbox, baselines and publishing
 * still read archived content.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Whether the artifact aliased `alias` is archived: its latest act, as `snapshot` sees it where a walk
 * gives one, else as the statement does, is `archived` (AH-C).
 */
export function archivedAs(alias: string, snapshot?: string): RawBuilder<SqlBool> {
  const seen = snapshot === undefined ? sql<SqlBool>`true` : visibleIn('x.written_by', snapshot);
  return sql<SqlBool>`coalesce((select x.act = 'archived' from artifact_archival x
    where x.artifact_id = ${sql.ref(`${alias}.id`)} and ${seen}
    order by x.id desc limit 1), false)`;
}

/** What an ordinary listing keeps: the artifact aliased `alias` not archived. */
export function notArchivedAs(alias: string, snapshot?: string): RawBuilder<SqlBool> {
  return sql<SqlBool>`not ${archivedAs(alias, snapshot)}`;
}

/** Whether the artifact is archived now. */
export async function isArchived(trx: TenantTransaction, artifactId: string): Promise<boolean> {
  const latest = await trx
    .selectFrom('artifact_archival')
    .select('act')
    .where('artifact_id', '=', artifactId)
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return latest?.act === 'archived';
}

/**
 * Whether this tenant stores archival yet (0083): indexing runs in the migration run that applies 0031,
 * before it does.
 */
export async function archivalStored(trx: TenantTransaction): Promise<boolean> {
  const { rows } = await sql<{
    present: boolean;
  }>`select to_regclass('artifact_archival') is not null as present`.execute(trx);
  return rows[0]?.present === true;
}

export type ArchivalAnswer = 'changed' | 'unchanged';

/** Archives or unarchives an artifact of one of these kinds: undefined for any other. */
export async function actOn(
  trx: TenantTransaction,
  artifactId: string,
  by: string,
  act: 'archived' | 'unarchived',
  kinds: readonly ('component' | 'document' | 'bibliographyEntry')[] = ['component', 'document'],
): Promise<ArchivalAnswer | undefined> {
  if (!UUID.test(artifactId)) return undefined;
  const artifact = await trx
    .selectFrom('artifact')
    .select('kind')
    .where('id', '=', artifactId)
    .executeTakeFirst();
  const kind = kinds.find((each) => each === artifact?.kind);
  if (kind === undefined) return undefined;
  // Under the artifact's lock, as a version is recorded: two acts at once record one between them,
  // and an edit indexes it as the act left it.
  await lockArtifact(trx, artifactId);
  if ((await isArchived(trx, artifactId)) === (act === 'archived')) return 'unchanged';
  await trx
    .insertInto('artifact_archival')
    .values({ artifact_id: artifactId, kind, act, by })
    .execute();
  await trx
    .updateTable('search_entry')
    .set({ archived: act === 'archived' })
    .where('artifact_id', '=', artifactId)
    .execute();
  await flagEarlier(trx, artifactId, { archived: act === 'archived' });
  const place = await artifactPlace(trx, artifactId);
  await recordEvent(
    trx,
    {
      kind: act === 'archived' ? 'artifact.archived' : 'artifact.unarchived',
      subject: { kind, id: artifactId, version: place.version },
      space: place.space,
    },
    place.labels,
  );
  return 'changed';
}

/**
 * Archives a component or a document (LIF-020): archiving the archived changes nothing. Undefined for
 * anything else. The caller has decided `retire`.
 */
export function archiveArtifact(
  trx: TenantTransaction,
  artifactId: string,
  by: string,
): Promise<ArchivalAnswer | undefined> {
  return actOn(trx, artifactId, by, 'archived');
}

/** Unarchives one, as `archiveArtifact` archives it: unarchiving the live changes nothing. */
export function unarchiveArtifact(
  trx: TenantTransaction,
  artifactId: string,
  by: string,
): Promise<ArchivalAnswer | undefined> {
  return actOn(trx, artifactId, by, 'unarchived');
}
