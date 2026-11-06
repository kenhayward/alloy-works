# PC: The provider is asked again, so a leaver's session ends

> **Full tier:** a stored shape (a sealed token per session), sign-in, a requirement amended (IAM-044) and a
> superseded decision (IN-C). One PR. Pre-flight reviewed; Ken's answers (6 November) are marked **(Ken)**.

**Goal:** a person disabled or deleted at their organisation's provider loses access within minutes,
without SCIM (IAM-010). Today their session lasts until it expires, up to 12 hours.

**Why not back-channel logout:** Keycloak, Entra ID and Okta send it when a person signs out, not
reliably when they are disabled or deleted (IN-C's reasoning, and Keycloak's own reports since). All three
refuse a disabled or deleted person's refresh grant with `invalid_grant`.

## Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PC-A | **What is kept:** an organisation sign-in's refresh token, sealed with a new `SealPurpose` to the tenant and the session's id (generated in `createSession`, not by default), in `session.sealed_refresh`, beside `provider_checked_at`. Checks: `sealed_refresh is null or provider_id is not null`, and `like 'v1.%'`, so nothing unsealed is stored. Kept by `createSession` and by re-authentication (`markReauthenticated`), which replaces it. Never logged or sent; a test that it cannot be serialised.                                                                                    |
| PC-B | **Offline access (Ken: yes):** an organisation provider is asked `openid email profile offline_access`; Google's route keeps `openid email profile` exactly. **This amends IAM-044**, with a change history: an online token dies with the provider's own session, and its refusal is the same `invalid_grant` a leaver gets, so without offline access the check would sign innocent people out. A token is kept only when the token response's `scope` includes `offline_access`; otherwise none.                                                                                                |
| PC-C | **When:** on a cookie request whose session was last checked more than **5 minutes** ago (Ken: fixed), before it is answered. Streams need nothing of their own: one lives 5 minutes and comes back through a request, and an ending's notice (PC-E) ends the rest. The provider call has a **3-second** timeout.                                                                                                                                                                                                                                                                                  |
| PC-D | **Never in the request's transaction:** the check is claimed by `update session set provider_checked_at = now() where id = $1 and provider_checked_at < $due returning sealed_refresh`, so one replica asks and the others go on; the provider is called with no transaction open; the rotated token or the ending is written in a second.                                                                                                                                                                                                                                                         |
| PC-E | **The answer:** `invalid_grant` ends the session as a system sign-out (`provider_refused`, a new reason of `authentication.signed_out`), in `withTenant` as the sweep's system act, with `notifyTenant(credential_ended)` so every replica's streams end, and the request is `401 unauthenticated`. **(Ken: yes)** It also revokes the principal's API tokens, since IAM-010 says "lose access" and a token is decided before any cookie. Unreachable, timed out, erring, or the provider closed or unreadable: the session goes on and is asked at the next interval (Ken: kept going, as today). |
| PC-F | **Not covered, named beside the design's table:** Google's route; a provider that will not grant offline access. Both keep today's behaviour, and SCIM still covers them. Also named: a sign-out or an expiry here leaves the offline token alive at the provider until its own lifetime.                                                                                                                                                                                                                                                                                                          |
| PC-G | **The design:** `identity.md` claims IAM-010 for an organisation's provider that grants offline access; IN-C superseded, with `access.md` and `service-foundations.md` brought into line.                                                                                                                                                                                                                                                                                                                                                                                                          |

## Tasks

1. IAM-044 amended with its change history, as Ken agreed.
2. The migration and its test on the old schema (new keys omitted, not `null`); the `SealPurpose`.
3. Sign-in and re-authentication keep the sealed token; scopes per route. The stand-in IdP: the
   `refresh_token` grant, `offline_access`, lifetimes for refresh tokens (no console warning), and a
   disabled flag making `findAccount` refuse.
4. `checkAtProvider` in `sessions.ts`, with the provider read per check (`organisationProvider` injected;
   undefined means "cannot ask", never "refused"). Unit tests: refused, rotated, unreachable and timed out,
   two replicas, re-authenticated, a provider closed; one that never reads another tenant's token.
5. Wired into the cookie path; tokens revoked if PC-E holds. Tests cite IAM-010 in literal titles.
6. The browser suite: Ada disabled at the stand-in is signed out at her next request after the interval.
7. Docs and the fragment. On staging: the realm grants `offline_access`; a throwaway user disabled in
   Keycloak loses their session within the interval.

## Risks

- **Each session's token is a credential at rest:** sealed as client secrets are, so a database read alone
  gives nothing, but alive as long as the provider's offline session.
- **A provider outage** under PC-E's default keeps everyone signed in, as today; failing closed would sign
  everyone out with it.
- **Okta's refresh-token reuse detection:** a rotated token lost between the provider's answer and the
  second write would, outside Okta's grace period, sign the person out. Keycloak revokes nothing by default.
