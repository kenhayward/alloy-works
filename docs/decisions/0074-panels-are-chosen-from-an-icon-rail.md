# 0074 - A document's panels are chosen from an icon rail

- **Status:** Accepted
- **Date:** 2026-11-01

## Context

A document's panels beside the text (Part, Document, Lists, Assistant, Versions, Publishing, and in
Review Threads, Suggestions, Rounds and Sources) were worded tabs in a strip across the panel. There
are now more than fit at the panel's width, and hidden, the panel left a rail of the same words set
vertically. [ADR-0046](0046-the-ledger-interface.md) decision 6 names panels in words. Ken asked
for a vertical icon rail with each icon named on hover
([the DP canvas](https://claude.ai/artifact/JXQBLQbP6tE79gvMyf8RCw)).

## Decision

**The panels are chosen from a vertical rail of icons on the panel's end edge**, the hide and show
toggle first, then one tab per panel. The rail stands whether the panel is shown or hidden; choosing a
tab while it is hidden shows it at that panel.

This amends ADR-0046 decision 6 rather than reversing it: **every panel is still named in words** -
as its tab's accessible name, as the name shown beside the icon on hover and on keyboard focus, and
as the heading of the panel when it is open. Only the visible tab is an icon.

## What would change the answer

- A panel set small enough to fit as worded tabs at the panel's narrowest width.
- Touch as a primary input, where nothing hovers: the names would need showing another way.

## Consequences

- A panel needs an icon as well as a name; both are tested.
- Counts and warnings the worded tabs carried are drawn as a badge on the icon and stay in its name.
