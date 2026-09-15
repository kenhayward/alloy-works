import { canonicalJson } from '../../stored/canonical.js';

import type { ContentDocument } from './document.js';

/**
 * The canonical serialisation of content, and the input to `content_hash`.
 *
 * `content_hash` keys derived data, and the version digest (ADR-0024) - which decides whether a
 * version changed - applies these same rules to the whole version, content included. Both rest on two
 * identical documents producing one string.
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
  return canonicalJson(document, marksAsASet);
}

function marksAsASet(member: string, array: readonly unknown[]): readonly unknown[] {
  if (member !== 'marks') return array;
  return [...(array as { type: string; id: string }[])].sort((a, b) =>
    a.type === b.type ? (a.id < b.id ? -1 : 1) : a.type < b.type ? -1 : 1,
  );
}
