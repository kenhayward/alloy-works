# 0029 - A browser suite in CI, and audits a person attests

- **Status:** Accepted
- **Date:** 2026-09-28

## Context

The renderer is tested in jsdom, which lays nothing out, measures nothing and runs no accessibility
engine. [The T1 audit](<../reviews/T1 - Audit against the code.md>) found six T1 requirements that
jsdom cannot demonstrate. It asked, as K4, whether CI should download a browser.

- **CNT-078 and CNT-139:** the editor meets WCAG 2.2 AA, verified rather than asserted.
- **CNT-076 and STR-039:** the view and the outline stay usable on documents of several hundred
  components or nodes, against scope §11's budget.
- **STR-006:** the outline can be edited by pointer and by keyboard.
- **STY-053:** the editor half of every style property rendering the same measured value in each output.

Two of these also ask for something no test can do. CNT-139 asks for a recorded manual audit against
WCAG 2.2 AA before each release. PUB-090 asks for the Matterhorn Protocol checkpoints that only a person
can judge to be reviewed whenever the engine, the template or the pipeline changes. A requirement that
says a person must look can never be Covered by a test, so as written each could never close.

The baselines already have the answer: a requirement a baseline declares with `attestation` is verified
by a named person on a named date for that release (baselines/README.md, "Verification").

## Decision

**CI runs a real browser.** A separate job runs Playwright over a pinned Chromium, the browser pinned as
Typst is, so a browser update never changes a result unannounced. The job runs the renderer against
the service's test stack. axe-core checks the editor's WCAG criteria automatically, and the same job
measures rendered style values, drives the outline by pointer and keyboard, and times the views on
large documents.

**What only a person can check is a requirement verified by attestation.** CNT-139 and PUB-090 are
each split in two:

- The automated half stays a T1 requirement that a test cites: CNT-176 and PUB-103.
- The person's half becomes a T1 requirement of its own that each release's baseline verifies by
  `attestation`, naming who looked and when: CNT-177 and PUB-104.

## What would change the answer

- **The browser job proves too slow or too flaky for every pull request.** It would then run nightly
  and on a release tag, with the jsdom suite still gating each pull request.
- **An accessibility engine good enough to replace the manual audit.** None is: automated checks find a
  minority of WCAG failures, which is why the manual half exists.

## Consequences

- W13 builds the browser job and its tests.
- CI downloads Chromium once per runner, cached by its pinned version.
- Each release's baseline carries an attestation row for CNT-177 and PUB-104. A release whose person has
  not looked cannot declare them met.
