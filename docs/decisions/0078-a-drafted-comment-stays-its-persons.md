# 0078 - A comment the assistant drafted stays its person's

- **Status:** Accepted
- **Date:** 2026-11-03

## Context

[The handoff](../interface/handoffs/threads-panel/README.md) draws the assistant as a comment's author, with
the person as "asked by". `propose_comment` posts a comment as the person who accepts it (GEN-009), and no
principal stands for the assistant.

## Decision

1. **The author is the person who accepted it.** They read those words and made them theirs. In a reviewed
   document, an author who cannot answer for a comment is the wrong record.
2. **It says so everywhere** (GEN-063): an **AI** tag, and "Assistant drafted" with the model.
   `thread_comment.drafted_by` names the proposal, set as the comment is inserted, never after.
3. **The model is kept from a reader from outside.** It names an endpoint, which is the organisation's own
   business.
4. **The assistant only comments, through a proposal. `@Assistant` starts nothing.** A model call started
   from a comment is a new data path and a cost, with no requirement. It may be filtered by, never mentioned.

## Consequences

An edit keeps the mark: the comment was still drafted so. `read_comments` tells the model nothing of it. An
assistant that speaks in its own right would need a principal of its own, and supersedes this.
