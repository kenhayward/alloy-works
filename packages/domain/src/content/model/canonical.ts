import type { ContentDocument } from './document.js';

/**
 * The canonical serialisation, and the input to `content_hash`.
 *
 * `storage-and-versioning.md` refuses a version whose hash is unchanged and skips a comparison when
 * two hashes are equal, so both behaviours rest on two identical documents producing one string.
 *
 * Three rules, and no more: members in lexicographic order (a declared order that needs no table to
 * keep in step with the schema), strings in NFC (CNT-056), and no insignificant whitespace.
 *
 * Marks are a set rather than a sequence (CNT-003), so they sort too - by type then identifier, which
 * is total because an identifier is unique.
 *
 * This returns a string rather than a hash on purpose: hashing needs `node:crypto`, which is not
 * platform-free, or `crypto.subtle`, which would make parsing async for no gain. The caller hashes.
 */
export function canonicalise(document: ContentDocument): string {
  return emit(document);
}

function emit(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (Array.isArray(value)) return `[${value.map(emit).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, member]) => member !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, member]) => `${JSON.stringify(key)}:${emitMember(key, member)}`).join(',')}}`;
  }
  throw new Error(`Cannot canonicalise a value of type ${typeof value}`);
}

function emitMember(key: string, member: unknown): string {
  if (key !== 'marks' || !Array.isArray(member)) return emit(member);
  const sorted = [...(member as { type: string; id: string }[])].sort((a, b) =>
    a.type === b.type ? (a.id < b.id ? -1 : 1) : a.type < b.type ? -1 : 1,
  );
  return `[${sorted.map(emit).join(',')}]`;
}
