import { createHash } from 'node:crypto';

import { blockIdentifierFrom } from '../content/model/identifier.js';

/** The namespace every component of a delivery is named in (docs/design/ct-studio-sink.md, "Identifiers"). */
const NAMESPACE = '6f1d3c3e-6b8f-5a52-9a3f-0c0d7c5e2b11';

/**
 * A name-based UUID, version 5 (RFC 4122, section 4.3): SHA-1 over the namespace's bytes and the name's
 * UTF-8, the version and variant bits set. Exported for its test, which holds it to the RFC's vector.
 */
export function uuidV5(namespace: string, name: string): string {
  const digest = createHash('sha1')
    .update(Buffer.from(namespace.replaceAll('-', ''), 'hex'))
    .update(name, 'utf8')
    .digest();
  const bytes = digest.subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A component's artifact id: the same section of the same document in a later delivery finds the same
 * component. `~lead` names the lead component. The NUL keeps the two parts apart.
 */
export function componentIdFor(persistentId: string, sectionId: string): string {
  return uuidV5(NAMESPACE, `${persistentId}\0${sectionId}`);
}

/**
 * A block, footnote, node or mark identifier: the first sixteen bytes of SHA-256 over `ct-studio`, the
 * owning artifact and the CT Studio element, spelt as every block identifier is.
 */
export function elementIdFor(owner: string, elementId: string): string {
  const digest = createHash('sha256').update(`ct-studio\0${owner}\0${elementId}`, 'utf8').digest();
  return blockIdentifierFrom(digest.subarray(0, 16));
}
