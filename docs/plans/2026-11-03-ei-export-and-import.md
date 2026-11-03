# EI: Export and import

> T7's next slice, designed in [export-and-import.md](../design/export-and-import.md). **Full tier**: several PRs,
> migrations, a new contract, a process boundary and tenancy. Ken decided that a whole-tenant archive goes only into an
> empty tenant (EI-D), that an erased person's return is a warning (EI-Q), that a secret's holder may arrive switched
> off (EI-G), and that sweeps wait for a review after a restore (EI-M). Pre-flight found sixteen defects, answered in the design and here; neither spike has run.

**Goal:** an administrator exports a whole tenant, reads it without the product, restores it into a new tenant with
its audit log and people, and brings a space or the configuration into a tenant already in use.

| PR  | Holds                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------- |
| EIa | Format 2: the census, every carried table in one cut, secrets as references, tar, the format guide, the independent reader |
| EIb | The partial scopes (`configuration`, `space`, `document`, `publication`), following references, Administration's Export    |
| EIc | The restore into an empty tenant: upload, preview, identities, binding, audit, a quiet start, EI-K, EI-P                   |
| EId | A partial archive into a tenant in use, as far as S1 allows; the walks, the final review, the close                        |

EIa alone answers "can I get everything out", which TL needs. The empty restore comes before the populated import
because it is the goal, it may take locks freely, and the populated path is the harder and may shrink. Nothing imports
until EIc, so format 2 can still change. EIc is the largest, and splits at audit if it must.

## Before EIa

**Amend the requirements through the form** (`pnpm trace draft`), and the design then claims them:

- IMP-039 says "restored into a tenant", and EI-D narrows it. A new row, IMP-0xx: _a whole-tenant export, the only kind holding the audit log, must be restored only into an empty tenant; anywhere else it must be refused before it runs._
- ADM-027 says every reference must be bound, and EI-G also lets one arrive switched off. It gains: _or be marked by the person importing to arrive switched off, with no credential, and be named in the report._

## Interfaces

- Migrations: `tenant_export` gains `scope`, `scope_id`, `follow_references`, `format`. New: `restoration` (`id`,
  `requested_by`, `object_key`, `sha256`, `state`, `plan`, `issuers`, `finished_at`), `import_binding` (`restoration_id`,
  `reference`, `sealed`, `sealed_for`, `target_digest`, `endpoint`, `switched_off`), `tenant_restore` (one row at most, `due_reviewed_at`),
  `audit_restored` (`sequence`, `original_sequence`, `restore_id`). `webhook_subscription.sealed` nullable, and
  `disabled_reason` gains `restored`. Kinds: `import.restored` as declared in audit.md, plus `import.previewed`, `import.refused` and `import.due_reviewed`.
- `packages/db/src/export-tables.ts`: `EXPORT_TABLES: Record<string, { fate: 'carried' | 'rebuilt' | 'leftOut'; why?: string; identity?: 'kept' | 'natural' | 'singleton' | 'renumbered'; key?: string[]; breaksCycleAt?: string[]; secrets?: SecretColumn[] }>`. `format.json` beside it, generated.
- `withTenant` gains an isolation option; the export job runs in one `repeatable read`, read-only transaction, and `EXPORT_PARTS` goes.
- `packages/db/src/restoring.ts`: `planImport(trx, archive)`, `previewImport`, `applyImport`, `tenantIsEmpty(trx)` answering `empty` or the first thing that is not. `remap` holds natural and renumbered ids.
- `packages/objects/src/store.ts`: `get`, `sign` and the rest resolve a well-formed key to this tenant's prefix plus its hash (EI-P); the test that another tenant's key is refused becomes one that it cannot reach another tenant's bytes.
- `apps/worker/src/jobs/tenant-export.ts` writes tar; `apps/worker/src/jobs/restoring.ts` reads it to disk, verifies, then applies. Archive reading in a new `packages/archive`, free of `pg`.
- The restorer's path (S1's expected answer), EIc's: `aw_restorer` in `bootstrap.ts` and its test, `provision.ts`, a grant for existing tenants, `deploy/`. It assumes the owner role, `set constraints all immediate` before triggers return, then the tenant's role to enqueue rebuilds, since the owner lacks `aw_tenant`.
- Contract: `POST /v1/exports` takes `{ scope, id?, followReferences? }`; `POST /v1/imports` (a signed upload, as assets do), `GET /v1/imports/{id}` (the plan), `PUT /v1/imports/{id}/bindings/{reference}` (per kind, write-only, or `switchedOff`), `PUT /v1/imports/{id}/identities`, `POST /v1/imports/{id}/apply`, `POST /v1/imports/{id}/due-reviewed`. Codes: `export_format_newer`, `export_invalid`, `tenant_not_empty`, `secret_unbound`, `identity_unanswered`, `restorer_would_not_administer`. `import_environment` joins `permissions.ts`, granted by migration as IN-H's six, and is left out of `tokenScopes`. Each route in the usual censuses.
- Web: `apps/web/src/admin/TenantExport.tsx` gains the scopes; `admin/Import.tsx` the upload, the plan, each binding, each identity. A space's and a document's More actions gain Export.
- `docs/guides/export-format.md`: the outsider's account, every claim checked against an archive.
- Sweep: an upload and its bindings expire as an export does; the held sweeps pass over a tenant under review (`apps/worker/src/sweep.ts`, EI-M).

