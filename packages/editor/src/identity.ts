import { blockIdentifierFrom } from '@alloy-works/domain';
import { isHistoryTransaction } from 'prosemirror-history';
import type { Node } from 'prosemirror-model';
import { Plugin, type Transaction } from 'prosemirror-state';
import { Mapping } from 'prosemirror-transform';

/**
 * A new block identifier: 128 random bits from the platform's own `crypto`, spelled by the domain
 * (`blockIdentifierFrom`), so the editor and the service spell one the same way.
 */
export function newBlockIdentifier(): string {
  return blockIdentifierFrom(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Every node the schema gives an `id` attribute, with the position it stands at, in document order.
 *
 * **It descends, and it filters on the node type's own spec rather than on a list of type names.** A
 * list item holds blocks, so a block can be made at any depth, and a walk over the top level alone
 * leaves every one of them carrying `id: null` - which `fromEditor` throws on, out of the save path,
 * where the service answers with a fixed message an author cannot act on. The nodes with no `id`
 * attribute - `listItem`, `definitionItem`, `term`, and the text inside them - are walked **through**
 * and never named: the stored model gives an item and a term no identifier, because an item is not a
 * block and a term is inline content belonging to one (content-model.md). Reading that from
 * `type.spec.attrs` rather than naming the three types is what keeps a node type added later from
 * having to be remembered here.
 */
function identified(doc: Node): { readonly id: unknown; readonly pos: number }[] {
  const found: { id: unknown; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.spec.attrs?.id !== undefined) found.push({ id: node.attrs.id, pos });
  });
  return found;
}

/**
 * The meta a transaction carries to say it has named what it places itself, so the identity plugin
 * keeps every identifier in it that no other node holds (cross-references 1, ruling R7). `pasteInto`
 * sets it: admission has already given every pasted block an identifier new to the component
 * (CNT-132), and a reference it pointed at one of them - or one the paste re-points - is pointing at
 * that identifier, which a rename would leave pointing at nothing.
 */
export const KEEPS_IDENTIFIERS = 'keepsIdentifiers';

/**
 * Whether a transaction puts back or places nodes whose identifiers are already right: an undo or a
 * redo, which restores what the author had, and one that says so (`KEEPS_IDENTIFIERS`).
 */
const keepsIdentifiers = (transaction: Transaction): boolean =>
  isHistoryTransaction(transaction) || transaction.getMeta(KEEPS_IDENTIFIERS) === true;

/**
 * ADR-0023's descent rule, as one plugin, applied at every depth. A block standing at its
 * identifier's forward-mapped position descends from the block that held it and keeps it; every other
 * block holding that identifier - a split's second half, something inserted - and every block with
 * none is given a new one. The position is mapped with association 1: with -1, a block inserted
 * exactly at an existing block's position looks like the heir, and the block already there is
 * renamed.
 *
 * **The rule is unchanged; only its reach is.** `identified` replaces the two top-level walks, so a
 * paragraph made inside a list item and a list made by sinking one are judged by exactly the rule a
 * top-level paragraph is - which is why `state.test.ts`'s top-level cases are the regression that
 * says so.
 *
 * **What an undo or a redo puts back keeps its identifiers** (cross-references 1, ruling R7, XR-E), as
 * does what a transaction marked `KEEPS_IDENTIFIERS` places: in such a transaction a node standing
 * anywhere keeps an identifier **no other node in the new document holds**. Read by the descent rule
 * alone, a table deleted and brought back by `Ctrl+Z` is placed, not descended from anything, and was
 * renamed - leaving every reference to it pointing at nothing. A redo of a split brings back the names
 * the split was left with: the history replays the document as this plugin left it, the second half
 * already renamed, so the redo puts back that name and nothing is held twice. An identifier that is
 * held twice - a node a paste or a command places carrying one another node keeps - is still the
 * descent rule's to settle, so the half that did not descend is named anew and ADR-0023 stands as
 * written.
 *
 * **Every position is collected before any attribute is set.** `tr.setNodeAttribute` produces an
 * `AttrStep`, which maps every position to itself, so the one pass over the positions read from
 * `newState.doc` stays right for every renewal in the transaction - including two at different
 * depths, where a step that moved positions would write an identifier onto the wrong block.
 */
export function identityPlugin(newIdentifier: () => string): Plugin {
  return new Plugin({
    appendTransaction(transactions, oldState, newState) {
      const changed = transactions.filter((transaction) => transaction.docChanged);
      if (changed.length === 0) return null;
      const mapping = new Mapping();
      for (const transaction of changed) mapping.appendMapping(transaction.mapping);

      const heir = new Map<string, number>();
      for (const { id, pos } of identified(oldState.doc)) {
        if (typeof id === 'string') heir.set(id, mapping.map(pos, 1));
      }

      const now = identified(newState.doc);
      // How many nodes hold each identifier now, where the transaction keeps what it places.
      const held = new Map<string, number>();
      if (changed.some(keepsIdentifiers)) {
        for (const { id } of now) {
          if (typeof id === 'string') held.set(id, (held.get(id) ?? 0) + 1);
        }
      }

      const kept = new Set<string>();
      const renew: number[] = [];
      for (const { id, pos } of now) {
        if (
          typeof id === 'string' &&
          !kept.has(id) &&
          (heir.get(id) === pos || held.get(id) === 1)
        ) {
          kept.add(id);
        } else renew.push(pos);
      }
      if (renew.length === 0) return null;

      const taken = new Set(kept);
      const tr = newState.tr;
      for (const pos of renew) {
        let id = newIdentifier();
        while (taken.has(id)) id = newIdentifier();
        taken.add(id);
        tr.setNodeAttribute(pos, 'id', id);
      }
      return tr.setMeta('addToHistory', false);
    },
  });
}
