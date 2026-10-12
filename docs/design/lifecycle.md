# Lifecycle

What happens to an artifact at the end of its working life, short of deletion
([ADR-0060](../decisions/0060-deletion-is-a-tombstone-and-retention-a-minimum.md)). This design
covers **archival** and **legal holds**, built by [the AH plan](../plans/2026-10-12-ah-archival-and-holds.md),
whose decisions are the detail. Deletion is DL's.

## Requirements owned

| Requirement | How                                                                                   |
| ----------- | ------------------------------------------------------------------------------------- |
| **LIF-020** | Archival, below: out of ordinary listings and search, still retrievable; AH-B to AH-D |
| **LIF-022** | Legal holds, below: placed with who, when and why, removed only by a recorded act     |

LIF-057's kinds, `artifact.archived`, `artifact.unarchived`, `hold.applied` and `hold.removed`, are
[audit.md](audit.md)'s claim. LIF-021 and LIF-023 (a hold refuses deletion) are DL's.

## Archival

**What archives**: a component or a document, by whoever may **`retire`** it, decided at the artifact
by the usual walk. Administrator holds `retire`: 0083 gave it to the role named Administrator,
matched by name, whatever its permissions had become, and to no role renamed from it. An external
principal never does, whatever the grants say (`externalCap`), and a token must be scoped to it. A connection's and a query definition's
**Retire** are their own acts and stay under `administer`; a space's archive is its own act too and
archives nothing in it.

**Archival hides; it does not freeze.** An archived artifact still opens by its id and link, still
resolves where a document references it, still publishes and still edits. A document's publications
are not archived with it. Its page and its row in the Archived listing say **Archived**; a reference
to it does not.

**Stored insert-only** (0083): `artifact_archival` holds each act, `archived` or `unarchived`, with
who and when, keyed to a component or a document by `(artifact_id, kind)`. An artifact is archived
while the latest act a snapshot sees is `archived`. Each act is taken under the artifact's advisory
lock; archiving the archived, or unarchiving the live, changes nothing and records nothing, and a
trigger refuses an act equal to the one before it. No reason is kept: it would be shown nowhere.

**Where it filters** (`packages/db/src/archival.ts`, `notArchivedAs`), and nowhere else:

| Left out                                                              | How                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `GET /v1/components` and `GET /v1/documents`, their facets and totals | the latest act as of the walk's snapshot, so a walk pages as begun |
| The component pickers, which read the component listing               | the same                                                           |
| Home's counts and Needs your attention ([home.md](home.md))           | the listings' totals; the attention queries                        |
| Search, its facets and counts ([search.md](search.md))                | `search_entry.archived`, set by the acts and by indexing           |

**Where it does not**: the shared readable set (`readableArtifacts`), so references, the outline,
the inbox, baselines and publishing read archived content as before; and `GET /v1/changes?space=`
(`packages/db/src/changes.ts`), which reports changes, and an archived artifact's are still changes. Indexing reads the flag, so an
edit of an archived artifact does not bring it back into search.

**Listed alone when asked**: `?archived=only` on either listing lists the archived and nothing else,
still filtered by what the reader may read; the listings' **Archived** filter asks for it.

**Audited** (LIF-057): `artifact.archived` and `artifact.unarchived`, about the artifact, with its
space.

## Legal holds

**Who**: an administrator of the environment, `administer` decided at the tenant itself, places,
releases and lists holds; a space's administrator does not, nor does a token not scoped to it.

**On what**: a component, a document, a publication or an asset, or a space, which holds every
artifact in it while the hold stands. Several holds may stand on one thing. A baseline is not held of
itself: it is its document's, which a hold on the document or its space covers.

**Stored insert-only** (0084): `legal_hold` keeps each hold, on an artifact by `(artifact_id, kind)`
or on a space, never both, with its reason (trimmed, never empty), who and when; `legal_hold_release`
keeps its release, once by its key, with a reason of its own, who and when. Nothing is updated or
deleted; a hold is in force while it has no release. A release is taken under the hold's advisory
lock, so two at once record one; a second is refused (`hold_released`).

**What a hold does now**: it is recorded, listed and shown. Nothing deletes yet; DL makes a hold
refuse deletion. A hold does not refuse archival.

**Where it shows**: Administration > **Legal holds** lists every hold, newest first, with what it
holds, who placed it, when and why, and its release, and offers **Release** on one in force. That
listing, `GET /v1/holds`, and the answers to placing and releasing are the only places a reason is
shown; it is never written to the audit log (LIF-030). **Place a hold** is offered on a component's
and a document's page and on a space's row in Spaces, to environment administrators alone, each
asking why. A component's and a document's view say `onHold` only to whoever may `retire` it or
administer the environment, false to anyone else: a hold may be confidential. Its page then shows
**On hold**. Legal holds names what each holds by its title now - a publication by its document's
title at the version published, an asset by its alternative text - whether or not the administrator
may read it, as [audit.md](audit.md) does: administrators may read everything, and the audit log
shows the same labels.

**Audited** (LIF-057): `hold.applied` and `hold.removed`, `{ hold }` its id, about the artifact or the
space it holds, with its space.
