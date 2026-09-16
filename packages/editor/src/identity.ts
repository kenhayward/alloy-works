import { Plugin } from 'prosemirror-state';
import { Mapping } from 'prosemirror-transform';

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * A new block identifier: 128 random bits, in lower-case base32 without padding (component-editor.md,
 * "Identity, by operation"). The random source is the platform's own `crypto`, which the browser and
 * Node both provide; this package is browser code, so it may use it where `packages/domain` may not.
 */
export function newBlockIdentifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
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

/**
 * ADR-0023's descent rule, as one plugin. A block standing at its identifier's forward-mapped position
 * descends from the block that held it and keeps it; every other block holding that identifier - a
 * split's second half, something inserted - and every block with none is given a new one. The position
 * is mapped with association 1: with -1, a block inserted exactly at an existing block's position looks
 * like the heir, and the block already there is renamed.
 */
export function identityPlugin(newIdentifier: () => string): Plugin {
  return new Plugin({
    appendTransaction(transactions, oldState, newState) {
      const changed = transactions.filter((transaction) => transaction.docChanged);
      if (changed.length === 0) return null;
      const mapping = new Mapping();
      for (const transaction of changed) mapping.appendMapping(transaction.mapping);

      const heir = new Map<string, number>();
      oldState.doc.forEach((node, offset) => {
        const id: unknown = node.attrs.id;
        if (typeof id === 'string') heir.set(id, mapping.map(offset, 1));
      });

      const kept = new Set<string>();
      const renew: number[] = [];
      newState.doc.forEach((node, offset) => {
        const id: unknown = node.attrs.id;
        if (typeof id === 'string' && !kept.has(id) && heir.get(id) === offset) kept.add(id);
        else renew.push(offset);
      });
      if (renew.length === 0) return null;

      const taken = new Set(kept);
      const tr = newState.tr;
      for (const offset of renew) {
        let id = newIdentifier();
        while (taken.has(id)) id = newIdentifier();
        taken.add(id);
        tr.setNodeAttribute(offset, 'id', id);
      }
      return tr;
    },
  });
}
