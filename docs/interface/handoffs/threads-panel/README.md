# Handoff: the threads panel, cards with a people strip

The threads panel in the right-hand panel (`ThreadsPanel`, CNT-155, CNT-157) becomes a list of
**cards** you can read at a glance, under a **people strip** and a **search box that takes
@person**. A thread **opens in place** in the list or **takes the whole panel**. Replies take
**@mentions typed inline**, with suggestions. The **assistant is a participant**, marked as AI, and
each of its comments shows where it came from. The buttons are icons. Drawn in the design canvas on
3 November 2026; layout A with C's people strip was chosen from three (B: dense rows grouped by
section; C: grouped by person, conversation bubbles).

**Drawings, not code**, as for the other handoffs: colour comes from `tokens.css`, layout from the
HTML, and the existing wording from `en-GB.json` (`review.*`). Each screen has a `-light` and a
`-dark` `.html`, each self-contained, and a `.png` of each at 400x788 (2x), the panel at the height
it has in the authoring page ([`../authoring-page/`](../authoring-page/README.md)).

Delivered as a zip; it lives in `docs/interface/handoffs/threads-panel/`.

## Screens

| Files                 | Screen                                                                     |
| --------------------- | -------------------------------------------------------------------------- |
| `list-*`              | The list: header, search, Show, people strip, cards                        |
| `one-person-*`        | Ravi chosen in the strip; the same person as a chip in the search box      |
| `opened-in-place-*`   | One card open in the list: its comments, a reply line, its actions         |
| `whole-panel-*`       | A thread taking the panel: back, 2 of 6, actions, the quoted text, replies |
| `assistant-comment-*` | A thread the assistant started, with its AI tag and where it came from     |
| `search-person-*`     | `@` typed in search: people to filter by, with how many threads each       |
| `show-filter-*`       | The Show menu, with counts                                                 |
| `mention-*`           | `@m` typed in a reply: Mei Chen and Ravi Menon suggested                   |

## Decisions to record (two ADRs: the panel, and the assistant as an author)

1. **A card per thread.** Top to bottom:
   - the avatar, the name of who started it and when, then an **AI** tag, the Internal chip, the
     Resolved chip and a dot for new;
   - the anchor in `--accent-text` after a `§`, in today's words (`review.anchor`) with the place
     from `placeOf`;
   - the first comment (`said`), cut to two lines, with mentions as `@First`;
   - a stack of up to four participants' avatars, the comment count, and a chevron.

   A resolved card's text is `--muted`. The whole head of the card is one button
   (`aria-expanded`); its accessible name is "{who}, {anchor}, {n} comments" plus ", new".

2. **The people strip**, under the search: All, then everyone who started, replied in or is
   mentioned in a thread, you as "You" and the assistant as "AI". Each has its avatar, first name
   and a badge counting their **open** threads. Choosing one filters the list to threads they are
   in (`aria-pressed`), and their chip appears in the search box. Choosing All, or removing the
   chip, clears both. One filter, two controls.
3. **Search** replaces nothing and joins Show: a box with a search icon, person chips and text.
   - Typing `@` lists people to filter by, with their role and how many threads they are in; Enter
     adds the first.
   - The text matches the anchor, the quoted text, the comments and the names. It searches the
     threads already listed (every page is read today, per the TH final review), so it needs no new
     route.
4. **Show** becomes a menu button with a funnel icon, showing its choice. Its items, each with a
   count: All threads, Open, New to me / Mentioning me, Raised by me, From the assistant, Internal
   only / Resolved. Open, Resolved and All are today's; the others are new. **The default stays
   Open**; the drawings show All so every kind is visible.
5. **Opening a thread, two ways.**
   - **In place**: clicking a card opens it in the list, one at a time. It shows every comment
     (22px avatars), a one-line reply with @ and send, then **Resolve**, **Make internal** and
     **More** as icons, and **Open thread** to take the panel.
   - **The whole panel**: the header becomes **back** (to All threads, `Esc`), "2 of 6 threads",
     **previous** and **next** (`K`, `J`), then the thread's icons. Under it: the quoted text, which
     goes to the place in the document (`onGoTo`); who started it and the count; then the comments
     with 28px avatars, **Edit** (pencil) on your own and **More** on each; then the reply box.
   - An address that opens a thread (`opening`, SV-M) opens it in the whole panel.
