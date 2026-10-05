import { createHash } from 'node:crypto';

import { ASSET_MAX_BYTES, isPaddedBase64, readImageHeader } from '@alloy-works/domain';

/**
 * An image cell, as the server printed it, to the image alone and its SHA-256 (the D8 plan, D8-B;
 * DAT-096): a `bytea` read from PostgreSQL's hex output, `\x` and lowercase pairs, and base64 text
 * only as the standard alphabet padded, with nothing between, so nothing is guessed at. Admitted only
 * as a PNG or a JPEG by the asset door's own header reading, which refuses one past the pixel limit,
 * and kept up to the image's end as the door keeps it; no larger than the door takes.
 */
export type ImageRead =
  { readonly hash: string; readonly bytes: Buffer } | { readonly refused: true };

const HEX = /^\\x[0-9a-f]*$/;

export function readImage(text: string, encoding: 'binary' | 'base64'): ImageRead {
  const refused = { refused: true } as const;
  let decoded: Buffer;
  if (encoding === 'binary') {
    // Anything else - an escape format a statement set, say - is not read as an image.
    if (!HEX.test(text) || text.length % 2 !== 0) return refused;
    decoded = Buffer.from(text.slice(2), 'hex');
  } else {
    if (!isPaddedBase64(text)) return refused;
    decoded = Buffer.from(text, 'base64');
  }
  const reading = readImageHeader(decoded);
  if (!reading.ok || reading.header.end > ASSET_MAX_BYTES) return refused;
  const bytes = Buffer.from(decoded.subarray(0, reading.header.end));
  return { hash: createHash('sha256').update(bytes).digest('hex'), bytes };
}
