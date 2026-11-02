# Identity

Who may sign in to an environment, through which providers, for how long, and who may do its riskiest
administrative acts: T7's fourth slice. It extends [service-foundations.md](service-foundations.md)
("Signing in", "Sessions and tokens") and [access.md](access.md) ("Groups", "Permissions"). Ken's
answers of 2026-11-02 shaped it, and [the ID plan](../plans/2026-11-02-id-identity.md) builds it.

## The shape in one paragraph

An environment has **any number of identity providers**, each an OpenID Connect client with a name
shown at sign-in, its own sealed secret, its groups claim and the claim that links it to SCIM. A
provider's groups and invitations are its own: another provider cannot assert them. An administrator
configures providers, the Google route and **the session lifetimes** in Administration's **Sign-in**,
each change needing `configure_services` and a sign-in made in the last ten minutes. **Re-authentication**
is a sign-in through the session's own way in with `max_age=0`, accepted only for the session's own
subject with an `auth_time` after it began. A provider may **provision by SCIM 2.0** through a service
identity of its own: people and groups pushed, a person set inactive or deleted disabled at once, their
sessions and tokens ended in the same transaction; without SCIM an administrator disables a person by
hand. **Six high-risk acts** leave `administer` for permissions of their own.

## Requirements owned

| ID          | How it is met                                                                                                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **IAM-011** | `identity_provider` holds any number of rows; sign-in offers each open one by name; the attempt, the session, the principal, its groups and its invitations name which ([Providers](#providers))                                                                               |
| **IAM-065** | A token naming a key not held is refused where the keys were fetched in the last minute, and the provider's keys are then fetched afresh, so the next sign-in needs no step; a key that still cannot be resolved stays refused. Tested by rotating the stand-in provider's key |
| **IAM-038** | `session_settings`: idle timeout and absolute lifetime per environment, within product bounds; a shortening reaches open sessions at once ([Session lifetimes](#session-lifetimes))                                                                                            |
| **IAM-012** | `POST /v1/sessions/current/reauthentication`, through the sign-in callbacks; the session records `authenticated_at`, which a route may require to be recent ([Re-authentication](#re-authentication))                                                                          |
| **IAM-008** | SCIM 2.0 `Users` and `Groups` per provider, as a service identity of its own; without SCIM, people are invited and disabled in Administration, documented in the administration guide ([SCIM](#scim))                                                                          |
| **IAM-032** | Access explains any person's permissions on any artifact, space or the environment to an administrator (IAM-029) without a session of theirs; a disabled person's every answer is refused, naming it                                                                           |

**Not claimed.** **IAM-010** is met only for a provider that provisions by SCIM: a person disabled at a
provider without it keeps their session until it expires or an administrator disables them here.
Back-channel logout was considered and left out (IN-C). **IAM-056** is met for a provider that
provisions by SCIM, whose memberships come from SCIM alone and apply on receipt; without SCIM they are
re-read at each sign-in and re-authentication, which a person using only a token never makes, so no
interval bounds them. **IAM-070** names eight acts; six exist and are split out here, and suspension or
closure (the TL slice) and granting support access (ADM-042) take their permissions when they are
built, since a permission no check reads is a promise with nothing behind it
([permissions.ts](../../packages/domain/src/access/permissions.ts)). IAM-068 and IAM-079,
organisation-wide providers, are TL's.

## Providers

`identity_provider` loses its singleton key for `id`, and gains `name` (shown on the sign-in page,
unique), `closed_at` and, in IDc, `scim_claim` (`sub` or `oid`, IN-E). An issuer is configured once,
since two clients of one issuer would sign the same people in twice over. The existing row becomes the first
provider, named "Your organisation". These gain `provider_id`, the existing rows the first provider's:

- `sign_in_attempt` and `session`, null for the Google route; `route` keeps its two values. The attempt
  also gains `purpose` (`sign_in` or `reauthentication`).
- `principal`, null for a Google or service principal, and `provider_key`, the value of the provider's
  `scim_claim` from its last sign-in, unique per provider. `principal_identity_whole` still holds, so a
  principal pushed by SCIM before signing in has a `provider_id` and no issuer or subject yet.
- `access_group`, for a provider group: `provider_value` becomes unique per provider, and a claim is
  applied only to the groups of the provider that asserted it (IN-I).
- `invitation`: the ways in it may be claimed through, `through_google` and `invitation_provider`. It
  may be claimed through the providers open as it is made, so one added later cannot claim it by
  asserting its address; an environment's first provider takes the invitations already waiting, since
  a first administrator is invited before the customer's provider is configured. An invitation made
  before ID keeps every way open at the time. A principal pushed by SCIM is never claimed by address
  (IN-J).

`/v1/sign-in/organisation?provider={id}` starts a sign-in; with several open and none named it goes
back to the application, which offers each by name. The callback stays one address per environment,
`CALLBACK_PATH`, the attempt naming the provider, so a customer registers one redirect URI per
environment as today.

**A connection naming people by subject** (DAT-117) names nobody once a second provider is open: a
subject means a person only at one provider, and the connection does not say which, so each act is
refused `identity_unavailable` until one is closed. A connection naming people by email still takes a
verified address from any provider, so a provider is trusted with that when it is added: the Sign-in
page says both as a provider is added (IDb).

**Closing a provider** ends every session it issued, revokes every token held by its principals and
its SCIM identity, as closing a route ends sessions (IAM-043; a route's close gains the same token
revocation). See [Lockout](#lockout) for what is refused.

**Keys** (IAM-065): openid-client fetches a provider's keys again when they are five minutes old, or
when a token names a key they lack and they are at least a minute old. A provider publishing a new key
before signing with it, as Entra ID and Okta do, is picked up by that alone. One signing with a key
within that minute has that token refused, since the code is already spent, and the service then
forgets the provider's keys, so the next sign-in fetches them. A key that still cannot be resolved is
refused every time. A refusal is recorded as any refused sign-in is, `provider_refused`.

**Where a provider is reached** (IN-A moved an issuer from an operator to an administrator, and what it
publishes names more addresses): every request to a provider, discovery, token and keys, goes through
`oidc-fetch.ts`, which requires HTTPS, refuses a name with any address that is loopback, private,
link-local or an IPv6 spelling carrying an IPv4 address, dials the one address it checked, and follows
no redirect. `ALLOW_INSECURE_ISSUERS`, development's setting for the stand-in, turns it off. An issuer
is not probed as it is added, since the request deciding it holds the access epoch: one that cannot be
reached is answered as a closed way in, and logged by the fact alone.

## Administration's Sign-in

One page, `configure_services` at the environment (`administer` until IDd splits it out):

- **Providers**: add (name, issuer, client id, secret, groups claim, SCIM claim), rename, replace the
  secret (`rotate_secrets`, write-only, never returned), close. The redirect URI to register is shown,
  read from the hostname.
- **Google**: the route on or off, and its Workspace domains.
- **Sessions**: idle timeout and absolute lifetime.
- **SCIM**: per provider, turned on (making its service identity) or off, its token made (shown once),
  last used, revoked.

Every change is audited (`sign_in.configured`, naming what changed and never a secret) and needs a
recent sign-in (IN-D). The page asks for one when it opens, before any form, so nothing typed is lost to
the redirect.

## Lockout

An act is refused, `last_way_in`, when afterwards no enabled person could both sign in through an open
way in and hold `configure_services` at the environment (IN-B). The acts checked: closing a provider or
the Google route, disabling a person by hand, and the grant and role changes the last-administrator
guard already checks for `administer` ([access.md](access.md)), which now checks this as well. Closing
the provider of the asker's own session is refused as well. It counts as that guard counts: a direct,
unexpiring allow, never a group's, since a membership can go at any sign-in. An environment with no such
way in today has none to lose, and nothing is refused for it.

A SCIM deprovision is never refused, since a provider retries what it is refused: one that disables the
last such person leaves the environment to an operator's `pnpm` command, which enables a named person.
That is named, not built around.

## Session lifetimes

`session_settings` holds `idle_minutes` (5 to 1,440; default 60) and `absolute_hours` (1 to 720;
default 12), today's `SESSION_POLICY`, which the cookie's `maxAge` reads from now on too. A session's
expiries are written from them at sign-in; a change also rewrites every open session's expiries to the
lesser of what it had and what the new settings give, in the same transaction, so shortening takes
effect at once and lengthening only for new sessions (IN-F).

## Re-authentication

`POST /v1/sessions/current/reauthentication` (a session only, never a token) records an attempt of
purpose `reauthentication` and returns where to send the browser: the session's own provider, or
Google, with `max_age=0` and `prompt=login` where the provider takes it. It returns through the same
callbacks as a sign-in, Google's through `signin.<domain>` and its hand-off as today; a hand-off of
purpose `reauthentication` marks the asking session rather than making one. The result is accepted only
when the issuer and subject are the session principal's and `auth_time` is after the attempt began; it
sets `session.authenticated_at`, re-reads groups as a sign-in does, and returns to the page that asked.

A route declares `access.recentSignIn: 600` (seconds); a request whose session authenticated longer
ago is refused `reauthentication_required`. A token never satisfies it. ID's own consumers are the
Sign-in page's changes; SG's signing is the next.

## SCIM

SCIM 2.0 (RFC 7643, RFC 7644), the subset Entra ID and Okta use, at `/scim/v2/` on the environment's
hostname, outside `/v1` and the generated client. Each provider that provisions has **a service
identity of its own** whose token is the bearer token (IN-K), so the audit names it, disabling it stops
it, and its last use shows as any service identity's does. It reads and writes only principals and
groups of its provider; never a service, a Google or another provider's principal.

- `Users`: create, read, list filtered by `userName eq` or `externalId eq`, replace, patch (`active`,
  names, emails), delete. `ServiceProviderConfig`, `Schemas` and `ResourceTypes` describe the subset.
- `Groups`: create, read, list filtered by `displayName eq`, patch members, replace, delete.

**A person pushed** is matched first to the provider's principal whose `provider_key` equals its
`externalId`, so a person who signed in before SCIM was turned on is the one provisioned, not a second.
Otherwise a principal is made with the `provider_id` and `provider_key` and no subject. At a sign-in
through the provider, a principal not found by issuer and subject is matched by the provider's claim
against `provider_key`, and the subject bound; from then on they are found by issuer and subject. Email
is never the link (IN-E). **A provider that provisions admits only those it pushed**: a subject matching
no pushed principal is refused, `not_provisioned`, rather than made.

**Active false or delete** disables the person (below). Delete keeps the principal, disabled, so
authorship and the audit still name them; erasure stays ER's act (IN-G). Active true enables only those
SCIM disabled, since a provider replays what it holds and must not undo an administrator's disablement.
Pushing somebody deleted brings them back.

**So that turning SCIM on locks nobody out** before the first push, somebody already known by issuer and
subject who holds `administer` at the environment by a direct, unexpiring grant is admitted though not
pushed (IN-B). Their memberships still come from SCIM alone.

**Groups**: a SCIM group matches its provider's group whose value equals its `externalId`, else its
`displayName`. For a provider that provisions, memberships come from SCIM alone, applied on receipt,
and the groups claim is no longer read, so a token that leaves a group out (Entra ID's overage) removes
nothing. A SCIM group with no provider group is held, so one made later picks up its members.

## Disabled people

`principal.disabled_at` (with `disabled_by`: SCIM or a person). Disabling deletes the principal's
sessions and revokes their tokens in the same transaction, saying `credential_ended` as signing out
does, so their stream stops within two seconds. A disabled principal is refused at sign-in
(`holdPrincipal`), at re-authentication, at an invitation's claim and at token creation, and Access
answers every question about them as refused, naming the disablement.

**The manual path**: Administration's **People** gains Disable and Enable for any user principal,
`administer` at the environment; the [administration guide](../guides/people-and-scim.md) documents
inviting and disabling as the path without SCIM.

## High-risk permissions

Six permissions join the closed set; every route below loses `administer` for its own:

| Permission           | Routes                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `export_environment` | `/v1/exports`                                                                                 |
| `export_audit`       | `requestAuditExport`, `getAuditExport`, `downloadAuditExport`                                 |
| `hold`               | `/v1/holds` apply and release                                                                 |
| `rotate_secrets`     | a connection's credential, a model endpoint's key, a webhook's secret, a provider's secret    |
| `configure_services` | connections, model endpoints and routes, reference sources, CT Studio and the bridge, Sign-in |
| `configure_webhooks` | `/v1/webhooks` but its secret, which is `rotate_secrets`                                      |

The Administrator starter role, every role holding `administer`, and every token scoped `administer`
gain all six by migration, so nobody and no automation loses an act on upgrade; a tenant then makes a
narrower role (IN-H). All six join `externalCap`. Access explains them as any other permission
(IAM-029 to IAM-031).

## Decisions

| #    | Decision                                                                                                                 | Instead of                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| IN-A | **Sign-in is configured in Administration** (Ken), not by an operator                                                    | Several providers configured through `dev:setup` and the database, a customer needing us for each change      |
| IN-B | **No act leaves nobody able to sign in and configure sign-in**; a SCIM deprovision excepted, recovered by an operator    | Guarding only a provider's close, or a warning, which still lets an environment lock itself out               |
| IN-C | **SCIM plus a manual disable** (Ken) is how a disabled person loses access; back-channel logout left out                 | Back-channel logout, which Entra ID and Okta send at sign-out, not when a person is disabled                  |
| IN-D | **Sign-in changes need a sign-in in the last ten minutes**, asked for as the page opens                                  | Re-authentication with no consumer until SG; or asked for at save, losing the form to the redirect            |
| IN-E | **A provider names the claim equal to SCIM `externalId`** (Ken): `sub` (Okta) or `oid` (Entra ID), kept at every sign-in | Linking by email, which can be reassigned, and Entra's `userName` is the UPN                                  |
| IN-F | **A shortened session lifetime applies at once**; a lengthened one to new sessions                                       | Every session keeping the lifetime it began with, so a shortening waits up to the old lifetime                |
| IN-G | **A SCIM delete disables, never erases**                                                                                 | Erasure on delete, which removes authorship a provider's clean-up should not                                  |
| IN-H | **Six permissions now, two with their acts**; existing administrators and `administer` tokens keep every act             | All eight now, two read by no check                                                                           |
| IN-I | **A provider's groups are its own**: its claim and its SCIM touch only them                                              | One namespace of provider values, where a second provider asserting `admins` joins the first's administrators |
| IN-J | **An invitation names its ways in**; a SCIM-pushed person is never claimed by address                                    | Any provider asserting a verified address claiming any invitation, grants included                            |
| IN-K | **SCIM acts as a service identity per provider**, admitting only those it pushed                                         | A bare provider token, which the audit cannot name as an actor                                                |

## Open questions

| ID  | Question                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New | Whether Google honours `max_age=0` with an `auth_time` for every account. Settled in IDb before IN-D applies to a Google session; if not, Ken chooses between a Google exemption and none |
| New | Whether Entra ID's provisioning accepts the SCIM subset as built; its validator is run against a deployed environment, not CI                                                             |
