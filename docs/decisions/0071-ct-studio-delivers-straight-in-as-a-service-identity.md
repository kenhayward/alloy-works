# 0071 - CT Studio delivers straight in, as a service identity

- **Status:** Proposed
- **Date:** 2026-10-29

## Context

CT Studio decomposes a source document into sections, tables, notes, images and properties, and
extracts data tables, and delivers both through its delivery bridge to sinks that speak one contract
(`@kenhayward/bridge-contract`). 3ds-sink is the first, a service of its own. Ken wants Alloy Works to
be a second, with the same capabilities through the contract, writing Alloy Works' own content and
landing it without a person accepting it here (2026-10-29).

That collides with three rules. **API-N05** rules out unattended bulk import through the API, and
**IMP-003** says import never runs unattended, both because an endpoint that skipped the proposal
would skip the person. **API-Q05** left batch create and update for native content open until "the
first integration that needs it". This is that integration. What sets it apart is that a person has
already reviewed the decomposition in CT Studio, the split is CT Studio's and not a judgement Alloy
Works would make, and the content arrives already in a structure that maps one for one.

## Decision

- **One exception to API-N05 and IMP-003**: a delivery through CT Studio's bridge contract lands as
  content, with no proposal, as **API-065** states. No other caller and no other format gets it.
- **Served by the Alloy Works service** under `/bridge`, not by a separate sink service: the bridge's
  signature proves the caller is the bridge, and the target's credential, a service identity's token,
  says who is acting, so a delivery can do exactly what that identity's grants allow.
- **All or nothing, at most once per key**: one tenant transaction per delivery, a replayed key
  answers the first receipt.
- **Identifiers derived, not reassigned**: admission runs without `reidentify`, so a later delivery
  of the same document finds the same components and blocks.
- **Data tables as real Postgres tables** in a delivery store the connector reaches, read through an
  ordinary connection and SQL query definitions.
- **API-Q05 is answered for this integration only**: general batch endpoints for native content stay
  open.

## What would change the answer

- A second integration asking for the same exception: the carve-out would want a general rule, not a
  second exception.
- CT Studio's contract gaining withdraw, a language or a status callback: each is additive here, but
  withdraw would need its own decision about deleting a person's later edits.
- A need for a person to accept deliveries after all: deliveries would become proposals in the
  import's tables, and this record would be superseded.

## Consequences

- Alloy Works depends on CT Studio's published contract package and must pass its conformance suite
  at each version it declares.
- Content written by a service identity, unattended, appears in spaces; its provenance is on every
  version's note and in `bridge_delivery`, and each delivery is audited.
- A second Postgres database joins the deployment.
- A person editing delivered content in Alloy Works makes the next CT Studio update of it refuse,
  `changed_in_target`, until CT Studio detaches it.
