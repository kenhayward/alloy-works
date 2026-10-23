# Import

How a Word, Markdown or HTML document becomes a document of sections and components: T6's fourth
slice. Ken's answers of 2026-10-22 shaped it,
[ADR-0069](../decisions/0069-an-import-is-a-proposal-read-in-the-worker.md) records it, and
[the IM plan](../plans/2026-10-22-im-import.md) builds it.

## The shape in one paragraph

A person uploads a file into a space. Importing it first says whether this file - by content hash, or
by name in this space - was imported before, what changed since, and proposes its changes as suggestions on what that import made (IMP-036, IMP-037). The worker reads it into the content model - headings, lists and their
numbering, tables, figures and captions, footnotes, cross-references, equations - as structure, never
as the text they resolved to, and proposes an **outline**: a section per Heading 1 and a component per
Heading 2, the levels the importer's to change, each split with its reason. Tracked changes become
proposed suggestions and comments proposed threads, each attributed to its Word author as the file
names them. The proposal is **reviewed** apart from the space: searched, filtered by kind and by what
it flags, a split moved, two merged, a component renamed, the identities the file carries listed;
left and returned to. **Accepting** makes the document, its sections, components, suggestions and
threads in one transaction, applying the tenant's identity policy then, and records against each what
it came from. **Abandoning** leaves nothing. What could not be carried, and what a round trip keeps
and loses, is said in the product.

## Requirements owned

| ID          | How it is met                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| **IMP-004** | Splits from heading structure, each with its reason                                                   |
| **IMP-005** | Tracked changes as suggestions attributed to their Word author, comments as threads                   |
| **IMP-006** | Numbering, cross-references, footnotes and captions read as structure                                 |
| **IMP-008** | Abandoned at any point before acceptance, nothing left                                                |
| **IMP-009** | The identities the file carries listed before acceptance                                              |
| **IMP-010** | The tenant's policy: map, keep as text, or discard                                                    |
| **IMP-011** | Which policy was applied recorded on what was imported                                                |
| **IMP-028** | Each part reviewed alone, beside its source and reason                                                |
| **IMP-033** | A reference whose target is outside the import listed before acceptance, with its source text         |
| **IMP-034** | Each such reference retargeted, converted to plain text and reported, or the import refused           |
| **IMP-037** | A re-import reviewed as a first is, its changes suggestions that become versions                      |
| **IMP-041** | A person's moves, merges and renames validated as made                                                |
| **IMP-042** | A failed import leaves nothing and says what happened                                                 |
| **IMP-013** | Markdown and HTML through the same proposal and report                                                |
| **IMP-026** | What a round trip keeps and loses stated in the product, on the import and in Help                    |
| **IMP-029** | A proposal searched, filtered and returned to across sessions                                         |
| **IMP-031** | How much of a proposal was accepted unchanged recorded                                                |
| **IMP-035** | Source name, content hash, when and by whom recorded against everything made                          |
| **IMP-036** | A source imported before said first, its changes shown, and an update offered                         |
| **CNT-168** | Paste from Word keeps a heading a heading, and a pasted outline is offered as sections and components |
| **IMP-001** | An outline of sections and components, never one blob                                                 |
| **IMP-002** | Adjusted, merged and split by a person before anything is made                                        |
| **IMP-003** | Nothing made until a person accepts what they started                                                 |
| **IMP-007** | What is left out or not read yet reported by kind, and tested                                         |
| **IMP-017** | Each component admitted as a paste is, so none fails validation                                       |
| **IMP-030** | Each split with its reason; no model makes a proposal (IMP-Q02)                                       |
| **IMP-047** | Macros, embedded objects, outside files and unallowed links never stored, and reported                |

PUB-028's import half is IMP-005's; its export half moves to T8 with Word fidelity. IMP-016 moves to
T7. The import constraints IMP-032 and IMP-048 are kept here unclaimed. IMP-012 is left unclaimed: the file's own properties are discarded by
default, but an image's metadata is AST-007's, in T7.

## Identities

A Word author is a name and sometimes an initials or an email. During review each is shown as
carried. At acceptance the tenant's policy applies: **map** an exact email match to that member, a
name match flagged for the importer to confirm, keeping the rest as text (the default); **keep** all as text; **discard**. A suggestion or a
thread made from the file is authored by the mapped person, else by the importer, with the Word
author kept as `attributedTo` text beside it ("Alex, from Word"); which policy applied is recorded
on the import and on each.

## As IMa built it

- **0155**: `import` (state `awaiting` its file, then `reading`, `proposed`, `accepted`, `abandoned` or
  `failed`), `import_part` as two sets of rows, `read` and `edited`, a trigger keeping `read` unchanged,
  and `import_made` naming the import each version came from (IMP-035).
- **The read**: `packages/readers` (`readImport`, `readDocx`) in a thread of the worker's with a
  memory limit and a timer; the zip guarded by `docx/zip.ts`, the XML by `saxes` in `docx/xml.ts`,
  the breakout by domain's `proposeImport`. What it does not read yet is reported as `notYetRead`.
- **Markdown and HTML** go through the paste's readers whole, as one introduction: their breakout is
  IMe's.
- **Accepting** makes a blank document unless a template is named: a space has no default template
  yet. An accepted import keeps its parts and its file, for IMP-031 and the re-import (IMd).

## As IMb built it

- **0156**: `import.revision`, which every edit is made against and refused if stale; `import.place`,
  the part its importer was last at, kept server-side; `import.accepted`, the counts at acceptance;
  `import_part.origins`, the parts as read each edited part came from; and `import_edit`, each edit as
  asked, gone with the proposal.
- **Edits** are one route, `POST /v1/imports/{id}/edits`, its body naming the edit (move, split,
  merge, rename, kind). Domain's `editProposal` applies it to the edited set and validates each
  component it changes with `parseContentDocument` (CNT-013); a refusal is named by code and said in
  words. A component stands under the section before it, so changing a kind re-parents what follows.
- **One part** is `GET /v1/imports/{id}/parts/{part}`: its blocks as text beside its source, and its
  neighbours. Search and flag filters are `GET /v1/imports/{id}/parts`; a part's flags add what the
  report said of its origins (not read yet, left out, kept differently).
- **IMP-031** counts each accepted part once, in the first that applies: merged (more than one
  origin), split (an origin shared), edited (kind or blocks changed), renamed, unchanged.
- A part's source after a move is still the source of what it came from: per-block sources are not
  kept.
