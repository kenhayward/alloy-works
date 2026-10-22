# 0067 - Citations are CSL, rendered by citeproc-js

- **Status:** Accepted
- **Date:** 2026-10-22

## Context

T6 asks for citation styles that declare an in-text and a bibliography form, ordering and
disambiguation (STY-020, STY-022), CSE, Vancouver and Harvard among them (CNT-102), and new ones added
without a code change (STY-023, API-032). The Citation Style Language is the open standard for exactly
this, with thousands of published styles. A style needs a processor; the reference one, citeproc-js, is
licensed CPAL-1.0 or AGPL-3.0, and this repository is Apache-2.0 and runs as a hosted service. The
permissive alternative, hayagriva, is Rust. [ADR-0007](0007-no-per-server-licensing-in-the-publishing-pipeline.md)
asks only for open source in the rendering path. Ken chose CSL, and citeproc-js under CPAL, unmodified
(2026-10-22; the [CI plan](../plans/2026-10-22-ci-citations.md)).

## Decision

- **A citation style is a CSL 1.0.2 file**, uploaded as a tenant's managed artifact; CSE, Vancouver and
  Harvard are seeded. Entries are held as CSL-JSON.
- **citeproc-js renders every form**, in-text and bibliography, for the editor, PDF and Word alike, so
  no two outputs disagree.
- **Taken under CPAL-1.0, never modified**: pinned, its notices kept, and its attribution
  (citeproc-js, Copyright (c) 2009-2019 Frank Bennett) shown in
  About alone (Ken, 2026-10-22: that meets its terms), never where citations are used. A change we
  need is made upstream, or this is revisited.
- **The styles' own licence (CC BY-SA 3.0) is kept** with each seeded file.

## Consequences

- A tenant can add any published CSL style without a release.
- The product carries one CPAL dependency, whose terms bind us only as distributed unmodified with
  attribution.

## What would change the answer

- **A need to change citeproc-js**, or a reading of CPAL's attribution or network terms that asks more
  than the attribution shown: hayagriva compiled to WebAssembly is the fallback.
