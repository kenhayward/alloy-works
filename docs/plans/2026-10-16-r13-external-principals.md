# R13: External principals

> T4's thirteenth slice, extending [access.md](../design/access.md) and
> [collaboration.md](../design/collaboration.md) under
> [ADR-0011](../decisions/0011-external-participation-guests-and-identified-links.md). **Full tier**:
> auth and tenancy, migration 0109, a contract change. Built inline, one final review at the slice's
> end. Decisions marked **(default)** are recommendations Ken may overturn; the rest are his answers
> of 2026-10-16.

**Goal:** a person from outside the tenant is said to be so wherever they appear; a review round can
name one; a thread can be kept from them; their access is extended only by an audited act; and an
administrator lists everyone from outside and what each can reach.

Already built (T1): `principal.kind` with `external`, the capability cap (IAM-047, IAM-057), the
mandatory and capped expiry (IAM-049), grants on named artifacts only (IAM-071), external
invitations. Left out (Ken): changing a principal's kind, and publication shares (PUB-058, PUB-060,
PUB-084).

| PR   | Holds                                                                                      |
| ---- | ------------------------------------------------------------------------------------------ |
| R13a | This plan; external shown everywhere (IAM-045); external reviewers (COL-059)               |
| R13b | Internal threads (0109), kept from external principals in reads, the inbox and search      |
| R13c | Extending external access (IAM-050); the external listing (IAM-051); final review; 0.184.0 |

## Decisions

| ID    | Decision                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R13-A | **Outside, beside the name** (IAM-045; Ken's answer): every person view the API returns - presence, a lock's holder, a thread's and a comment's author, a suggestion's, a round's reviewers, the people picker, inbox senders - gains `external: true` where the principal is so, absent otherwise. The page draws an **Outside** chip beside the name, said "from outside the organisation". |
| R13-B | **External reviewers** (COL-059): a round may name an external principal who may comment on or suggest to the document and reads all it covers, as for an internal one. What they may then do stays the cap's (IAM-047).                                                                                                                                                                      |
| R13-C | **Internal threads** (COL-038; Ken's answer): chosen when a thread is started, and an open thread may later be made internal, never public again. 0109's `thread_internal` (thread, marked by, at) is insert-only; marking is audited. Internal by default where the artifact has a reader from outside (default).                                                                            |
| R13-D | **Kept from outside** (COL-038, SCH-072, COL-036): an external principal is never shown an internal thread or its comments - listing, reading, replying, counts, the inbox, notifications, live events and search. Search filters a thread by whether it is internal for anybody else.                                                                                                        |
| R13-E | **Extending** (IAM-050; Ken's answer): a new grant whose `extends` names the old, its expiry no later than the tenant cap from now, made by somebody inside the tenant who may administer where the grant stands; audited with both expiries. `POST /v1/grants` also takes `expiresAt`. The old grant lapses as it would.                                                                     |
| R13-F | **The external listing** (IAM-051): `GET /v1/access/external`, `administer` at the tenant: each external principal, each grant reaching them (direct or by a group) with its level and expiry, and what they may read. The People admin page shows it.                                                                                                                                        |

## Tasks

- **R13a**: domain and contract person views; db reads joining `kind`; the chip in presence, threads,
  suggestions, rounds and the people picker. `openRound` admits external reviewers. Tests per place.
- **R13b**: 0109; start and mark; every thread read, count, notification, live event and search entry
  filtered for an external principal; the page's Internal choice and its mark. Tests that an external
  principal sees none of it, by every route.
- **R13c**: the extension route and `expiresAt`; the audit detail; the listing route and page. The
  final review hunts an internal thread or an over-long grant reaching outside. The close: 0.184.0.
