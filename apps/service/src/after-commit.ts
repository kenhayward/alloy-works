/**
 * Work a permission-checked handler leaves to run once the transaction its permission was decided in
 * has committed (the D1 fix, C4). That transaction holds the access epoch FOR SHARE, so anything slow
 * inside it - a connector reaching a tenant's source, for up to twenty seconds - holds back every grant
 * and revocation behind it. A handler decides and reads what it needs inside, and returns this; the
 * route's wrapper commits, releasing the lock, then runs `run` and answers what it gives. `run` is on
 * its own: whatever it writes, it writes in a transaction of its own.
 *
 * A route whose handler returns this declares `idempotencyKey: false`, so a key sent to it is
 * ignored and nothing of the request is recorded: a keyed answer is recorded in the deciding
 * transaction, before this work has run. The wrapper throws where a keyed request ever reaches such a
 * handler - a guard against a route that forgot the declaration, never an answer a client sees.
 */
export class AfterCommit<T> {
  constructor(readonly run: () => Promise<T>) {}
}
