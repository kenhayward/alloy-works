# Lifecycle

What happens to an artifact at the end of its working life, and to a person at the end of theirs
([ADR-0060](../decisions/0060-deletion-is-a-tombstone-and-retention-a-minimum.md)). This design
covers **archival** and **legal holds**, built by [the AH plan](../plans/2026-10-12-ah-archival-and-holds.md),
**deletion** and **retention**, built by [the DL plan](../plans/2026-10-13-dl-deletion-and-retention.md),
and **erasure**, built by [the ER plan](../plans/2026-10-13-er-erasure.md); their decisions are the
detail.

## Requirements owned

| Requirement | How                                                                                   |
| ----------- | ------------------------------------------------------------------------------------- |
| **LIF-020** | Archival, below: out of ordinary listings and search, still retrievable; AH-B to AH-D |
| **LIF-022** | Legal holds, below: placed with who, when and why, removed only by a recorded act     |
| **LIF-023** | Deletion, below: refused by a baseline, a publication or a hold, every reason listed  |
| **LIF-021** | A hold on it or its space refuses deletion; no keep overrides it (DL-C, DL-G)         |
| **LIF-024** | What remains, below, stated and shown before deleting                                 |
| **VER-047** | The chain is kept whole, unreachable, read through the log and what remains           |
| **VER-048** | What remains, below: identity, versions, the audit of them; nothing removed           |
| **VER-044** | A restore naming a component since deleted is refused, naming each (DL-F)             |
| **LIF-019** | Retention, below: a keep per kind, per space, or per kind in a space (DL-G)           |
| **VER-037** | A keep and a hold each refuse deleting anything, a baseline's dependants among them   |
| **VER-038** | Erasure, below: what is erased and what remains, stated and shown before erasing      |

LIF-057's kinds, `artifact.archived`, `artifact.unarchived`, `artifact.deleted`,
`artifact.undeleted`, `hold.applied`, `hold.removed` and `retention.changed`, are
[audit.md](audit.md)'s claim. VER-036, versions kept as long as the tenant keeps its content, is
[storage-and-versioning.md](storage-and-versioning.md)'s: a keep passing expires nothing.

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
still filtered by what the reader may read; the listings' **Archived** filter asks for it. One also
deleted is listed among the deleted, not the archived.

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

**What a hold does**: it is recorded, listed and shown, and refuses deleting what it holds
(Deletion, below). It refuses neither archival nor an undelete.

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

## Deletion

**What deletes**: a component or a document, by whoever may **`retire`** it (DL-A). Assets,
definitions and spaces do not, so a restore never meets a removed asset.

**A tombstone, nothing removed** (0085): `artifact_deletion` holds each act, `deleted` or
`undeleted`, with who and when, insert-only and guarded as archival's is. Deleted while the latest
act is `deleted`.

**Refused** (DL-C), every reason listed, not the first: a baseline pinning any version, superseded
or not; a publication that placed any version, a publish or preview queued to, or a done preview
yet to expire, which still serves it, named by its document, never by the request; a document whose
latest version references it in any mode, a deleted document included, so undeleting one never
revives a dangling reference; a hold on it or its space; a lock held, naming the holder, or saying
it is the deleter's own (`yours`: choose Done editing first); an open
review round; a retention keep yet to pass, saying until when (Retention, below). A document's own
baselines, publications and queued requests refuse it too. A
dependant the deleter may not read is never named or counted: the refusal says only that
something they may not read depends on it too (SCH-032). **Residual**: a refused deletion
unavoidably shows that something depends on it, as ranking may reflect what a reader cannot read
([search.md](search.md)); it never says what, or how many. **The consequence**: anything ever
baselined or published is undeletable; archive it instead.

**What remains** (LIF-024, VER-047, VER-048), stated by `GET .../deletion` and shown before
**Delete**: its identity, every version and its content, iterations, threads, suggestions, rounds
and every audit event, kept and unreachable, and all of it back on **undelete**, which nothing
refuses, a hold or a keep included. Content goes only by erasure. Iterations are the exception:
they still expire by their window (VER-003), deleted or not, and the dialog says so.

**Gone from every reader** (`notDeletedAs`, `search_entry.deleted`): the listings and their facets,
`readableComponents` (so references, numbering, publishing, baselines and comparison), search, the
inbox, Needs your attention, a stream's scope, a definition's where-used, and `mayReference`. By its
id, `authorise` answers **410 `artifact_deleted`** to whoever may read it but for the tombstone and
404 to anyone else; undelete and what remains opt out (`readsDeleted`). `recordVersion` refuses a
version of it under its lock. `GET /v1/changes` reports a deletion and an undeletion as changes. An
older version or a comparison shows a reference to a deleted component as withheld, as one the
reader may not read; showing it as deleted is a gap.

