/**
 * A job refused on its merits: what it was given will fail the same way every time, so the worker
 * finishes it at once, recording `code`, rather than trying again (issue #146). Anything else a handler
 * throws - a lost connection, a timeout, a crash - might not happen twice, and is retried.
 */
export class JobRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
