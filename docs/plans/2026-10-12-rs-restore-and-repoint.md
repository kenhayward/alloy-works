# RS: Restore, and the audited re-point

> T3's eighth phase, its first slice ([ADR-0057](../decisions/0057-t3s-order-and-template-moves-leave-for-t9.md),
> [ADR-0060](../decisions/0060-deletion-is-a-tombstone-and-retention-a-minimum.md)), designed in
> [storage-and-versioning.md](../design/storage-and-versioning.md) and
> [component-editor.md](../design/component-editor.md). **Full tier**: a stored shape (migration 0082)
> and new routes; a pre-flight review (its findings folded in) and a final review. Ken asked for the
> run on 2026-10-12; decisions marked **(default)** are recommendations he may overturn.

**Goal:** an author restores an earlier version of a component or a document, after seeing what it
would produce, as a new version saying what it came from; and changing which version a document's
reference takes is audited from and to (VER-032, VER-033, VER-035, CNT-170, CNT-182).

| PR  | Holds                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------ |
| RS1 | This plan and the design; a component's restore end to end: stored, answered, in its Versions panel (Task 1) |
| RS2 | A document's versions, their comparison and restore; the audited re-point; the close (Task 2)                |

## The challenge

**CNT-161 asked for "version or revision", and choosing a revision is T9's** (CNT-159). Ken agreed
the split: **CNT-182**, which version a reference takes, T3, built here; **CNT-183**, which revision,
T9.

## Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RS-A | **What restores** (default): a component or a document, by `edit` on it, the handler deciding `read` too (a deny on read stands beside an allow on edit). Other kinds wait for their own panels.                                                                                                                                                                                                                                                                                                                                                                     |
| RS-B | **A restore is a new version** (VER-032) whose content is the earlier version's as read now (`readContent`, `readOutline`: migrated to today's schema, so its digest may differ from its source's) and whose values are the earlier version's carried forward over the definitions current now (`carryForward`, MET-018), refused only on a `fixed` failure, as a cut is. It is the one version not promoted from an iteration (VER-006's exception, named in the design). Numbered after the latest; it designates nothing, so `approved` references are untouched. |
| RS-C | **`restored_from`** (VER-033; migration 0082): nullable, `(restored_from, artifact_id, kind)` keyed to `artifact_version (id, artifact_id, kind)`, `on delete restrict`, never itself; authorship, not in the digest; named on insert only when set. Audited `content.restored` `{ kind, from }` on the new version, beside `content.version_cut`.                                                                                                                                                                                                                   |
| RS-D | **Preview and write share one resolver** (VER-035): `GET .../versions/{version}/restoration` answers what it would make - the comparison with the latest, the values not carried, the refusals - inserting nothing; `POST .../versions/{version}/restore` names the latest it was previewed against and answers `version.precondition` if that has moved. Unreadable components' titles withheld.                                                                                                                                                                    |
| RS-E | **Refused**, said with why: `restore.unchanged` (the result equals the latest, which also covers restoring the latest); `restore.locked`, a component anybody holds the lock on, the restorer included ("Done editing first") (default: an open session is never broken by a version cut under it); `restore.unreadable`, a source that no longer reads; `fixed` values; for a document, `editOutline`'s guards over the whole result (RS-F).                                                                                                                        |
| RS-F | **A document's restore** brings back its outline, references and their modes as they stood, under `editOutline`'s guards: `mayReference` for each reference new or re-pointed against the latest, the template's rules over the whole outline, `checkWrittenValues` for section values; parameters carried as they stand now (TP1-E) (default). A reinstated node returns with what is keyed to it (threads, binding revisions).                                                                                                                                     |
| RS-G | **The re-point** (CNT-182): the outline's `set` changing a reference's mode, and a document's restore, record `reference.repointed` `{ node, component, from, to }` (modes) in the version's transaction. Insert, remove and move are not re-points; a `latest` reference meeting a newer version is not an act.                                                                                                                                                                                                                                                     |
| RS-H | **The UI**: the component's Versions panel offers **Restore** on each earlier version, with the existing comparison, the values not carried and any refusal, then **Restore this version**; a restored version reads "Restored from version N". RS2 adds a document's versions (`GET /v1/documents/{id}/versions`), an outline comparison of a version with the latest (`compareOutlines`, `withholdComponents`) and the same panel on its page.                                                                                                                     |
| RS-I | **VER-044 waits for DL**: until something can be deleted, everything a restored version references still resolves. Recovery's restore of iterations and a space's Restore keep their names; undoing a tombstone (DL) takes another.                                                                                                                                                                                                                                                                                                                                  |

## Task 1: A component's restore - RS1

- Migration 0082; `packages/db/src/restore.ts`; the component routes, the contract, its documentation
  and the sweeps; **Restore** in the component's Versions panel.
- Tests: a new version naming its source, the earlier row untouched; values carried forward; the
  preview inserts nothing and matches the write; each refusal; the precondition; audited; the panel.

## Task 2: A document's restore, the re-point, and the close - RS2

- A document's versions, comparison and restore under `editOutline`'s guards; `reference.repointed`.
- Tests: the panel; each guard; each re-pointing act audited from and to; axe in Light and Dark; the
  whole browser suite.
- The final review hunts a restore that loses or invents content, that escapes a guard, and a
  re-point not audited. `features.md`, `README.md`, `architecture.md`, the CHANGELOG, the version
  (0.160.0) and the baseline.

## Changed while building

| Where | Planned                                      | Built, and why                                                                                                                                                                   |
| ----- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRs   | Two                                          | Two, #585 and #586                                                                                                                                                               |
| RS-A  | Read of the version decided                  | `authorise` decides read beside edit; the preview is decided on `edit`, as it previews a write                                                                                   |
| RS-C  | A component's preview answers the comparison | The panel asks the existing comparison from the preview's latest; a document's preview carries its outline comparison, titles per side                                           |
| RS-E  | Locks                                        | A document has no lock (COL-N02): each outline act is its own version under the artifact's advisory lock, so nothing is cut under an open session                                |
| RS-E  | The save's checks                            | A component's restore runs them too (`storable`, `namesUnreadableColumn`) through the resolver's `check` hook, in the preview and the write (the final review, 1)                |
| RS-F  | Parameters carried                           | Parameters carried as they stand; the document's own values and each changed section's restored through `writtenValues`, as every values write stores them (the final review, 2) |
| RS-H  | The panels                                   | A document's Versions panel sits before Publishing, which End still reaches; both post the preview's latest (the final review, 3)                                                |

## Final review

Fixed: a component restore skipping the save's content checks, so a column of an unreadable query
definition came back (1); a document's values stored raw, dropping a fixed value added since (2); both
panels posting the list's head, looping on a refusal (3); carried values that change unshown (4);
Restore missing until the editor mounted (5); a double click posting twice (6); one title per node
across both sides (7); status lines not announced (8); titles citing beyond their tests, and untested
branches (9). Left: `content_invalid` and the changed values' field names tested in the db suite
only; a node on both sides shows the restored side's title, as the baseline comparison does.
