# 0053 - The toolbar has a second line

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

The editor's options came as bands stacked between its toolbar and its text, each appearing as the
cursor moved: Paragraph style, a list's options, a preformatted block's language, a figure's, a
value's. The text jumped down and up as they came and went, and a list's band offered a Kind select
that repeated the toolbar's own Bulleted and Numbered buttons. Ken asked on 10 October 2026 for one
line reserved under the toolbar instead.

## Decision

1. **One second line under the toolbar, always there while the text is open**, so nothing under it
   moves as options come and go. What the selection offers is set along it, the groups well apart.
2. **Paragraph style stands first on it**, wherever the selection touches a paragraph.
3. **A list's options are its own kind's.** Every list has Nest item and Lift item, which leave the
   first line for this one. A numbered list adds Start at and Numbering; a bulleted list adds
   nothing, having none to set. There is no Kind select: the toolbar's Bulleted and Numbered buttons
   change a list's kind (`countedList`).
4. **Every other band under the toolbar comes onto it**: a preformatted block's language, a figure's
   settings, a value's (UI3). Notices, such as what a paste left out, stay above the text.
5. **Not on it**: table formatting, which is the Table tab beside the text
   ([ADR-0052](0052-table-formatting-is-a-tab-beside-the-text.md)), and the dialogs that choose
   what to insert (Link, Reference, Value, Equation, Symbols, Figure), which stay dialogs.

## Consequences

- The text starts one line lower whether or not anything is on the line, and never moves after.
- Nest and Lift are reached on the second line, or by their shortcuts, which are unchanged; F6
  reaches a list's options as it reached its band.

## What would change the answer

- **More options than a line holds** for one selection: they would wrap, and the line would grow;
  a third line or a panel beside the text would then be the question.
- **Bullet styles** (disc, circle, dash) becoming part of a stored list: they would join a bulleted
  list's options here.
