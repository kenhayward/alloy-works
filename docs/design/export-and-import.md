# Export and import

A tenant reproduced from its export, a part of one moved to another tenant, and an archive that can be
read without this product: T7's EI slice. It extends the tenant export
[the R21 plan](../plans/2026-10-18-r21-stored-results-and-export.md) built, which holds content alone and
says so. [The EI plan](../plans/2026-11-03-ei-export-and-import.md) builds it.

## The shape in one paragraph

An administrator asks for an export of the whole tenant, its configuration, or one space, document or
publication. A job writes an archive: every carried table's rows, the bytes they name by hash, a manifest
of what is in it and what is not, and a schema describing every column, so that it reads without the
product. A secret is a reference, never a value. To bring one in, an administrator uploads it and is told
first what would arrive, what stays, and which secrets need binding; a job then applies all of it or
nothing. What is already here is never overwritten. **A whole-tenant archive, the only kind holding the audit log,
restores only into an empty tenant** (Ken); a tenant in use takes a partial archive.

## Requirements owned

| ID          | How it is met                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **IMP-018** | Format 2 carries every table a census calls carried, audit, people and grants among them (EI-A, EI-B)                                    |
| **IMP-019** | `schema.json` in each archive and the format guide, `docs/guides/export-format.md`; no product code is needed to read one                |
| **IMP-020** | The census's left-out and rebuilt tables, each with its reason, are written into the manifest, and so is an object the store has lost    |
| **IMP-021** | A test exports a fixture tenant, reads it back and compares                                                                              |
| **IMP-022** | Administration's Export asks for each scope, with nobody else involved                                                                   |
| **IMP-023** | `export_environment`, and `export_audit` as well for audit; `export.produced` (EI-J)                                                     |
| **IMP-024** | The scopes `space`, `document` and `publication`                                                                                         |
| **IMP-038** | A partial archive's `references.jsonl` lists each thing outside it by identity, and by value or by reference (EI-E)                      |
| **IMP-039** | `POST /v1/imports`, no assisted review (EI-C)                                                                                            |
| **IMP-040** | `followReferences` on the request, recorded in the manifest                                                                              |
| **IMP-043** | The read-back test's reader imports neither `@alloy-works/db` nor `@alloy-works/domain`                                                  |
| **IMP-044** | An archive and an upload are kept in the tenant's store, seven days, and each download is an event                                       |
| **IMP-046** | The preview needs an answer for every issuer, and lists groups, externals and service identities; an actor is never reassigned (EI-N)    |
| **IMP-048** | A job, `import_environment` or `administer` at the target, the audit event `import.restored`, no token (EI-J, EI-K)                      |
| **ADM-005** | The scope `configuration`, imported as any other                                                                                         |
| **ADM-054** | `secrets.jsonl` holds references; an import with one unanswered is refused, naming each; one may arrive switched off (EI-G)              |
| **AST-030** | An asset's rows and rights travel with its bytes; each object is checked against its hash on the way in                                  |
| **REL-007** | Relationship types are definitions, carried and imported with the rest                                                                   |
| **IMP-052** | A whole-tenant archive anywhere but an empty tenant is refused, `tenant_not_empty`; only a whole-tenant archive holds audit (EI-D, EI-E) |

**Not claimed.** IMP-045 names notification channels, which do not exist until EM: the census will catch their table, and EM claims it then. ADM-029 is TL's: this offers the export, TL makes closure wait for it. ADM-043, a rehearsal
on a schedule, is DG's, and this slice must not be presented as a backup until it is. LIF-055, a chain over
exported audit, is SG's; EI-H leaves room for it. IAM-066 asks for far more than an archive; this answers
only its export artifacts.

## Decisions

**EI-A. Format 2: tables as stored, one cut.** `tables/<name>.jsonl`, one row per line. Instead of format 1's five
curated parts, which would need a shape designed for each of some 170 tables, and could not restore. Format 1
archives stay readable by what they say; they are not importable. The whole export runs in one `repeatable read`,
read-only transaction: format 1's pages are separate transactions, and most tables carry nothing to read them as of
a moment, so a row could name another the archive lacks, and refuse its own restore. The manifest says when the cut was.
A lost object is named there rather than failing the export: otherwise one lost image would keep a tenant from leaving.

**EI-B. A census decides every table and every awkward column.** `EXPORT_TABLES` names each tenant table `carried`,
`rebuilt` (search, embeddings, derivatives, previews) or `leftOut` with its reason (sessions, sign-in attempts,
locks, presence, jobs, idempotency records, tokens, store credentials), and for a carried one its identity (EI-C). A
test reads the catalogue and fails on a table named nowhere, as `moving.test.ts` does for `space_id`. Generated
columns are not written. `written_by` and `xact` (`xid8`, on some 30 tables) are not carried: another cluster's id could
read as the future and hide the row (audit.md); they take the restore's own.

**EI-C. Nothing here is overwritten, and identity is by table.** Each carried table has one of four:

