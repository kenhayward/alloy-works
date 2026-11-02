# ID: Identity

> T7's fourth slice, designed in [identity.md](../design/identity.md). **Full tier**: auth and tenancy,
> a migration of `identity_provider`, `session`, `principal`, `access_group` and `invitation`, new
> routes and a contract outside `/v1` (SCIM). Ken's answers of 2026-11-02 are marked **(Ken)** in the
> design; the rest are defaults. Pre-flight found ten defects, answered in the design (IN-B, IN-I to
> IN-K; IAM-056 no longer claimed).

**Goal:** an administrator configures more than one identity provider, the session lifetimes and SCIM
in Administration; a person disabled by SCIM, or by hand, loses access at once; a sensitive act can ask
for a fresh sign-in; and the riskiest administrative acts are granted apart from `administer`.

| PR  | Holds                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| IDa | This plan and the design; providers as rows, sign-in through each; groups and invitations by provider (IN-I, IN-J); the key rotation test (IAM-011, IAM-065) |
| IDb | Re-authentication, Google's hand-off included (IAM-012); session lifetimes (IAM-038); disabled people and the lockout guard; Administration's **Sign-in**    |
| IDc | SCIM `Users` and `Groups` as a service identity per provider; `provider_key` matching; admitting only the pushed (IAM-008)                                   |
| IDd | The six high-risk permissions and their migration, tokens included (IN-H); IAM-032 cited; the walks; the review; the close                                   |

## Interfaces

- `packages/db`: `listProviders`, `addProvider`, `renameProvider`, `sealProviderSecret`,
  `closeProvider`; `wayInRemains(trx, change)`, the lockout check every guarded act calls;
  `sessionSettings`, `setSessionSettings`; `markReauthenticated(sessionId, at)`; `disablePrincipal`,
  `enablePrincipal`; `scimUsers` and `scimGroups`, over `principal` and `access_group` scoped to one
  provider, and a `scim_group` held for an unmatched one.
- `packages/api-contract`: `/v1/sign-in-settings/providers[/{id}[/secret|/closure|/scim]]`,
  `/v1/sign-in-settings/google`, `/v1/sign-in-settings/sessions`; `/v1/sessions/current/reauthentication`;
  `/v1/principals/{id}/disablement`. A route's `access.recentSignIn`. SCIM is served by
  `apps/service/src/scim.ts`, outside the contract, with a test holding its paths to the design's subset.
- Audit kinds: `sign_in.configured`, `authentication.reauthenticated`, `principal.disabled`,
  `principal.enabled`, `scim.provisioned` (what changed, by resource, never a token).
- Failure codes: `last_way_in`, `reauthentication_required`, `not_provisioned`, `principal_disabled`.

## Tests worth naming

- IAM-011 signs in through each of two providers, the session recording which, and closing one ends only its sessions and its people's tokens.
- IAM-011 a second provider asserting a group value the first's group holds joins nothing.
- IAM-011 an invitation for one provider is not claimed through another asserting the same verified address.
- IAM-065 signs in after the stand-in provider rotates its key, and refuses a token signed by a key it does not publish.
- IAM-038 shortening the idle timeout ends a session idle longer than it at its next request.
- IAM-012 refuses a re-authentication whose subject is another, or whose `auth_time` is before it began.
- IAM-012 a Google re-authentication marks the asking session and makes no other.
- IAM-008 provisions a person by SCIM who then signs in and is bound by the named claim, never by email.
- IAM-008 provisions a person who signed in before SCIM was on as that principal, not a second.
- IAM-008 a provider that provisions refuses a subject it never pushed.
- IAM-070 an Administrator and an `administer` token keep every act after the migration; a role without `export_audit` cannot export the audit.
- IAM-032 explains another person's permissions to an administrator without a session of theirs, and a disabled person's as refused.
- Not cited (IAM-010 and IAM-056 are unclaimed): a person set inactive by SCIM is refused at once and their stream ends within two seconds; a group removed by SCIM applies on receipt; disabling the last person who can configure sign-in is refused.

## Spikes

- **The stand-in provider rotating its key in a running test** (IAM-065): oidc-provider's `jwks` is
  fixed at start, so the test may need a second instance or a restart. Settled in IDa.
- **Re-authentication through the stand-in provider**: that oidc-provider sets `auth_time` and honours
  `max_age=0`. Settled in IDb. Google's behaviour is the design's open question, settled in IDb by a
  real sign-in before IN-D applies to Google sessions.

## Risks

- **Lockout**: `wayInRemains` is the guard; a test drives each guarded act. A SCIM deprovision of the
  last administrator is recovered by an operator command, named in the design.
- **The migration** moves a singleton-keyed row to an `id` key with sessions, attempts, principals,
  groups and invitations pointing at it; migration tests run current code on the old schema.
- **SCIM is a second contract** outside the generated client and the route registries: cross-tenant,
  audit and access coverage are added by hand in `scim.test.ts`.

## As built

- **IDa**: providers as rows, configured by an operator until IDb. Pre-flight's other seams, found
  building: a connection naming people by subject now refuses once a second provider is open
  (`actingOn` read the first row it found); closing a route revokes its people's tokens too. The rotation
  test found that openid-client does not refetch inside its first minute, so `oidc.ts` forgets the keys
  after such a refusal. An invitation's ways are chosen by nobody yet, only defaulted: the invite route's
  `through` comes with IDb's forms, as does the group form's choice of provider, whose route takes
  `provider` now and refuses `group_provider_required` with several open.
