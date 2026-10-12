import { AppError } from './errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A cursor for a listing paged newest first by an instant and an id (threads, the inbox): the listing's
 * name, the last row's instant to the millisecond and its id, as the base64url of one JSON object.
 * Opaque to a caller, and read back only by the listing that wrote it.
 */
export function keysetCursor(listing: string, last: { at: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ v: 1, l: listing, a: last.at.toISOString(), i: last.id }),
    'utf8',
  ).toString('base64url');
}

/** Where a page continues, from a cursor `keysetCursor` gave out for this listing; 400 for any other. */
export function keysetAfter(
  listing: string,
  cursor: string | undefined,
): { at: Date; id: string } | undefined {
  if (cursor === undefined) return undefined;
  const refusal = new AppError(
    400,
    'invalid_request',
    'The cursor is not one this listing gave out.',
  );
  let written: { v?: unknown; l?: unknown; a?: unknown; i?: unknown } | null;
  try {
    written = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as typeof written;
  } catch {
    throw refusal;
  }
  const at = typeof written?.a === 'string' ? new Date(written.a) : undefined;
  if (
    written?.v !== 1 ||
    written.l !== listing ||
    at === undefined ||
    Number.isNaN(at.getTime()) ||
    typeof written.i !== 'string' ||
    !UUID.test(written.i)
  ) {
    throw refusal;
  }
  return { at, id: written.i };
}
