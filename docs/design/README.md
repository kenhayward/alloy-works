# Design

How the product will be built. One document per subsystem.

[`../specification/requirements/`](../specification/requirements/) says what the product must do;
these say how. They are the level between a requirement and the code, and they are the documents
that survive being built - once storage exists, its design document is what somebody reads to
understand the storage layer, rather than something to be thrown away.

> **Not true yet.** Along with [`../specification/`](../specification/), this folder describes the
> thing being built towards rather than the repository as it stands.
> [`../features.md`](../features.md) remains the honest account of the distance between them.

## Documents

| Document                                               | Subsystem                                                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| [system.md](system.md)                                 | The whole system: containers, languages, and the data flowing between them                           |
| [storage-and-versioning.md](storage-and-versioning.md) | Iterations, versions, revisions, baselines and derived data                                          |
| [word-output.md](word-output.md)                       | The resolved document as a real Word document, and why its pages are Word's                          |
| [themes.md](themes.md)                                 | One theme driving the editor, the PDF and Word, and the suite that keeps them in agreement           |
| [realtime.md](realtime.md)                             | Presence, locks and notifications on one stream, and model output on its own request                 |
| [relationships.md](relationships.md)                   | Declared relationships and references, and walking them without revealing what the user may not read |
| [search.md](search.md)                                 | Words and meaning searched together, filtered by what the user may read when they ask                |

## Why these are not one per requirement area

There are twenty-one requirement areas and there will not be twenty-one design documents. **Design
boundaries are not requirement boundaries.** Storage serves VER, CNT, REU, LIF, TPL and REL at once;
publishing will serve PUB, STY, STR and TAB. Mirroring the areas would either fragment one subsystem
across six documents or repeat it in six, and both make the design harder to reason about than the
requirements it serves.

## How a design document is written

Every document carries a **`## Requirements owned`** section: a table of the requirement identifiers
that document is the answer to, each with a line on how. That section is the mapping, and it is the
only place the mapping lives - nothing is recorded back in the requirements themselves, because a
coverage column maintained by hand is a coverage column that drifts.

**Owning is not mentioning.** A design document refers to requirements from all over the
specification; it owns the ones it is the realisation of. A requirement has **at most one owning
design**, and `apps/desktop/src/design.test.ts` fails when two claim the same one, when a claimed
identifier does not exist, or when a document is missing from the table above.

Requirements nothing yet owns are the work not yet designed. That is the intended reading, and it is
why the mapping points this way round: the gap is visible without anybody maintaining a list of it.

## What belongs here rather than in a decision record

A [decision record](../decisions/) states a choice and what would change the answer. A design
document states the shape of the thing that choice implies, in enough detail to build from. When a
subsystem's design rests on a decision, the design links the record rather than restating its
reasoning - records are never edited once accepted, and a design that paraphrases one will disagree
with it eventually.
