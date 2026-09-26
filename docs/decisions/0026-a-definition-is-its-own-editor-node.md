# 0026 - A definition is its own editor node

- **Status:** Accepted
- **Date:** 2026-09-26

## Context

[ADR-0025](0025-the-editor-schema-is-not-the-stored-model-one-for-one.md) split the stored model's one
`list` into more editor node types than the store has, because a ProseMirror content expression is
fixed per node type, and fixed a definition list's item as `definitionItem` (`term block+`), never
relaxed. Its argument stands. What did not survive is that shape.

An item of `term block+` holds its definition's blocks as its own children, beside the term, and
renders `div > dt + p...`. So a screen reader was told each definition was a paragraph in an
unlabelled group, not the definition of its term - CNT-175, which asks the editor to expose a
component's structure to assistive technology as structure, and issue #246 - and a `p` standing
beside a `dt` in a `dl`'s `div` is not valid HTML. No rendering can fix that from `term block+`: a
`toDOM` cannot put a `dd` round some of a node's children, and a node view has one content element,
which cannot split the term from the blocks after it. The blocks need a parent of their own.

This survived contact with the build rather than one conversation. Every definition-list command -
Enter from the term and from the definition, the joins Backspace and Delete make between two items,
leaving the list from an emptied last item, nesting and lifting, and **Definition list** wrapping a
paragraph - was moved one level deeper, and the existing definition-list tests and the thousand
seeded runs of random gestures kept every behaviour they pin.

## Decision

**ADR-0025's decision stands, with a sixth editor node type: a definition item is `term definition`,
and its blocks stand in the `definition`.**

- **Six editor node types for the model's one `list`.** `list` (`listItem+`, with `kind` restricted
  to `'ordered' | 'unordered'`, plus `start` and `format`), `listItem` (`block+`), `definitionList`
  (`definitionItem+`), `definitionItem` (`term definition`), `term` (inline, marks allowed) and
  `definition` (`block+`). The stored model keeps one `list` with three kinds and an item of
  `{ term?, content }`; an item's `content` is its definition's children, and nothing is stored for
  the `definition` itself, so no stored content changes and nothing is migrated.
- **They render `dl > div > dt + dd`**, the one wrapper HTML admits in a `dl` grouping a term with
  its definition, so assistive technology is told what each definition defines.
- **`definitionItem` is `term definition` and is never relaxed.** The term's presence is still a
  property of the content expression; relaxing the item to `term? definition`, `definition` or
  `block+` is still the one change this shape exists to forbid.
- **A term that has not been typed is an empty `term` node, and the stored item omits `term`
  entirely** - unchanged from ADR-0025.
- **The mapping is the only place the two vocabularies meet**, and it refuses an item whose blocks
  do not stand in a definition by name, as it refuses one that does not open with its term.
- **The editor's extra types carry no identifier.** `listItem`, `definitionItem`, `term` and
  `definition` declare no `attrs`, and the identity plugin walks through them.
- **The commands that `prosemirror-schema-list` cannot answer for a definition item are the
  product's.** Its sink and its lift look for a sublist after an item's last child, which is now the
  definition; `sinkDefinitionItem` and the lift beside it build the same `ReplaceAroundStep`s one level
  deeper, so every block moved keeps its position and its identifier.

## What would change the answer

- Everything ADR-0025 names, which is unchanged.
- **HTML admitting a `dd` that is not an element of its own**, or assistive technology reading a
  definition's role from something the blocks could carry themselves. Neither is in prospect; ARIA's
  `definition` role on each block would name every paragraph of a definition a separate definition.

## Consequences

- **A definition list's commands are one level deeper than a counted list's**, and are the product's
  own where the upstream ones assume an item's blocks are its children. A future change to
  `prosemirror-schema-list`'s sink or lift is not inherited by definition lists.
- **Backspace and Delete between two items can no longer nest one inside the other**: after a
  `definition` the item admits nothing, so `deleteBarrier`'s wrap finds no place. The join
  (issue #160) answers both keys first, and the depth guard on them stays so that the depth rule does
  not rest on either fact.
- **The editor's own HTML is a definition list's.** What a copy writes as HTML is the schema's
  rendering, so it is now `dl > div > dt + dd`. `packages/readers` reads that shape and skipped the
  old `div > dt + p` body, measured, so the editor's HTML read back without the product's own
  clipboard type now keeps its definitions. A paste between components travels as that type and
  never depended on the HTML.
- ADR-0025's consequences hold otherwise; its content-match note now reads: a definition item's
  blocks are asked of `definition`, which is `block+` from its first position.
