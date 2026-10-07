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

/**
 * What an `AfterCommit` answers with status 202 rather than 200: work accepted and not yet done, which
 * the caller follows elsewhere (the D8 plan, D8-D) - a resolve whose result waits on its images. The
 * body is the route's 200 schema's, which its 202 declares too.
 */
export class Accepted<T> {
  constructor(readonly body: T) {}
}

/**
 * A permission-checked answer that is cached privately and revalidated (the TB2 plan, TB2-A): sent with
 * `ETag: etag` and `Cache-Control: private, no-cache`, its body where the caller does not hold it, and
 * where it does - `If-None-Match` naming `etag` - status 304 with none, `body` then undefined.
 */
export class Revalidated<T> {
  constructor(
    readonly etag: string,
    readonly body: T | undefined,
  ) {}
}
