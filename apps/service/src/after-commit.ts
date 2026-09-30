/**
 * Work a permission-checked handler leaves to run once the transaction its permission was decided in
 * has committed (the D1 fix, C4). That transaction holds the access epoch FOR SHARE, so anything slow
 * inside it - a connector reaching a tenant's source, for up to twenty seconds - holds back every grant
 * and revocation behind it. A handler decides and reads what it needs inside, and returns this; the
 * route's wrapper commits, releasing the lock, then runs `run` and answers what it gives. `run` is on
 * its own: whatever it writes, it writes in a transaction of its own.
 *
 * A route whose handler returns this takes no idempotency key: a keyed answer is recorded in the
 * deciding transaction, before this work has run, and the wrapper refuses the pairing.
 */
export class AfterCommit<T> {
  constructor(readonly run: () => Promise<T>) {}
}