## Tests worth naming

- IMP-020 a table in no list fails the census, and a left-out table's reason is in the manifest.
- A foreign-key cycle no column breaks fails against `pg_constraint`; no digest serialises a natural or renumbered id.
- IMP-021 exports a fixture tenant holding every carried table, reads it back and compares row counts and digests.
- IMP-043 recomputes each version digest from the archive using only `node:crypto` and the format guide's serialisation.
- IMP-018 a whole-tenant archive holds audit, people, grants, threads, definitions, assets, baselines and publications.
- A document written while the export runs is wholly in it or wholly out; no row names one the archive lacks.
- ADM-027 no sealed value appears anywhere in the archive; each secret column is seeded with a marker and the bytes searched.
- ADM-027 an import with an unanswered reference is refused, naming each; one switched off arrives with no credential and off.
- IMP-040 a space exported without following references lists an outside component by identity, and with it, by value.
- IMP-023 a whole-tenant export without `export_audit` is refused, and a partial one holds no part its asker cannot read.
- IMP-039 a tenant restored keeps every version digest, and an image in it opens from the new tenant's store.
- IMP-042 an import failing at its last row leaves no row and no event but the refusal.
- IMP-046 an unanswered issuer refuses; an event's actor is the same principal after a mapping.
- IMP-048 a token cannot import; a whole-tenant import needs a sign-in in the last ten minutes.
- IMP-0xx audit returns in order, with original instants, sequences and labels, into an empty tenant.
- IMP-0xx a whole-tenant archive into a tenant in use is refused before any binding is asked for, and a partial archive holds no audit.
- `tenant_not_empty` for another person's act, a made document or a second restore; not for the restorer's sign-in, the vendor's naming or a stranger's failed sign-in.
- Seeded `General`, roles and policies: an empty tenant ends holding the archive's, with every reference rewritten.
- A forged archive is refused: a changed version, an object not matching its hash, `../` in an entry name, a declared size exceeded, a script in content.
- A person restored by issuer and subject signs in as the restored principal; one who would not administer is refused in the preview.
- A label erased in the archive stays erased; the preview says how old an archive is and what that brings back.
- Another tenant's bytes stay unreachable by any key, restored content's included.
- A migration changing a carried column fails against `format.json`; the frozen format-2 archive still restores.
- A restored subscription sends nothing until switched on; restoring audit queues no webhook attempt.
- A date and a retention period long past do nothing after a restore until the review ends, then act; a sweep named as neither held nor not fails.
- Round trip, whole system: export, new tenant, restore, sign in, publish a restored document.

## Spikes

Neither has been run; each could change the plan.

- **S1, how rows get in (before EIc).** Some 45 insert triggers hold live rules (`publication_output_while_queued`, `workflow_transition_follows`, `review_round_event_by_a_reviewer`...), which history cannot satisfy, and `generated always` needs `overriding system value`. Try a fixture archive through the tenant's role and list what refuses. Expected: the `aw_restorer` path above with `alter table ... disable trigger user`, foreign keys left on. It takes `access exclusive`: fine in an empty tenant, not in a populated one. So EId may carry only what live triggers accept, or insert through narrow `security definer` functions. **The worker gaining the owner role is the largest risk here**; a separate process with that login alone is the alternative, and my recommendation if the worker cannot be kept from it.
- **S2, one transaction at size (before EIc).** A million-event fixture: time, WAL, the job's lease. Also the export's long `repeatable read`, which holds back vacuum for the whole cluster, not just this tenant. If either is too much, the fallback for export is `pg_export_snapshot` over pages, and for restore a job heartbeat.

## Risks

- **A review nobody ends.** Sweeps stay off a restored tenant until an administrator ends the review (EI-M), so retention could wait indefinitely. Administration says so on every visit; no timeout, since acting unreviewed is what it prevents.
- **Secrets through the connector.** EI-G asks each kind's sealing path to accept a holder that does not exist yet. If one cannot, that kind binds after the restore and arrives off. Read each path before EIc.
- **Upload size.** A single signed `PUT` stops at 5 GB on S3. Multipart is needed for a large tenant, and the export's `putFile` needs the same check. Otherwise a stated cap in the preview, and an operator route.
- **Every migration now costs a format bump** when it touches a carried column. The price of EI-I; the upgrader is usually one line, a default.
- **Restored audit is only as good as the archive.** An administrator with a text editor can forge it. EI-H marks it; SG's signature is the real answer.
- **Grant limits.** The open question from ID: a narrower role with `administer` can still grant itself `import_environment` until a grant is limited to what its maker holds.
