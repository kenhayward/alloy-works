import {
  decideOnly,
  latestConnectionTest,
  loadFacts,
  type StoredConnection,
  type TenantTransaction,
} from '@alloy-works/db';
import { decide, type AccessFacts, type QueryDefinition } from '@alloy-works/domain';
import type { Caller } from '../access.js';
import { AppError } from '../errors.js';
import { refused, wireCode } from '../wire-codes.js';

/**
 * Who may write SQL against a connection, and on which connections SQL may be written at all (the D2
 * plan, task 4; data.md, "Permissions" and "The fetch"). Both are decided at the connection, never at
 * the definition or its space: `use_connection` and `write_sql` there, walked from the connection as
 * every permission is (DAT-101), and the connection's latest test (DAT-103).
 */

/** Whether facts at a connection let their principal use it and write SQL against it (DAT-101). */
export function maySqlWith(facts: AccessFacts): boolean {
  return decide('use_connection', facts).allowed && decide('write_sql', facts).allowed;
}

/** A definition's fetch, or the kind of one: SQL, a built query or an HTTP request. */
type FetchOf = Pick<QueryDefinition['fetch'], 'kind'>;

/**
 * Whether facts at a connection let their principal run a fetch there (the D4 plan, D4-J), the one
 * place a fetch's needs are decided: a built query needs `use_connection` alone, since it writes only
 * a `SELECT` the product generates, and so does an HTTP request, whose every value its builder places
 * (the D6 plan, D6-E); SQL needs `write_sql` as well (DAT-101).
 */
export function mayRunFetch(facts: AccessFacts, fetch: FetchOf): boolean {
  return fetch.kind === 'sql' ? maySqlWith(facts) : decide('use_connection', facts).allowed;
}

/** The refusal of a caller who may read a connection but may not use it for a built query. */
export const useForbidden = () =>
  new AppError(403, 'forbidden', 'This needs the use connection permission on the connection.');

/** The refusal of a caller who may read a connection but may not run this fetch on it. */
export const fetchForbidden = (fetch: FetchOf) =>
  fetch.kind === 'sql' ? sqlForbidden() : useForbidden();

/** The refusal of a caller who may read a connection but may not write SQL against it. */
export const sqlForbidden = () =>
  new AppError(
    403,
    'forbidden',
    'This needs the use connection and write SQL permissions on the connection.',
  );

/**
 * Decides, in the caller's transaction, that they hold what a fetch needs on a connection a definition
 * names (DAT-101, D4-J): `use_connection`, and `write_sql` for SQL. A connection they may not read is
 * named as a problem of the definition's, since the address they called is the definition's or its
 * space's; one they may read without what the fetch needs is forbidden.
 */
export async function decideFetchAt(
  trx: TenantTransaction,
  caller: Caller,
  connectionId: string,
  fetch: FetchOf,
): Promise<AccessFacts> {
  await decideOnly(trx);
  const facts = await connectionFacts(trx, caller, connectionId);
  if (!facts || !decide('read', facts).allowed) {
    throw refused(400, 'definition.invalid', 'The query definition is not valid.', {
      problems: [
        {
          rule: 'definition_invalid',
          path: 'connection',
          message: 'A definition names a connection the caller may read',
        },
      ],
    });
  }
  if (!mayRunFetch(facts, fetch)) throw fetchForbidden(fetch);
  return facts;
}

/**
 * Why SQL may not run on a connection, or null where it may (DAT-103): its latest test must be a pass
 * of its latest version, made with the credential set now, that did not find its account able to
 * write. Anything else - no test, a failed one, one of an earlier version or an earlier credential -
 * is `untested`; a finding is `not_read_only`.
 */
export async function sqlRefusedOn(
  trx: TenantTransaction,
  connection: StoredConnection,
): Promise<'untested' | 'not_read_only' | null> {
  const last = await latestConnectionTest(trx, connection.id);
  if (
    !last ||
    last.outcome !== 'ok' ||
    last.version !== connection.version.id ||
    !last.credentialCurrent
  ) {
    return 'untested';
  }
  return last.findings.includes('account_not_read_only') ? 'not_read_only' : null;
}

const SQL_REFUSED = {
  untested:
    'SQL runs only on a connection tested at its latest version and credential, and found read-only. ' +
    'Test the connection first.',
  not_read_only:
    "This connection's account can write at the source, so SQL may not run on it. Use an account " +
    'that can only read.',
  asserted:
    'This connection runs as each person, so only a query made in the builder may run on it, never SQL.',
} as const;

/**
 * Refuses SQL on a connection that has not been found read-only (DAT-103), before anything runs, and
 * on one asserting a person's identity at all (DAT-102, the D7 plan's D7-F): only builder text runs as
 * a person (DAT-113), so the version a definition is saved on, or runs on, decides. A built query is
 * never refused here (D4-J): it writes only a `SELECT`, in D2's read-only transaction.
 */
export async function requireSqlPermitted(
  trx: TenantTransaction,
  connection: StoredConnection,
  fetch: FetchOf,
): Promise<void> {
  // Neither a built query nor an HTTP request is SQL an author wrote (D4-J, D6-E).
  if (fetch.kind !== 'sql') return;
  const { identity } = connection.settings;
  if (identity.kind === 'endUser' && identity.mechanism === 'asserted') {
    throw new AppError(409, wireCode('sql.not_permitted'), SQL_REFUSED.asserted, 'DAT-102', {
      reason: 'asserted',
      attribution: 'product',
    });
  }
  const reason = await sqlRefusedOn(trx, connection);
  if (reason !== null) {
    throw refused(409, 'sql.not_permitted', SQL_REFUSED[reason], {
      reason,
      attribution: 'product',
    });
  }
}

/** The caller's facts at a connection, masked by their token's scopes, or undefined where none. */
export async function connectionFacts(
  trx: TenantTransaction,
  caller: Caller,
  connectionId: string,
): Promise<AccessFacts | undefined> {
  const loaded = await loadFacts(trx, caller.principalId, { kind: 'artifact', id: connectionId });
  return loaded && { ...loaded, scopes: caller.scopes };
}
