# 0069 - An import is a proposal, read in the worker

- **Status:** Accepted
- **Date:** 2026-10-22

## Context

T6 asks that a Word, Markdown or HTML document arrive as structure, broken into sections and
components with the reasons stated (IMP-004), its tracked changes as suggestions and its comments as
threads (IMP-005), navigable and resumable at size (IMP-029), and abandonable with nothing left
behind (IMP-008). A .docx is an untrusted zip of XML. The T1 spike's importer (`content/ooxml`)
builds the spike's model, not the content model, and says itself it is to be replaced. Ken chose a
reviewed proposal, a section per Heading 1 and a component per Heading 2, known people mapped and
the rest kept as text, and our own OOXML reader (2026-10-22; the [IM plan](../plans/2026-10-22-im-import.md)).

## Decision

- **An import is a proposal held apart**: the file, what it read into, the proposed outline and each
  split's reason, in tables of its own, invisible to the space until accepted. Accepting makes the
  document, its sections and components, suggestions and threads in one transaction; abandoning
  deletes the import and its file.
- **Read in the worker**: a .docx is unzipped with caps on entries and inflated size, and read by a
  streaming XML parser (`saxes`) into the content model through admission, as a paste is.
- **One reader per format into one proposal**: Word, Markdown and HTML meet in the same proposal and
  the same review.
- **Identities as the file carries them until acceptance** (IMP-032), then the tenant's policy.

## Consequences

- An import that is never accepted costs storage until it is abandoned or swept.
- The spike's importer is retired.

## What would change the answer

- **Imports at a size the review cannot hold**, which would want accepting part of a proposal at a time.
