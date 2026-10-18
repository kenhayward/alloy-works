# 0064 - Model calls leave through the connector

- **Status:** Accepted
- **Date:** 2026-10-18

## Context

T5 calls a tenant's model endpoints ([generation.md](../design/generation.md), GEN-027), self-hosted
ones among them (GEN-027, GEN-030). [system.md](../design/system.md) had the service call them. A
self-hosted endpoint is a host a tenant administrator chose, which is the case
[ADR-0034](0034-data-connectors-run-apart-as-a-declared-identity.md)'s spike tested for sources:
from the caller, a redirect returned the stand-in metadata credential and a DNS rebind reached the
platform's Postgres past a guard that approved both; from the connector's own network, neither
answered. The connector also already seals and opens credentials with a key the service never holds.

## Decision

- **Every model call, embedding included, leaves through `apps/connector`**: its guarded HTTPS
  client, its network, its child per request. The service and the worker never reach an endpoint.
- **An endpoint's key is a connector-sealed secret** (purpose `model-credential`), set write-only
  and opened only in the connector, as a connection's credential is (GEN-029).
- **The connector gains a streamed answer**: the child writes each chunk as a line, the supervisor
  relays it, and the service passes it on as the run's `text/event-stream`. Closing the request
  ends the child.

## Consequences

- A model call costs one more hop and a process (41 ms at the spike), small beside a model's first
  token.
- The connector becomes the one process that reaches anything a tenant names: sources, models, and
  later webhooks and extensions (GN-D).
- A connector outage stops generation as it stops queries; both fail visibly (GEN-032).

## What would change the answer

- **A platform-held model account** (GN-C, declined 2026-10-18), whose endpoint the platform
  chooses: it could be called from a process of its own without the guard.
- **A child per call too slow for streaming**, measured, which a warm child per tenant would answer
  inside the connector.
