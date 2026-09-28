# 0028 - Personal API tokens in T1, service identities with the MCP facade

- **Status:** Accepted
- **Date:** 2026-09-28

## Context

T1 names "the OpenAPI surface". Three T1 requirements give the API a caller that is not a browser:

- **IAM-033:** service identities distinct from people, never made by impersonating one.
- **IAM-034:** a token with explicit scopes and an expiry, issuable with less than its creator's
  authority.
- **IAM-035:** a token revocable with immediate effect.

Two things stand against building all three in T1. First, nothing in T1 needs a token: the renderer and
the Electron shell both sign in with a session cookie, and the first caller that is not a browser is the
MCP facade, in T5. Second, [the T1 audit](<../reviews/T1 - Audit against the code.md>) found that no
design covers IAM-033, and that service-foundations.md's `api_token` row does not say how a token's
scopes meet IAM-062, under which every permission is held through a role.

The costly and uncertain part is the service identity: who creates one, who owns it once that person
leaves, and how it holds roles without being a person. A personal token has none of those questions. It
acts as the person who made it, and it can be held to IAM-062 by being a mask over that person's grants.
It also covers the integration a T1 customer is most likely to write first: their own script that
publishes on a merge or loads a batch of components.

The audit asked for this decision as K3 and recommended keeping all three in T1. Ken took a narrower
option on 2026-09-28: personal tokens in T1, and service identities moved to T5.

## Decision

**T1's tokens are personal.** A person issues themselves a token that acts as them, can do no more
than they may do, can be limited to less, and has an expiry. Revoking it takes effect at the next request.

- **IAM-034 and IAM-035 stay in T1**, and W12 builds them from service-foundations.md's design as W12.0
  settles it.
- **IAM-033 moves to T5** whole, keeping its identifier, where the MCP facade gives a service identity
  its first real caller.
- **A token's scopes are a mask, never a grant.** A request made with a token is allowed only where its
  creator's grants allow it and its scopes include it, so IAM-062 holds unchanged: no permission is held
  outside a role.

## What would change the answer

- **A T1 customer needs an integration that outlives any one person** - a nightly import owned by a
  department. Then a service identity is needed before T5, and it would be designed against that caller.
- **The MCP facade moves earlier.** It brings IAM-033 with it.
- **Personal tokens prove to be misused as shared ones** - one person's token passed round a team. That
  is what service identities are for, and it would bring them forward.

## Consequences

- W12 builds personal tokens: issued, listed and revoked by their owner, and revocable by a tenant
  administrator.
- An integration that outlives its creator is not possible in T1. When a person leaves and their
  principal is removed or disabled, their tokens stop working with them.
- IAM-033 has no design until T5. access.md already says service identities are the token design's.
