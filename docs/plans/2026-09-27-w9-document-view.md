# W9: The document view

> **A sketch**, built a pull request at a time, each test-first with one final whole-branch review
> before it opens that is asked for a break of its own against every citation. It builds W9 of
> [the rest of T1](2026-09-25-t1-remainder.md) from [document-view.md](../design/document-view.md),
> whose decisions DV-A to DV-J were taken as recommended on Ken's instruction of 2026-09-27 to continue
> with W9, and are his to review.

**Goal:** a document is read and authored on one page, as one continuous scroll set in its theme, in a
mode the reader chooses from those they may have, with its outline tracking where they are and each
reference's version shown and chosen where it stands.

| PR   | Holds                                                                                        | Version |
| ---- | -------------------------------------------------------------------------------------------- | ------- |
| W9.0 | This plan and document-view.md, claiming nine requirements                                   | Build   |
| W9.1 | One scroll: one canvas, headings in the theme's roles, no cards; boundaries and their labels | Minor   |
| W9.2 | Reading and Authoring                                                                        | Minor   |
| W9.3 | Navigation: the current node, jumping to a node, arriving by a link                          | Minor   |
| W9.4 | Versions: shown in the label, chosen from it; `GET /v1/components/{id}/versions`             | Minor   |

## Global constraints

- Test titles cite only what they show, checked with `pnpm trace show <ID>`, in a literal title.
- Each test is watched fail: a new test before the code, or, where the code exists, by breaking it.
- No em or en dash in user-facing text, and no real names, addresses or paths in a fixture.
- `pnpm typecheck`, `pnpm lint`, `pnpm format`, the affected suites, then `pnpm trace generate` after
  Prettier and `pnpm trace pins`; the full suite before each pull request, and its CI log read.
- The web tests run in jsdom: an `IntersectionObserver` and `scrollIntoView` are faked by hand where a
  test needs them, never by a library.

## W9.1: One scroll, and boundaries

1. `DocumentText` renders the whole outline on one canvas (`useCanvas` on the column, not per block);
   every heading, a section's and a component's, carries `data-role="heading<n>"` for its depth.
2. The card goes: a component is its heading and its text. Its label - number and title, whether the
   reader may edit it and who holds it, **Open** - is shown on hover and focus, and for all under
   **Show boundaries**, a header toggle kept per viewer.
3. Tests: CNT-072 (one canvas, heading roles, no card chrome), CNT-073 (hidden, hover, focus, toggle).

**W9.1, as built.** The label stands at the top of its own component's box, to the right, transparent
rather than removed, so it moves no text when it shows and a screen reader and the keyboard reach it;
it takes no pointer while hidden. Standing above the component, as first built, it covered the end of
the component before and was clipped above the canvas, which scrolls sideways (final review). A heading's role is `heading<depth>` on the element, which the theme's rules set as the
PDF does, held to the measure by the canvas's own rule. The version in the label waits for W9.4.

## W9.2: Reading and Authoring

1. The header's mode switch, offered by the document's `mayEdit` and each occurrence's; kept per
   viewer; first opening in Authoring where offered.
2. Reading hides the outline's acts, the editor in place and the fields' writing; Publishing stays.
3. Tests: CNT-154, CNT-105, CNT-156. IAM-023 is not cited: its review-mode half is T3's.

## W9.3: Navigation

1. The current node by an `IntersectionObserver`: `aria-current="location"` in the tree, kept in view;
   the rail's position.
2. Choosing a node scrolls the text to it; a link's arrival scrolls and marks the heading until the
   reader moves.
3. Tests: STR-035, STR-045, STR-065.

## W9.4: Versions

1. The texts route answers each occurrence's version number; the label shows it with latest or pinned.
2. `GET /v1/components/{id}/versions`, paged, read permission; the label's chooser in Authoring sets the
   reference's mode through the outline's `set`.
3. Tests: CNT-162, CNT-158, and the route's.
