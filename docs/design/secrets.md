# Secrets

How a tenant replaces any secret it holds without reading it, and sees first everything that uses it (ADM-007,
ADM-047), and sees everything that can leave it (ADM-041). Built by [the SA plan](../plans/2026-11-07-sa-support-access-boundary-and-secrets.md)'s SAd and SAe, which holds the
decisions (SA-C, SA-H, SA-I).

## Secrets

**One row per kind**: `SECRET_CONSUMERS` ([`packages/domain/src/secrets/consumers.ts`](../../packages/domain/src/secrets/consumers.ts))
names, for each kind of secret, the column holding it, what reads it, what consumes it, the operation and permission
that replace it, how, and how a break after a replacement is read. A test scans the migrations for every `sealed*` and
`token_hash` column and holds them to the rows or to `SECRET_EXCLUSIONS`, each with why, so a secret cannot be added
without saying what uses it. A test in `packages/api-contract` holds each row's operation and permission to the route.

| Kind                                  | Replaced by                                        | How                                 |
| ------------------------------------- | -------------------------------------------------- | ----------------------------------- |
| Sign-in client secret, shared one too | `replaceProviderSecret`, `rotate_secrets`          | At once: the service is its holder  |
| Connection credential                 | `setConnectionCredential`, `rotate_secrets`        | At once: the connector              |
| Delivery store password               | `putBridgeSettings`, `configure_services`          | At once: the service mints it       |
| Model endpoint key                    | `setModelEndpointKey`, `rotate_secrets`            | At once: the connector              |
| Webhook signing secret                | `rotateWebhookSecret`, `rotate_secrets`            | The old signs beside it 24 hours    |
| Extension secret                      | `setExtensionSecret`, `rotate_secrets` (was admin) | At once: the connector              |
| Mail relay password                   | `setMailPassword`, `rotate_secrets`                | At once: the connector              |
| SCIM token                            | `issueScimToken`, `rotate_secrets`                 | The old is accepted 24 hours more   |
| CT Studio token                       | `issueCtStudioToken`, `administer`                 | The old is accepted 24 hours more   |
| Service identity token                | `issueServiceIdentityToken`, `administer`          | Issued beside the old, then revoked |

**A token held outside overlaps** (SA-C, SA-I): `api_token.ends_at` (0220) is set once, from null, never past the
token's expiry, by its own column grant and a trigger. Issuing a SCIM token sets the one before it to end 24 hours on
and ends any older at once, so two at most are accepted; CT Studio's new token does the same to the recorded one,
leaving an adopted identity's other tokens alone. `findApiToken` refuses a token past its end, and the sign-in sweep
deletes it, recorded as revoked and told to every replica. Turning SCIM off disables its identity, which ends every
token at once. A token's scopes and expiry never change: nothing widens what it may do.

**Every other secret is replaced at once**: the product is its only holder and reads the new value from the replacing
transaction on, so there is never a moment when neither value is valid.

**When last replaced** is the credential row's own time for connections, model keys and extensions, the newest token
for SCIM and CT Studio, and for the provider secret, the relay password and a webhook's secret a column (0220) the
database sets whenever the sealed value changes, so no write path can forget it.

**`GET /v1/secrets`** (`rotate_secrets`; reads metadata) answers each secret held here with what it belongs to, when
last replaced, until when an old value is still accepted, how it is replaced, and its consumers resolved now: a model
key every purpose routed to its endpoint, the guardrails every call is held to and the translation policy where
machine translation is on and routed there; a connection the query definitions naming it and their datasets, and the
spaces delivered to through it; a webhook its subscription; the relay mail delivery; a SCIM token provisioning; CT
Studio's token the spaces it delivers to; a shared provider the organisation's other tenants by name. It selects no
sealed value or hash, and a test holds its answer free of every one. Scanning and translation services are named
absent: none exists, and machine translation is a model endpoint's.

