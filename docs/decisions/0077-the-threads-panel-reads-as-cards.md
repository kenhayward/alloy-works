# 0077 - The threads panel reads as cards, found in the browser

- **Status:** Accepted
- **Date:** 2026-11-03

## Context

[The handoff](../interface/handoffs/threads-panel/README.md) turns the panel's list of rows into cards under
a people strip and a search that takes `@person`. [The TP plan](../plans/2026-11-03-tp-threads-panel.md)
records where the code answers it otherwise.

## Decision

1. **The panel reads every thread in every state and filters in the browser.** Show's counts, the strip's
   badges and the search need them all, and it read every page already. `GET .../threads` answers each
   thread's participants, the people it names and every comment's latest words. Its `state`, `author` and
   `since` filters stay for integrators.
2. **The text's marks follow Show's state; a component's gutter glyph means any open comment.**
3. **New is per person and thread** (COL-070): somebody else's comment after the mark, or no mark. The mark
   is the server's, to the microsecond, and never moves back. No backfill, so on the first day every thread
   somebody else commented on is new: a backfill would invent reads, and one click clears it.
4. **A thread opens in place, or across the panel**, with one way of drawing its comments. An address opens
   it across the panel. Editing one's own comment is across the panel only.
5. **Mentions are typed where they belong in a plain `textarea`**, tracked by position, since two people can
   share a name. No `contenteditable`. Text typed into a mention stops it being one.
6. **The composer promises nobody will hear.** Who may not read a thread is known only once it is sent, and
   a person's cadence may be daily or never, so "will be notified" is not said.

## What would change the answer

Documents with thousands of threads, where reading every page stops being quick: then the list filters on the
service again, and Show's counts come from a route of their own. And a real need for a chip in the box as a
mention is typed, which would take a small editor rather than a `textarea`.

## Consequences

The list answer grows with every comment's words. A thread with very long comments costs more per page; if
that shows, `words` moves behind a query parameter. J and K are single printable keys, live only with the
focus in an opened thread and outside anything typed into (WCAG 2.1.4, ADR-0076). The panel names itself, so
the dock's heading gives way to it, as it does for the Assistant.