**Races** (DL-D): delete and undelete take the tenant's `alloy-works:deletion` advisory lock
exclusive, then the artifact's; every writer of a dependant takes it shared first - `mayReference`,
a document's restore, `makeBaseline` and `requestPublication` (by `resolvePublishable`), `placeHold`,
`setKeep`, `claimLock`, `takeLock` and `openRound` - so either the dependant is seen or it sees the
tombstone. `saveIteration` needs no check: it needs a lock, which a delete refuses.

**Cost**, to watch in the load suite: the reference check scans every document version that ever
referenced the component, and `isDeleted` adds a lookup to every `authorise` (its `to_regclass`
check asked once per transaction).

**VER-044** (DL-F): `mayReference` answers a component the author may read but for its deletion as
deleted, with its last title; a document's restore lists `reference_deleted` for each such node, the
preview first, the write refusing `409 reference_deleted`.

**Listed** (DL-H): `GET /v1/deleted` lists the deleted components and documents the reader may read
but for the tombstone, the latest deleted first, paged as of the walk's first page, `?kind=` for one
kind; each row says who deleted it, when, and `mayUndelete`, `retire` decided per row. The listings'
Status filter offers **Deleted** beside **Archived**, each the one way to list its own, with
**Undelete** on each row for whoever may.

**Audited** (LIF-057): `artifact.deleted` and `artifact.undeleted`, about the artifact, with its
space.

## Retention

**A keep is a minimum, never an expiry** (ADR-0060): the least time, in days, a component or a
document is kept before it may be deleted, counted from its latest version. Nothing is ever deleted
because a keep has passed.

**Declared** by an administrator of the environment, `administer` at the tenant (a space's
administrator refused, an external one capped, a token scoped to it), for a kind (component or
document, not a component type), a space, or a kind in a space. Every keep reaching an artifact
applies, and the longest wins; a hold stands whatever the keep (LIF-021).

**Stored insert-only** (0086, `packages/db/src/keeps.ts`): `retention_keep` keeps each change, the
latest row per (kind, space) in force and null days clearing it, under the shared deletion lock
then the keeps' own. Setting what is in force records nothing.

**Where it shows**: Administration > **Retention** lists the keeps in force, by kind and by space,
and sets or clears one (`GET` and `PUT /v1/retention`). The Delete dialog says a keep refuses it
and until when.

**Audited** (LIF-019): `retention.changed`, `{ kind, space, days }`, days null where cleared, with
the space.

## Erasure

**What erases** (ER-A, ER-C): a person, by an administrator of the environment, `administer` at the
tenant (a space's administrator refused, an external one capped, a token scoped to it), never
themselves or a service, and refused while any grant names them: their access is removed first.
`packages/db/src/erasure.ts`; `GET /v1/principals/{id}/erasure` states it, `POST .../erase` does it.

**What is erased**, in one transaction: their sessions ended, their tokens revoked, their provider
and own memberships removed, the accepted invitation's row (it holds their address) deleted, any
Google hand-off dropped; `display_name` becomes **Erased person**, `email` null, `email_verified`
false, `erased_at` set (0087); last, `erase_labels` gives every audit label naming them a fixed word,
those the act's own events wrote among them. Somebody invited who never signed in is withdrawn, and
so goes whole. Every reader of a name shows the fixed word; `principalLabel` names them nothing, the
people picker leaves them out, and a user value naming them reads as an inactive user.

**What remains** (VER-038, ER-B), stated by the preview and shown before **Erase**: their id, and the
issuer's pseudonymous subject for them, so every reference, author, thread, grant and event still
holds; every event recorded against the id, readable by the fixed word; content, titles, comments and
messages they wrote, their name included wherever somebody typed it ([ADR-0060](../decisions/0060-deletion-is-a-tombstone-and-retention-a-minimum.md):
LIF-Q03 stays open for them); a dataset version's record of how a source saw them (`asSeen`,
immutable content), which the bindings view no longer shows for an erased person; audit exports made
before; and the erasure's own event.

**Never again** (ER-D): a sign-in by an erased person's issuer and subject is refused
`403 principal_erased`, recorded as a failed sign-in naming nobody, before their claims touch the row;
`principal_erased_stays` (0087) refuses any change to an erased row's name, address or identity, the
owner's included. A new identity is a new person.

**Races**: the act takes the access epoch, then the invitation's row, then the principal's, as a
claim takes them; a sign-in holds the principal's row `FOR UPDATE` to look them up, and holds it
`FOR SHARE` after any epoch lock before it makes a session. Either the act waits and ends the session,
or the sign-in waits and is refused.

**Audited**: each session, token, membership and withdrawal as its own kind, then
`audit.label_erased`, `{ labels }`, about the person by id, naming the administrator and nobody erased.
