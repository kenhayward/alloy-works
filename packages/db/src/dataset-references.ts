import type { Provenance } from '@alloy-works/domain';
import type { TenantTransaction } from './tables.js';

/**
 * What a dataset version's provenance names (the D3 plan's stored-shape check, row 8): a version of
 * the query definition it names, and a version of the connection it names, each of its kind. Read
 * where every version is written - `createArtifact` and `recordVersion` call it - so no writer records a
 * provenance naming a version that did not run, as a foreign key would hold a column to it.
 */
export async function checkProvenanceNames(
  trx: TenantTransaction,
  provenance: Provenance,
): Promise<void> {
  for (const [kind, named] of [
    ['queryDefinition', provenance.queryDefinition],
    ['connection', provenance.connection],
  ] as const) {
    const row = await trx
      .selectFrom('artifact_version')
      .select('id')
      .where('id', '=', named.version)
      .where('artifact_id', '=', named.artifact)
      .where('kind', '=', kind)
      .executeTakeFirst();
    if (!row) {
      throw new Error(
        `A dataset version's provenance names ${kind} ${named.artifact} at ${named.version}, which is no version of it`,
      );
    }
  }
}