**Administration's Secrets** lists them, each linked to the page that replaces it, asking the service for
`rotate_secrets` first.

**A break told once** (ADM-047): after a replacement, the first authentication failure of a consumer is read from
records already kept, with no write per request: a connection's runs and tests failing `connection_failed`, an
endpoint's runs ending `model_unavailable`, a webhook's attempts answered 401 or 403, the relay's mail failing
`auth_failed`. It is DGe4's `secret_failing`, keyed by the secret and its replacement, so it is told once to whoever
reads Diagnostics, naming every consumer, and again only after the next replacement; Diagnostics' Needs attention says
it too, and to support says nothing, whose spaces may not reach the consumers. A refused token is not found, so an old
SCIM, CT Studio or service token cannot be told from a stranger's; a refused sign-in secret and a failing extension
check record no reason. Those breaks are not told.

## The boundary

Everything that can leave a tenant, declared once (ADM-041; the SA plan, SA-J, SAe). **`OUTBOUND`**
([`packages/domain/src/boundary/outbound.ts`](../../packages/domain/src/boundary/outbound.ts)) has a row per way out:
model endpoints, embedding, machine translation, reference sources, malware scanning, data connections, webhooks,
mail, extensions, vocabulary sources and CT Studio. Each says what may leave in plain words, whether it is on by
default (only Crossref and PubMed are), the operation and permission that turn it on or move it, and its residency.
**Residency is stated only where an endpoint declares one**: a model endpoint's `boundary`, inside or outside, set by
an administrator (GEN-031), so model endpoints, embedding and translation say it per endpoint and the rest say "not
declared". What residency is promised is ADM-Q01, open. **Malware scanning is a row with nothing behind it**: no
scanner exists (AST-Q03). CT Studio delivers in and is sent nothing.

**Held to the code**: a test scans the service, worker and connector for every module that opens a socket, an HTTP
request, an SMTP transport, a database client, a `fetch` or the connector's guarded exchange, and holds each to a row's
`senders` or to `OUTBOUND_EXCLUSIONS` with why: the connector's exchange itself, the service's and worker's hop to the
connector, the product's own database and health probe, sign-in, and the API reference page's same-origin script. A
way out cannot be added without a row. A test in `packages/api-contract` holds each row's operation and permission to
the route.

**`GET /v1/boundary`** (`administer`; reads metadata) answers every row with what this tenant has set up for it: each
endpoint by name with its boundary and whether a purpose routes to it, the reference sources on or off, connections,
webhooks, the mail relay, extensions, vocabulary sources and the spaces CT Studio delivers to. An address is answered
by its host alone, since a path or query can carry a key, and no secret is selected; tests hold the answer free of
both. **Administration's What leaves** shows it, one row per way out, each linked to the page that changes it, asking
the service for `administer` first.

## Requirements owned

| ID          | How it is met                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| **ADM-007** | Every tenant secret is write-only and replaced without being read: a token held outside overlaps 24 hours, the rest at once |
| **ADM-041** | `OUTBOUND`, held to every sender, and `GET /v1/boundary`: each way out, what leaves, default, permission, residency         |

ADM-007 is claimed for **a tenant's own secrets**. The object store credential (0005) is the operator's: the store
issues it and nothing in the product rotates it, so it is a gap, named, not claimed; the delivery store's password is
the service's own, minted when data delivery needs one, and is not replaced on demand. **ADM-047 is not claimed**:
every secret's consumers are shown before it is replaced, but a break is told for connections, model keys, webhooks
and mail alone; the token, sign-in and extension breaks above are not read, and a model key's is read from
`model_unavailable`, which an outage gives too.

ADM-041 is claimed with residency **where declared, else not declared**: ADM-Q01 (what residency is promised) is
open, so nothing beyond a model endpoint's own `boundary` is stated. Each way names the one permission that turns it
on; machine translation also needs an endpoint routed (`configure_services`).
