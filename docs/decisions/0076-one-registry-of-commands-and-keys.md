# 0076 - One registry of commands and keys

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

[The handoff](../interface/handoffs/authoring-page/README.md) gives menus, tooltips,
`aria-keyshortcuts` and a Help page that must not disagree, and a table of new keys. The editor already
has a registry, `EDITOR_COMMANDS`, whose keys were each chosen for a written reason, and six of the
table's keys were already taken by it.

## Decision

1. **A command is registered once**, with its words, icon, key and enablement
   (`apps/web/src/shell/commands/`). Menus and dock buttons are views of it. Editor commands are derived
   from `EDITOR_COMMANDS`, never restated.
2. **The existing keys stand.** A key is added only where a command has none and nothing takes it: not
   `Ctrl Alt` plus a letter a browser, a desktop or a layout owns. Many commands stay without one, and are
   reached from the menus by keyboard.
3. **One way of matching a key**: `prosemirror-keymap`'s, with its fallback for a layout whose letters
   differ, and never while `AltGraph` is held, so that a page's key and an editor's cannot disagree on a
   layout and AltGr still types its character.
4. **A key belongs to one command in its scope.** The one overlap across scopes is `Ctrl K`: Link in text,
   Search elsewhere ([ADR-0046](0046-the-ledger-interface.md)).
5. **`Ctrl S` makes no version.** A version is a decision and the text saves itself, so the key is
   swallowed in the editor and nothing more.
6. **Go-to keys are single printable keys**, so they can be turned off (WCAG 2.1.4), and never act in text,
   a tree, a list being typed into, or a menu.

## What would change the answer

- A browser reserving a key a command relies on; `F10` is the way into the menus regardless.
- People asking for more keys than free chords remain: then rebinding, which this registry makes possible.

## Consequences

- The table in the handoff is not the product's: Help's Keyboard shortcuts is, being read from the registry.
- A literal table in the registry's test pins every key, so a moved key fails loudly.
