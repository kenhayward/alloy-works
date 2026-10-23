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
| **IMP-032** | Identities shown as carried in review, the policy applied once, at acceptance                         |
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
T7. The import constraint IMP-048 is kept here unclaimed. IMP-012 is left unclaimed: the file's own properties are discarded by
default, but an image's metadata is AST-007's, in T7.

## Identities

A Word author is a name and sometimes an initials or an email. During review each is shown as
carried. At acceptance the tenant's policy applies: **map** an exact email match to that member, a
name match flagged for the importer to confirm, keeping the rest as text (the default); **keep** all
as text; **discard**. **Mapping attributes; it never authors.** A file's names and emails are
whatever its writer typed, so every suggestion, thread and reply an import makes is made by its
importer; the Word author is kept as `attributed_to` text beside it, with the member it matched
("Alex (from Word, matched to Alex Smith)"). A confirmation must name the member the identity
matches, a user of the tenant. Which policy applied is recorded on the import and on each.

Review matches only what its importer could already look up. The directory (`/v1/people`) shows any
member every name, never an email, so for an importer who does not administer the space a name the
file carries is matched by name alone: a file of typed addresses learns nothing of whose they are. An
administrator, who may list members with their emails (`/v1/principals`), sees email matches too.
Acceptance still maps by email as the policy says.

## As IMa built it

- **0155**: `import` (state `awaiting` its file, then `reading`, `proposed`, `accepted`, `abandoned` or
  `failed`), `import_part` as two sets of rows, `read` and `edited`, a trigger keeping `read` unchanged,
  and `import_made` naming the import each version came from (IMP-035).
- **The read**: `packages/readers` (`readImport`, `readDocx`) in a thread of the worker's with a
  memory limit and a timer; the zip guarded by `docx/zip.ts`, the XML by `saxes` in `docx/xml.ts`,
  the breakout by domain's `proposeImport`. What it does not read yet is reported as `notYetRead`.
- **Markdown and HTML** go through the paste's readers whole, as one introduction: their breakout is
  IMe's (below).
- **Accepting** makes a blank document unless a template is named: a space has no default template
  yet. An accepted import keeps its parts and its file, for IMP-031 and the re-import (IMd). The
  document is titled as its importer typed, else by the file's first Title-style paragraph, else by
  its name without the ending; the page fills the field with the same.

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

## As IMc built it

- **The reader** (`packages/readers/src/docx`) reads footnotes, numbering carried on or restarted,
  captions (style Caption, after their `SEQ`) onto the adjacent table or figure, images by their
  relationship (PNG and JPEG, the rest reported), and REF, NOTEREF and PAGEREF fields to the block,
  footnote or captioned block their bookmark is in, displayed as `write.ts` writes them. A field's
  result is source text only. OMML has no reader: equations are reported with their text in the
  source. Text boxes are dropped, content controls and other fields kept as text, each said.
- **References** carry the reader's identifier through admission; `proposeImport` records where each
  was admitted (`import.anchors`), and acceptance (`resolveReferences`) points each at its own block,
  another component's (identities chosen before anything is written), or a heading's node. One whose
  bookmark is not in the file has a key (`wx-n`) in `import.outside` until retargeted or made text,
  through the edits route; acceptance is refused before then.
- **Changes** stay on the reader's text runs, by author. `proposeImport` admits the part as every
  change rejected, then each author's variant, matched to it by identifier: `import_part.changes`,
  per top-level block, so edits carry them. A change id in two parts stays in the first, flagged.
  Comments become `import_part.threads`, anchored to their span where its quote stands, else the
  component, flagged where clamped.
- **Images** are held to asset ingest's check (`checkImage`) in the import job, stored by hash and
  held in `import_asset` against the import, the figure naming a placeholder; a refused one is an
  empty paragraph. Acceptance makes each an asset, recorded with the header the job read. Abandoning,
  failing or the sweep deletes the rows and each object nothing else holds (IMP-008): versions are
  never deleted, so none is made before acceptance.
- **0157**: `import_policy`, the import's anchors, outside references, identities, confirmations,
  properties (kept only under `keep`) and the policy applied; `import_asset`; and `import_attribution`, beside each
  suggestion, thread and reply: the policy, the Word author as text, and the member matched.
  Everything is made by the importer (the security review): a name or an email in a file is its
  writer's to type.
- **Retargeting** to another component asks that its importer may read it, live, and that it holds
  the block, one refusal for every way it does not.
