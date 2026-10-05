# The document view

A document read and authored on one page: its outline beside it, its text as one continuous scroll set
in its theme, each component's edges shown when they are wanted, and each reference's version shown
and chosen there. Designed on 2026-09-27 for W9 of [the rest of T1](../plans/2026-09-25-t1-remainder.md),
from the page the interface slices built - layout C of [the interface](../interface/README.md), the
"document triptych" - which [structure.md](structure.md) and [component-editor.md](component-editor.md)
each left to "the document view". Its decisions, DV-A to DV-J, were taken as recommended on Ken's
instruction of 2026-09-27 to continue with W9, and are his to review.

## Requirements owned

| ID          | How it is met                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CNT-072** | The text is one canvas on the theme's paper: every heading, a section's and a component's, set in the theme's heading role for its depth, and each component's text beneath its heading, with no card around it ([One scroll](#one-scroll))                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **CNT-073** | A component's edges and its label appear when the pointer or the focus is in it, and for all of them while **Show boundaries** is on, and never otherwise ([Boundaries](#boundaries)). The one component open in an editor keeps its edges while it is open: that is the editor an author opened and closes with Done, not chrome the page puts round a component whatever the reader does                                                                                                                                                                                                                                                                                                         |
| **CNT-154** | The page is in **Reading** or **Authoring**, said by a switch in its header that shows the mode it is in ([Modes](#modes))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **IAM-080** | Authoring is offered only where the document's `mayEdit` or an occurrence's allows it, and Reading otherwise, so a mode the permissions do not give is never offered ([Modes](#modes))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **CNT-105** | Authoring is offered where the reader may restructure the document or edit any component it places; anyone in Authoring may switch to Reading, and the page keeps that choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **CNT-156** | Reading offers moving through the document and nothing that changes it; Authoring offers the outline's acts and each component's editor in place. The Publishing panel shows in both, to whoever may publish: publishing changes nothing in the document, and is the `publish` decision's rather than an editing affordance (DV-D, Ken's to overrule)                                                                                                                                                                                                                                                                                                                                              |
| **CNT-162** | A component's label names the version its reference resolves to and whether it is the latest or pinned ([Versions](#versions))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **CNT-158** | In Authoring, where the reader may restructure the document, the label's version opens a list of the component's versions and **Always the latest**; choosing one is the outline's `set` of the reference's mode                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **STR-035** | The outline marks the node whose text is in view as the reader scrolls, and choosing any node - in the outline, a generated list or a link - scrolls the text to it ([Navigation](#navigation))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **STR-045** | Opening a node's link scrolls the text to the node and marks it there as well as in the outline, for whoever may read the document; a component they may not read is reached at its place and not shown                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **CNT-180** | The browser suite (`tests/browser/src/budgets.test.ts`) opens a document of 400 components in 500 nodes, a fifth of whose texts hold cross-references, ten times from the documents list and ten times cold - its address loaded into a fresh page - to its outline named and its first component's text on the screen, against p90 1 s and a maximum of 2 s; and jumps from the outline to ten nodes drawn from a seeded sequence, to the node's heading on the screen and still there once the page has settled, against p90 250 ms and a maximum of 500 ms. Each is the whole time, timed by the page, with the configuration recorded beside it; run and bound only off CI, on a named machine |

**STR-065 stays [structure.md](structure.md)'s**, which claims the outline as the table of contents; W9
cites it, since the outline following each act is what STR-035's tracking rests on. **CNT-075 stays
[component-editor.md](component-editor.md)'s**: the read text and the surface are one rendering, which
One scroll keeps. **CNT-076**, a document of several hundred components against no number, is superseded by
**CNT-179**, which gives it numbers, and that by **CNT-180**, the same at p90, which is claimed above.

**IAM-023 was split on 2026-09-28**: its T1 half, **IAM-080** - the read and author modes of CNT-154
derive from the permissions, so a mode a user cannot have is never offered - is what this design builds
([Modes](#modes)), and is claimed above; IAM-081, the review mode's half, is T3's with CNT-155.

**Not claimed, T3**: CNT-155 and CNT-157, the review mode and what it offers; CNT-159, choosing a
revision; CNT-161, an audited re-point; CNT-163, showing latest-approved. An approved reference is shown,
as it is in the outline, as "waiting on revisions", and is never offered: nothing is approved in T1.

## What the page does today

The document's page reads in order: each section's heading, and each component in a bordered card
under its number and title, with an **Open** link and a sentence saying whether the reader may edit it.
A click on a card's text opens the component's editor in place; the outline beside it follows every act
and goes to a linked node, choosing and marking it. What it does not do: the cards are permanent chrome,
so the text is not one scroll; there are no modes, only the document's `mayEdit` switching the outline's
acts off; choosing a node, in the outline or by a link, never moves the text; nothing tracks where the
reader is; and no version is shown anywhere but a reference's "latest" or "pinned" in the tree's label,
nor chosen anywhere at all.

## One scroll

**The text column is one canvas** (W8's), the theme's paper at the layout's measure, holding the whole
document rather than a canvas per component. Every heading is set in the theme's role for its depth,
`heading1` to `heading6`, a deeper one in `heading6`, with its number - a section's and a component's
alike, as the publication sets them: the number, a space and the title in one line of the heading
style, in its colour and alignment, and spaced from what stands above and below it by that style alone,
never by the view's own gaps (issue #333). A component's text follows its heading with nothing around it: no
border, no fill, no head of controls. The editor opened in place is the same surface on the same paper,
so opening a component moves nothing (CNT-075). What each card says today - whether the reader may edit
it, and who holds it - moves into the component's label.

## Boundaries

**A component's label** stands at its top edge, in the application's own face and colours - it is
chrome, not text - and says: its number and title, its version and whether it is the latest or pinned,
whether the reader may edit it and who is editing it, and **Open**, which opens it on its own page. Its
edges are a hairline in the application's border colour.

**When it shows** (CNT-073): while the pointer is over the component, while the focus is inside it -
the keyboard's route to the same thing - and for every component while **Show boundaries** is on, a
toggle in the page's header, kept per viewer in the browser. Otherwise the text is text. The component
being edited in place keeps its edges while it is open, since its editor's strip is its label.

## Modes

**Two modes, Reading and Authoring** (CNT-154), a switch in the page's header that shows which the page
is in, and the page itself says it in its accessible name.

| Mode      | Offered to                                                                      | Offers                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading   | Everyone who may read the document                                              | The outline, collapsed and chosen and linked to; the generated lists; search; boundaries and labels; **Open**. No editor, no outline act, no field written |
| Authoring | Whoever may restructure the document, or edit any component it places (IAM-023) | Reading's, and the outline's acts where the document allows them, each component's editor in place where the component allows it, and the version chooser  |

**Derived, never granted** (IAM-023): the page is told the document's `mayEdit` and each placed
component's, and offers Authoring where either is true for anything. A reader with neither sees no
switch, only the page in Reading, so a mode they cannot have is never on offer. **Dropped to
deliberately** (CNT-105): anyone in Authoring switches to Reading, and the choice is kept per viewer in
the browser, so the next document opens as they left the last. The first time, a reader who may author
opens in Authoring: they came to work.

**Publishing is neither.** The Publishing panel is the `publish` decision's, not an editing affordance,
and shows in both modes to whoever may publish (DV-D).

## Versions

**Shown** (CNT-162): each component's label names the version its reference resolves to - `Version 1.2`

- and **latest** or **pinned**. The texts route already answers each occurrence's resolved version by
  identifier; it answers its number too. A component the reader may not read shows neither, as its text is
  withheld.

**Chosen** (CNT-158), in Authoring, where the reader may restructure the document: the label's version is
a button opening a list - **Always the latest**, then each version of the component, newest first, with
its number and when it was made. Choosing one is the outline's `set` of the reference's mode, `pinned` to
that version or `latest`, the act the store already checks (CNT-160): a version of that component, which
the reader may read. The list is a new route, `GET /v1/components/{id}/versions`, paged as the other
listings are (W7), to whoever may read the component.

## Navigation

**Tracking** (STR-035): as the reader scrolls, the node whose text is at the top of the column is the
outline's **current** node - marked with `aria-current="location"`, and kept in view in the tree - and
the collapsed rail says where the reader is, as layout C draws it: "4.1 of 46". It is an
`IntersectionObserver` over each node's `data-node` element, which the text already carries.

**The outline pane scrolls itself** (issue #336). The window scrolls the text; the outline pane stands
beside it, sticky between the header band and the status bar, and its tree scrolls inside it.
The current node is kept in view by scrolling the pane alone, never by the tree item's
`scrollIntoView`, which scrolls the window too: with the pane scrolled by the window, keeping its item
in view moved the text, which changed the node in view, which moved the window again, and the page
sprang back near its top however the reader scrolled. The status bar tells the page its height, one
line or wrapped, as `--status-height`, which the pane's height and the root's
`scroll-padding-bottom` subtract. In a window under 480 pixels tall - a phone on its side, or 400%
zoom - the pane is not stuck: it would show a line or two of its tree, so it scrolls with the page.

**Jumping**: choosing a node - in the outline, in a generated list, or following a link - scrolls the
text to its heading, and the outline chooses it, as today. The heading stops below the header band,
not under it: the root carries `scroll-padding-top: var(--header-height)`.

**Arriving by a link** (STR-045): the page opens at the node, scrolled to once the placed components'
texts have arrived - before then every component above it is a heading alone, and the node would be
pushed down the page as each fills in - or after five seconds where they have not. It does not go at
all where the reader has meanwhile chosen another node or done anything with the page themselves: a
wheel, a touch, a key other than a modifier alone, a press of the pointer, or a scroll of their own
however made - a find, a scrollbar dragged - which is any scroll but the browser's anchoring and a
page grown shorter pulling the window up (`watchReader` in `position.ts`). A modifier alone is not
the reader's act: a screen reader's user presses Ctrl to silence speech as the page opens.

**Holding the node** (issues #341, #350): the theme, asked for beside the texts, may answer after
them, and its faces are fetched only once text set in them is drawn, so everything above the node
changes height after it is gone to - and the browser's own scroll anchoring does not keep it in
place, which left it a few pixels under the header when the faces arrived, or off the screen when the
theme did. So having gone there, the page holds the node there: whenever the text's column changes
size, or the article holding it does - a notice of faces not held, shown above the text as the theme
arrives, moves the node without changing the column - a `ResizeObserver` goes to the node again, with
the browser's anchoring off meanwhile so the two never fight (`holdInPlace` in `position.ts`). It lets go when the reader does anything the wait
above would have heard, when another node is chosen, when the node leaves the text, and once the page
has settled - the texts read, the theme's presentation in and its faces loaded, and then a second and
a half with the column's size unchanged - and in any case after ten seconds.

**Marking the node**: the page marks the linked node's heading as well as its tree item, a mark that
stays until the reader moves elsewhere, as the outline's does. A document the reader may not read is
not found, as today (404). A node that places a component the reader may not read is still reached:
its place, its number, and "Not yours to read", never its text.

## Decisions for Ken

| #    | Decision                                                                                                                          | Recommended                                                                                                                                                                          |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DV-A | **One canvas for the whole document**, every heading in the theme's heading roles, no card around a component                     | Yes. It is what CNT-072 asks, and what the PDF prints; the card was scaffolding for editing in place, which the label now carries.                                                   |
| DV-B | **A component's edges and label on hover and focus, and all of them under Show boundaries**, kept per viewer                      | Yes. Focus as well as hover, so the keyboard reaches what the pointer does.                                                                                                          |
| DV-C | **Reading and Authoring, a switch in the header**; Authoring offered where the document or any component it places may be changed | Yes. The two scopes - the outline and the text - are one mode rather than two, since an author moving between them should not have to change modes.                                  |
| DV-D | **Publishing shows in both modes**, to whoever may publish                                                                        | Yes. Publishing is the `publish` decision, not an editing affordance; hiding it in Reading would send a publisher to Authoring to do something that changes nothing in the document. |
| DV-E | **The mode is kept per viewer in the browser**, first opening in Authoring where it is offered                                    | Yes. A per-document mode would surprise; a per-account one would need a stored preference nothing else has yet.                                                                      |
| DV-F | **The version in the label; chosen from it in Authoring**, from a new versions listing                                            | Yes. The label is where the reader looks at the component; the dock's panel for the chosen node shows the same.                                                                      |
| DV-G | **Approved is shown and never offered** in T1                                                                                     | Yes. Nothing is approved until revisions exist (T3); offering it would pin to nothing.                                                                                               |
| DV-H | **The current node is the one whose text is at the top of the column**                                                            | Yes. It is what a reader means by "where I am"; the one mostly in view would jump between two short components.                                                                      |
| DV-I | **A link's mark stays until the reader moves**, in the text and the tree                                                          | Yes. A mark that fades is gone before a reader who looked away sees it.                                                                                                              |
| DV-J | **Four build slices**: W9.1 one scroll and boundaries; W9.2 modes; W9.3 navigation; W9.4 versions                                 | Yes. Each is visible on its own, and modes come before versions because the chooser is Authoring's.                                                                                  |
