# Secrets

How a tenant replaces any secret it holds without reading it, and sees first everything that uses it (ADM-007,
ADM-047). Built by [the SA plan](../plans/2026-11-07-sa-support-access-boundary-and-secrets.md)'s SAd, which holds the
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

## Requirements owned

| ID          | How it is met                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **ADM-007** | Every tenant secret is write-only and replaced without being read: a token held outside overlaps 24 hours, the rest at once         |
| **ADM-047** | `SECRET_CONSUMERS` held to the migrations; `GET /v1/secrets` and Administration's Secrets; a break told once, naming every consumer |

ADM-007 is claimed for **a tenant's own secrets**. The object store credential (0005) is the operator's: the store
issues it and nothing in the product rotates it, so it is a gap, named, not claimed. ADM-047's second sentence is met
for connections, model keys, webhooks and mail; the token and sign-in breaks above are not read.
