import type {
  CreateQueryDefinitionBody,
  QueryDefinitionListQuery,
  QueryDefinitionParams,
  QueryDefinitionVersionBody,
  QueryDefinitionView,
  SpaceParams,
} from '@alloy-works/api-contract';
import {
  createQueryDefinition,
  listReadableQueryDefinitions,
  readConnection,
  readQueryDefinition,
  recordQueryDefinitionVersion,
  type QueryDefinitionAnswer,
  type StoredConnection,
  type StoredQueryDefinition,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { decide, type AccessFacts, type QueryDefinition } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { callerOf, notFound, type Authorised, type Caller } from '../access.js';
import { versionView } from '../components.js';
import { cursorFor, pageAsked } from '../listing.js';
import type { SessionPrincipal } from '../sessions.js';
import { refused } from '../wire-codes.js';
import { connectionFacts, decideFetchAt, mayRunFetch, requireSqlPermitted } from './sql-access.js';

/**
 * The query definition routes (data.md, "Routes"; the D2 plan, task 4). None reaches the connector:
 * making and changing a definition decides at its connection who may run its fetch there - SQL, or a
 * built query (DAT-101, D4-J) - and whether SQL may be written there at all (DAT-103), and the database checks what it names on every
 * path a version is written by (D2-P).
 */

/**
 * A definition as the routes answer it, with what the caller may do with it. Its connection's name is
 * told only to a caller who may read the connection; its identity and whether it is retired are told
 * to every reader of the definition, who must see as whom its query runs (DAT-022).
 */
async function definitionView(
  trx: TenantTransaction,
  caller: Caller,
  stored: StoredQueryDefinition,
  facts: AccessFacts,
): Promise<QueryDefinitionView> {
  const connection = await readConnection(trx, stored.definition.connection);
  const atConnection = await connectionFacts(trx, caller, stored.definition.connection);
  // Decided by the latest version's own fetch: a built query needs no write_sql (D4-J).
  const mayRun = atConnection !== undefined && mayRunFetch(atConnection, stored.definition.fetch);
  const mayReadConnection = atConnection !== undefined && decide('read', atConnection).allowed;
  return {
    id: stored.id,
    space: stored.space,
    version: versionView(stored.version),
    definition: stored.definition,
    connection:
      connection === undefined
        ? null
        : {
            id: connection.id,
            name: mayReadConnection ? connection.settings.name : null,
            identity: connection.settings.identity.kind,
            retired: connection.settings.retired,
          },
    mayEdit: decide('edit', facts).allowed && mayRun,
    mayRun,
    mayUse: atConnection !== undefined && decide('use_connection', atConnection).allowed,
  };
}

/**
 * What a definition's writer must hold and find before a version is written, decided by the version's
 * own fetch (D4-J): `use_connection` at the connection it names, and `write_sql` for SQL (DAT-101); a
 * connection that is not retired; and for SQL, one whose latest test found its account read-only
 * (DAT-103) - unless the version retires the definition,
 * which runs nothing, so a definition on a connection found writable can still be retired, and the
 * connection after it.
 */
async function connectionFor(
  trx: TenantTransaction,
  caller: Caller,
  definition: QueryDefinition,
): Promise<StoredConnection> {
  await decideFetchAt(trx, caller, definition.connection, definition.fetch);
  const connection = await readConnection(trx, definition.connection);
  if (!connection) {
    throw refused(400, 'definition.invalid', 'The query definition is not valid.', {
      problems: [
        {
          rule: 'definition_invalid',
          path: 'connection',
          message: 'A definition names a connection of this environment, and this is none',
        },
      ],
    });
  }
  if (connection.settings.retired) {
    throw refused(409, 'connection.retired', 'This connection is retired, so it runs nothing.');
  }
  if (!definition.retired) await requireSqlPermitted(trx, connection, definition.fetch);
  return connection;
}

export function queryDefinitionHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
) {
  /** A writer's answer that is not a definition: refused by name, or absent. */
  async function refusedDefinition(
    trx: TenantTransaction,
    caller: Caller,
    answer: Exclude<QueryDefinitionAnswer, { definition: StoredQueryDefinition }>,
    facts: AccessFacts,
  ): Promise<never> {
    switch (answer.answer) {
      case 'definition.refused':
        throw refused(400, 'definition.invalid', 'The query definition is not valid.', {
          problems: answer.problems,
        });
      case 'version.precondition':
        throw refused(
          409,
          'version.precondition',
          'This query definition has a newer version than the one this page opened.',
          { current: await definitionView(trx, caller, answer.current, facts) },
        );
      case 'space.missing':
      case 'definition.missing':
        throw notFound();
    }
  }

  return {
    listQueryDefinitions: async (request: FastifyRequest) => {
      const query = request.query as QueryDefinitionListQuery;
      const asked = pageAsked('queryDefinitions', query);
      const listed = await db.withTenant(tenantOf(request), (trx) =>
        listReadableQueryDefinitions(trx, principalOf(request).principalId, asked, {
          ...(query.spaces === undefined ? {} : { spaces: query.spaces.split(',') }),
          ...(query.connection === undefined ? {} : { connection: query.connection }),
        }),
      );
      if (!listed) throw new Error('A signed-in principal is not in its own tenant');
      return {
        items: listed.items.map((item) => ({
          id: item.id,
          title: item.title,
          space: item.space,
          connection: item.connection,
          retired: item.retired,
          version: {
            id: item.version.id,
            number: `${item.version.revision}.${item.version.version}`,
          },
          changedAt: item.changedAt.toISOString(),
        })),
        next: cursorFor('queryDefinitions', asked.sort, asked.order, listed.snapshot, listed.next),
        total: listed.total,
        facets: { spaces: listed.facets.spaces.map((each) => ({ ...each })) },
      };
    },

    createQueryDefinition: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ) => {
      const { space } = request.params as SpaceParams;
      const { definition } = request.body as CreateQueryDefinitionBody;
      const caller = callerOf(request);
      await connectionFor(trx, caller, definition);
      const answer = await createQueryDefinition(trx, {
        author: principalId,
        spaceId: space,
        definition,
      });
      if (answer.answer !== 'created') {
        return refusedDefinition(
          trx,
          caller,
          answer as Exclude<QueryDefinitionAnswer, { definition: StoredQueryDefinition }>,
          facts,
        );
      }
      // Decided at the space, which a new definition inherits from.
      return definitionView(trx, caller, answer.definition, facts);
    },

    // `authorise` never looks at an artifact's kind, so another kind's id authorises cleanly here;
    // `readQueryDefinition` answers nothing for it, and neither does this.
    getQueryDefinition: async (request: FastifyRequest, { trx, facts }: Authorised) => {
      const { id } = request.params as QueryDefinitionParams;
      const stored = await readQueryDefinition(trx, id);
      if (!stored) throw notFound();
      return definitionView(trx, callerOf(request), stored, facts);
    },

    recordQueryDefinitionVersion: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ) => {
      const { id } = request.params as QueryDefinitionParams;
      const body = request.body as QueryDefinitionVersionBody;
      const caller = callerOf(request);
      if (!(await readQueryDefinition(trx, id))) throw notFound();
      await connectionFor(trx, caller, body.definition);
      const answer = await recordQueryDefinitionVersion(trx, {
        author: principalId,
        id,
        openedFrom: body.openedFrom,
        definition: body.definition,
      });
      if (answer.answer === 'recorded' || answer.answer === 'version.unchanged') {
        return definitionView(trx, caller, answer.definition, facts);
      }
      return refusedDefinition(
        trx,
        caller,
        answer as Exclude<QueryDefinitionAnswer, { definition: StoredQueryDefinition }>,
        facts,
      );
    },
  };
}
