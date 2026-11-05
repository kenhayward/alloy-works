# 0092 - Mail leaves by SMTP through the connector

- **Status:** Accepted
- **Date:** 2026-11-05

## Context

Notifications by email (COL-064), a tenant choosing what its mail is sent from (COL-060), invitations (IAM-089) and closure
notices (ADM-055) need a way out. [system.md](../design/system.md) left the provider open. A vendor's API would add a
vendor to the product and could not reach a regulated tenant's own relay. A new tenant's first administrator must be
invited before that tenant could have set up anything. A tenant's own relay is a host an administrator chose, the case
[ADR-0064](0064-model-calls-leave-through-the-connector.md) sent through the connector.

## Decision

- **SMTP, with no vendor's API.** Every provider speaks it. Mailpit stands in during development.
- **The operator's relay by default, and a tenant's own.** The operator's sends from the operator's address with the tenant's
  name, so no tenant can send as another's domain; its password is the connector's alone.
- **Through the connector**, its pinned address and a child per send. Port 465 or 587, TLS required, its certificate verified
  by name.
- **A password is sealed to the tenant, host, port and username**, and asked for again on changing any.
- **A tenant's own relay may be on a private address**, past the guard's permanent refusals. The webhook rule is public hosts
  only because the reply is shown; here only a code is.
- **`nodemailer`, with every value refused a line break first.** At the spike it pinned, verified and kept headers and body safe,
  but a line break in a recipient changed who the mail went to, and its errors quote the relay's reply, so neither reaches it
  or leaves it.

## What would change the answer

A bulk sender's rules that SMTP cannot meet, or a deployment where no relay can be run or bought. Finding that private
relays let an administrator probe the network in spite of showing only a code would close that one bullet.

## Consequences

- The operator must run or buy a relay, or a tenant must name one, before anybody gets mail.
- SPF and DKIM on a tenant's own relay are the tenant's. Nothing checks them.
- Bounces are not seen: they need inbound mail.
- The connector gains a dependency, and a kind of exchange that is not HTTP.
