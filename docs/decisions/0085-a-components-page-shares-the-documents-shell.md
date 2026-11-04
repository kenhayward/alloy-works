# 0085 - A component's page shares the document's shell

- **Status:** Accepted
- **Date:** 2026-11-04

## Context

`ComponentEditor` already runs on a component's own page and in place in a document, but the page around it did not
follow: the redesigned band, side dock, header, menu bar and icon rail stood on a document alone, and each new control
would have been built twice or missed. [The plan](../plans/2026-11-04-ce-the-component-page-on-the-document-shell.md)
holds Ken's rulings and how it lands.

## Decision

1. **One shell, two pages.** `AuthoringShell` is layout only. Each page keeps its own state and passes in what to draw.
2. **Not a document of one.** `DocumentPage` is built on an outline, and a component has none. Some differences stay on
   purpose: a binding shows what it asks for rather than a value, and the Reference dialog offers the component's own targets.
3. **A panel is declared once, saying where it applies,** in one registry. Shell-level controls reach both kinds at once;
   a panel opts in, so a document's panel cannot appear on a component by accident.
4. **The band and the frame are separate things.** A band is where the toolbar stands; a frame and its way out are for
   what may close, in a document's sheet.
5. **A component keeps Done editing** as an act that cuts and releases and closes nothing, since leaving a page releases
   no lock.
6. **The menu bar takes a kind.** A component's first menu is Component, from the rows a document's already has, and
   "what cannot apply stays" holds within a kind and not across them.
7. **Authoring to Reading does as a document does:** the editor goes, the last save is sent and the lock lapses. A mode
   switch cuts no version.

This amends [ADR-0046](0046-the-ledger-interface.md) decision 6 for this page, and
[ADR-0075](0075-one-header-a-side-dock-and-margin-labels.md) decision 3: its header and menu bar now stand on a component too.

## What would change the answer

- **A third kind of page wanting the shell,** such as a template, should use it rather than copy it.
- **`applies` growing per-panel exceptions** would mean the kinds differ more than this says, and the shell should be
  questioned.
- **A lock left to lapse causing harm in use** would change decision 7 on both pages together.

## Consequences

- The editor draws its header's facts by portal, because they live inside it. Lifting that fetch out would be cleaner and
  far larger, and is left unless the portal proves awkward.
- `ComponentDock`, its word tabs and the breadcrumb go. A component's chosen mode and panel are kept under keys of their
  own, so reading a document does not open the next component read-only.
