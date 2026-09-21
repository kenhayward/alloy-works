# 0025 - The editor schema is not the stored model one for one

- **Status:** Accepted
- **Date:** 2026-09-20

## Context

[ADR-0023](0023-prosemirror-as-the-editor-and-its-model.md) chose ProseMirror and said the editor's
document is "same-family" with the stored content model rather than object-identical: same node
names, same marks, the same shape of tree, with one mapping in `packages/editor/src/mapping.ts`
translating between them. Until lists, that mapping was close to an identity function - the editor
had a root, paragraphs, text and ten marks, and every one of them had exactly one counterpart in
`packages/domain`.

Lists are the first family where that correspondence cannot hold, and the reason is a property of
ProseMirror rather than a preference. **A ProseMirror content expression is fixed per node type.** The
stored model holds one `list` node carrying `kind: 'ordered' | 'unordered' | 'definition'`, and its
item is `{ term?, content }` - a discriminator plus an item whose first member is present only for
one value of that discriminator. A single editor node type cannot express that: `listItem` would need
`content` to be `block+` for two kinds and `term block+` for the third, and there is one expression
per type. The alternatives were to relax the item to `term? block+` or `block+` and police the term
with a plugin, or to give the definition list its own node types.

This survived contact with two things rather than one conversation. The plan's spike built both
candidate schemas in prosemirror-model 1.25.11 and drove real gestures through them; and the
pre-flight scan then measured that the obvious "make the test green" move on the strict schema is
exactly the relaxation this record forbids, which is why the constraint is written into the schema's
own comments as well as here.

## Decision

**Where the stored model's shape cannot be expressed as one ProseMirror node type, the editor holds
more node types than the store does, and the mapping widens and narrows between them.**

For lists, concretely:

- **Five editor node types for the model's one `list`.** `list` (`listItem+`, with `kind` restricted to
  `'ordered' | 'unordered'`, plus `start` and `format`), `listItem` (`block+`), `definitionList`
  (`definitionItem+`), `definitionItem` (`term block+`) and `term` (`text*`, marks allowed). The
  stored model keeps one `list` with three kinds and an item of `{ term?, content }`.
- **`definitionItem` is `term block+` and is never relaxed.** The term's presence is a property of
  the content expression, so the schema cannot make an item without one, and no plugin, command or
  paste path has to be trusted to keep it. Relaxing it to `term? block+` or `block+` is the one
  change this shape exists to forbid.
- **A term that has not been typed is an empty `term` node, and the stored item omits `term`
  entirely.** The editor must let an author write the definition before the word, and the store must
  not be given an empty inline sequence. That asymmetry is the mapping's job, and it is the same
  bargain the content model already strikes for a single empty paragraph under CNT-124.
- **The mapping is the only place the two vocabularies meet.** `toEditor` widens the stored `kind`
  into a choice of node type; `fromEditor` narrows it back and runs `parseContentDocument`, so
  nothing reaches storage without going through the store's own rules. A node the editor has no
  counterpart for still opens read-only by name, unchanged.
- **The editor's extra types carry no identifier.** A stored item has none, so `listItem`,
  `definitionItem` and `term` declare no `attrs` and the identity plugin skips them; the blocks
  inside an item carry their own, as every block does.

## What would change the answer

- **A stored item gaining an identity of its own.** If an item became a cross-reference target or a
  comment anchor, it would need an `id`, and the editor's item types would need attributes - which
  does not change the type split but does change what the mapping carries.
- **ProseMirror admitting a content expression that varies with an attribute.** The split exists
  because it cannot. If a later version of prosemirror-model could express "`term block+` when
  `kind` is definition", one node type would be honest again and this record would be superseded
  rather than worked around.
- **The stored model splitting instead.** Holding three stored node types rather than one `list` with
  a `kind` would make the two vocabularies agree again. It was rejected because the stored shape is
  insert-only and a split of it can never be taken back, while the editor's schema is rebuilt from
  source on every load and costs nothing to change.
- **A family where the extra types would outnumber the useful ones.** Tables and footnotes arrive
  next, and both nest. If either needed a type per attribute value rather than per shape, the split
  would stop paying for itself and the policing-by-plugin alternative would deserve re-examining.

## Consequences

- **Every nesting family that follows inherits this.** `prosemirror-tables` brings its own node types
  for rows and cells, and the restricted footnote schema will bring one for a note's content; in both
  cases the editor's vocabulary is wider than the store's and the mapping absorbs the difference.
  That is now the expected shape rather than a surprise in a diff.
- **The mapping is load-bearing and is tested as such.** It is the only thing holding the two
  vocabularies together, so it carries a property test over thousands of real editing operations at
  depth, and every editor node without a stored counterpart is asserted to open read-only by its own
  name.
- **A test asserting what a node type may contain has to ask at the right position.**
  `definitionItem.contentMatch` is the match at position zero, where only a `term` matches, so
  "can an item hold a list" is asked of the match _after_ the term. Getting that wrong reads as a
  broken schema and invites the relaxation above; the schema's tests say so where they ask.
- **ADR-0023's "same-family" wording is now specific.** Same family means one mapping and one set of
  rules, not one node type per stored node type. Nothing in ADR-0023 is contradicted, and its
  argument for one view per component and for the editor's document being the store's dialect is this
  record's argument too.
