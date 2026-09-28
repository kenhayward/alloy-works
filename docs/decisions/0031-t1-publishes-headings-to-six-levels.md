# 0031 - T1 publishes headings to six levels

- **Status:** Accepted
- **Date:** 2026-09-28

## Context

PUB-090 asks that PDF output be tagged and conform to PDF/UA-1. PDF/UA-1 knows six heading levels,
`H1` to `H6`. STR-007 lets an outline nest sections nine deep.

The first publishing slice measured the pinned Typst 0.15.1: a heading below level six is tagged as a
paragraph. That fails a checkpoint only a person can judge, since the document's structure then
disagrees with what it shows, and veraPDF does not catch it. PDF/UA-2 has unbounded heading levels,
but Typst does not write PDF/UA-2.

[The T1 audit](<../reviews/T1 - Audit against the code.md>) asked, as K6, whether to cap publishing at
six levels or to hold PUB-090 open until the engine catches up.

## Decision

**T1's PDF publishing is capped at six heading levels.**

- A document with a heading deeper than six levels fails the publish, naming the section, at the
  compose stage.
- The outline still nests to nine levels (STR-007). Only publishing refuses. An author sees the
  refusal as they see any other, at its place in the outline.
- **PUB-090 is superseded by PUB-103 and PUB-104.** PUB-103 is the automated half: tagged, passing
  veraPDF's PDF/UA-1 profile on every publication, and refusing a heading deeper than six by name.
  PUB-104 is the person's half, the Matterhorn checkpoints reviewed on the regression corpus, verified
  by attestation ([ADR-0029](0029-a-browser-suite-in-ci-and-attested-audits.md)).

## What would change the answer

- **Typst writes PDF/UA-2**, or tags a seventh level as a heading under PDF/UA-1's role mapping. Then
  the cap lifts to the outline's nine.
- **A customer's documents routinely go deeper than six.** The workaround in T1 is to restructure them;
  a customer who cannot would bring forward a different engine path for deep headings.

## Consequences

- W14 adds the refusal and its test, and PUB-103 closes with PUB-091's veraPDF run.
- Word is not capped, since Word numbers and tags nine heading levels. The cap is the PDF's alone, and
  a document refused for PDF can still be published to Word.
