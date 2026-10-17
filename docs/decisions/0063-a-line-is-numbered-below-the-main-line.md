# 0063 - A line is numbered below the main line

- **Status:** Accepted
- **Date:** 2026-10-17

## Context

A divergent line (LIF-044; the [R16 plan](../plans/2026-10-17-r16-divergent-lines.md)) is a second
head in one component's version chain: its own versions, beside the main line's, in
`artifact_version`. About fifty reads across the store take "the latest version" by ordering
`artifact_version` by `(revision_no, version_no)` descending - publishing, gates, suggestions,
restore, numbering, impact, deletion, search. A line's version numbered `2.6` beside a main line at
`2.5` would be taken as the latest by every one of them, and serve a line where the main line is
meant. Filtering each by line touches every one, needs a guard in each for the schemas before the
column exists that migration tests run against, and any read written later without it is wrong
silently.

## Decision

- **A line's versions are stored with `revision_no < 0`**: the line's ordinal, negated, every version
  of line 1 at `-1`, line 2 at `-2`, its `version_no` counting from 1. A main-line version keeps
  `revision_no >= 0`. `artifact_version` gains `line_id`, and one check holds the two together.
- **So every read ordering by the numbers takes the main line**, unchanged, on every schema. A read
  that lists every version - the versions panel, earlier versions in search - holds itself to the
  main line with `revision_no >= 0`, which needs no guard. A line is read only where it is asked for.
- **A line's number as people see it is computed, never stored**: the revision it diverged from, or
  its latest designated, and its version's place, `US 2.3`. Designations stay one sequence across
  lines (`revision_designation` unchanged).

## Consequences

- `revision_no` is a sort key as well as a number: a negative one means a line, and nothing may
  show it.
- A read added later that orders by the numbers is right for the main line without knowing lines
  exist. One that must see a line names it.

## What would change the answer

- **Lines on more than components, or many lines on one artifact**, where a line's own reads become as
  common as the main line's. Then a line column on every read, and an index on it, pays for itself.
