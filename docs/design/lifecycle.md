# Lifecycle

What happens to an artifact at the end of its working life, short of deletion
([ADR-0060](../decisions/0060-deletion-is-a-tombstone-and-retention-a-minimum.md)). This design
covers **archival**, built by [the AH plan](../plans/2026-10-12-ah-archival-and-holds.md), whose
decisions are the detail. Legal holds are AH2's; deletion is DL's.

## Requirements owned

| Requirement | How                                                                                   |
| ----------- | ------------------------------------------------------------------------------------- |
| **LIF-020** | Archival, below: out of ordinary listings and search, still retrievable; AH-B to AH-D |

LIF-057's kinds, `artifact.archived` and `artifact.unarchived`, are [audit.md](audit.md)'s claim.

## Archival

**What archives**: a component or a document, by whoever may **`retire`** it, decided at the artifact
by the usual walk. Administrator holds `retire`; an external principal never does, whatever the
grants say (`externalCap`), and a token must be scoped to it. A connection's and a query definition's
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
the inbox, baselines and publishing read archived content as before. Indexing reads the flag, so an
edit of an archived artifact does not bring it back into search.

**Listed alone when asked**: `?archived=only` on either listing lists the archived and nothing else,
still filtered by what the reader may read; the listings' **Archived** filter asks for it.

**Audited** (LIF-057): `artifact.archived` and `artifact.unarchived`, about the artifact, with its
space.