| Identity     | Tables, for example                                                                        | On import                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kept`       | `artifact`, `artifact_version`, `baseline`, `publication`                                  | The id stays, since a version's digest serialises it (VER-042). Same id and digest: skipped and counted. Other content: left, listed as a conflict |
| `natural`    | `role`, `space` (`General`), `workflow_definition`, `identity_provider`                    | Random ids under a unique name. Matched by that key; a match maps the archive's id to this tenant's, and every reference to it is rewritten        |
| `singleton`  | `access_policy`, `editing_policy`, `data_policy`, `translation_policy`, `session_settings` | Seeded in every tenant. Replaced in an empty tenant; left in a populated one, and listed                                                           |
| `renumbered` | The 27 `generated always` keys, `connection_credential` among them                         | Per tenant, so not an identity: given new numbers, and references remapped                                                                         |

An import never changes a row it did not make, but for a singleton in an empty tenant. A kept chain stops where it
stops: this is not a merge. A test holds that no digest serialises a `natural` or `renumbered` id.

**Rows arrive in two passes.** "Foreign-key order" does not exist: `principal` and `identity_provider`,
`artifact_version` through `artifact_line` and `revision_designation`, and `import` and `import_part` are cycles, and
`restored_from` and its like refer to their own table. The census names the column each cycle breaks on: written null,
then set. A test builds the graph from `pg_constraint` and fails on a cycle unbroken.

**EI-D. A whole-tenant archive goes only into an empty tenant** (Ken). The log says what happened in a tenant, so it
cannot be interleaved with what happened in another, and an archive without its log would not be the tenant. So a
whole-tenant archive anywhere else is refused, `tenant_not_empty`, before any binding is asked for. Only a whole-tenant
archive holds audit; a partial one never does. A tenant in use takes a `configuration`, `space`, `document` or
`publication` archive. To take one space from a whole-tenant archive whose source has gone, restore it into a new
tenant and export the space from there.

**EI-E. "Empty" cannot mean no events.** Provisioning seeds `General`, definitions and starter roles, and the
person restoring must sign in first, which writes events; so do the vendor's naming of them, and may a stranger's
failed sign-in. Empty means, read under the restore's lock: no artifact beyond the seeded identifiers, no space but an
unused `General`, no grant but the first administrator's, no connection, endpoint, token or subscription, no principal
but the restorer, no event by a person or token but the restorer, and no earlier restore. `tenant_restore` records the restore, and a second is refused.

**EI-F. People and access.** Into an empty tenant, principals, groups, roles and grants arrive as they were. Into
a populated one, nothing that gives access does: an author is matched by issuer and subject, or made with no grants
so that history keeps its author, and what arrives takes the target space's access, as a move does (MV-B). A share of
a publication is left out either way: a link somebody holds should not start working again unasked.

**EI-G. Secrets are bound first, each as its kind seals it.** There is no store of secrets, so a reference names
the thing that holds one (`connection:<id>`, `model_endpoint:<id>`, `webhook:<id>`, `extension:<id>`,
`identity_provider:<id>`) and what consumes it. There is no one seal either: a connection's, model's, webhook's and
extension's are sealed by the connector, with a key the service lacks, to the holder and its target or origin.
So each binding goes through its kind's own path, naming the holder's id and the archive's target, and `import_binding`
holds what that kind stores (`sealed`, `sealed_for`, `target_digest`, `endpoint`), write-only and removed when the job
ends. The preview lists each; the administrator gives a value or chooses **Arrive switched off**, the holder then
having no credential and being off, named in the report. Foreign keys forbid dropping a holder that history points at
(`generation_run`, `principal.provider_id`). Refused while any is unanswered (ADM-054, Ken). A webhook's `sealed` becomes nullable, with a `disabled_reason` of `restored`. A hashed token cannot be
restored and is listed as left out; so is the environment's store credential.

**EI-H. Restored events are renumbered, and say so.** `audit_event.sequence` is the read's cursor, and the
restorer's sign-ins hold the low numbers. Each restored event takes a new sequence and its original `at`, with
`audit_restored (sequence, original_sequence, restore_id)` beside it, its `audit_label` rows remapped with it, and reads "Restored from an export" in the
log, because the archive is not signed and the database cannot vouch for it. `xact` is the restore's own
(audit.md: an `xid8` does not survive). The restorer's own earlier events stand before the old history, by sequence;
that oddity is the honest order of insertion. A chain computed at export runs over `original_sequence`, so LIF-055
needs nothing further from this slice.

**EI-I. Older archives come forward, or are refused.** The manifest names its format and last migration. A
committed `format.json` lists each carried table's columns; a test fails when the schema drifts from it, and the fix
bumps the format and adds an upgrader taking format N to N+1. A frozen fixture archive is imported on every run. An
archive newer than the product is refused, `export_format_newer`. Without this, an export a year old is not a backup.

**EI-J. Permissions.** `export_environment` for every scope, and `export_audit` as well for the whole tenant, since it
holds audit, to ask for one and to download one; so too to download someone else's partial export. A partial export holds only what the asker may read, with no internal
threads (COL-053), which reads IMP-023 as the whole tenant's rule. A new high-risk permission, `import_environment`, for
every import, with a sign-in in the last ten minutes (IN-D). Not `administer` at a scope, as first designed: a person
holding only that could ask for an archive and have nowhere to find it, and every route here would need a second
check. The routes stay one permission each.

**EI-K. An archive is untrusted input, and this is not a bulk-create endpoint** (IMP-048, API-N05). Entries are
read by exact name (`tables/<known>.jsonl`, `objects/<64 hex>`), sizes are capped against what the manifest declares,
every version's digests are recomputed, every object's hash checked, every content row validated and sanitised as a
paste is (IMP-017, IMP-047). Any failure refuses the whole import. Triggers that hold a rule about the row itself stay on through a restore, `audit_label_erased_on_write` among them. No token may hold `import_environment`, and a
partial import through a token is refused.

**EI-L. All or nothing, in one transaction.** Audit is insert-only, so a rollback is the only undo (IMP-042). Objects
are put first: they are named by hash, a retry finds them there, and one a failed run leaves stays unreferenced; nothing
sweeps those today, and the design accepts that rather than build a store listing. An upload and its bindings expire
with the sweep that expires an export. `previewImport`
and `applyImport` share `planImport`, so a preview cannot say what the import would not do (as MV's `planMove`).

**EI-M. A restored tenant starts quiet.** Subscriptions arrive off (`disabled_reason` `restored`). `webhook_queue_audit` fires on an inserted
event, so audit is inserted before subscriptions. Restored notifications are not sent again. Derived data is rebuilt by
the jobs that make it. Anything already due waits (Ken): restored dates and retention may be long past, and would act at once. While
`tenant_restore.due_reviewed_at` is null, the sweeps that act on restored content pass this tenant over (`sweepDates`,
`sweepExpiredIterations`, `sweepOldNotifications`, `sweepUncheckedPublications`), and Administration says so and lists
what is due until an administrator ends the review, an audited act. A test names every sweep as held or not, so a new
one must choose. An upload's and an export's expiry, sessions and the like are not held.

**EI-N. Every identity is answered for** (IMP-046). A principal is found by issuer and subject, and an issuer holds
its host, so a tenant restored elsewhere would lock out everyone in it. The preview lists the archive's issuers with
counts, and its groups, externals and service identities. Each issuer needs an answer: map to one of this tenant's,
keeping subjects, or **keep as they are**, those people arriving unable to sign in. An actor is never reassigned; a
mapping changes how a principal signs in, not who it is. If the restorer's issuer and subject are in the archive, that
restored principal wins, the fresh one gives up its identity (`provider_id` and `provider_key` too) and they sign in
again; the preview refuses unless that principal is enabled, not erased and would administer, so nobody is locked out (IN-B).
If they are not in it, they keep their principal and Administrator grant.

**EI-O. Tar, not ZIP.** A ZIP without its 64-bit extension stops at 65,000 entries and 4 GB, which format 1 refuses as
`export_too_large`, and IMP-020 does not allow a large tenant to be incomplete. A tar of gzipped JSON Lines and raw
objects has no such limit, streams both ways, and opens with anything. The manifest comes first.

**EI-P. A key resolves in the tenant reading it.** An asset version's `object` is `t_<id>/sha256/<hash>` inside
digested content, and `packages/objects` refuses another tenant's prefix. Rewriting it breaks VER-042; keeping it makes
the bytes unreachable. So content keeps the key as written, and the store resolves any well-formed key to this tenant's
prefix plus its hash: it can never reach another tenant's bytes, since the prefix read is always its own. Key columns
outside a digest (`publication_output.object_key`, `report_key`) are rewritten on the way in.

**EI-Q. An old archive brings back what was since erased.** An erasure leaves no trace an archive could consult, and
a new tenant knows nothing of it. A restore is as of its archive: the preview says how old it is and that anyone
erased since returns and must be erased again, and the report repeats it (VER-038). A ledger of erasures that outlives
a tenant would be a list of erased people (Ken).

**EI-R. A part follows artifacts through foreign keys.** `export-scope.ts` names each carried table: content follows
the artifacts in scope, a row staying only when every content row it requires is in; referenced rows are those it names
(`principal` to issuer, subject and name alone); the configuration scope alone holds the configuration, whole. Access,
audit and everything else stay out, and the manifest says so. Definitions always come, since a version's digest names
them. What a row names and the archive lacks is in `references.jsonl` by identity, or by value where followed. It runs
in one read-only cut like a whole export, and the asker's readable set, read first, bounds what is seeded.

## Not designed

A whole-tenant archive into a tenant in use, or a part picked out of one (EI-D); restoring into a different tenant while keeping both signed in; a merge of two histories; an import that updates
what is already here; a scheduled export; encrypting an archive with a passphrase (it is permissioned, expiring and
audited, IMP-044); XML vocabularies (IMP-016).
