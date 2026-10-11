# 0058 - Suggestions are proposals beside the content

- **Status:** Accepted
- **Date:** 2026-10-11

## Context

[ADR-0057](0057-t3s-order-and-template-moves-leave-for-t9.md) asked for a spike of phase 6 -
suggestions that keep block identity - before comparison (phase 4) is designed, since the redline it
draws decides how phase 4 renders one.

The content model already carries a `suggestion` mark - operation (`insert`, `delete`, `replace`),
author and identifier - stored since T1 so no migration would be needed (CNT-033, CNT-116), and
designed so that accepting acts on every fragment of one identifier (CNT-005) and keeps every block's
identifier (CNT-009). Nothing makes one yet.

The spike (2026-10-11, ten experiments against the editor's own schema and identity plugin, not kept)
found:

| #   | Found                                                                                                                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | A suggestion mark that does not exclude itself lets two cover one range - a deletion inside another author's insertion - as CNT-003 asks. The editor's mapping refuses two marks of one type today                                                                         |
| S2  | Typing, deleting and replacing within one paragraph turn into marks, and deleting one's own pending insertion removes it. **`replace` cannot be stored**: one identifier carries one value, so the old and the new text under one `replace` mark cannot say which is which |
| S3  | Accepting and rejecting each suggestion whole, by identifier, keeps every block's identifier                                                                                                                                                                               |
| S4  | A deletion across a paragraph boundary cannot be said by a mark: marked on both sides and accepted, it leaves two paragraphs where the author's edit joined them                                                                                                           |
| S5  | Enter, a pasted paragraph and every other structural edit are not inline: no mark carries them                                                                                                                                                                             |
| S6  | A block-level carrier - the suggestion as an attribute of the block it adds or removes - resolves structural suggestions with every other block keeping its identifier; S7, a rejected split rejoined under the first half's identifier                                    |
| S9  | A suggestion kept **beside** the content - each change anchored to a block by its identifier and to the text it changes by that text - applies to a later version the author edited meanwhile, an inserted block taking a fresh identifier and every other keeping its own |
| S10 | Such a suggestion is found stale, and nothing of it applied, where its anchor is gone                                                                                                                                                                                      |

And one finding that is not code. **A suggestion stored in the content is a write to the content, so
making one needs the component's lock** (component-editor.md). COL-025 asks that suggestions not
wait for an author to finish, and COL-042 that accepting waits for the lock: a reviewer who must
hold the lock to suggest is a reviewer waiting on the author.

## Decision

**A suggestion is a proposal stored beside the component, never a mark in its content.** It records
the version it was made against, its author and time, and its changes, each anchored to a block by
identifier: text changed within a block (by the text before it and the text it replaces), a block
inserted after one, a block removed, split or joined, a block's attributes changed. It is made without
the lock, while the author goes on.

**Suggest mode is editing a private copy.** The reviewer edits as they would, structure and all, in a
draft of their own; the proposal is **the comparison of that draft with the version it was opened
from** - so every edit the editor can make can be suggested, with nothing in the editor turning keys
into marks (S2's machinery is not needed).

**Accepting applies the proposal to the component as it is then**, as an edit by the person
accepting, under the lock (COL-042), audited as theirs (COL-024). A change whose anchor is gone makes
the suggestion stale, said so and applied in no part (COL-052, S10).

**The redline is the comparison's.** A suggestion is drawn over the current version by the same
renderer that draws a comparison of two versions (VER-030), as decorations, never stored.

**So phase 4 builds what phase 6 stands on**: the block-identity comparison (VER-027 to VER-029)
answers its result as anchored changes of exactly the kinds above, and its redline renders them.
Phases 4 to 7 keep ADR-0057's order.

**The `suggestion` mark stays in the schema**, refused on entry as it is today, for a review copy
exported to Word with tracked changes if that is ever asked. CNT-033 is answered by the proposal, not
the mark.

## What would change the answer

- **Suggestions must be visible in a published review copy or a Word export as tracked changes.**
  The proposal is rendered into marks at export; the mark is there for it.
- **Anchoring by quoted text proves too loose** - the same words twice in one block. The anchor gains
  an offset within the block at the version made against, mapped through the comparison.
- **Phase 4's comparison cannot answer anchored changes at an acceptable cost** (VER-051). Suggestions
  fall back to S6's block-level carrier in the content, with the lock that brings.

## Consequences

- content-model.md's claims of CNT-005 and CNT-033 are answered by collaboration.md's proposal when
  phase 6 is designed, and move there; CNT-009 stays, and binds accepting too.
- COL-026 and CNT-113 - an author's own changes in the session - are the same comparison, of the
  session's latest iteration with the version it opened from.
- Phase 4's plan designs the comparison's result as anchored changes, not as a rendering alone.
