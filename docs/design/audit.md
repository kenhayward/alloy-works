# Audit

The tenant's audit log: one record of who did what, to which version, and when - every act that
changes something, every sign-in and every refusal - kept beyond the things it describes, readable by
the environment's administrators and exported whole.

This realises the audit half of [LIF](../specification/requirements/LIF-lifecycle-workflow-and-audit.md),
with IAM's authentication and token records and ADM's reading and export of the log, the first T3
design ([ADR-0045](../decisions/0045-t3-is-the-collaboration.md)). It rests on the tenant's own
schema ([service-foundations.md](service-foundations.md), ADR-0008), the version chain
([storage-and-versioning.md](storage-and-versioning.md)), the access model and its routes
([access.md](access.md)), and the job queue. The designs that wait on it - access.md, data.md,
bindings.md, assets.md, component-editor.md, metadata.md, themes.md, relationships.md and
document-view.md - each emit the event types named [below](#event-types) as their acts are built.

> **Not built.** Built in two slices, [below](#build-order).

## The shape in one paragraph

An **event** is an insert-only row in the tenant's schema: a per-tenant **sequence**, a UTC instant,
a **kind** from a closed list in `packages/domain`, the **actor** (a person by session or by token,
the system, or the vendor), the **subject** (an artifact or other thing by kind and id, with the
version acted on), the **space**, an **outcome** (done or refused), a **detail** of identifiers, field
names, codes and rules - never a value, a credential or content - and the request's trace id. The
**labels** the event needs to be read after its subject or actor is gone - a title, a name, a space's
name - are kept beside it in a companion table, the only part of the log an erasure may later change.
**An act and its event commit in one transaction**, so neither exists without the other; **a refusal**
is written in a transaction of its own, since the refused act commits nothing. Nothing in the product
updates or deletes an event, by the schema's own grants. The environment's administrators read it,
filtered by actor, kind, date and subject, and export it whole as a job.

## Requirements owned

| Requirement | How                                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LIF-026** | The closed list of [event types](#event-types) holds every kind LIF-026 names; each act's design emits its own                                                                   |
| **LIF-027** | Every event has its actor, kind, instant, subject and the subject's version where it has one                                                                                     |
| **LIF-028** | `GET /v1/audit` queries it; an export is complete as of a sequence, written by a job                                                                                             |
| **LIF-032** | `sequence` is a per-tenant identity, monotonic in commit order of its assignment; order is read by sequence, never by time ([Order](#order))                                     |
| **LIF-056** | The log is under no retention policy in T3: kept for ever, never shorter than anything it describes ([Retention](#retention))                                                    |
| **LIF-057** | Hold applied and removed, archival, deletion and gate rejection are kinds of their own                                                                                           |
| **LIF-064** | API and tool use on a governed artifact, generation, a bound value revised, relationships, assets, shared-publication access, support access and channels are kinds of their own |
| **LIF-025** | Insert-only by the schema's grants and a guard trigger; no route changes or deletes an event ([Kept as written](#kept-as-written))                                               |
| **LIF-029** | An event and its labels read without the content they describe, which may be gone                                                                                                |
| **LIF-030** | Detail holds identifiers, field names, codes and rules; never a secret, a credential, a bound value or content                                                                   |
| **LIF-031** | One table in each tenant's schema; no event of one tenant is readable from another                                                                                               |
| **LIF-062** | `at` is `timestamptz`, UTC; `detail.offset` keeps a local offset where local time is part of the act                                                                             |
| **LIF-063** | Every kind names the requirement it answers, and each emitter's test asserts the event lands with actor, kind, instant and version ([Verification](#verification))               |
| **IAM-013** | Every sign-in, failed sign-in and sign-out, and every refused authorisation of someone signed in, is an event                                                                    |
| **IAM-037** | A token's issue and revocation are events, and its use is, once a minute per token                                                                                               |
| **IAM-060** | Provisioning writes the vendor's naming of the first administrator into the tenant's own log, and the claim of it                                                                |
| **IAM-077** | The log is the tenant's, read only through its own schema                                                                                                                        |
| **ADM-002** | Every administrative act - spaces, grants, roles, groups, invitations, connections - is an event                                                                                 |
| **ADM-038** | Administration's **Audit log** reads and searches it by actor, kind, date and subject                                                                                            |
| **ADM-039** | An administrator exports it, complete and scoped to the tenant                                                                                                                   |
| **DAT-007** | A connection made, changed (naming the fields changed), its credential set, tested or retired is an event; the credential's value never is                                       |

**Not claimed:** DAT-013 (its review half is review.md's); LIF-055, LIF-034 and LIF-035 (T7, ADR-0045:
the export leaves room for a signature over its sequence); IAM-070 (T7, an audit-reader permission);
the workflow, approval, hold, deletion and generation events, whose kinds are listed here and whose
emission is their own designs'.

## The event

```sql
audit_event (
  sequence        bigint generated always as identity primary key,
  at              timestamptz not null default now(),
  kind            text not null,            -- the closed list, checked
  actor_kind      text not null,            -- person | token | system | vendor
  actor           uuid,                     -- the principal, for person and token
  token           uuid,                     -- the token, for token
  subject_kind    text,                     -- an artifact kind, or space, grant, role, group, token, session, ...
  subject         uuid,
  subject_version uuid,                     -- the artifact version acted on, where there is one
  space           uuid,                     -- the space acted in, where there is one; no foreign key
  outcome         text not null,            -- done | refused
  detail          jsonb not null default '{}',  -- strict per kind, checked in the domain
  trace_id        text                      -- X-Request-Id (API-047)
)
audit_label (
  sequence        bigint references audit_event,
  role            text,                     -- actor | subject | space | target ...
  text            text not null,            -- a name or title as it was
  erased_at       timestamptz,              -- set by an erasure act, text then a fixed word
  primary key (sequence, role)
)
```

- **No foreign keys to what an event describes**: the subject, the actor and the space may be deleted
  or erased, and the event stays (LIF-029, VER-048). Ids are kept; labels make them readable.
- **Labels** (Ken, 2026-10-08): every event keeps the names and titles needed to read it once its
  originals are gone - the actor's name, the subject's title, the space's name, a grant's role and
  grantee. **Erasure** (VER-038) of a person replaces their labels' text with a fixed word and sets
  `erased_at`, by an act that is itself an event; nothing else ever changes a label.
- **Detail is strict per kind**, a zod shape in `packages/domain/src/audit/`: a version cut names its
  version and parent; a connection change the fields changed; a refusal its permission, target, wire
  code and rule; a grant its role, level and effect. No free text a person typed, other than labels.

## Event types

A closed list in `packages/domain/src/audit/kinds.ts`, each naming the requirement it answers
(LIF-063); a kind added is a code change and its check. **Emitted from AU1**, for acts that exist:

| Kind                                                                    | Emitted by                                                         | Requirement      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------- |
| `authentication.signed_in`, `.sign_in_failed`, `.signed_out`            | the sign-in routes, sign-out                                       | IAM-013          |
| `access.refused`                                                        | every refused authorisation of a signed-in principal               | IAM-013, LIF-026 |
| `access.granted`, `.revoked`                                            | grants made and removed                                            | ADM-002, LIF-026 |
| `group.member_added`, `.member_removed`                                 | group membership                                                   | ADM-002          |
| `invitation.sent`, `.accepted`, `.withdrawn`                            | invitations                                                        | ADM-002          |
| `tenant.administrator_named`, `.administrator_claimed`                  | provisioning, the first sign-in                                    | IAM-060          |
| `token.issued`, `.used`, `.revoked`                                     | API tokens; `used` at most once a minute per token                 | IAM-037          |
| `space.made`, `.renamed`, `.archived`, `.restored`                      | SP1's acts                                                         | ADM-002, ADM-049 |
| `content.version_cut`                                                   | every version of every artifact kind; never an iteration (VER-005) | LIF-026          |
| `connection.made`, `.changed`, `.credential_set`, `.tested`, `.retired` | connections                                                        | DAT-007          |
| `binding.resolved`, `.checked`, `.accepted`, `.confirmed`               | bindings                                                           | LIF-026          |
| `dataset.named`                                                         | a dataset's name                                                   | LIF-026          |
| `publication.requested`, `.produced`, `.failed`                         | publishing                                                         | LIF-026          |
| `export.produced`, `.downloaded`                                        | an audit export (AU2); others as they arrive                       | LIF-026          |
| `audit.label_erased`                                                    | erasure of a person's labels                                       | VER-038          |

**Declared now, emitted by the design that builds the act:** `workflow.transitioned`,
`approval.given`, `approval.rejected`, `gate.rejected` (LIF-053: never `access.refused`),
`hold.applied`, `hold.removed`, `artifact.archived`, `artifact.deleted`, `revision.designated`,
`baseline.made`, `baseline.superseded`, `content.restored`, `reference.repointed` (CNT-161),
`lock.taken` (COL-009), `suggestion.accepted`, `suggestion.rejected` (COL-024), `template.moved`
(TPL-033), `binding.revised` (DAT-058), `relationship.*`, `asset.*`, `generation.*`,
`publication.shared_accessed`, `support.*`, `channel.changed`, `tool.used`. A design emitting one
cites it in its tests.

## Writing

- **`recordEvent(trx, event)`** (`packages/db/src/audit.ts`), in the act's own transaction, after the
  act's write and before commit: an act and its event commit together or not at all. Labels are
  written with it, read from the rows the act already holds.
- **A refusal** has no transaction that commits. The service's refusal path writes `access.refused`
  in a short transaction of its own, after the act's has rolled back, for a principal it has
  identified; a failure to write it is logged and does not change the answer. An anonymous request
  that never named anyone is not recorded (Ken, 2026-10-08). **A 404 that hides an existing item is
  recorded as the refusal it is**, readable only by administrators, who may read everything.
- **No IP address or user agent** (Ken, 2026-10-08): the trace id joins an event to the service's own
  logs where an investigation needs them.
- **Acts that delete their own history** write their event first: revoking a grant or a token, signing
  out, restoring a space (which clears `archived_by`), and a sweep ending sessions (`system` actor).
- **No NOTIFY per event**: the log is not on the realtime stream in T3.

## Order

`sequence` is a tenant-wide identity: monotonic, so two events read in sequence order are in the order
their sequences were taken; a rolled-back act leaves a gap, which LIF-032 permits - it asks for order,
not density. `at` is for people; order is the sequence's. A gapless counter would serialise every
writing act in the tenant on one row, and is ruled out. LIF-055's hash chain (T7) runs over sequence
order and is computed at export, so it needs nothing stored now.

## Kept as written

The migration revokes `update`, `delete` and `truncate` on `audit_event` from the service's login, as
the version chain's does, with a trigger refusing an update for anyone else; `audit_label` grants
`update (text, erased_at)` alone, to an erasure function the service calls. Nothing deletes from
either. **This is policy enforced by the database, not write-once storage** (LIF-Q02): an operator with
the owner's role could still alter a row, which LIF-055's signed export (T7) is for.

## Retention

Kept for ever in T3: nothing in the product deletes an artifact yet, and the log must outlive what it
describes (LIF-056). When LIF-019's retention policies arrive, the log's is declared as at least the
longest of them, and a legal hold (LIF-021) holds its events too.

## Reading and export

| Route                        | Permission                 | Does                                                                                                                                                                                  |
| ---------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/audit`              | `administer` at the tenant | Events newest first by sequence, filtered by `actor`, `kind` (or a prefix), `from`, `to`, `subject` and `space`, a page at a time by a cursor over the sequence, each with its labels |
| `POST /v1/audit/exports`     | `administer` at the tenant | Queues an export of every event matching the filters up to the newest sequence now: a job writes JSON Lines to the tenant's store; `export.produced`                                  |
| `GET /v1/audit/exports/{id}` | `administer` at the tenant | The export's state, and its download once made; `export.downloaded` on each download                                                                                                  |

- **Reading is not itself an event** (volume); exporting and downloading are.
- **Administration's Audit log** shows the events with their labels, the filters, and Export.
- A token holding `administer` reads it as a person does, its scopes masking as everywhere (TK-A).

## Failures

| Failure                | Meaning                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| `audit_filter_invalid` | A filter the query cannot take: an unknown kind, a date out of order |
| `export_not_ready`     | A download asked of an export still running                          |

## Verification

- `packages/domain`: every kind's detail shape, refusing a value where only a name belongs; the list
  of kinds complete against the table above.
- `packages/db`: an event commits with its act and rolls back with it; a refusal's event survives the
  act's rollback; update, delete and truncate refused; a label erased and nothing else changed; the
  sequence monotonic across concurrent writers.
- `apps/service`: **each emitter's test asserts its event** - kind, actor, subject, version, outcome
  and labels (LIF-063) - and that its detail holds no value; the reading route's filters and paging;
  an export complete as of its sequence; permissions; another tenant's events unreachable.
- `apps/web`: the Audit log page and its filters; axe.

## Decisions

| ID   | Decision                                                                                                   | Instead of                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| AU-A | **One table of events, a closed list of kinds in the domain**                                              | A table per kind, which every reader would union                                               |
| AU-B | **In the act's transaction**; a refusal in its own                                                         | An outbox, which an act can commit without                                                     |
| AU-C | **A tenant identity for order, gaps allowed**                                                              | A gapless counter serialising every act                                                        |
| AU-D | **Labels kept beside events, erasable alone** (Ken: keep names and titles for when the originals are gone) | Ids only, unreadable after deletion; names in the event, which erasure could not reach         |
| AU-E | **Refusals of identified principals and failed sign-ins only** (Ken)                                       | Every anonymous request                                                                        |
| AU-F | **No IP or user agent** (Ken); the trace id instead                                                        | Personal data no requirement asks for                                                          |
| AU-G | **Environment administrators read and export** (Ken); IAM-070's separate permission is T7                  | Space administrators reading their spaces' events, which would need per-event access decisions |
| AU-H | **Policy by grants and triggers**; the signed export is T7                                                 | Write-once storage the platform does not have                                                  |
| AU-I | **Token use once a minute per token**                                                                      | An event per request                                                                           |

## Build order

1. **AU1, the log written**: the table, the kinds and their detail shapes, `recordEvent`, refusals,
   labels and erasure, and every emitter for acts that exist today - sign-in, refusals, grants,
   groups, invitations, provisioning, tokens, spaces, versions, connections, bindings, datasets and
   publications - with the acts that delete history writing first. Plan with pre-flight review (a
   stored shape and every write path).
2. **AU2, the log read**: `GET /v1/audit`, exports as a job, Administration's Audit log, the whole
   system. Its close claims DAT-007 and the rest above.

Then `lifecycle.md`, whose acts are the declared kinds' first emitters.
