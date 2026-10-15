# WF6: Template governance

> T9's sixth phase ([ADR-0061](../decisions/0061-t9s-order.md); moved here by
> [ADR-0057](../decisions/0057-t3s-order-and-template-moves-leave-for-t9.md)), extending
> [templates.md](../design/templates.md). **Full tier**: migrations 0100 and 0101, stored shapes, new
> routes. Built inline, one final review at the phase's end (Ken, 2026-10-14). Decisions marked
> **(default)** are recommendations Ken may overturn.

**Goal:** a document lists how it departs from its template; a section its template requires is
removed only with a reason, kept on the document; and a document moves to its template's newest
version as an explicit, audited act, previewed with everything it will change and abandonable there
(TPL-028, TPL-029, TPL-033, TPL-034, TPL-058).

| PR   | Holds                                                                                    |
| ---- | ---------------------------------------------------------------------------------------- |
| WF6a | This plan; departures; a required section removed with a reason (0100) (Task 1)          |
| WF6b | Moving to a newer template version (0101); the final review; the close, 0.171.0 (Task 2) |

## Decisions

| ID    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WF6-A | **Departures** (TPL-028): a pure `departures(definition, outline, waived)`: each section the document has that its template does not (no `origin`, or one the template no longer names), and each template section it lacks, required or not, with the reason where one was given. On the document's view, beside the template's name and version, only to a reader of the template.                                                                                                                                                                    |
| WF6-B | **A reason to remove a required section** (TPL-029): the outline's `remove` takes an optional `reason`; removing a subtree holding a section whose `origin` is a required key needs one (`section.reason_required`). Insert-only `section_waiver (document_id, key, reason, version_id, by, at)` (0100) keeps it, audited `section.waived { key }`, the reason on the row as a rejection's is (LIF-053). A waived key is no longer missing (TPL-013 at publish, `sections` at a gate). A restore removing one is refused the same way: remove it first. |
| WF6-C | **A move is to the template's latest version** (TPL-033): `POST /v1/documents/{id}/template-moves { latest, to }` on edit and the template's read, against the version the author saw; insert-only `document_template_move (document_id, template_id, from, to, version_id, by, at)` (0101), the latest the document's binding, `document_template` its first. Audited `template.moved`. Never forced: refusable by not taking it, and refused where nothing would change.                                                                              |
| WF6-D | **The report first** (TPL-034, TPL-058): `GET .../template-moves/preview?to=` answers what the move changes, from one resolution the move repeats: the theme and the layout, each field assigned or no longer assigned at document and section level and each whose requiredness changes, each value that would not be carried forward (by node, `carryForward`), and each section the newer version requires that the document lacks. The author takes it or leaves it; nothing is recorded by the preview.                                            |
| WF6-E | **The outline is not restructured** (default): a move records a new document version carrying its values forward and changes its binding; a section the newer version requires is reported, to be added or waived before a publish.                                                                                                                                                                                                                                                                                                                     |
| WF6-F | **TPL-058, challenged and claimed** (default): fields resolve at their current definitions (TE-K), so a changed schema or field already applies without a move, which is therefore never needed for one; a move brings the template's assignments forward, and the report names each field that changes and each value not carried, as MET-036 asks. Pinning field versions per document (TPL-056, TPL-057) stays unbuilt.                                                                                                                              |

## Task 1: Departures and required sections - WF6a

- Domain: `departures`, `remove.reason`, `OutlineRules.required`. 0100; `section_waiver`; `editOutline`
  and restore; `missingSections` skipping waived keys. The view's `template` name, version and
  `departures`; the page's template line, its departures and the remove dialog's reason.
- Tests: departures each way; removal refused without a reason and recorded with one, audited; a
  waived key not refused at publish; restore refused; the page.

## Task 2: Moving forward - WF6b

- 0101; `template-move.ts` (resolve, preview, move) after restore's; the binding read through moves; the
  routes; the page's **Move to version N** with its report.
- Tests: the report's every kind of change; the move recorded, audited, its values carried; refused
  stale, unchanged, or to a version not the latest; the binding read after. The final review hunts a
  value lost unreported, a move by somebody who may not read the template, and a waiver dropped. The
  close: 0.171.0.
