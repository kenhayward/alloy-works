# 0059 - A suggestion merges by whole block

- **Status:** Accepted
- **Date:** 2026-10-12

## Context

[ADR-0058](0058-suggestions-are-proposals-beside-the-content.md) keeps a suggestion beside the
content and applies it to the component as it is when accepted. It anchors text changed within a
block "by the text before it and the text it replaces", which would merge two people's edits inside
one paragraph. Building it (the SG plan, `applySuggestion`) asked what a block is when it is a list or
a table, and what a merge inside one can promise: a cell changed by the author and another by the
reviewer, two edits to one sentence, a mark spanning both.

## Decision

**A suggestion merges by whole top-level block, by identifier.** A block it changes, removes or moves
must stand in the current version as it did in the version the suggestion was made against - or
already as the draft has it, somebody having made the change by hand, which is then done - or the
suggestion is stale there, said with the block and why; nothing is merged inside a block, a list or a
table. The current version's order is the merge's start, so nothing the author did meanwhile is
undone; an added block follows the block it followed in the draft, after any others added since. The
result must parse as a content document, or the suggestion is stale as a whole.

## What would change the answer

- **Reviewers find suggestions stale too often** on long blocks - a table, a list - that authors keep
  editing. The merge goes inside a block by its units (a cell, an item), as the comparison already
  pairs them.
- **Two edits to one paragraph must both stand.** ADR-0058's text anchor, with an offset, merges
  within a block.

## Consequences

- A stale suggestion is never lost: it applies again if its blocks are put back, and its author can
  withdraw it and suggest again over the current version.
- CNT-009 holds trivially: a block is taken whole, its nested identifiers with it.
