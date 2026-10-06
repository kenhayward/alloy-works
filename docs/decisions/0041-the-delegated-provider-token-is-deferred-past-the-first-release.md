# 0041 - The delegated provider token is deferred past the first release

- **Status:** Accepted
- **Date:** 2026-10-06

## Context

DAT-076 has two halves: an asserted identity, which D7 built for PostgreSQL, and a delegated one, in
which the session holds the person's token from their sign-in provider and the connector exchanges it
for one an HTTP or S3 source accepts (RFC 8693). Ken moved the delegated half from D7 to D6, the
slice that builds HTTP and S3 ([the D6 plan](../plans/2026-10-06-d6-http-s3-and-files.md), D6.4).

Planning D6 found it the slice's only authentication risk, asked for by no tenant, and likely to be
redesigned by the first that does: Microsoft Entra ID's on-behalf-of flow is not RFC 8693. Ken
answered on 2026-10-06: build D6.1 to D6.3, defer the token.

## Decision

**The delegated provider token is not built in T2, and is not scheduled.** D6 builds HTTP and S3
connections and the CSV, JSON and XLSX readers with the connection's own secret only; its close rides
in D6.3. When the token is scheduled, it is planned from the D6 plan's D6.4 and the D7 plan's D7-K,
against the provider the first tenant uses.

- **No requirement moves.** DAT-076 stays in T2, Designed, its delegated half named as a gap in
  data.md beside the claim.
- **An HTTP or S3 connection declares no identity but `service`**, as D1 left it: a connection that
  declares `delegated` is refused `identity_not_supported`.

## What would change the answer

- **A tenant before the first release needs each person's own authority at an HTTP or S3 source.**
  Then D6.4 is planned next, for that tenant's provider.
- **A provider that tenants share adopts RFC 8693**, making one exchange serve most of them.

## Consequences

- Sessions hold no provider token; sign-out ends only the product's own authority.
- An HTTP or S3 result is never a person's own view, so DAT-091's warning does not arise for them.
