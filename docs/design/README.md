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

| Document                                               | Subsystem                                                                                                                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [system.md](system.md)                                 | The whole system: containers, languages, and the data flowing between them                                                                                                    |
| [service-foundations.md](service-foundations.md)       | How a request reaches one tenant, and how an endpoint is written                                                                                                              |
| [storage-and-versioning.md](storage-and-versioning.md) | Iterations, versions, revisions, baselines and derived data                                                                                                                   |
| [content-model.md](content-model.md)                   | The stored shape of a component: nodes, marks, identity, and what may enter the model                                                                                         |
| [word-output.md](word-output.md)                       | The resolved document as a real Word document, and why its pages are Word's                                                                                                   |
| [themes.md](themes.md)                                 | One theme driving the editor, the PDF and Word, and the suite that keeps them in agreement                                                                                    |
| [realtime.md](realtime.md)                             | Presence, locks and notifications on one stream, and model output on its own request                                                                                          |
| [relationships.md](relationships.md)                   | Declared relationships and references, and walking them without revealing what the user may not read                                                                          |
| [search.md](search.md)                                 | Words and meaning searched together, filtered by what the user may read when they ask                                                                                         |
| [metadata.md](metadata.md)                             | Which fields apply to a component, what makes a value valid, and what a version records about its definitions                                                                 |
| [comparison.md](comparison.md)                         | What changed between two versions, two baselines or a session and its version, at three levels, as anchored changes and a redline                                             |
| [component-editor.md](component-editor.md)             | Editing one component: the surface, the lock, continuous saving, cutting a version, and its metadata                                                                          |
| [access.md](access.md)                                 | Spaces, roles and grants, and deciding what a principal may do to an artifact and why                                                                                         |
| [structure.md](structure.md)                           | The document and its outline, and the numbering, references, navigation and links computed over it                                                                            |
| [assets.md](assets.md)                                 | An image arriving: proved to be what its format permits, stored by its hash, read by who may read its space                                                                   |
| [publishing.md](publishing.md)                         | A document version to a kept, reproducible PDF: who may publish, the layout, the pipeline and the record                                                                      |
| [templates.md](templates.md)                           | A template, a document made from one, and what the document keeps of it                                                                                                       |
| [definitions.md](definitions.md)                       | Fields, schemas and component types made and changed, and values written, shown and held at publication                                                                       |
| [document-view.md](document-view.md)                   | A document read and authored on one page: one scroll, boundaries, modes, navigation and versions                                                                              |
| [data.md](data.md)                                     | Connections, query definitions and stored results, and the connector: the one process that reaches a source                                                                   |
| [baselines.md](baselines.md)                           | A named, immutable version of a whole document: made, superseded, published to the same bytes, and addressed                                                                  |
| [bindings.md](bindings.md)                             | A bound value placed and shown in the editor, a document's values and their revisions, and the publish's binding stage                                                        |
| [tables.md](tables.md)                                 | A result as a bound table: its columns, order, formats and notes, laid out alike in the page and the publish                                                                  |
| [audit.md](audit.md)                                   | The tenant's audit log: every act, sign-in and refusal recorded, kept beyond what it describes, read and exported by administrators                                           |
| [collaboration.md](collaboration.md)                   | Who holds a component's lock, for how long, and how it passes from an idle holder to somebody who needs it                                                                    |
| [home.md](home.md)                                     | What waits on the person signed in that they may resolve, each with its one action, and nothing they may not read                                                             |
| [lifecycle.md](lifecycle.md)                           | Archival out of ordinary listings and search; legal holds; deletion as a tombstone, refused while anything depends on it; retention keeps; erasure of a person                |
| [workflow.md](workflow.md)                             | Each kind's workflow, declared and versioned per tenant; every component and document in one state, moved along a transition by whoever it permits                            |
| [generation.md](generation.md)                         | A model as a governed contributor: endpoints, runs, the assistant drafting against a document, and every output a proposal                                                    |
| [webhooks.md](webhooks.md)                             | Events posted to a service identity's endpoint, thin and signed, queued in the act's transaction and retried for a day                                                        |
| [extensions.md](extensions.md)                         | A source type added as a manifest and a remote service, installed by an administrator, pinned by its digest                                                                   |
| [citations.md](citations.md)                           | A bibliography entry as a space's CSL-JSON artifact, its key and duplicates; citation styles as CSL rendered by citeproc-js; citations and the bibliography at publish        |
| [terms.md](terms.md)                                   | A term as a space's artifact on its own workflow, its labels per language and stated relations; printed forms, glossary and abbreviations; search through terms; SKOS         |
| [translation.md](translation.md)                       | A variant as a language line of the one component; what each translates; status computed, out of date at a source change; Mark current; a lock per line                       |
| [interface-localisation.md](interface-localisation.md) | The interface in each person's own language: catalogues of ICU messages, bundled CLDR, pseudo-locales the suites walk                                                         |
| [import.md](import.md)                                 | A Word, Markdown or HTML file read in the worker into a proposal of sections and components, reviewed, accepted or abandoned                                                  |
| [ct-studio-sink.md](ct-studio-sink.md)                 | A document decomposed by CT Studio delivered straight in through its bridge contract, as a service identity; its data tables as real Postgres tables                          |
| [ct-studio-connect.md](ct-studio-connect.md)           | An administrator connects CT Studio from Administration: identity, grant, token and settings in one flow, ending on what to paste into CT Studio                              |
| [reference-sources.md](reference-sources.md)           | Crossref and PubMed searched through the connector and cited; a cited source's retraction or correction found, flagged and told                                               |
| [vocabularies.md](vocabularies.md)                     | Vocabularies as environment-wide definitions, drawn on by fields and condition axes; values labelled per language, deprecated and retired, never dropped; SKOS; from a source |

## Why these are not one per requirement area

There are twenty-two requirement areas and there will not be twenty-two design documents. **Design
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
design**, and `packages/trace/src/design.test.ts` fails when two claim the same one, when a claimed
identifier does not exist, or when a document is missing from the table above.

Requirements nothing yet owns are the work not yet designed. That is the intended reading, and it is
why the mapping points this way round: the gap is visible without anybody maintaining a list of it.

## What belongs here rather than in a decision record

A [decision record](../decisions/) states a choice and what would change the answer. A design
document states the shape of the thing that choice implies, in enough detail to build from. When a
subsystem's design rests on a decision, the design links the record rather than restating its
reasoning - records are never edited once accepted, and a design that paraphrases one will disagree
with it eventually.
