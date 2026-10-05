import type { Provenance } from '@alloy-works/domain';
import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/**
 * What a dataset version's provenance names (the D3 plan's stored-shape check, row 8): a version of
 * the query definition it names, and a version of the connection it names, each of its kind, and that
 * connection the one the definition version names. Read where every version is written -
 * `createArtifact` and `recordVersion` call it - so no writer records a provenance naming a version
 * that did not run, as a foreign key would hold a column to it.
 */
export async function checkProvenanceNames(
  trx: TenantTransaction,
  provenance: Provenance,
): Promise<void> {
  const contents = new Map<string, unknown>();
  for (const [kind, named] of [
    ['queryDefinition', provenance.queryDefinition],
    ['connection', provenance.connection],
  ] as const) {
    const row = await trx
      .selectFrom('artifact_version')
      .select(['id', 'content'])
      .where('id', '=', named.version)
      .where('artifact_id', '=', named.artifact)
      .where('kind', '=', kind)
      .executeTakeFirst();
    if (!row) {
      throw new Error(
        `A dataset version's provenance names ${kind} ${named.artifact} at ${named.version}, which is no version of it`,
      );
    }
    contents.set(kind, row.content);
  }
  // The connection a run ran on is the one its definition version names: no other ran it.
  const names = (contents.get('queryDefinition') as { connection?: unknown } | null)?.connection;
  if (names !== provenance.connection.artifact) {
    throw new Error(
      `A dataset version's provenance names connection ${provenance.connection.artifact}, and its query definition version names another`,
    );
  }
  for (const [hash, version] of Object.entries(provenance.images)) {
    const held = await trx
      .selectFrom('artifact_version as v')
      .innerJoin('artifact as a', 'a.id', 'v.artifact_id')
      .innerJoin('artifact as d', 'd.space_id', 'a.space_id')
      .select('v.id')
      .where('v.id', '=', version)
      .where('v.kind', '=', 'asset')
      .where('d.id', '=', provenance.queryDefinition.artifact)
      .where(sql<boolean>`v.content ->> 'object' like ${`%/sha256/${hash}`}`)
      .executeTakeFirst();
    if (!held) {
      throw new Error(
        `A dataset version's provenance names asset version ${version} for image ${hash}, which is no asset version holding it in its definition's space`,
      );
    }
  }
}
