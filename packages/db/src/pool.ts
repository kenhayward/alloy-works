import pg from 'pg';

/**
 * A connection pool that survives the server ending a connection it holds idle (issue #169).
 *
 * `pg.Pool` emits `error` when the server disconnects a client that is sitting idle in it - a
 * database restart, a failover, an idle timeout, an operator's `pg_terminate_backend`. With no
 * listener, Node treats that event as an uncaught exception and the process falls over, taking every
 * request in flight with it. The pool has already dropped the dead client by the time it emits, and
 * the next checkout opens a fresh one, so there is nothing to do here but not crash: a query that was
 * actually running on the connection fails through its own promise, where the caller sees it.
 *
 * Every long-lived pool in this package is made here, so the listener cannot be left off the next one.
 */
export function createPool(options: pg.PoolConfig): pg.Pool {
  const pool = new pg.Pool(options);
  pool.on('error', () => undefined);
  return pool;
}
