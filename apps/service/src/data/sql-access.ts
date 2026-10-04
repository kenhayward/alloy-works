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
import { refused } from '../wire-codes.js';

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

/** A definition's fetch, or the kind of one: SQL, or a built query. */
type FetchOf = Pick<QueryDefinition['fetch'], 'kind'>;

/**
 * Whether facts at a connection let their principal run a fetch there (the D4 plan, D4-J), the one
 * place a fetch's needs are decided: a built query needs `use_connection` alone, since it writes only
 * a `SELECT` the product generates; SQL needs `write_sql` as well (DAT-101).
 */
export function mayRunFetch(facts: AccessFacts, fetch: FetchOf): boolean {
  return fetch.kind === 'builder' ? decide('use_connection', facts).allowed : maySqlWith(facts);
}

/** The refusal of a caller who may read a connection but may not use it for a built query. */
export const useForbidden = () =>
  new AppError(403, 'forbidden', 'This needs the use connection permission on the connection.');

/** The refusal of a caller who may read a connection but may not run this fetch on it. */
export const fetchForbidden = (fetch: FetchOf) =>
  fetch.kind === 'builder' ? useForbidden() : sqlForbidden();

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
} as const;

/**
 * Refuses SQL on a connection that has not been found read-only (DAT-103), before anything runs. A
 * built query is never refused here (D4-J): it writes only a `SELECT`, in D2's read-only transaction.
 */
export async function requireSqlPermitted(
  trx: TenantTransaction,
  connection: StoredConnection,
  fetch: FetchOf,
): Promise<void> {
  if (fetch.kind === 'builder') return;
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
