const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * A block identifier's spelling: 128 bits as 26 lower-case base32 characters, no padding
 * (component-editor.md, "Identity, by operation"). The bytes are the caller's, because where randomness
 * comes from is the caller's platform and this package has none: `packages/editor` passes
 * `crypto.getRandomValues`, `packages/db` passes `node:crypto`'s `randomBytes`. Here so that both spell
 * an identifier the same way, and one test holds the spelling.
 */
export function blockIdentifierFrom(bytes: Uint8Array): string {
  if (bytes.length !== 16) {
    throw new Error(`A block identifier is sixteen bytes, not ${bytes.length}`);
  }
  let bits = 0;
  let value = 0;
  let spelled = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      spelled += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) spelled += BASE32[(value << (5 - bits)) & 31];
  return spelled;
}
