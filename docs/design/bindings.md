# Bindings

A value from a tenant's own data standing in a component's text: how an author places one, what the
editor shows of it in a document and out of one, what a document shows of all its values and their
revisions, a value a person revises by hand, and the publish's binding stage, which reads each
binding's stored result and never a source.

This realises the half of [DAT](../specification/requirements/DAT-data-connectivity-and-bindings.md)
that [data.md](data.md) left to it: the editor's side of a binding and the publish's binding stage.
It is written from [ADR-0035](../decisions/0035-bindings-hold-stored-results-and-a-publish-never-queries-a-source.md),
which is the authority - every binding holds a stored result, the editor, a preview and a publish read
it, a source is queried only when a person acts, and nothing a source returns replaces a stored result
until a person accepts it - and on what [the D3 plan](../plans/2026-10-03-d3-datasets-and-resolutions.md)
and [the D4 plan](../plans/2026-10-03-d4-the-builder.md) built, as their "Changed while building"
tables record it rather than as their plans expected. **Ken built D4 before this design**, where
data.md's DA-V put it after D3: a binding names a definition by identifier whatever its fetch, so
nothing here depends on the builder, and nothing in D4 needed this.

What it rests on: the binding in a component's content, its resolution owned by the document, the
dataset and its provenance, and the five acts - data.md's, built by D3; the surface, its identity rules
and its dialogs - [component-editor.md](component-editor.md)'s, and its cross-reference above all, the
nearest thing the editor already has to a binding; the one scroll, its modes and its outline pane -
[document-view.md](document-view.md)'s; the order, the request, the job and the record -
[publishing.md](publishing.md)'s; the Word writer - [word-output.md](word-output.md)'s; and the theme -
[themes.md](themes.md)'s. A bound table's presentation is `tables.md`'s, not designed; a template's
parameters feeding a binding are the `templates.md` additions'.

> **Not built.** D3 built the binding's stored shape, datasets, resolutions and the resolve, check and
> accept routes, and refuses to publish or preview any document holding a binding. No screen places,
> shows or accepts one, and the editor opens a component holding one read-only. This document is what
> replaces both.

## The shape in one paragraph

A **binding** is an inline atom in a component, `binding` in ProseMirror as in the stored model,
placed and changed from a **Value** dialog that chooses a query definition, its parameters, the value
it takes and its mode. **On its own a component shows no value**, only what the binding asks for,
because a value belongs to a document: the same component holds different values in different
documents. **In a document** the editor and the read text show the value that document holds, taken
from its stored result by one pure function and formatted by the document's theme, or why it has
none, in place. Placing a binding in a document resolves it at once - the one query placing makes -
from the author's own editing session, so the value appears without a version being cut. The
document page's **Data** tab lists every binding the document holds with its state - holding,
never resolved, changed since it was resolved, failed, a source revision waiting, a definition moved
on, revised by hand, changed since last published - and is where a person checks, accepts, keeps a
value across a changed binding, and revises one by hand; a checked binding is checked when the
document is opened. **The publish's binding stage** replaces D3's refusal: the request records the
resolution every binding holds, refusing by name any that holds none; the worker reads each result
by its checksum from the tenant's store, takes and formats each value with the same function, and
fails the job by name rather than printing a blank; and the publication records what it read and is
accompanied by a provenance file of every value it printed.

## Requirements challenged

Ken asked for the pushback first. Five rows are wrong or over-broad for the design ADR-0035 chose,
and one area is better moved out of T2.

**Ken accepted every recommendation on 2026-10-04**, and the corpus moved with them: DAT-072
superseded by DAT-116; revising a value by hand, DAT-057 to DAT-063 but DAT-059, moved to T3,
recorded as [ADR-0036](../decisions/0036-revising-a-bound-value-by-hand-moves-to-t3.md); DAT-059
superseded by DAT-115; PUB-099 superseded by PUB-108, the binding stage, in T2, with PUB-109 to
PUB-111 for REU's stages in T4; STY-082 added; DAT-032 clarified. The table below is the challenge as
it was made.