6. **Icons for every button**, each with its words as accessible name and tooltip:

   | Today              | Icon                                              |
   | ------------------ | ------------------------------------------------- |
   | Resolve            | check in a circle, `--ok`                         |
   | Make internal      | padlock                                           |
   | Edit               | pencil                                            |
   | Reply (send)       | paper plane; filled `--accent` once there is text |
   | Mention            | `@`                                               |
   | All threads (back) | arrow left                                        |
   | Remove {name}      | `x` on the chip                                   |

7. **@mentions typed in a reply.**
   - Typing `@` and a letter or two opens **Mention someone** above the reply box. It matches the
     start of a first name or a surname, puts people already in the thread first ("In this
     thread"), and underlines the matched letters. Enter or Tab chooses; Esc closes. The `@` icon
     types an `@`.
   - A chosen person goes in **where it was typed**. The parts model (`{text}` and `{mention}`)
     already allows that; today the mentions are appended after the text from a select. The limit
     of 20 stays.
   - Under the box, in place of "Enter to send": "{names} will be notified", or today's "Not told,
     as they may not read this: {names}." for people who may not read the thread.
   - Mentions show as chips: `@Full Name` in `--accent-text` on `--accent-weak`, 4px radius.
8. **The assistant is a participant, marked as AI.**
   - Its avatar is a four-point star in `--accent` on `--accent-weak`, filling 80% of the circle;
     people have initials.
   - Its name is "Assistant", followed by an **AI** tag (10px, bold, `--accent-text` on
     `--accent-weak`, title "An AI assistant, not a person").
   - Each of its comments carries a provenance line with a tool icon: "Added by a tool call · asked
     by {person} · {model}". The model is the one the assistant panel shows.
   - It appears in the strip, in @person search, in Show (From the assistant) and in Mention
     someone, where `@Assistant` changes the line under the box to "The assistant will reply here".
9. **New and read.** The "3 new" chip, the dots, Mark all as read (header icon), New to me and the
   badge on the Threads tab need a per-person read mark, which the panel does not keep today (it
   reads when it opens, never live: TH-L). This is new behaviour.
10. **Light and dark** follow the user's theme. Tokens only.

## Measures

```css
:root {
  --threads-head: 52px; /* header, and the whole panel's header */
  --threads-strip-item: 40px; /* strip button; avatar 32px, badge 16px */
  --avatar: 28px; /* card and whole-panel comments; 22px in place; 20px in stacks; 16px in chips */
  --show-menu: 236px;
  --suggest-row: 44px; /* @person and Mention someone rows */
}
```

The panel is 400px with the 48px tab column, as in the authoring page. Cards: 10px radius, 10px by
12px padding, 8px apart, 1px `--border` (`--accent` when open). Controls in the filter row are 34px
high. Icon buttons are 30px square.

The assistant's star (24px box, filled and stroked 1.5px with round joins, so the tips round):

```
M12 1.5C13.4 7.6 16.4 10.6 22.5 12C16.4 13.4 13.4 16.4 12 22.5C10.6 16.4 7.6 13.4 1.5 12C7.6 10.6 10.6 7.6 12 1.5Z
```

The same shape, stroked only, is the Assistant tab's icon and From the assistant's.

**Avatar colours**, six pairs per theme, chosen by a stable hash of the person's id. New tokens:

| Token pair     | Light background, text | Dark background, text |
| -------------- | ---------------------- | --------------------- |
| `--avatar-1-*` | `#d7ecf2`, `#165a72`   | `#17414d`, `#8fd0e0`  |
| `--avatar-2-*` | `#ebe5fb`, `#5b3fb8`   | `#2f2752`, `#c0adff`  |
| `--avatar-3-*` | `#fbe9d6`, `#9a4610`   | `#43301a`, `#f2a764`  |
| `--avatar-4-*` | `#dcf1e4`, `#1d7148`   | `#163a28`, `#5ccf93`  |
| `--avatar-5-*` | `#fbe1df`, `#b42318`   | `#45201d`, `#ff8a80`  |
| `--avatar-6-*` | `#e3e8ee`, `#34424f`   | `#2a3644`, `#c9d2da`  |

Menus and suggestions use `--surface`, `--strong-border` and `--shadow-modal`; the highlighted row
uses `--hover` from the authoring-page handoff.

**Check the chips' colours.** The drawing puts Internal in `--info` and Resolved in `--ok`.
`tokens.css` gives `--info` one meaning (somebody else editing, or a newer version), so Internal
should keep today's `Chip` look; decide whether Resolved counts as `--ok`'s "passed".

## Wording

Kept (`review.*`): "Open", "Resolved", "All", "All threads", "Internal", "Make internal",
"Resolve", "Reply", "Edit", "Save", "Cancel", "Mention", "Mentioned", "Remove {name}", "New
thread", "Start thread", "Earlier texts", "Its text is no longer there", "No threads here.",
"Not told, as they may not read this: {names}.", "Resolved by …", and the anchor's words ("The
section", "A table cell", "The whole component", the quoted text). "Show" stays as the menu's name.

New, check each:

- "{n} open", "{n} new", "Mark all as read".
- "Search, or @ for a person", "Filter by person", "{n} threads", "Raised by or replying in a
  thread · Enter to add".
- Show's new items: "New to me", "Mentioning me", "Raised by me", "From the assistant", "Internal
  only".
- "Open thread", "{i} of {n} threads", "Previous thread", "Next thread", "{name} raised this".
- "Reply, or @ to mention" and "Reply, or type @ to mention someone" (placeholders), "Mention
  someone", "In this thread", "Enter or Tab to choose · Esc to close", "Enter to send", "{names}
  will be notified", "The assistant will reply here".
- "Assistant", "AI", "An AI assistant, not a person", "Added by a tool call · asked by {person} ·
  {model}".
- "You" and "All" in the strip.
- "More" and its items (see Open questions).

No em or en dashes.

## Open questions

1. **Who an assistant comment belongs to.** Today a person accepts the assistant's comment before it
   is posted (`readAgain`). The drawing shows the assistant as the author and the person as "asked
   by". Choose one:
   - keep that, and say "accepted by" if acceptance stays; or
   - post it as the person, with an "Assistant drafted" line.

   Either way the author needs a kind (`person` or `assistant`) and provenance (who asked or
   accepted, the model, the tool and when). That is a stored shape: a written plan and a migration.

2. **What the assistant may do.** Resolve, make internal, or only comment? And does `@Assistant`
   start a model call in the thread?
3. **Making a thread visible again.** Internal is one way today (COL-038), and readers from outside
   (IAM-045) cannot make a thread internal. The drawing's pressed padlock, titled "Make visible to
   the sponsor", would be new. Keep it one way (show the padlock pressed and disabled), or add the
   reversal as a requirement.
4. **More**: the drawing proposes Copy link (thread addresses exist, SV-M) and Mark unread (needs
   decision 9). Nothing else exists to put there; drop More if both are cut.
5. **Read marks** (decision 9): store per person and thread, and decide whether the badge counts new
   threads or new comments.

## Not drawn

- Starting a thread. Today's New thread flow stays; it gets a `+` icon in the header.
- Editing your own comment (the pencil opens today's editor in place, with Earlier texts).
- An orphaned thread: its anchor line and quote read "Its text is no longer there", in `--muted`.
- Resolved by …, the No threads here state, and a reader from outside the organisation.
- A thread on a baseline (COL-031); the panel is the same.

## Example data

The people, their roles, the comments and the counts are invented. The document's text comes from
the demo document on the development tenant; do not use it in fixtures.

## Order of work

Multi-PR, with a stored shape (the assistant as author, read marks) and a new contract, so it gets a
written plan with pre-flight review (`docs/plans/README.md`).

1. Query the trace before planning (`pnpm trace show CNT-155`, `CNT-157`, `COL-018`, `COL-038`,
   `IAM-045`; `pnpm trace search mention`, `assistant`, `thread`) and cite what exists. New
   behaviour arrives as requirements through the issue form.
2. The two ADRs; settle the open questions.
3. The cards and the people strip, from today's summaries. Pure filtering (person, text, Show) in
   its own tested module.
4. In place and the whole panel, with focus handling and the keys.
5. Inline @mentions in the composer, keeping the parts model and the 20 limit.
6. The assistant as an author: domain, migration, API, then its avatar, tag and provenance.
7. Read marks, then New to me, the dots, the badge and Mark all as read.
8. Move the existing tests' queries (`ThreadsPanel.test.tsx`). Keep their requirement IDs and
   accessible names. Add axe checks for the strip, menus and suggestion lists.

## For Claude Code

Read this README and open the `.png` files before planning. Treat the HTML as a measured drawing,
not code to copy. Most of it already exists in `ThreadsPanel.tsx`: summaries, opening a thread,
replies, resolving, internal, mentions, anchors. What is new:

- the card layout, the people strip and search with @person;
- opening in place, and back, previous and next in the whole panel;
- the Show items beyond Open, Resolved and All;
- @mentions typed inline;
- the assistant as a marked author;
- read marks;
- the avatar tokens.
