# 0009 - Federation and Google accounts, no local passwords

- **Status:** Accepted
- **Date:** 2026-09-10

## Context

[`Project_Scope.md`](../specification/Project_Scope.md) §10 left the identity strategy open: pure
federation with a customer's own provider, or a first-party identity provider with federation as an
option.

Pure federation is the strongest position - the product holds no credentials, so it cannot lose any -
and it is less exclusionary than it sounds, because Google Workspace and Microsoft 365 are both OIDC
providers and nearly every firm has one. What it does not serve is a tenant that has not set
federation up yet, which is the state every tenant is in for its first hour, and the state a small
evaluation or test deployment may stay in indefinitely.

A first-party identity provider serves that case and buys a password store, reset flows, multi-factor
enrolment, a breach surface and a compliance burden the product would not otherwise carry - all for a
market whose customers mostly have a provider already.

## Decision

**Authentication is federated. The product never holds a password.**

Two routes in:

- **A tenant's own identity provider over OIDC**, which is the expected arrangement for any
  organisation of size, with group membership mapped to roles.
- **Google-authenticated accounts**, for a tenant that has no federation configured. A tenant may be
  set to accept Google accounts only, which is what makes a small deployment or an evaluation work
  before any federation exists.

Supporting choices:

- **A tenant declares which routes it permits.** Google-only, federated-only, or both. A tenant that
  has configured its provider can close the Google route, and should.
- **No local passwords, ever.** Not as a default, not as a fallback, not for administrators. This is
  the part that must not erode: a single "temporary" password path brings the entire burden back.
- **Only basic identity scopes are requested from Google** - `openid`, `email`, `profile` - and
  nothing sensitive or restricted. **The product does not go through Google app verification**, and
  staying inside those scopes is what makes that possible.

## What would change the answer

- **A customer whose policy forbids Google.** Some organisations do, and the answer is that they
  federate, which they can. It only becomes a problem for a customer that has neither a provider nor
  permission to use Google.
- **A feature needing a restricted Google scope.** Requesting Drive or Docs access would put the
  product into verification and a periodic security assessment - see Consequences, because one
  requirement already implies it.
- **External reviewers becoming a supported case.** IAM-Q03 and IAM-Q04 are still open, and this
  record settles how somebody authenticates rather than whether an outside reviewer may be invited at
  all. If they may, guest identities are the mechanism, and Google accounts are how most of them
  would sign in.

## Consequences

- **Google Docs export is now in doubt on a second front.** PUB-054 makes it a labelled lossy export,
  and PUB-Q02 already asked whether it survives. Writing to a user's Google Docs needs Drive scopes,
  which are restricted, which means app verification and a periodic security assessment - exactly
  what this decision avoids. Either that feature goes, or it carries a cost this decision was taken
  to avoid. It should be settled rather than discovered.
- **Onboarding has a route that does not need a customer's IT department**, which matters for
  evaluation and for the first hour of every tenant.
- **The bootstrapping question in ADM-Q04 gets easier**: the first administrator of a tenant can be a
  Google account, without the vendor issuing a credential.
- **IAM keeps the requirement that a disabled upstream account loses access promptly** (IAM-010), and
  that applies to the Google route as much as to a federated one.
- Nothing in the product stores, resets, or emails a password, so none of that has to be built,
  secured, audited, or explained to an assessor.
