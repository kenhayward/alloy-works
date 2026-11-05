# A first way in through any provider

One PR. `steward organisation` opens only Google, so an organisation on Keycloak or any other provider has no
first way in, and nobody can sign in to what it made. [The tenant's lifecycle](2026-11-04-tl-tenant-lifecycle.md)
kept a provider's secret off the command line and out of `tenant_request`; this keeps that.

## Calls

As the pre-flight changed them.

- **SP-A** A command of its own, after `steward organisation`: `steward provider --tenant <id> --issuer <url>
--client-id <id> [--name <shown>] [--first-administrator <address>]`. The secret comes from standard input, so it
  reaches no argument, history, request row or log. A terminal gives none, as typing would show it. Line endings go.
- **SP-B** Only for an organisation's own tenant, active and finished, **until somebody who signed in holds a grant
  or an invitation has been accepted**, so it can never replace the sign-in of a tenant in use (IAM-087). Somebody who
  signed in and holds nothing does not stop it: an unverified address makes one.
- **SP-C** One transaction under the access epoch: check, then update the one provider in place, or insert. A second
  provider would leave the first holding the invitation, able to claim it. Several already is refused.
- **SP-D** Nobody invited is refused, or a lapsed invitation dead-ends silently, unless `--first-administrator`
  invites or renews. Somebody who signed in unverified has a principal an invitation never reaches: use another.
- **SP-E** `steward` gains `SECRET_OBJECT_STORE_KEY`, read only by this command.
- **SP-F** A store's refusal prints its code alone, since a driver's detail can quote the row.
- **SP-G** `steward organisation` without `--google` says nobody can sign in until `steward provider` has run.
- **SP-H** `!reset` loses once `compose.lan.yaml` is in the chain, so `compose.keycloak.yaml` sets Google's settings
  empty, and the service takes empty as none.

## Interfaces

- `configureFirstProvider(stewardUrl, tenant, provider, key, inviting)`, the transaction.
- `TenantMaker.firstProvider(tenantId, provider, key, firstAdministrator?)`: undefined, or what refused it.
- `runSteward` deps gain `readSecret(): Promise<string>` and `key(): Buffer`.

## Tests

`steward-commands.test.ts`, with a real maker, as its titles say. `config.test.ts`: empty Google settings mean no Google.

## Docs

`deploy/README.md`'s `steward organisation`, its variable table; the guide's section 7; `features.md`; a fragment. No
requirement is added: IAM-059 covers how a first administrator arrives.
