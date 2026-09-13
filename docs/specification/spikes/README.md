# Spikes

The briefs and findings for the questions that were too expensive to get wrong by argument. A spike
is run when a decision is **irreversible** - it constrains everything built afterwards - and when
nobody can settle it from the documents alone. Each one ends in a decision record, and the findings
are what that record rests on.

**The code lives elsewhere.** The throwaway programs these documents describe are in
[`/spikes/`](../../../spikes/) at the repository root; what is here is what was asked and what came
back.

| Spike                                                                                             | Question it settled                                                                       | Decision                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Content model](Content_Model_Spike.md) - [findings](Content_Model_Spike_Findings.md)             | Whether a purpose-built node-and-mark model survives its ten hardest cases                | [ADR-0005](../../decisions/0005-purpose-built-node-and-mark-content-model.md), [ADR-0012](../../decisions/0012-relational-version-chain-hashed-content.md)            |
| [Publishing engine](Publishing_Engine_Spike.md) - [findings](Publishing_Engine_Spike_Findings.md) | Which engine paginates and renders, and what it does with content as data                 | [ADR-0013](../../decisions/0013-typst-rendering-resolved-data-through-a-fixed-template.md), [ADR-0015](../../decisions/0015-word-output-our-own-writer-reflowable.md) |
| [Search](Search_Spike_Findings.md)                                                                | Whether full text and semantic search are one system, and how fast                        | [ADR-0016](../../decisions/0016-search-in-postgres-behind-one-interface.md)                                                                                           |
| [Relationships](Relationship_Spike_Findings.md)                                                   | Whether a graph store is needed, or recursive queries over the primary one                | [ADR-0017](../../decisions/0017-relationships-in-postgres-traversed-by-recursive-sql.md)                                                                              |
| [Realtime](Realtime_Spike_Findings.md)                                                            | Which transport carries presence, locks and notifications, and how it fans out            | [ADR-0018](../../decisions/0018-realtime-one-push-channel-postgres-fan-out.md)                                                                                        |
| [Editor framework](Editor_Framework_Spike.md) - [findings](Editor_Framework_Spike_Findings.md)    | Which editor the stored model is the editor's model of, and what it imposes on that model | [ADR-0023](../../decisions/0023-prosemirror-as-the-editor-and-its-model.md)                                                                                           |

## What a findings document is for

It records what was measured and what was learned, including the things that were not the question -
several of the requirements in [`../requirements/`](../requirements/) exist because a spike found a
defect nobody was looking for. The content model spike's importer dropped three empty paragraphs and
did not count them; the publishing engine spike found an engine that borrows a missing glyph from a
face nobody declared, silently, with exit code 0. Both are requirements now.

Findings are not edited once written. Where a later decision changes the answer, the decision record
supersedes the earlier one and the findings stay as the evidence that was available at the time.
