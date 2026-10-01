import { DefinitionRefused } from '@alloy-works/domain';
import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/**
 * What a query definition names and what names a connection (the D2 plan, D2-O and D2-P), read where
 * every version is written: `createArtifact` and `recordVersion` call these, so no writer - a route,
 * `testing/every-kind.ts`, or any later caller - writes a definition naming what it may not, or retires
 * a connection a definition still names. Both sides take the connection's own lock first, the lock
 * `recordVersion` takes on the connection, so a definition written while the connection is retired
 * waits for the other and then sees what it did.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The artifact lock `recordVersion` takes, taken here by the connection's id. */
async function lockConnection(trx: TenantTransaction, id: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`alloy-works:artifact:${id}`}, 0))`.execute(
    trx,
  );
}

/**
 * Refuses, `definition_invalid` at `connection`, a definition naming anything but a connection of this
 * tenant whose latest version is in service. Holds the connection's lock to the end of the
 * transaction, so it is not retired meanwhile.
 */
export async function checkNamedConnection(trx: TenantTransaction, id: string): Promise<void> {
  const refuse = (message: string) =>
    new DefinitionRefused([{ rule: 'definition_invalid', path: 'connection', message }]);
  if (!UUID.test(id)) throw refuse('A definition names a connection by its identifier');
  await lockConnection(trx, id);
  const latest = await trx
    .selectFrom('artifact_version')
    .select(['kind', sql<boolean>`(content ->> 'retired')::boolean`.as('retired')])
    .where('artifact_id', '=', id)
    .orderBy('revision_no', 'desc')
    .orderBy('version_no', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!latest || latest.kind !== 'connection') {
    throw refuse('A definition names a connection of this environment, and this is none');
  }
  if (latest.retired) throw refuse('The connection is retired: a definition names one in service');
}

/** A definition naming a connection, at its latest version. */
export interface NamingDefinition {
  readonly id: string;
  readonly spaceId: string;
  readonly title: string;
  readonly retired: boolean;
}

/**
 * The query definitions whose latest version names a connection, by title and then id: computed when
 * asked, never stored beside what it counts (data.md, "Rotation, where used and retiring").
 */
export async function latestDefinitionsNaming(
  trx: TenantTransaction,
  connectionId: string,
): Promise<NamingDefinition[]> {
  if (!UUID.test(connectionId)) return [];
  const { rows } = await sql<{ id: string; space_id: string; title: string; retired: boolean }>`
    select latest.artifact_id as id, a.space_id, latest.content ->> 'title' as title,
           (latest.content ->> 'retired')::boolean as retired
      from (
        select distinct on (v.artifact_id) v.artifact_id, v.content
          from artifact_version v
         where v.kind = 'queryDefinition'
           and v.artifact_id in (
             select artifact_id from artifact_version
              where kind = 'queryDefinition' and content ->> 'connection' = ${connectionId})
         order by v.artifact_id, v.revision_no desc, v.version_no desc
      ) latest
      join artifact a on a.id = latest.artifact_id
     where latest.content ->> 'connection' = ${connectionId}
     order by latest.content ->> 'title' collate "C", latest.artifact_id`.execute(trx);
  return rows.map((row) => ({
    id: row.id,
    spaceId: row.space_id,
    title: row.title,
    retired: row.retired,
  }));
}

/** A connection retired while a definition in service names it (DAT-065): nothing is cut. */
export class ConnectionInUse extends Error {
  constructor(readonly definitions: readonly string[]) {
    super(`The connection is in use by ${definitions.length} query definition(s) in service`);
  }
}

/**
 * Refuses a version retiring a connection that a definition in service still names (DAT-065). Called
 * under the connection's lock, which `recordVersion` has taken.
 */
export async function checkNotInUse(trx: TenantTransaction, connectionId: string): Promise<void> {
  const inService = (await latestDefinitionsNaming(trx, connectionId)).filter(
    (each) => !each.retired,
  );
  if (inService.length > 0) throw new ConnectionInUse(inService.map((each) => each.id));
}