- **Gaps**: retargeting to another
  component is in the route, not yet in the page; a change crossing a split the importer makes is not
  re-clamped; endnotes are not read.

## As IMd built it

- **0158**: `import.earlier` (the accepted import an `again` one updates) and `import.outcome`, what
  accepting it did; `import_part.made`, the component each edited part made or updated, recorded at
  acceptance, and `matched` with `matched_by`; and `import_made` now holds a suggestion beside a
  version, one of the two.
- **Recognised first** (IMP-036): `earlierImport` finds the latest accepted import in the space with
  the same hash, else the same name, accepted before this one. Every view of an open import names it
  (`recognised`): on the create answer by name, on the file's answer by hash, before the read.
  `PUT /v1/imports/{id}/kind` chooses `first` or `again`, needing read on the earlier document.
- **Matching** (domain's `matchAgain`): candidates are the earlier import's parts with `made`, in
  order, none deleted or archived. A component part matches the one read from the same heading
  (provenance), then the one whose title now is its title, then, between two parts matched so, those
  left there in order. A section never matches; what no part matches is gone. Matched in the job's
  transaction (`recordProposal`), or at once when chosen on a proposal. The `match` edit rematches a
  part, or marks it new, to a candidate no other part holds.
- **Status** is by each block's kind and text against the component's latest version (`againStatus`),
  so an edit made in the space shows as changed; the diff (`againDiff`) is a block-level longest
  common run. Formatting alone is not compared.
- **Accepting again** (`acceptAgain`) makes no document. A changed part is one whole-component
  suggestion against the current version, recorded in `import_made`; its Word authors' changes are
  suggestions and its comments threads on top, against the same version, as IMc makes them. A new
  part is a component placed directly in the earlier document after the part before it (no
  suggestion places, so none is suggested). A gone component is kept and flagged by a thread on the
  document at its node. Permissions are the caller's (`may`): `suggest` per changed component,
  skipped and said where missing, the whole refused before anything is written only where none may
  be; `edit` on the document to place; `comment` to flag.
- **Gaps**: sections are not made or moved by an update; a cross-reference to a heading is left as
  it was read; an import accepted before 0158 has no `made`, so nothing matches it; a suggestion
  accepted later is not recorded as the import's version.

## As IMe built it

- **Markdown and HTML** (IMP-013): `readHtmlOutline` (and `readMarkdownOutline`, Markdown rendered
  first) is the paste's reader with each heading standing in the top-level flow kept as an
  `outlineHeading`, which `readImport` makes a flow heading styled `Heading n`; one inside a
  quotation, list, table or note stays a paragraph, said as a paste's. A `data:` PNG or JPEG image
  there is a figure held as Word's are (`import_asset`); any other image is never fetched and is
  reported left out. The paste path (`readHtml`) is unchanged.
- **Paste breakout** (CNT-168): `breakoutOf` names an HTML paste whose reading made a heading a
  paragraph. Given `heldForBreakout`, the view holds such a paste rather than placing it, and the
  component editor's paste report offers **Keep as one component** (the held reading pasted as
  before) or **Break out into sections and components**: an import of the pasted HTML in the
  component's space (`importFile`, the dialog's own path), its page opened. Close pastes nothing.
- **The round trip stated** (IMP-026, IMP-025): the import page's header says what an import of its
  format keeps and does not (`keptBy`); `#/help/import` (`ImportHelp`) lists what arrives from Word
  and what does not. Neither says lossless.
- **Hardening** (the slice's final review): accepting under `discard` blanks every Word author's
  name on both sets of parts (`import_part_unnamed`, the read set's one allowed change, 0157). An
  earlier import is recognised only where its importer made it or may read its document. Importing
  again, each block a matched part shares with its component keeps the component's identifiers
  (`againIdentifiers`), and references resolve against components as they stand; one that does not
  is kept and said. Each component not suggested on is skipped with why (`suggest`, `limit`,
  `empty`, `resolved`, `gone`). Accepting, re-levelling and choosing the kind take the `revision`
  read. Budgets: 500,000 elements a part, 200 images an import, their checks inside the read's time,
  a diff paired only past its common ends up to 2,000 blocks a side, one footnote read once.
- **Gaps**: Paste as Markdown is never held for breakout; a heading's marks and a footnote in it are
  not kept (the footnote is said); an image inside a paragraph splits it round its figure.
