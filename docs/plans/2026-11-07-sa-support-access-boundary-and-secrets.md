# SA: Support access, the boundary and secrets

> T7's trust slice, split from DG by DG-E. **Full tier**: several PRs, migrations, new contracts, auth and tenancy.
> Ken answered SA-A to SA-C (2026-11-07); the rest are taken by default, for Ken to overrule.

**Goal:** a tenant decides who outside it may look, at what and until when, and sees it happening; sees everything
that can leave it; and replaces any secret without reading it, knowing first what uses it.

**Requirements:** ADM-022, ADM-023, ADM-024, ADM-025, ADM-026, ADM-042 (support); IAM-070 (its last act, granting
support access); ADM-041 (the boundary); ADM-007, ADM-047 (secrets). **LIF-072** only if pre-flight 4 finds
`asset.replaced` and `channel.changed` emitted or emittable here; otherwise its gap is named. **Left unclaimed, gap
named:** ADM-Q01 is open, so the boundary states a residency only where an endpoint declares one; malware scanning
does not exist (AST-Q03), so the boundary says so.

**What exists** (the map, 2026-11-07):

- **Support:** `support.granted`, `support.used`, `support.revoked` declared in `audit/kinds.ts`, emitted by nothing.
  No support identity; the operator is the steward's CLI, holds no account and reads no content (TL-P, IAM-087).
- **Outside people:** invitations (IAM-072), grants with an expiry capped by the tenant (IAM-049, IAM-050), the
  external list (IAM-051), the effective-permission view (`explainAccess`, IAM-029, IAM-030).
- **Permissions:** IAM-070's acts exist as permissions but granting support access (`permissions.ts`; `0190`).
- **Secrets**, all sealed and write-only: connection credential, model endpoint key (generation, embedding,
  translation), extension secret (behind `administer`), webhook signing secret (the old one signs 24 hours more), mail
  relay password, sign-in client secret, SCIM token (ends the old at once). Nothing lists what consumes a secret.
- **Boundary:** `model_endpoint.boundary` (inside or outside) alone; no declaration.

| PR  | Holds                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------- |
| SAa | The plan, `support.md`, ADR-0102; every route declares what it reads (content, metadata or neither), held by a test     |
| SAb | Support grants: `grant_support`, the grant routes, scopes enforced, `support.*` audited, in the effective view          |
| SAc | Administration's Support access: grant, review, revoke; active access shown to administrators; content read on purpose  |
| SAd | Secrets: SCIM overlap, the extension secret under `rotate_secrets`, `GET /v1/secrets` with consumers, a break told once |
| SAe | The boundary declared: `OUTBOUND` registry, `GET /v1/boundary`, Administration's What leaves; the close                 |

## Ken's answers

| ID   | Question                        | Answer                                                                                                                                       |
| ---- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| SA-A | Who is support                  | **A named person invited** by address, signing in through the tenant's invitation path. No platform staff identity, no cross-tenant sign-in. |
| SA-B | What a metadata grant withholds | **Titles and names are metadata.** Bodies, captions, comments, asset files, publications and search snippets are content.                    |
| SA-C | ADM-007's windows               | **The SCIM token overlaps 24 hours**, as webhook signing does; the extension secret moves to `rotate_secrets`.                               |

## Taken by default, for Ken to overrule

- **A support grant is a grant**, to an external principal, with a required expiry under the tenant's cap and a
  required purpose: one row in `support_grant` (principal, scope, purpose, expires, granted by, revoked) beside the
  grants it makes, so revoking it ends them together and the effective view explains it as support.
- **`grant_support`** is a new permission (IAM-070's last), held by Administrator by migration, limited by ADR-0091.
- **`support.used`** is audited once per support person per day per scope, and once per artifact whose content is
  opened under a content grant: the log stays readable and every content read is named.

## Decisions (draft)

- **SA-D Scopes.** _Diagnostics_: Diagnostics, Usage and background work, through a new `read_diagnostics` permission
  (Administrator holds it too). _Metadata_: diagnostics plus every listing and outline (titles, states, dates, sizes,
  failures) with content withheld and marked so. _Content read_: metadata plus `read` on the spaces named.
- **SA-E What a route reads**, declared in `documentation.ts` beside its summary (`reads: 'content' | 'metadata' |
'none'`); `buildOpenApi` throws without it. A metadata-scope caller reaching a content route is refused
  `support_scope`. This is ADM-026's "obvious": the line is in the contract, not in each handler.
- **SA-F Seen while active** (ADM-025): `GET /v1/support-access` lists active and past grants; while any is active every
  administrator sees a lozenge in Administration naming who, what scope and until when.
- **SA-G Content on purpose** (ADM-026): under a content grant the renderer asks before opening a body ("Read this
  content under support access") and the service records the read; nothing opens content by navigation alone.
- **SA-H Consumers** (ADM-047): `SECRET_CONSUMERS` in `packages/domain` maps each secret kind to what reads it
  (a model key to every purpose and guardrail using its endpoint; a connection to its datasets, query definitions and
  refreshes; and so on). `GET /v1/secrets` answers each secret, when it was last replaced and its consumers. After a
  replacement, the first authentication failure of any consumer is told once against the secret, naming every
  consumer, by the silent-failure path DGe4 built.
- **SA-I The boundary** (ADM-041): `OUTBOUND` in `packages/domain`, one row per way out (model endpoints, embedding,
  reference sources, translation, malware scanning, connections, webhooks, mail, extensions): what may leave, on by
  default or not, the permission that changes it, residency where declared. `GET /v1/boundary` adds what this tenant
  has configured. A test holds `OUTBOUND` to every outbound sender module.

## Pre-flight

1. **Every content route.** Classify every route under SA-E before SAb; list the doubtful (search snippets, outlines
   carrying text, exports, previews, live updates on the event stream). The stream is the likeliest leak.
2. **The external path end to end.** An invited address claims on first sign-in (IAM-072); confirm a support grant's
   expiry and revocation end an open session's access at its next request, not its next sign-in.
3. **`read_diagnostics`** without `administer`: every Diagnostics and Usage read checked, nothing else opened.
4. **LIF-072.** Is `asset.replaced` emittable (does replacing exist)? Is `channel.changed` superseded by
   `mail_channel.changed`? Claim or name the gap.
5. **Consumers complete.** Every sealed column found by migration search has a `SECRET_CONSUMERS` row; the object store
   credential is the operator's and outside ADM-007 (say so).
6. **SCIM overlap.** Two valid tokens for 24 hours without widening what either can do.
