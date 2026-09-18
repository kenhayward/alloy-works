import { z } from 'zod';

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * An outline node's identifier: 128 bits in the spelling `blockIdentifierFrom` fixes (structure.md,
 * "Identity"). Here rather than in `structure/` because a cross-reference names one too, and the
 * content model cannot import the outline, which is built on it.
 */
export const nodeIdentifierSchema = z
  .string()
  .regex(/^[a-z2-7]{26}$/, 'not an outline node identifier');

// Duplicates the wire contract's `LowercaseUuid` deliberately: `packages/domain` stays platform-free
// and does not depend on `packages/api-contract`, which is a service-side concern (routes, wire
// codes). One regex, defined twice on purpose, rather than a cross-package dependency for a pattern.
const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** An artifact's identifier, as an outline's component reference and a cross-reference name one. */
export const artifactIdentifierSchema = z.string().regex(LOWERCASE_UUID, 'not a lowercase uuid');

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
