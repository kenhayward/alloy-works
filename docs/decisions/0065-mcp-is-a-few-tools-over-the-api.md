# 0065 - MCP is a few tools over the API, as their caller

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

T5 gives agents an MCP surface (API-018 to API-024) and machine callers identities of their own
(IAM-033). The API is the contract every route answers (API-003, `openapi.json`), and its callers
authenticate with a session or a personal token
([ADR-0028](0028-personal-api-tokens-in-t1.md)). An MCP surface can be a generated mirror of the
API, which API-018 forbids, or a separate service holding its own queries, which would be a second
path to the data and a second set of permission checks (IAM-036). Ken chose HTTP on the service,
service identities an administrator makes, reads plus writes that go to review, and every call
audited (2026-10-21; the [G8 plan](../plans/2026-10-21-g8-mcp-and-service-identities.md)).

## Decision

- **`POST /mcp` on the service**, stateless Streamable HTTP with JSON answers, a bearer token its
  only credential. It is outside the contract: JSON-RPC is not a REST route, and `openapi.json`
  describing it would mislead an integrator.
- **A tool is the `/v1` route it wraps**, called in process with the caller's token, host and request
  id, so tenancy, scopes, permissions and the route's own audit apply exactly as over HTTP. A tool
  shapes arguments and trims answers; it holds no query.
- **The tools are few and named in the plan**; adding one is a decision recorded there, never a
  consequence of adding a route (API-024).
- **A service identity is a principal of kind `service`** with no sign-in identity, made by an
  administrator, granted roles as a person is, and issued tokens by an administrator.
- **Versions** (API-052): every tool wraps a `/v1` route. A `/v2` names in its own ADR the tools that
  move to it, those pinned to `/v1`, and the date `/v1`'s stop.

## Consequences

- The surface can do nothing its caller's routes cannot, which is IAM-036's guarantee for MCP.
- A tool costs an in-process request: small beside a model's turn.
- A client that connects only by OAuth (a hosted connector) cannot use a static token; that waits for
  an authorisation server.
- A service's token lasts at most a year (TK-C), so an integration's is reissued yearly.

## What would change the answer

- **OAuth for MCP clients**, which would add an authorisation server and dynamic client registration
  in front of the same tools.
- **A tool no route answers**, which would mean adding the route first, or revisiting this.
