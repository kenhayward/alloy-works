# SA: Support access, the boundary and secrets

> T7's trust slice, split from DG by DG-E. **Full tier**: several PRs, migrations, new contracts, auth and tenancy.
> Ken answered SA-A to SA-C (2026-11-07); the rest are taken by default, for Ken to overrule. Pre-flight ran
> 2026-11-07 and reshaped SA-D, SA-E and SA-G.

**Goal:** a tenant decides who outside it may look, at what and until when, and sees it happening; sees everything
that can leave it; and replaces any secret without reading it, knowing first what uses it.

**Requirements:** ADM-022, ADM-023, ADM-024, ADM-025, ADM-026, ADM-042 (support); IAM-070 (its last act, granting
support access); LIF-072 (`asset.replaced` emitted by `replaceAsset`; `mail_channel.changed` answers COL-060, so
`channel.changed` retires); ADM-041 (the boundary); ADM-007, ADM-047 (secrets). **Gaps named, not claimed away:**
ADM-Q01 is open, so the boundary states a residency only where an endpoint declares one; malware scanning does not
exist (AST-Q03); the object store credential is the operator's and nothing rotates it, so ADM-007 is claimed for a
tenant's own secrets and the operator's is named.

**What exists** (the map and pre-flight, 2026-11-07):

- **Support:** `support.granted`, `support.used`, `support.revoked` declared, emitted by nothing. No support identity;
  the operator is the steward's CLI and reads no content (TL-P, IAM-087).
- **Outside people:** invitations (IAM-072); grants with an expiry, the tenant's cap re-applied at every decision
  (`decide.ts:106`); facts read per request, so expiry and revocation bite at the next request. **An outsider's
  tenant-level allow is refused and ignored (IAM-071)**, so support cannot be ordinary grants.
- **Routes:** 493 in the contract; about 79 GETs carry content, 57 metadata, 83 neither; 31 writes need only a session.
  The event stream carries ids, state names and presence: metadata.
- **Diagnostics:** six reads, all `administer`: diagnostics, usage, query usage and its CSV, model usage, meaning
  freshness. Failures are codes; query usage shows document titles, Diagnostics connection names (metadata).
- **Secrets**, sealed or hashed, write-only: sign-in client secret, connection credential, model key, webhook signing
  secret (old signs 24 hours more), extension secret (`administer`), mail password, SCIM token (issuing deletes the
  rest), CT Studio token (the old stays live), service identity tokens, the bridge's delivery-store password, a shared
  provider's secret (copied into member tenants), the object store credential (the operator's). Session refresh tokens
  are per session, outside ADM-007.

| PR  | Holds                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| SAa | The plan, `support.md`, ADR-0102; `reads` on every `RouteContract`, held by the compiler and a test; `read_diagnostics`                      |
| SAb | Support grants: `grant_support`, `support_grant` decided apart from `access_grant`, read-only, scopes refused by route, `support.*` audited  |
| SAc | Administration's Support access (grant, review, revoke, active shown to every administrator); the support person's own view; LIF-072's kinds |
| SAd | Secrets: SCIM overlap, the extension secret under `rotate_secrets`, `GET /v1/secrets` with consumers, a break told once                      |
| SAe | The boundary declared: `OUTBOUND`, `GET /v1/boundary`, Administration's What leaves; the close                                               |

## Ken's answers

| ID   | Question                        | Answer                                                                                                                                       |
| ---- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| SA-A | Who is support                  | **A named person invited** by address, signing in through the tenant's invitation path. No platform staff identity, no cross-tenant sign-in. |
| SA-B | What a metadata grant withholds | **Titles and names are metadata.** Bodies, captions, comments, asset files, publications and search snippets are content.                    |
| SA-C | ADM-007's windows               | **The SCIM token overlaps 24 hours**, as webhook signing does; the extension secret moves to `rotate_secrets`.                               |

## Taken by default, for Ken to overrule

- **SA-B extended:** field values, version notes and approval reasons are content. A route carrying any content is a
  content route, so the metadata scope sees less, never more.
- **Support is read-only.** A support principal is refused every write (`support_scope`) but signing out, its own
  sessions, presence and its inbox; it cannot make a token, use `/mcp`, start a conversation or import.
- **`support.used`** is audited once per support person per day per scope, and once per content read, naming it.
- **A tenant whose only way in is its own provider** needs a guest account there for support; `support.md` says so.

## Decisions (draft)

- **SA-D Support decided apart.** A `support_grant` row (principal, scope, spaces, purpose, expires, granted by,
  revoked) is checked by its own decision, not through `access_grant`, so IAM-071 stands. Its expiry is required and
  capped as an outsider's grant is; a lowered cap ends it, and "active" is read from the decision, never the row. The
  row joins the access-change trigger and the IAM-063 epoch lock, so a revocation ends open streams.
- **SA-E What a route reads**: `reads: 'content' | 'metadata' | 'none'`, required on `RouteContract` beside `access`;
  the compiler holds every route to it, the service's route hook enforces it, the OpenAPI document publishes it. A test
  pins the doubtful as content: search, document reads (field values), numbering (captions), texts, changes,
  comparisons, previews, shared outputs, every download and export, query definitions (SQL), mail and webhook
  deliveries, version and approval lists.
- **SA-F Scopes.** _Diagnostics_: the six diagnostics reads, through `read_diagnostics` (also given to every role and
  token holding `administer`, kept from `externalCap`). _Metadata_: diagnostics plus `metadata` routes in the spaces
  named. _Content read_: metadata plus `content` routes there, each request carrying `Support-Read: <purpose>` or
  refused (ADM-026's deliberate act, for API callers as much as the renderer, which asks first).
- **SA-G Seen while active** (ADM-025): `GET /v1/support-access` lists active and past grants; while any is active every
  administrator sees a lozenge naming who, what scope and until when. `grant_support` sits in
  `administrativePermissions` and `PERSONS_ACTS`, so ADR-0091 and the last-holder guard apply and no token holds it.
- **SA-H Consumers** (ADM-047): `SECRET_CONSUMERS` in `packages/domain`, one row per secret above, each naming what
  reads it (a model key every purpose and guardrail on its endpoint; a connection its datasets, definitions and
  refreshes; a shared provider's secret its member tenants). `GET /v1/secrets` answers each, when last replaced and its
  consumers. After a replacement, the first authentication failure of any consumer is told once against the secret,
  naming every consumer, by DGe4's silent-failure path. Scanning and translation services are named as absent.
- **SA-I SCIM overlap**: `api_token.ends_at`, nullable, settable once from null and never past `expires_at`, with its own
  update grant; issuing sets it 24 hours on for the token before and ends any older at once (two at most);
  `findApiToken` refuses past it; a sweep deletes them. Turning SCIM off ends all. The CT Studio token and service
  identity tokens gain the same rule.
- **SA-J The boundary** (ADM-041): `OUTBOUND` in `packages/domain`, one row per way out (model endpoints, embedding,
  reference sources, translation, malware scanning, connections, webhooks, mail, extensions, CT Studio's sink): what
  may leave, on by default or not, the permission that changes it, residency where declared. `GET /v1/boundary` adds
  what this tenant has configured. A test holds `OUTBOUND` to every outbound sender module.