| Requirement                                        | The trouble                                                                                                                                                                                                                                                                                                                                                                                                                       | Recommended                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DAT-072                                            | **It contradicts ADR-0035 and DAT-093.** It calls accepting a source revision and revising a binding "a change to the component holding it", under the component lock. But a value is the document's: one component serves many documents, each holding its own version (DAT-093), so accepting moves one document and must not touch the component. Changing a binding's mode is a component edit, and is under the lock already | **Supersede** with: accepting a source revision or revising a bound value is a change to the document holding the binding, and changing a binding is a change to the component; each is refused unless it names what it replaces, never last-write-wins. This design answers that (BI-O, BI-J). **Answered**: DAT-116, claimed here |
| DAT-057 to DAT-060, DAT-062                        | **A value revised by hand is a review feature in a data tranche.** It needs a stored revision per document, a three-way decision when a source revision meets one, a mark in the editor and in print, and two halves of provenance - and DAT-061, its reason to exist, is a reviewer's queue and a lifecycle gate, both T3's (COL, LIF). Built in T2 it is a revision nobody is asked to review                                   | **Move to T3 with DAT-061.** Designed here whole ([A value revised by hand](#a-value-revised-by-hand)), so T3 builds it without redesign; the build order puts it last (B5). **Answered**: T3, [ADR-0036](../decisions/0036-revising-a-bound-value-by-hand-moves-to-t3.md)                                                          |
| DAT-059                                            | **"In published output" has no good answer.** A revised number marked in an issued PDF is what an author who corrected a source deliberately does not want a reader to see, and a mark a theme can style away is no guarantee. What a reader of the publication can rely on is its provenance (DAT-042), which names every revised value and what the query said                                                                  | **Narrow** "in published output" to "in the provenance accompanying a publication". The editor and the document page mark a revised value always (BI-O). **Answered**: DAT-115, claimed here                                                                                                                                        |
| PUB-099                                            | **One row for four stages that arrive in three tranches.** Bindings arrive in T2, transclusion and conditions with REU in T4, variables later. No design can claim it until the last arrives, and a claim made by the first would be false for the rest                                                                                                                                                                           | **Split per stage**, so the bindings row can be claimed here. **Answered**: PUB-108 for the binding stage, PUB-109 to PUB-111 for REU's in T4; PUB-108 is a named gap below                                                                                                                                                         |
| DAT-033                                            | **It points at a style no requirement makes.** "Formatted by a style" for a table is STY-014's table style; for a value in running text STY asks for nothing, and the theme has no place for it                                                                                                                                                                                                                                   | **Add an STY row** for a theme's value formats by type, which BI-F designs; DAT-033 is claimed once `tables.md` puts a table's formatting over the same declaration. **Answered**: STY-082, claimed here                                                                                                                            |
| DAT-032                                            | **"Returns no value" is unclear about a null and an empty string.** A cell can be null, or text of no characters; either prints as nothing                                                                                                                                                                                                                                                                                        | **Clarify** that a null and an empty text are no value. Read so here (BI-E). **Answered**: clarified                                                                                                                                                                                                                                |
| DAT-042, PUB-049                                   | **One requirement stated twice**, PUB-049 citing DAT-042                                                                                                                                                                                                                                                                                                                                                                          | Keep both; both are claimed here, answered by one thing                                                                                                                                                                                                                                                                             |
| DAT-012, CNT-039, DAT-048, DAT-063, DAT-057's cell | **data.md gave these to this document; they belong to the bound table.** Each is about anchoring to a row of generated content - a footnote, a revision, a cross-reference by key - and a block binding's rows, cells and presentation are `tables.md`'s                                                                                                                                                                          | **Move to `tables.md`**, which places what they anchor into. This design gives it the key lookup and the named failure they share with an inline binding (BI-Q)                                                                                                                                                                     |

## Requirements owned

| ID          | How it is met                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DAT-027** | In a document, an inline binding is drawn and printed as the one value `takeValue` takes from the result the document holds, formatted by the document's theme, standing in the text where the binding stands ([A value, taken and formatted](#a-value-taken-and-formatted))                                                                                                                                                                                                                                                                                    |
| **DAT-031** | A binding taking `{ column }` from a result of more than one row is `value_many`, naming the count, the binding and the definition, in the editor, the Data tab and the publish alike; nothing takes a first row                                                                                                                                                                                                                                                                                                                                                |
| **DAT-032** | No rows is `value_none`, a key no row holds `row_missing`, a null `value_null` and an empty text `value_empty`; each is shown as a failure in place and fails a publish, and nothing prints an empty string                                                                                                                                                                                                                                                                                                                                                     |
| **DAT-047** | A binding whose value fails is drawn in place as a marker saying why, apart by more than colour, and every other node of the component and the document draws as before; the Data tab lists it                                                                                                                                                                                                                                                                                                                                                                  |
| **DAT-022** | The Value dialog names, beside each definition and again on the chosen one, the identity it runs as - the service account, or each person's own view by the connection's mechanism - read from the definition's route, which answers its connection's identity to every reader of the definition                                                                                                                                                                                                                                                                |
| **DAT-024** | The provenance panel and the Data tab say whose view a value is, from the dataset version's provenance: the service account, or a person by name with their sign-in route and the identity as the source saw it                                                                                                                                                                                                                                                                                                                                                 |
| **DAT-041** | Activating a value - a click, or Enter on the value's button in the read text, or selecting it in an open editor - opens its provenance panel in one step: the definition and its version, the connection, the parameters, whose view, when, the rows, the checksum, the dataset version, who accepted it, and the SQL where the reader may read the definition                                                                                                                                                                                                 |
| **DAT-039** | The document page's **Data** tab lists every binding the document holds with its state: never resolved, changed since it was resolved, failed (a value that cannot be taken, or the check made on opening failing), a source revision waiting, a definition moved on, revised by hand, changed since last published, or holding                                                                                                                                                                                                                                 |
| **DAT-082** | A checked binding is checked when the document page opens, by whoever may check it, and on **Check now**; a pinned one never. A waiting revision's value is shown beside the value held, in the Data tab and the value's panel, and nothing moves until somebody accepts                                                                                                                                                                                                                                                                                        |
| **DAT-070** | A floating binding whose definition has a version newer than the one its held result ran is flagged **Definition changed** beside a source revision's flag, and a check's result of the newer version is waiting even where its rows are the same (BI-K); the Data tab lists the bindings whose question, definition or value differs from what the document's latest publication printed                                                                                                                                                                       |
| **DAT-091** | Accepting a result fetched under the accepting person's own identity opens a confirmation saying that everybody who may read the document will see it, with the readers counted; only its **Share my view** sends `sharesOwnView: true`, without which the route refuses                                                                                                                                                                                                                                                                                        |
| **DAT-087** | A publish or a preview request is refused before anything is queued, `binding_unresolved`, naming the document and each binding with no resolution matching its digest, by its node and identifier, and whether it was never resolved or changed since; `assemble` refuses the same should a request reach it                                                                                                                                                                                                                                                   |
| **DAT-088** | The worker reads each binding's dataset version recorded on the request, and its rows from the tenant's store by their checksum, held to it; neither it nor the service on a publish or a preview has a route to the connector (DAT-089)                                                                                                                                                                                                                                                                                                                        |
| **DAT-046** | The binding stage either sets a value `takeValue` took and the theme formatted, or fails the job by name; it has no path that sets a blank, a zero, a placeholder or the binding's own description in a value's place                                                                                                                                                                                                                                                                                                                                           |
| **DAT-042** | A publication records every binding it printed, `publication_binding`, held whole to its request, and is accompanied by `provenance.json`, an output beside the PDF and Word: for each value, where it stood, what was printed, what the query returned, any revision, and the dataset version's provenance; `GET /v1/publications/{id}/bindings` answers the same                                                                                                                                                                                              |
| **PUB-049** | As DAT-042, which it restates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **DAT-058** | A revision is a row of its own, `binding_revision`, beside the resolution and never in place of it: the value entered, the dataset version it stands in front of, who, when and the reason; insert-only, each naming the revision it replaces, so the rows are its audit with what it was and what it became                                                                                                                                                                                                                                                    |
| **DAT-060** | A revised binding is still checked. A source revision waiting for one shows three values - what the query returned, the revision, and what the source returns now - and accepting it must say `withdraw` or `keep`, refused `revision_decision_required` otherwise; keeping records the revision again against the newer version in the same transaction                                                                                                                                                                                                        |
| **DAT-116** | Accepting and revising are the document's acts, on the document's routes, writing the document's rows, never the component (BI-O): accept is refused `resolution_precondition` unless `replaces` names the resolution held (D3-K), and revise and withdraw `revision_precondition` unless it names the revision standing. Changing a binding, its mode included, is an edit to the component's content, saved as every edit is, under the component's lock (COL-005) and carrying the version it was opened from (API-037); no binding route writes a component |
| **STY-082** | The theme's value catalogue (BI-F) declares a number's decimal and group separators and its minus, a date's order and separator, a time's separator and a boolean's words, with `byLanguage` overrides; `formatValue`, the domain's own code with no `Intl` and no locale data, is the one function the editor, the read text, Typst and Word print from; a decimal prints at its declared scale, an instant in UTC; LOC-038's data arrives as a source of these declarations                                                                                   |
| **DAT-062** | The provenance panel, the Data tab and `provenance.json` give a revised value both halves: the revision - value, who, when, why - and the dataset version's provenance with the value the query returned                                                                                                                                                                                                                                                                                                                                                        |
| **DAT-097** | A bound image, after D8, takes its description from the column its definition names, or is decorative; a row whose description is null or empty fails the publish by name, `image_description_missing`, naming the binding, the row and the column ([Bound images](#bound-images))                                                                                                                                                                                                                                                                              |

## What this document does not own

| Left unclaimed                     | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DAT-033                            | **A named gap.** An inline value is formatted by the theme's value formats and the binding holds none (BI-F); a table's formatting is STY-014's table style, `tables.md`'s. Claimed when that lands on the same declaration                                                                                                                                                                                                                                                                                                                     |
| DAT-057                            | **A named gap.** Revising an inline value in place is designed here; revising a cell of a bound table in place is `tables.md`'s presentation, over the same `binding_revision` with its `cell` member                                                                                                                                                                                                                                                                                                                                           |
| DAT-061                            | A reviewer's queue and a lifecycle gate are T3's COL and LIF. The Data tab's list of revised values is what they will read                                                                                                                                                                                                                                                                                                                                                                                                                      |
| DAT-098                            | **A named gap.** A bound image in a line of text and in a table's cell is an inline binding taking an image column; one as a figure needs the figure's stored shape widened, which D8's plan settles by its stored-shape check (BI-P)                                                                                                                                                                                                                                                                                                           |
| DAT-012, CNT-039, DAT-048, DAT-063 | Anchoring to a row of generated content is the bound table's; `tables.md`'s (challenged above). `takeValue`'s key lookup and `row_missing` are what they share with an inline binding                                                                                                                                                                                                                                                                                                                                                           |
| DAT-028, DAT-069                   | A block binding's table and an empty result's statement are `tables.md`'s, as data.md has them                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| DAT-115                            | **A named gap.** A revised value is marked as a person's in the editor and the read text (a marker always shown, _revised by hand_, in its accessible name too), as a state of its own in the Data tab, and beside what the query returned in the provenance panel and `provenance.json`; print is unmarked, as DAT-115 allows. DAT-115 also names review, whose mode (CNT-155, T3) is not designed, so the claim waits for review's design to draw the mark                                                                                    |
| PUB-108                            | **A named gap.** The binding stage is placed after conditions and before contributions (BI-L), and the order test fails with it swapped after references or after generation. Swapped after contributions or numbering it changes nothing a test can read: no value is counted or numbered, and a title holds no binding. PUB-108 asks the test to fail if the stage moves after numbering too; claimed when B3's plan makes that move fail, by the types, as `number` already refuses at compile time what has not been through the conditions |
| PUB-002, PUB-109 to PUB-111        | PUB-002 names transclusion, conditions and variables beside bindings, and PUB-109 to PUB-111 the order test's place for each: REU's, T4. publishing.md owns the order                                                                                                                                                                                                                                                                                                                                                                           |
| PUB-072                            | Publishing failing on a failed binding is one clause of publishing.md's list; this design supplies that clause's failures                                                                                                                                                                                                                                                                                                                                                                                                                       |
| DAT-038, VER-019                   | A baseline pinning every binding's dataset version is storage-and-versioning.md's; a publication's `publication_binding` rows are what a baseline made from it will pin                                                                                                                                                                                                                                                                                                                                                                         |
| DAT-030                            | data.md's. The dialog offers a document parameter once TPL-020 gives a document parameters, and says why it cannot before                                                                                                                                                                                                                                                                                                                                                                                                                       |
| TPL-019, TPL-022, TPL-063, TPL-065 | The `templates.md` additions', which call resolve for every binding a document is made with                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| STR-038, LIF-004, LIF-026          | T3's: the contents showing failed bindings, a transition gate on them, and the audit log's binding events                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| LOC-043                            | A bound value inert through translation is LOC's, T6; a value is never in a component's text to translate                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| API-049                            | A connector removed is T5's; a binding whose definition's connection is retired still holds and publishes what it holds (data.md)                                                                                                                                                                                                                                                                                                                                                                                                               |

## What is built, and what this design changes in it

| Built                                                                                                                                                                                                   | Changed by                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bindingNodeSchema` (`packages/domain/src/content/model/inline.ts`): `{ type, id, query, version?, parameters, mode, take }`, every string NFC, widened in place at content schema 1 (D3-C)             | Nothing. It is the node this design edits. **It has no `marks`**, as a cross-reference has none (BI-A)                                                                                                                                |
| The editor opens a component holding a binding read-only, by name (`packages/editor/src/mapping.ts`, `marksWithNoType`)                                                                                 | B1: the editor schema gains the node, and such a component opens for editing                                                                                                                                                          |
| **The admission pipeline's re-identify stage keeps a binding's identifier** (`reidentify.ts`, `reidentifyInline` returns any inline but text, a reference and a footnote as it came)                    | B1, **a fix**: a pasted binding is given a new identifier, so a copy pasted into the component it came from does not hold an identifier twice, which the content walk refuses at save; a cut and a paste gives it back its own (BI-D) |
| Resolve reads a binding from the component version the node resolves to (D3-E)                                                                                                                          | B2: it may also read it from the caller's own editing session's latest iteration, where the node floats at latest, so a binding just placed shows a value without a version being cut (BI-C)                                          |
| `resolutionsOf` answers a newer dataset version as waiting only where its checksum differs (D3, "Changed while building")                                                                               | B4: also where it ran a newer version of a floating binding's definition, so a definition moved on with the same rows is offered (BI-K)                                                                                               |
| `binding_resolution.act` is `resolve` or `accept` (0047)                                                                                                                                                | B2: gains `confirm`, a held result kept across a binding change that leaves its question unchanged (BI-J)                                                                                                                             |
| A publish and a preview of a document holding any binding are refused, `binding_unresolved` (`apps/service/src/publishing.ts`, `refuseBindings`); `assemble` refuses one too (`publishing/assemble.ts`) | B3: the request refuses only a binding holding no matching resolution, and records the rest; `assemble`'s refusal becomes the stage's own check (BI-L)                                                                                |
| `packages/domain/src/content/binding.ts`, `resolveBoundTable` over string rows, and `cases/case-03-bound-table-footnote.test.ts`: the scaffolding's bound table, which nothing outside its test imports | Left to `tables.md`, which replaces it; it is not the rule this design takes a value by. It cites no requirement, so the trace is unchanged by its removal                                                                            |
| The theme has paragraph, character, table and image styles, and nothing for a value's format                                                                                                            | B1: a value catalogue, the theme's seventh, and the default theme's 0.6 naming it (BI-F)                                                                                                                                              |
| [component-editor.md](component-editor.md)'s table says of a binding "Create: No; Edit: Removal only; DAT, T2"                                                                                          | B1 and B2 make it true otherwise; that row is updated by the slice that changes it, as the editor's rows always have been                                                                                                             |

## The binding in the editor

### The node

**`binding` is an inline atom** in the editor's schema, carrying the stored binding's members as
attributes - `id`, `query`, `version`, `parameters`, `mode`, `take` - with no marks, no content and
no `parseDOM`, mapped losslessly by `toEditor` and `fromEditor` as every node is. It stands wherever
component content admits an inline (D3-D): a paragraph, and so a list's item, a quotation and a
table's cell; a term, an attribution, a table's or a figure's caption, a table's note and a footnote's
paragraph. **Never** in preformatted text, an equation, or a section's title, whose title editor
(`mountTitleEditor`) does not offer it and whose schema refuses it (`binding_in_title`). A mark put
over words and a binding rests on the words alone, and an annotation either side of one is one
annotation, as with a cross-reference and an inline image. **No marks** (BI-A): a bound value is set
in its paragraph's style, never bold or in another language by a mark; adding `marks` later is a
member added with a default, at content schema 1, by the footnotes plan's evidence rule.

### Placing and changing one

**Value** on the toolbar, beside **Reference**, opens the **Value dialog**; its shortcut is chosen by
B2's plan by the registry's own check, as Equation's was - a Ctrl-Alt chord is AltGr on Windows, and
`Mod-Shift-D` is a bookmark command in both browsers - with the toolbar's button the way in wherever a
platform takes it. With a binding selected whole, the dialog opens on it, and **Change** keeps its
identifier. It is unavailable where the node cannot stand, and available in a footnote's open editor.

The dialog, top to bottom, each step enabled once the one above is chosen:

1. **Query definition**: the definitions the author may read, searched by title, each with its space
   and **Runs as** - _the service account_, or _each reader's own view, as the source sees them_ - from
   `GET /v1/query-definitions/{id}`, which answers its connection's identity (DAT-022). A retired one
   is not offered; one the binding already names and the author may not read is shown as _a query
   definition you cannot read_ and can only be kept or replaced.
2. **Version**: **Always the latest** (floating, the default) or one of its versions, newest first.
3. **Parameters**: each the version declares, as a field of its type - a list of its permitted values
   as a choice, a range's bounds said beside it, a list parameter as several - checked by D2's
   `checkParameterValues` as typed, its refusal said beside the field in its own words. **From the
   document** is shown and unavailable until a document has parameters (TPL-020), saying so (DAT-030).
4. **Value**: the column, from the version's declared columns (an image column only from D8, BI-P);
   then **the only row**, or **the row whose** each key column **is** a typed value, offered only where
   the version declares a key (DAT-067). Nothing here knows how many rows a result will have: that is
   the take's to find at resolve, and its failure is shown in place.
5. **Mode**: **Checked** - _looked for each time the document is opened_ - or **Pinned** - _never looked
   for_ (DAT-082). Checked is the default.

**Insert** places the binding at the end of the selection and selects it whole. **In a document**
(BI-C) the page then resolves it - the one query placing makes (DAT-089) - reading it from the
author's own editing session, and the value, or its failure, appears in place; an author without
`use_connection` on the definition's connection places it holding nothing, and the dialog says
somebody who may use the connection resolves it from the Data tab. **On its own**, the dialog says the
value will show in each document that resolves it. Nothing is placed on Cancel or `Escape`.

**Changing** a binding that documents already hold values for says, before **Change**, how many will
hold none until they are resolved again - readable ones named, the rest counted, from
`GET /v1/components/{id}/bindings/{binding}/holders` - unless the change leaves its question unchanged
(only the value taken or the mode), where each document keeps its value by **Keep** in its Data tab,
querying nothing (BI-J). **Removing** one is deleting the atom, an ordinary edit; the resolutions it
had stay as history and hold nothing, since no version holds the binding.

### What it shows

**What a binding shows is drawn by a node view from a decoration** whose spec carries the text flat,
as a cross-reference's is ([cross-references 1](../plans/2026-09-23-cross-references-01-references-in-the-editor.md),
ruling R10): the surface's state holds the host's `BindingContext`, null on its own, set by a
transaction the history never holds, and the decorations are recomputed whenever it changes - a check
finding a revision, an accept, a page's values arriving - without the component's document changing.

| Where                               | It shows                                                                                                                                                                                                                                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **On its own**                      | What it asks for, not a value (BI-B): the definition's title and the value taken - _Mean reading, Readings_, or _Mean reading where site is north, Readings_ - in the application's chip, with _a value in each document_ as its description. A definition the reader may not read is _a bound value_                |
| **In a document, holding**          | The value, formatted ([Formatting](#formatting)), set in the paragraph's style as the publication sets it. Nothing marks it until the pointer or the focus is on it, or **Show boundaries** is on (DV-B), when it is underlined dotted and labelled _bound value_                                                    |
| **In a document, needing a person** | The value with a marker always shown, apart by an icon and words, never by colour alone: _revision waiting_, _definition changed_, _revised by hand_                                                                                                                                                                 |
| **In a document, with no value**    | A marker in its place, as a broken reference is drawn: _No value - never resolved_, _No value - the binding changed since it was resolved_, _No value - the query returned 3 rows_, _No value - no row where site is north_, _No value - empty_. The rest of the component and the document draw as before (DAT-047) |

**The document's read text shows the same**, through the same context, and a copy to another
application carries the shown words in its plain text and its HTML, as a cross-reference's does. A
value never enters a component's search entry: it is not in the component.

### Identity: copy, cut, paste and undo

A document holds a value **by node and binding identifier** (data.md's resolution), so a binding's
identifier is what keeps its values in every document. By [Identity, by operation](component-editor.md#identity-by-operation):

- **Undo** keeps it: the identity plugin keeps an identifier exactly one node holds in an undo or a
  redo, so deleting a binding and undoing brings back the binding every document holds a value for.
- **Copy and paste** gives the pasted binding a new identifier in the admission pipeline's re-identify
  stage, which today returns a binding as it came (the fix above): a copy holds nothing anywhere until
  a document resolves it, and the paste report counts _bound values pasted, each to be resolved in a
  document_. Nothing but the product's own clipboard type carries a binding; the readers never make one.
- **Cut and paste** in one component gives it back its own identifier (BI-D): where a pasted binding
  arrived with an identifier no node of the component still holds - its original was cut - the paste
  keeps it, by the `keepsIdentifiers` meta a paste already uses, so moving a value within its
  component loses no document's value and queries nothing. A cut from one component and a paste into
  another is a new binding: the other component is placed by other nodes.
- **Split, join and move** never touch an atom's identifier: it is the atom's own attribute, which
  ProseMirror's split does not copy, since an atom is never split.

### Keyboard and accessibility

The atom is reached by the arrow keys as a whole, a node selection, and its accessible name is what
it shows with its kind - _1,234.5, bound value, revision waiting_. Selecting it shows the **Value
panel** in the dock, beside the Figure and Table panels: its provenance in brief, **Change**, and
**Provenance** for the whole panel. In the read text, a value is a button in the tab order, as a
link in text is, and Enter or a click opens its provenance (DAT-041); the Data tab reaches every value
too, so no value is reachable only by the pointer. The dialog is worked by keyboard as the other
dialogs are. The browser suite's keyboard and axe tests take each surface, as every dialog's have.

## A value, taken and formatted

### Taking

**`takeValue(take, result)`**, in `packages/domain/src/data/`, pure: the one rule by which the page,
the editor and the publish take a value from a stored result (BI-E).

| Take                | Result                         | Answer                                                    |
| ------------------- | ------------------------------ | --------------------------------------------------------- |
| `{ column }`        | One row                        | Its cell                                                  |
| `{ column }`        | No rows                        | `value_none` (DAT-032)                                    |
| `{ column }`        | More than one                  | `value_many`, naming the count (DAT-031); never the first |
| `{ key, column }`   | The row whose key equals `key` | Its cell; the key is unique by D2-M, so at most one       |
| `{ key, column }`   | No such row                    | `row_missing`, naming the key                             |
| Either, the cell    | `null`                         | `value_null` (DAT-032)                                    |
| Either, a text cell | No characters, or spaces alone | `value_empty` (DAT-032)                                   |

A key is compared in canonical form, which is what the result and the take both hold. A column not
declared is `take_invalid`, checked at resolve already (D3-L) and again here, since a result read
later is the result of the version it ran.

### Formatting

**A value is formatted by the document's theme, never by the binding** (DAT-033's half; BI-F): a
**value catalogue**, the theme's seventh, at catalogue/1, which the default theme's 0.6 names - added
by a migration as 0043 added 0.5, over the same guard - and which a theme naming none reads as the
product's default. **Declared, never derived**: the formatter is the domain's own code over what the
catalogue declares, with no `Intl` and no locale data, because the editor runs in Chromium and
Electron and the worker in Node, each with its own ICU and CLDR, and Word does not run either; one
pure function over declared separators prints the same characters everywhere, which themes.md's
conformance suite can hold. LOC-038's named, versioned locale data is T6's, and arrives as a source of
these declarations, not instead of them.

```ts
ValueCatalogue = {
  kind: 'value', schemaVersion: 1,
  formats: ValueFormats,                                     // the default
  byLanguage: { language: string, formats: ValueFormats }[], // a primary language subtag each, at most 32, each once
}
ValueFormats = {
  number:  { decimal: '.' | ',', group: 'none' | ',' | '.' | "'" | 'U+00A0' | 'U+202F',
             groupFrom: 4 | 5, minus: 'U+002D' | 'U+2212' },
  date:    { order: 'ymd' | 'dmy' | 'mdy', separator: '-' | '/' | '.', pad: boolean },
  time:    { separator: ':' | '.' },
  boolean: { true: string, false: string },                  // 1 to 40 characters, NFC
}
```

- **The language is the document's**, the one its layout is written in (LOC-028: content is formatted
  for the language being published), its primary subtag finding `byLanguage`, else `formats`.
- **An integer** is grouped from `groupFrom` digits; **a decimal** is printed at exactly its declared
  scale, its canonical form's trailing zeros put back - never fewer places, which would round (DAT-080,
  TAB-019). **A date** in its order, padded or not; **a time** and **a local date-time** to the
  column's declared fraction; **an instant** as a local date-time in UTC followed by `UTC`: a document
  has no time zone, and a zone needs the time zone database, versioned data again. **A boolean** in the
  declared words. **Text** as it is, each line break or tab shown as one space.
- **No month names** until LOC: a name is language data.
- The default theme's 0.6: `.`, `,` from 4 digits, hyphen-minus, `ymd` with `-` padded (ISO 8601),
  `:`, _Yes_ and _No_. An environment that has recorded a theme of its own keeps it, read with the
  product's default value formats, as 0043's reader does for catalogue/2.

`formatValue(value, column, catalogue, language)` is the one function: the editor's node view, the
read text, the Typst projection and the Word writer all print what it returns.

### The taken value, held as derived data

**A page does not read result objects to show values** (BI-G). A result can be 25 MiB at the
ceilings, and a document can hold fifty distinct ones: reading each to take one cell at every opening
would be the page's whole cost. So the service writes what a take gave as **derived data**, keyed by
the dataset version and the take, whenever it holds the rows anyway - a resolve's run, a check's
revision, a revision's value checked against its column - and on a miss reads the object once,
computes, and writes it:

```sql
dataset_take (
  dataset_version  uuid not null,        -- with its artifact and kind, by foreign key to artifact_version
  take_digest      text not null,        -- SHA-256 over the take's canonical form
  outcome          jsonb not null,       -- { value, column } | { failure, count? }, strict
  primary key (dataset_version, take_digest)
)                                        -- derived: rewritten by the same function, deletable, never authoritative
```

It is derived as storage-and-versioning.md uses the word: a function of an immutable version and a
take, which `takeValue` recomputes exactly, so deleting the table loses nothing. **The publish does
not read it**: the worker takes every value itself from the object it reads by its checksum, which is
the authority, so a derived row can never print.

## The document's side

### The Data tab

The document page's outline pane gains a tab, **Data**, beside **Contents** (`OutlineTabs`), shown
wherever the document holds a binding the reader can see (BI-H). It lists every binding in the
outline's order, grouped under its node's number and title, each with its value as the document
shows it, its definition, its mode and its state, filtered by state:

| State                       | Means                                                                                                                                               | Offers, to whoever may                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Never resolved**          | No resolution for this node and binding                                                                                                             | **Resolve** (`edit` on the document, `use_connection`)       |
| **Changed since resolved**  | The latest resolution's digest is not the binding's (`stale`)                                                                                       | **Keep** where the question is unchanged (BI-J), **Resolve** |
| **Failed**                  | Its value cannot be taken (BI-E), or the check made on this page's opening failed for it - its failure in the product's words, attributed (DAT-049) | **Resolve**, **Check now**                                   |
| **Revision waiting**        | A newer result of its question, shown beside the held value (DAT-082)                                                                               | **Accept**                                                   |
| **Definition changed**      | Floating, and its definition has a version newer than the one its result ran (DAT-070)                                                              | **Check now**, then **Accept**                               |
| **Revised by hand**         | A person's revision stands in front of the result (DAT-115, BI-O)                                                                                   | **Withdraw**, **Revise**                                     |
| **Changed since published** | Its question, definition version, dataset version or revision differs from the document's latest publication's `publication_binding`, or it is new  | Nothing; it says what differs                                |
| **Holding**                 | None of the above                                                                                                                                   | **Revise**                                                   |

**Failed is what can be known when the page asks**: a failed act records nothing (DAT-086), so a
check's failure is the page's to keep for as long as it is open, beside every failure the stored
state implies. A value the reader may not see - in a component they may not read - is not listed, as
the bindings view shows it nothing (D3, "Changed while building"). The tab's **Go to** scrolls the
text to the value and marks it, as a generated list's entry does a figure.

### Checking on opening

**A checked binding is checked when the document page opens** (DAT-082; BI-I), in either mode, by
whoever may check it - `read` on the document and `use_connection` on its connection, the route's
rule (D3) - by one `POST .../bindings/check` once the bindings view has answered; and again on
**Check now**. The route runs each distinct question once, two at a time, fifty a check (D3-I), so
opening a document of many values costs at most fifty runs; a pinned binding is never checked. A
reader who may not check sees what is stored, and the Data tab says that values were not checked
for them. **Nothing throttles checks across openings in T2**: the tenant's total volume is DAT-071's,
T3's, and the open question below.

### Accepting, and the warning

**Accept** shows the waiting value beside the held one and accepts that version, `replaces` the one
held (D3-K), refused `resolution_precondition` with the binding as it stands where another accept got
there first. **Where the version was fetched under the accepting person's own identity** - from D7,
when an end-user connection exists - Accept opens a confirmation first (DAT-091): _Everybody who may
read this document will see this value, which the source showed to you_, with the document's readers
counted, and **Share my view** or **Cancel**; only Share sends `sharesOwnView: true`, which the route
otherwise refuses, `acknowledgement_required` (DA-AE). A service-account result asks nothing.

### A definition moved on, and changed since published

**A floating binding is flagged when its definition advances** (DAT-070): the bindings view answers
`definitionChanged` where the definition's latest version is not the one the held result's provenance
names and the binding floats, and the value is marked and listed. A check runs the latest version
(D3-E), and **its result is a waiting revision even where its rows are the same** (BI-K), since the
question the value answers has changed meaning: D3's `resolutionsOf` offered only a different
checksum, which would have recorded the new version and offered nothing.

**Changed since last published** compares each binding with the document's latest publication's
`publication_binding` rows (B3) - its digest, its definition version, its dataset version and its
revision - and lists the differences and the bindings that are new, so an author knows which values
the next publication will print differently before they publish.

### Keeping a value across a changed binding

**Keep** (`POST .../bindings/confirm`, BI-J) holds the result a binding already held under its
changed digest, querying nothing, where its question is unchanged: the same definition, the same
parameters, and a version the held result ran - its pin unchanged, or floating with the definition
not moved on - so only what it takes or its mode changed. The take is checked against the held
version (`take_invalid`), and the row is a resolution like any other, `act: 'confirm'`, naming what it
replaces. **D3-R's rule stands**: a binding turned from pinned to checked holds nothing until somebody
confirms it; confirming is now a click rather than a query. A changed question is refused,
`confirm_not_possible`, and the Data tab offers **Resolve** instead.

### Provenance, from the value

**One step from the value** (DAT-041): the Value panel's **Provenance**, or activating the value in
the read text, opens the provenance panel:

- **The value**: as shown, and what the query returned in its canonical form, with its column's name
  and type; a revised value both halves (DAT-062).
- **Where from**: the query definition by title and version, linked where the reader may read it; the
  connection by name where they may read it; the parameters the document supplied.
- **Whose view** (DAT-024): _the service account_, or the person by name, their sign-in route and the
  identity as the source saw it.
- **When and what**: fetched at, the rows, the checksum (its first twelve characters, the whole on
  request), the dataset by name and version; who resolved or accepted it and when; the mode.
- **What ran**: the SQL that ran, only where the reader may read the definition, as the bindings view
  redacts it today (D3), and **Show the result**, the rows through `GET .../datasets/{version}`.

## A value revised by hand

Designed whole here, and T3's: Ken moved it there with DAT-061 on 2026-10-04, answering question 1
([ADR-0036](../decisions/0036-revising-a-bound-value-by-hand-moves-to-t3.md)). It is built in B5,
only once T3 begins.

**A revision is the document's** (BI-O), as a value is: one component serves many documents, and a
person correcting a number in one must not change it in another. It stands **in front of** a
resolution, never in place of it (DAT-058):

```sql
binding_revision (
  id             bigint generated always as identity,
  document_id    uuid not null,          -- a document, by (id, kind)
  node_id        text not null,
  binding_id     text not null,
  cell           jsonb,                  -- null for an inline binding; { key, column } for a bound table's cell (tables.md)
  binding_digest text not null,          -- holds only while the binding is unchanged, as a resolution does
  dataset_version uuid not null,         -- the result it stands in front of, by (id, artifact_id, kind)
  act            text not null check (act in ('revise', 'withdraw')),
  value          jsonb,                  -- canonical in the column's type; null exactly for withdraw
  reason         text not null,          -- 1 to 1,000 characters, NFC, no control
  replaces       bigint references binding_revision,   -- the revision it replaces, or null
  revised_by     uuid not null references principal,
  revised_at     timestamptz not null
)                                        -- insert-only: UPDATE, DELETE and TRUNCATE revoked
```

- **Which stands**: the latest row for a document, node, binding and cell, where it is a `revise`, its
  digest is the binding's and its dataset version is the one the binding holds. A revision against a
  version the binding no longer holds stands for nothing, and is shown as such.
- **Revise** (`POST .../bindings/revisions`): `edit` on the document; the value checked canonical in
  the column's type (`value_invalid` otherwise) and formatted to show the author before it is saved;
  a reason required; `replaces` the revision standing, or null, refused `revision_precondition` where
  that is not what stands. It queries nothing, and needs no `use_connection`: it is the person's own
  value, not the source's. **Withdraw** is the same route with `act: 'withdraw'` and a reason.
- **A source revision meeting one** (DAT-060): the Data tab and the panel show three values - what the
  query returned, the revision, and the source's new result - and **Accept** asks **Withdraw my
  revision** or **Keep my revision**; the route refuses an accept over a standing revision without
  `revision: 'withdraw' | 'keep'`, `revision_decision_required`. Keep records the revision again,
  against the accepted version, with the same value and reason, in the accept's transaction; withdraw
  records a `withdraw`. Neither is ever silent.
- **Marked as a person's** (DAT-115): in the editor and the read text, a marker always shown -
  _revised by hand_ - and its accessible name; in the Data tab, its own state; in `provenance.json`,
  both halves. **Not in print**: the PDF and Word set it as any value, Ken's answer to question 2.
- **Concurrency**: revise, withdraw, accept, confirm and a resolve's and a check's recording take
  `lockBindings`' lock on the document, node and binding before reading what stands, as D3's accept
  does, so two acts on one binding take turns and the second is refused by its precondition. All of
  these are the document's (DAT-116): none writes the component. Changing the binding itself is an
  edit to the component, saved as an iteration under its lock (COL-005) and carrying the version it
  was opened from (API-037), as every edit is.

## The publish's binding stage

### Where in the order

**The binding stage runs after conditions and before contributions** (BI-L) - stage 2b in
publishing.md's order - so that a value a condition hides is never taken or required once REU makes
conditions more than the identity, and every value is in the content before anything numbers,
resolves a reference or generates a list (PUB-002): a cross-reference printing a caption prints the
caption's value, and a list of tables lists it. **The order test proves it**
(`publishing/order.test.ts`, which cites PUB-098): swapped after references, a reference to a table
whose caption holds a value prints no value; swapped after generation, the list of tables omits it.
The conditions pair is stated and not testable while conditions are the identity; REU's slice tests
it.

### At the request

In the transaction that records the request as its publisher, after the occurrences are resolved
(IAM-063), **for every binding in every component version the request resolved**:

- **The resolution it holds** is the latest for the document, node and binding whose digest is the
  binding's. None is `binding_unresolved`, 400, `attribution: 'product'`, naming the document and each
  such binding by node and identifier with `reason: 'never' | 'changed'` (DAT-087), and nothing is
  queued. This replaces D3's blanket refusal.
- **What it records**: `publication_request_binding` - the node, the binding, its digest, the
  resolution and its dataset version, and the revision standing, if any - written while the request is
  queued, as 0022's assets are.
- **No value is taken here.** Taking needs the rows, and the request's transaction holds the access
  epoch's shared lock; the worker takes them, as it does everything else that reads content, and the
  page has already shown the author every failure it will find.

### In the worker

`publish` and `preview` load the request's bindings with its occurrences. **For each distinct dataset
version** - once, however many bindings hold it - the worker reads its provenance (the version's
content) and its rows from the tenant's store by the checksum the provenance names, **refusing bytes
whose SHA-256 is not that checksum**, `result_unreadable`, attributed to the product, as the service
refuses a run's bytes before storing them. It never asks the connector: it has no route to it
(DAT-088, DAT-089). Then `assemble` receives, beside the occurrences, each binding's result and any
revision, and the stage, in `packages/domain`, pure:

1. **takes** each value by `takeValue`, or the revision's value where one stands (DAT-062);
2. **formats** it by `formatValue` with the request's theme version's value catalogue and the
   document's language;
3. **replaces** the inline `binding` with a projected `value` inline - the formatted text, the
   binding's identifier, and whether it is revised - which the rest of the pipeline reads as text: the
   references stage, the generated lists, the checks of glyphs and emptiness;
4. **fails** by name for each value it cannot take - `value_none`, `value_many`, `row_missing`,
   `value_null`, `value_empty`, `image_description_missing` - stage `bind`, naming the block and the
   binding, beside every other failure, as publishing.md's failures are gathered rather than the
   first alone (DAT-046). A binding the request did not record is `binding_unresolved`, the second line
   D3 put in `assemble`, kept.

**What is never printed in a value's place**: a blank, a zero, a placeholder, the binding's
description, a previous publication's value, or the derived `dataset_take` row (DAT-046).

### What a publication records, and what accompanies it

- **`publication_binding`**: the request's rows, written in the transaction that makes the
  publication, and held by 0022's rule to **exactly** the request's, no more and no fewer - the
  publication names every dataset version it read, and each is held by `on delete restrict`, so
  nothing sweeps a result a publication printed (data.md). Reproducibility (publishing.md) gains them:
  made again, a publication reads the same dataset versions and revisions, and prints the same.
- **`provenance.json`** (DAT-042, PUB-049; BI-N), written by the worker beside each format and stored
  as an output of its own, `format: 'provenance'`, by its hash, wherever the publication printed a
  value: for each, the node and its number, the binding and the block it stood in, **what was
  printed**, the canonical value the query returned and its column, the take, the dataset by name and
  version, the revision standing - value, who, when, why - and the dataset version's provenance **as
  every reader of the publication may see it**: without the SQL, the connection and each column's
  source, which D3 shows only to a reader of the definition. A reader who may read the definition
  follows its identifiers. The publication's page lists it beside the PDF and Word, and
  `GET /v1/publications/{id}/bindings` answers the same, whole to a reader of each definition.
- **Not embedded in the PDF.** An attached file would be one more structure for veraPDF and the
  Matterhorn review to judge in every publication, for a reader the separate file serves as well.

### Preview, PDF and Word

**A preview takes its values exactly as a publish does** (PUB-006), from the same request tables,
and **fails as a publish does** on a binding holding nothing (BI-M): a preview with a marked
placeholder would show what no publish can print, and the page already shows the author every value
it cannot take. In the PDF a value is text in its paragraph's run, tagged as its paragraph's text,
in the paragraph's language; in Word it is a run in the paragraph's style - `formatValue`'s string in
both, so the Word check against the PDF compares the same characters. A revised value prints as any
value does, unmarked (DAT-115, question 2).

## Bound images

**After D8**, which admits image columns through `ingest` (DAT-096), and designed here so D8's plan
starts from it (BI-P):

- **In a line of text and in a table's cell** (DAT-098's two): an inline binding whose take names an
  image column. It is drawn and printed as an inline image is - one line high in its paragraph or
  cell, by the theme's inline image style - from the asset the dataset version's provenance `images`
  map gives the cell's hash. The Value dialog offers image columns once D8 has built them.
- **As a figure**: the figure node's image is an asset version today; taking it from a binding
  instead needs a member beside `asset` that holds a `BindingCore` and a take, which is a content
  schema change D8's plan makes by its stored-shape check and the footnotes plan's evidence rule. That
  shape is why DAT-098 is not claimed.
- **The description** (DAT-097): the column the definition names, read from the taken row, or
  decorative where the definition says so. A null or empty description fails the publish by name,
  `image_description_missing`, naming the binding, the row's key and the column; in the editor it is
  shown in place as any failure is.

## Stored shapes and migrations

Every member, what validates it on every write path, and what it points at - by
[the stored-shape rule](../plans/2026-10-03-d3-datasets-and-resolutions.md#the-stored-shape-check),
since every version, resolution, revision and publication row is immutable once written.

| Shape                                          | Written by, alone                                                | Validated by                                                                                                                                                                                                                                                      | Points at, and who checks                                                                                           | Slice |
| ---------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----- |
| The binding in content                         | Every content write path, unchanged                              | D3-C's schema, unchanged; the editor's node is mapped losslessly to it                                                                                                                                                                                            | As D3                                                                                                               | B1    |
| The value catalogue and the default theme 0.6  | A migration, as 0043; nothing else writes a theme in T2          | The catalogue's strict schema: each member's closed set, `byLanguage` each a primary subtag once, at most 32, words 1 to 40 characters in NFC; the theme reader's test recomputes digests                                                                         | The theme names the catalogue version by identifier, as 0.5 names its others                                        | B1    |
| `dataset_take`                                 | `recordTake`, from resolve, check, a revision and a view's miss  | The outcome's strict schema: a value canonical in the column's declared type, or one of the failure codes with a count where it has one                                                                                                                           | A dataset version, by `(id, artifact_id, kind)`; derived and deletable                                              | B1    |
| `binding_resolution.act` gains `confirm`       | `recordResolution`, from confirm                                 | The check constraint widened; `binding_resolution_accept_replaces` widened so a confirm names what it replaces too                                                                                                                                                | As 0047                                                                                                             | B2    |
| `publication_request_binding`                  | `requestPublication` and the preview's request, while queued     | A trigger refusing a row once the request is not queued, as 0022's; node and binding spelled as the outline's and NFC; digest 64 hex                                                                                                                              | The request; the resolution; its dataset version by `(id, artifact_id, kind)`; a revision or null                   | B3    |
| `publication_binding`                          | The worker's recording transaction                               | 0017's while-queued check, and `publication_recorded_whole` widened: exactly the request's rows                                                                                                                                                                   | The publication; as above                                                                                           | B3    |
| `publication_output.format` gains `provenance` | The worker                                                       | 0027's format, standard, producer and report checks widened - no standard, the product as producer at the pipeline's version, an empty report; the whole-publication check gaining one exactly where the publication holds a binding, never asked for as a format | The publication                                                                                                     | B3    |
| `binding_revision`                             | `recordRevision`, from revise, withdraw and an accept that keeps | The value canonical in the column the dataset version declares; the reason; `replaces` of the same document, node, binding and cell; withdraw exactly with a null value                                                                                           | The document and the dataset version by `(id, artifact_id, kind)`; the node's existence is the service's at the act | B5    |

**No content schema change before D8**, and no change to a stored binding: `bindingNodeSchema` is
what D3 left it. Every new table's text is held to NFC and its spellings by a constraint as well as by
its one writer, as 0047's `dataset_name` is, so a direct insert cannot pass what the writer would
refuse; and every trigger reads its table by `tg_table_schema`.

## Routes

| Route                                                  | Permission                                                          | Does                                                                                                                                                                                                             | Slice      |
| ------------------------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `GET /v1/documents/{id}/bindings`                      | `read` on the document                                              | D3's, gaining per binding the taken value or its failure for what it holds and what is waiting, `definitionChanged`, the revision standing, what differs from the last publication, and `mayCheck`, `mayResolve` | B1, B4, B5 |
| `POST /v1/documents/{id}/bindings/resolve`             | `edit` on the document, `read` on each definition, `use_connection` | D3's; an item may say `from: 'session'`, reading the binding from the caller's own editing session where the node floats at latest (BI-C)                                                                        | B2         |
| `POST /v1/documents/{id}/bindings/confirm`             | `edit` on the document, `read` on the definition                    | Keeps the held result under the binding's changed digest where its question is unchanged; queries nothing (BI-J)                                                                                                 | B2         |
| `GET /v1/components/{id}/bindings/{binding}/holders`   | `read` on the component                                             | The documents holding a resolution for the binding, readable ones by name and the rest counted, as the uses routes answer                                                                                        | B2         |
| `POST /v1/documents/{id}/bindings/check`               | `read` on the document; `use_connection` per connection             | D3's, unchanged; asked by the page on opening (BI-I)                                                                                                                                                             | B4         |
| `POST /v1/documents/{id}/bindings/accept`              | `edit` on the document, `read` on the definition, `use_connection`  | D3's, gaining `revision: 'withdraw' \| 'keep'`, required over a standing revision                                                                                                                                | B4, B5     |
| `POST /v1/documents/{id}/bindings/revisions`           | `edit` on the document                                              | Revises or withdraws a value by hand (BI-O)                                                                                                                                                                      | B5         |
| `POST /v1/documents/{id}/publications`, `.../previews` | `publish`, `read`                                                   | Refuse a binding holding nothing, and record the rest (BI-L)                                                                                                                                                     | B3         |
| `GET /v1/publications/{id}/bindings`                   | `read` on the publication                                           | Every value the publication printed with its provenance, redacted as the bindings view redacts                                                                                                                   | B3         |

Each is documented as `packages/api-contract/src/documentation.ts` requires, with a description for
an integration developer and its one tag, **Bindings and datasets** as D3's are, the publication's
route under the publications' tag; `openapi.json` and the client are regenerated with each.

## Permissions

No permission is added; D3's decisions stand.

- **Reading a value is reading the document** (DAT-090): whoever may read the document sees the values
  it holds, in a component they may read, without `use_connection`.
- **Provenance is redacted without `read` on the definition** - the SQL that ran, the connection and
  each column's source answered null - in the bindings view, the panel, the publication's route, and
  always in `provenance.json`, which every reader of the publication may download.
- **The source's own message goes only to a holder of `write_sql`** at the connection, decided again
  in the transaction that answers (D3, D4-K), wherever a resolve's or a check's failure is shown in
  place.
- **Placing and changing a binding** is `edit` on the component, as any content is, and the dialog
  offers only definitions the author may read. **Resolving** is `edit` on the document, `read` on the
  definition and `use_connection`; **accepting** the same (DAT-090); **keeping** across a change
  `edit` and `read` on the definition, since it holds a result of it again; **revising** `edit` on the
  document alone; **checking** `read` and `use_connection`.
- **Publishing a document holding values** needs nothing of the data: `publish` on the document, as
  every publish (ADR-0035: the worker holds nothing of the publisher's identity).

## Failures

Each is one code, attributed (DAT-049), naming the binding, its node and the document, and the
definition where the act has one (DAT-086).

| Code                         | Attribution | Where                    | When                                                                                                |
| ---------------------------- | ----------- | ------------------------ | --------------------------------------------------------------------------------------------------- |
| `value_none`                 | query       | In place, the stage      | A `{ column }` take of no rows (DAT-032)                                                            |
| `value_many`                 | query       | In place, the stage      | A `{ column }` take of more than one row, naming the count (DAT-031)                                |
| `row_missing`                | query       | In place, the stage      | No row holds the key, naming it                                                                     |
| `value_null`, `value_empty`  | query       | In place, the stage      | The cell is null, or text of no characters or spaces alone (DAT-032)                                |
| `image_description_missing`  | query       | In place, the stage (D8) | A bound image's description cell is null or empty (DAT-097)                                         |
| `binding_unresolved`         | product     | The request; the stage   | No resolution matching the binding's digest: never resolved, or changed since (DAT-087)             |
| `result_unreadable`          | product     | The stage                | A result object missing from the store, or its bytes not its checksum                               |
| `confirm_not_possible`       | product     | Confirm                  | The binding's question changed: its definition, its pin, its parameters, or the definition moved on |
| `revision_decision_required` | product     | Accept                   | Accepting over a standing revision without `withdraw` or `keep` (DAT-060)                           |
| `revision_precondition`      | product     | Revise                   | `replaces` is not the revision standing                                                             |
| `value_invalid`              | product     | Revise                   | A revised value not canonical in its column's type                                                  |

D3's and D2's codes are unchanged: a resolve's or a check's failure shown in place is theirs, in
their words.

## Where the code lives

| Where                                                      | What                                                                                                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain: src/data/take.ts`, `src/data/format.ts`           | `takeValue` and `formatValue`, pure, and the outcome's schema                                                                                |
| `domain: src/theme/`                                       | The value catalogue's schema, its reader's default, and the default theme's 0.6                                                              |
| `domain: src/publishing/`                                  | The binding stage in `assemble`, the projected `value` inline, its failures, its place in `order.test.ts`; the Typst projection's value text |
| `domain: src/word/`                                        | A value as a run                                                                                                                             |
| `domain: src/content/admission/reidentify.ts`              | A binding re-identified, and kept on a cut and paste                                                                                         |
| `editor: src/bindings.ts`, `bindingView.ts`                | The node, its plugin holding the `BindingContext`, its decorations and node view, after `references.ts` and `referenceView.ts`               |
| `db: migrations/tenant/`                                   | One migration per slice that stores something: B1, B2, B3, B5                                                                                |
| `db: src/datasets.ts`, `src/bindings.ts`, `src/publishing` | `recordTake`, confirm, revisions, the request's and the publication's binding rows                                                           |
| `service: src/data/bindings.ts`, `src/publishing.ts`       | The routes, the view's values, the request's binding rows in place of `refuseBindings`                                                       |
| `worker: src/jobs/publish.ts`, `preview.ts`                | Reading each result by its checksum, and `provenance.json`                                                                                   |
| `web: src/editor/ValueDialog.tsx`, `ValuePanel.tsx`        | The dialog and the panel                                                                                                                     |
| `web: src/structure/DataTab.tsx`                           | The Data tab, the check on opening, accept and its warning                                                                                   |

## Verification

- `packages/domain`: `takeValue` over each row of its table, red under a take of the first row;
  `formatValue` for each base type and declaration, the same string under Node as under the browser
  suite's Chromium; the stage's failures gathered whole; the order test's two new swaps.
- `packages/editor`: a component holding a binding opens for editing; the node mapped losslessly; a
  copy re-identified and a cut and paste keeping its identifier, red against today's `reidentify`; an
  undo keeping it; the decorations drawn again when the context changes and not otherwise.
- `packages/db`: each new table refusing an update and each loose value by its constraint as well as
  its writer; `publication_binding` refused unless whole; a confirm refusing a changed question.
- `apps/service`: each route with its permission; the request refusing an unresolved binding and
  recording the rest; the view's redaction; `binding_resolution`'s lock taken by confirm and revise,
  each race red without it, as D3's were.
- `apps/worker`: a publish and a preview of a document holding values, in PDF and Word, the value's
  text read back from each; a result object altered in the store refused; `provenance.json` holding
  what was printed; the Word check comparing the same characters.
- **Whole system and browser**: placing a value through the dialog in a document against
  `source-postgres`, the value shown, checked after the source changed, accepted, published, and the
  PDF read back; the dialog and the Data tab by keyboard and axe. Which of these prove a claim and
  which stand in for Ken's look in the real application is said in each slice's pull request.

## Decisions

Approved by Ken on 2026-10-04, every one as recommended.

| #    | Decision                                                                                                                                                                                                                                              | Recommended over                                                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BI-A | **The binding is an inline atom with no marks**, standing where any inline may but preformatted text, an equation and a title, as a cross-reference does                                                                                              | Marks on the binding now: a content member added for bold numbers, which a later slice can add with a default                                            |
| BI-B | **On its own a component shows what a binding asks for, never a value**; in a document, the value that document holds                                                                                                                                 | A sample run on opening a component, which would query a source per opening and show a value no document holds                                           |
| BI-C | **Placing a binding in a document resolves it at once, from the author's own editing session**, where the node floats at latest; on its own it is placed holding nothing                                                                              | Resolving only once a version is cut, which leaves a just-placed value blank until **Save version**                                                      |
| BI-D | **A pasted binding takes a new identifier; a cut and paste in one component keeps its own**, so a move loses no document's value; undo keeps it                                                                                                       | Re-identifying every paste, which would make every move re-query each document's source                                                                  |
| BI-E | **One pure `takeValue`**: none, many, a missing row, a null and an empty text each fail by name; nothing takes a first row or prints nothing                                                                                                          | Printing a null as empty or a dash, which DAT-032 and DAT-046 forbid                                                                                     |
| BI-F | **Values formatted by a value catalogue in the theme**, declared separators and orders per type with per-language overrides, by the domain's own code, never `Intl`; decimals at their declared scale, instants in UTC, no month names until LOC      | `Intl`, whose ICU differs between Chromium, Electron and Node and is not Word's; or formatting stored in the binding, which DAT-033 forbids              |
| BI-G | **Taken values are derived data**, `dataset_take`, written when the service holds the rows; the page reads them, the worker never                                                                                                                     | Reading each result object at every page opening, up to 25 MiB each; or the value in the resolution row, which a waiting revision has no row for         |
| BI-H | **The Data tab**, in the outline pane beside Contents, lists every binding with its state and its acts                                                                                                                                                | A panel per binding alone, which cannot answer "which of my values need me" for a whole document                                                         |
| BI-I | **Check on opening the page, in either mode, by whoever may check, and on Check now**; no throttle in T2                                                                                                                                              | Checking only on request, which DAT-082 does not allow; or only in Authoring, which DAT-082's "when opened" does not say                                 |
| BI-J | **Keep**: a held result carried across a binding change that leaves its question unchanged, `act: 'confirm'`, querying nothing                                                                                                                        | Re-running the source for a change of the value taken or the mode, which asks it a question it has answered                                              |
| BI-K | **A floating binding's result of a newer definition version is waiting even with the same rows**                                                                                                                                                      | D3's checksum-only rule, which records the new version and offers nothing (DAT-070)                                                                      |
| BI-L | **The binding stage after conditions and before contributions**; the request records each resolution and refuses one holding none; the worker reads each result by its checksum and takes every value                                                 | Taking values at the request, under the access epoch's lock with the objects read in it; or before conditions, which would require a value REU will hide |
| BI-M | **A preview fails as a publish does** on a binding holding nothing                                                                                                                                                                                    | A marked placeholder in a preview, which shows what no publish can print                                                                                 |
| BI-N | **`publication_binding` and `provenance.json`**, an output beside each format, redacted for every reader; a route answering the same, whole to a definition's reader                                                                                  | Provenance attached inside the PDF, one more structure for every PDF/UA check; or a route alone, which a downloaded PDF does not carry                   |
| BI-O | **A revision is the document's**, insert-only, in front of a resolution and bound to its digest and dataset version; accepting over one must say withdraw or keep; T3's ([ADR-0036](../decisions/0036-revising-a-bound-value-by-hand-moves-to-t3.md)) | A revision in the component, which would change every document's value                                                                                   |
| BI-P | **Bound images after D8**: an inline binding of an image column in a line or a cell, a figure's binding member settled by D8's stored-shape check, a missing description failing by name                                                              | Designing the figure's member now, before the image column it reads exists                                                                               |
| BI-Q | **Block bindings and anything anchored to their rows are `tables.md`'s**; this design gives them `takeValue`'s key lookup and `row_missing`                                                                                                           | Claiming DAT-012, CNT-039, DAT-048 and DAT-063 here, for a table this document does not design                                                           |
| BI-R | **Six slices, B1 to B6**, each with its own plan; revisions last, bound images after D8                                                                                                                                                               | One slice, which would be the size of D1 and D3 together                                                                                                 |

## Questions for Ken

Answered by Ken on 2026-10-04: every one as recommended. The corpus changes they need - questions
1, 2, 3, 4 and 8 - landed in a corpus pull request of their own, and question 1 is recorded as
[ADR-0036](../decisions/0036-revising-a-bound-value-by-hand-moves-to-t3.md).

1. **Revisions by hand to T3** (DAT-057 to DAT-060, DAT-062, with DAT-061)? **Recommended: yes.**
   The design is whole, so nothing is lost; T2 ships the data spine without a review feature nobody is
   asked to review. A corpus PR would move the rows.
2. **DAT-059 in print**: mark a revised value in the published PDF and Word, or only in the
   provenance that accompanies them? **Recommended: provenance only**, narrowing the row; the
   alternative is a theme character style the default draws visibly, which a theme can still style
   away.
3. **DAT-072**: supersede it with the precondition-per-change wording above? **Recommended: yes**; as
   written it makes a document's act a component's, against DAT-093.
4. **BI-F**: values formatted from declared separators, with no locale data and no month names until
   LOC in T6? **Recommended: yes**, and an STY row for the value catalogue (DAT-033's home).
5. **BI-I**: check every time the document page opens, in either mode, with no throttle until T3's
   DAT-071? **Recommended: yes**; fifty runs a check is the bound.
6. **BI-M**: a preview refused on an unresolved binding, as a publish is? **Recommended: yes.**
7. **BI-N**: `provenance.json` as an output beside every publication holding a value? **Recommended:
   yes.**
8. **PUB-099 split per stage**, and DAT-012, CNT-039, DAT-048 and DAT-063 moved from this document to
   `tables.md`? **Recommended: yes to both.**
9. **BI-E**: a null value fails, rather than printing a theme's word for nothing? **Recommended: yes**;
   a definition that means "none" can say so in its query.

## What was ruled out

- **A value in the component.** One component serves many documents (data.md, CNT-030).
- **A sample run to show a value outside a document**, or on any opening: a source is queried only when
  a person acts, and a sample's value is no document's.
- **A placeholder anywhere a publish or a preview prints**, and a value from an earlier publication.
- **The publish reading `dataset_take`**: derived data never prints; the object, held to its checksum,
  does.
- **`Intl` and the browser's locale for a value in content**: a document is formatted for its own
  language, the same in every output (LOC-028).
- **Provenance embedded in the PDF.**
- **A revision held in the component, or replacing the resolution.**
- **Marks on a binding in T2.**

## Open questions

| Question                                                                                                                                                 | Where it goes                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| A tenant-wide throttle on checks made by openings                                                                                                        | DAT-071, T3                                                                                         |
| A binding's mode is the component's, so two documents placing one component cannot check one and pin the other. Whether a document should override it    | Ken, once documents share components in earnest; no requirement asks                                |
| Marks on a binding - a bold total, a value in another language - as a member added with a default                                                        | A slice after B6, if authors ask                                                                    |
| Month names, time zones and number formats from locale data                                                                                              | LOC, T6 (LOC-038)                                                                                   |
| A revised value's printing                                                                                                                               | Answered, question 2: not marked in print; marked in the product and in `provenance.json` (DAT-115) |
| The shortcut for **Value**                                                                                                                               | B2's plan, by the registry's check                                                                  |
| Resolving from the session where the node is pinned to an older version: the value placed shows in no document until the node takes a version holding it | B2's plan, which says so in the dialog                                                              |
| The figure's binding member                                                                                                                              | D8's plan (BI-P)                                                                                    |

## Build order

Each slice has a plan of its own, written when its turn comes. **Ken built D4 before this design**;
D5 to D7 can come before or after any of these, and D8 before B6.

| Slice  | What                                                                                                                                                                                                                                                                                                                                                                | Claims                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **B1** | **The value shown.** The editor's node, a component holding a binding opening for editing, the identity fix and cut-and-paste rule; `takeValue`, `formatValue`, the value catalogue and the default theme's 0.6; `dataset_take`; the bindings view's values; values and failures in place in the editor and the read text; the Value panel and the provenance panel | DAT-027, DAT-031, DAT-032, DAT-047, DAT-041, DAT-024, STY-082    |
| **B2** | **Placing and changing.** The Value dialog, resolve from the session, **Keep** and `confirm`, the holders route and the warning on change                                                                                                                                                                                                                           | DAT-022                                                          |
| **B3** | **The publish's binding stage.** The request's refusal and records in place of D3's guard, the worker reading results by checksum, the stage in `assemble`, PDF and Word, the preview, `publication_binding`, `provenance.json` and its route                                                                                                                       | DAT-087, DAT-088, DAT-046, DAT-042, PUB-049                      |
| **B4** | **The Data tab.** Every binding's state, the check on opening, waiting beside held, Accept and its warning, a definition moved on (BI-K), changed since published                                                                                                                                                                                                   | DAT-039, DAT-082, DAT-070, DAT-091 (exercised from D7)           |
| **B5** | **Revisions by hand**, in T3 ([ADR-0036](../decisions/0036-revising-a-bound-value-by-hand-moves-to-t3.md))                                                                                                                                                                                                                                                          | DAT-058, DAT-060, DAT-062, DAT-116; DAT-115 with review's design |
| **B6** | **Bound images**, after D8                                                                                                                                                                                                                                                                                                                                          | DAT-097                                                          |

Then `tables.md`, whose bound table takes the stage, `takeValue`'s key lookup and the value catalogue
from here, and the `templates.md` additions, which resolve a new document's bindings.
