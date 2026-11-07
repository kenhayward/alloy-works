# Support access

How a tenant lets somebody from outside it look, at what and until when, and sees it happening (ADM-022 to ADM-026,
ADM-042). Built by [the SA plan](../plans/2026-11-07-sa-support-access-boundary-and-secrets.md), which holds the
decisions. **SAa is built**: what each route reads, and `read_diagnostics`. The rest is designed and not built.

## Who support is

**A named person, invited by address** (SA-A), who signs in through the tenant's invitation path. There is no platform
staff identity and no cross-tenant sign-in; the operator stays the steward's CLI and reads no content (IAM-087). A
tenant whose only way in is its own provider needs a guest account there for support.

## Decided apart from grants

An outsider's tenant-level allow is refused and ignored (IAM-071), so support cannot be ordinary grants. **A
`support_grant` row** (principal, scope, spaces, purpose, expires, granted by, revoked) is checked by its own decision,
not through `access_grant` (SA-D). Its expiry is required and capped as an outsider's grant is; "active" is read from
the decision, never the row. It joins the access-change trigger and the epoch lock, so a revocation ends open streams.
Support is read-only: every write is refused but signing out, its own sessions, presence and its inbox.

## What a route reads

[ADR-0102](../decisions/0102-every-route-declares-what-it-reads.md). Every `RouteContract` declares `reads`:
`content`, `metadata` or `none`, published as `x-alloy-reads`. **Titles and names are metadata**; bodies, captions,
comments, field values, version notes, approval reasons, asset files, publications, search snippets, SQL, and mail
and webhook deliveries are content, and a route carrying any content is `content`. Writes are classed by what their
answer reveals. `packages/api-contract/src/reads.test.ts` pins the doubtful as content. Not yet enforced: SAb's route
hook refuses a support principal what its scope does not reach.

## Scopes

| Scope        | Reaches                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| Diagnostics  | The six diagnostics reads, through `read_diagnostics`                                                      |
| Metadata     | Diagnostics, and `metadata` routes in the spaces named                                                     |
| Content read | Metadata, and `content` routes there, each request carrying `Support-Read: <purpose>` or refused (ADM-026) |

**`read_diagnostics`** (0217) decides diagnostics, usage, query usage and its CSV, model usage and meaning freshness,
which `administer` decided before. Every role and token holding `administer` gained it by migration, so nobody loses
Diagnostics; Administrator holds it. It is administrative (ADR-0091's grant limits and last-holder guard apply), a
token may hold it, and it stays out of `externalCap`: support is an outsider, and a tenant-level allow to one is
refused anyway.

## Seen while active

`GET /v1/support-access` lists active and past grants; while any is active every administrator sees who, what scope
and until when (SA-G). `support.granted`, `support.used` (once per person per day per scope, and once per content read)
and `support.revoked` are audited. `grant_support` is administrative and a person's act alone.

## Requirements owned

| ID          | How it is met                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **ADM-017** | An Administrator reads Diagnostics and usage through `read_diagnostics`, which every role and token holding `administer` gained |

**Support itself is not claimed yet.** `reads` and `read_diagnostics` are what support's scopes will be decided by,
but no test yet shows a support person refused or let in: ADM-022 to ADM-026, ADM-042 and IAM-070's last act are
claimed with the tests of SAb and SAc.
