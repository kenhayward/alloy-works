# TP: The threads panel, cards with a people strip

> From [the handoff](../interface/handoffs/threads-panel/README.md). **Full tier**: two stored shapes and
> a changed contract, so a plan and a pre-flight review. **One PR** (Ken, 2026-11-03), though the handoff
> proposes several: the slice's only build PR, so the close rides in it. D1 to D6 accepted by Ken,
> 2026-11-03. Pre-flight found 15 defects, answered under [Pre-flight](#pre-flight); where they differ
> from a task, they win.

**Goal:** the panel reads at a glance: cards under a people strip and a search that takes @person, a
thread opened in place or across the panel, @mentions typed where they belong, and the assistant's part
in a comment marked.

## What the review found

The handoff says most of this exists and search needs no new route. Against the code:

1. **The list cannot answer the drawing.** `ThreadSummaryView` has `startedBy`, `said` and a count. The
   strip, the avatar stacks, the people filters, Mentioning me and a search of "the comments" all need
   every comment's author, mentions and words. No new route, but a changed answer (T1).
2. **Counts need every state.** The panel asks the service for one state at a time, so Show's counts and
   the badges cannot be drawn. It must read all states and filter in the browser. That also fixes a slip
   from #909: Show set to Resolved removes the gutter glyphs, because they are built from the panel's list.
3. **The assistant as author contradicts what we just built.** `propose_comment` posts "as the author"
   once accepted (GEN-009, `generation.md`, #905). `thread_comment.author` is a person, nothing stores
   that a comment came from a proposal, and acceptance is only an audit event (D1).
4. **The provenance line may disclose.** "{model}" is an endpoint's name, such as a local server's, shown
   to everybody who reads the thread, reviewers from outside included. Hidden from them (D1).
5. **"{names} will be notified" cannot be known before sending.** `untold` is answered only once the
   comment is written, and a person's cadence may be daily or never. A line promising it before sending
   would be false (D4).
6. **People have no role.** `PersonView` is an id, a name and `external`. "Regulatory writer" has no source.
   Cut the line; `Outside` marks IAM-045 instead (D5).
7. **The composer's link icon has no meaning.** It is in the drawings and not in the README. Cut (D5).
8. **Every thread is new on the first day.** No mark means unread, so every existing thread gets a dot
   for everybody (D2).
9. **A panel address can open a thread the filter hides.** Show defaults to Open; a resolved thread opened
   by an address has no "2 of 6". Drop the count and the arrows there (T4).
10. **J and K are single printable keys** (WCAG 2.1.4, ADR-0076). Live only with focus in the opened
    thread, outside the composer. Pre-flight checks them against AP's go-to keys (T4).
11. **Mention text cannot be matched by name.** Two people can share a name, and a chip cannot sit in a
    `textarea`. Mentions are tracked as ranges (T5).
12. **Editing loses a mention's place.** `Composer` flattens `initial` to words then mentions. Inline
    mentions must round-trip (T5). A space between two mentions is a valid `{text}` part, as is one with
    only a space; the 4,000 limit counts words alone, so `maxLength` on the box would be wrong.
13. **Opening no longer goes to the text.** Today a row click also calls `onGoTo`; the drawing moves that
    to the quote in the whole panel, leaving the in-place card no way there. Keep `onGoTo` on opening.
14. **The in-place card omits things.** Edit, Earlier texts and Resolved by are drawn only across the panel.
    Resolved by must show in both; edit stays across the panel. One `ThreadBody`, two densities.
15. **Two headings.** `DocumentPage` draws an `h2` over the dock. The panel draws its own header, so it
    names itself, as the Assistant does (#864). `BaselinePage` hosts it too.
16. **A long strip is not drawn.** Eight fit. It scrolls sideways with arrow keys; no wrap.

## Decisions (recommended)

**D1. A comment stays the person's; the assistant is marked as having drafted it.** Pushback on the
drawing: a person read and accepted these words, GEN-009 makes that the act, and in a reviewed document an
author who cannot answer for a comment is the wrong record. So no assistant principal:
`thread_comment.drafted_by` points to the proposal. The comment shows its person's avatar and name, an
**AI** tag and "Assistant drafted · {model}", the model left out for a reader from outside. No
`read_comments` change. Show's From the assistant and the strip's **AI** filter on it. Not in Mention
someone (D3).

**D2. Read marks are in, per person and thread.** `thread_read (thread_id, principal_id, read_to)`. New
means a comment by somebody else after `read_to`, or no mark and somebody else's comment. Opening a thread
marks it; Mark all as read marks what is listed. The Threads badge counts **threads**, open and new, not
comments. Day one is accepted: one click clears it, and a backfill would invent reads. Refreshed as the
panel reads (TH-L), never live.

**D3. The assistant only comments, through a proposal. `@Assistant` is cut.** Starting a model call from a
comment is a new data path (GEN-061 stops at reading), a cost, and has no requirement. Worth its own slice.

**D4. The line under the composer stays honest.** "Enter to send" before sending; today's "Not told, as they
may not read this: {names}." after. No "will be notified". Enter sends, Shift+Enter is a new line, composing
text (IME) never sends. The edit composer keeps Save and Cancel.

**D5. Cut:** role lines, the composer's link icon, More on each comment, Mark unread, Make visible again
(COL-038 is one way: the padlock is pressed and disabled once internal). **Copy link** is an icon in the
whole panel's header, in place of More.

**D6. Chips:** Internal keeps `Chip`; Resolved is neutral too, as `--ok` means passed. Resolve's icon stays
`--ok`, as drawn, since it states what the act does.

Two ADRs, as the handoff asks: the panel; a drafted comment stays its person's.

## Tasks

Each is test first and ends in a commit. Requirements arrive first through the issue form and
`pnpm trace draft`: read marks, a drafted comment marked, finding threads by person and text. Citations
below use those; **CNT-157, COL-015, COL-018, COL-038, COL-067, CNT-137 and IAM-045 stay cited** in moved tests.

**T1. The list answers more** (`db/threads.ts`, `api-contract/threads.ts`, `service/threads.ts`).
`ThreadSummaryView` gains `participants: PersonView[]` (authors, in first-spoke order, through `person-view`),
`mentioned: uuid[]`, `words: string` (every comment's latest words, for search), `drafted: boolean`,
`new: boolean`. Mentioned stay ids: nobody's name is disclosed that the thread does not already show.

- `it('COL-018 lists each thread with who spoke, who is named and all its words, as they read now')`
- `it('COL-038 keeps an internal thread\'s participants and words from somebody from outside')`
- Erased person: `name` null in `participants`.

**T2. Stored shapes** (`0196_thread_panel.sql`, added to the 15 db test lists; no local suite run of them all).
`thread_comment.drafted_by uuid references generation_proposal`, set as acceptance starts the thread;
`thread_read` with RLS, in the tenant-deletion and trigger lists, `update` granted (upsert).
`PUT /v1/threads/{id}/read`, `POST /v1/documents/{id}/threads/read` with the thread ids; each documented, an
integrator's words. Regenerate `openapi.json` and the client.

- `it('GEN-… marks a comment accepted from the assistant, leaving its author the person who accepted')`
- `it('COL-… counts a thread new for a comment by somebody else after one\'s mark, and never for one\'s own')`
- `it('COL-… refuses marking a thread its reader may not read, as if it did not exist')`

**T3. Cards, strip, search, Show.** Pure `threadFilters.ts`: `shownThreads(threads, { show, person, text })`,
`countsOf`, `peopleIn`. Parts: `Avatar` (stable hash, six token pairs, star; null name shows the generic
glyph), `ThreadCard`, `PeopleStrip`, `ThreadSearch` (combobox), Show on `MenuButton` (`checked`, new `count`
and icon). Search folds case and accents, so "ibanez" finds Ibáñez. `firstName` is the name's first word,
for the strip and the card. The panel reads all states; `onThreads` hands the page all of them and the ids
Show leaves: marks follow Show as today, glyphs are every open thread's. New thread moves behind a `+`.
Tokens added to `tokens.css` and `colours.test.ts`, light and dark.

- `it('COL-… filters to the threads a person is in, the strip and the search box one filter')`
- `it('COL-… finds a thread by a reply\'s words, ignoring case and accents')`
- `it('keeps the default at Open, and counts each Show item over every state')`
- `it('keeps the gutter glyphs whatever Show is set to')` (`DocumentPage.review.test.tsx`)
- `it('COL-067 lists a thread on a deleted component as no longer there, and says why it does not open')`, moved

**T4. In place and across the panel.** `ThreadBody` (22px or 28px), one card open at a time. Header: back
(Esc), "{i} of {n} threads", previous and next, Resolve, Make internal, Copy link. `opening` opens across
the panel. Focus: back to the card on leaving; to the first comment on arriving; status region kept (CNT-137).

- `it('opens a card in place, one at a time, naming its state with aria-expanded')`
- `it('steps through the threads shown with J and K, not while typing a reply')`
- `it('opens an address\'s thread the filter hides, with no count or arrows')`
- `it('COL-038 presses and disables the padlock once internal, offering it to nobody from outside')`

**T5. Mentions typed inline.** Pure `mentionDraft.ts`: `applyEdit(draft, value)` moves ranges and drops one an
edit lands in; `toParts`, `fromParts`. Box stays a `textarea` with `role="combobox"`: no ProseMirror, no
`contenteditable`. Matches start of any word in a name, people in the thread first. Limit of 20 stays;
the 21st is not offered.

- `it('COL-015 names people where they were typed, each by id, however alike their names')`
- `it('keeps a mention\'s place through editing a comment')` (fixes finding 12)
- `it('drops a mention when its name is typed into')`, `it('does not send while composing')`

**T6. The drafted mark** on card and comment, Show and strip entries; rest of the words; star icon.
`it('GEN-… marks a drafted comment with the model, leaving the model out for somebody from outside')`.

**T7. New:** dots, "{n} new", header Mark all as read, New to me, rail badge through `PanelRail`'s `count`.

**T8. Close.** Move `ThreadsPanel.test.tsx`'s queries, keep IDs. Axe on the strip, menus, suggestions, in both
themes (`accessibility.test.ts`, new walk in `document-panes.test.ts`). Measure at 1440 by 900, light and dark.
Handoff into `docs/interface/handoffs/threads-panel/`; `features.md`, `README.md`, `collaboration.md`,
`generation.md`, the ADRs with index rows; fragment folded; `version.json` and mirrors to 0.229.0; baseline
and `architecture.md`. `trace generate` after prettier; CI's full run decides the close.

## Pre-flight

- **Read marks are the server's.** `read_to` is set to the thread's `max(created_at)` with `greatest`, and
  `new` is compared in SQL: a client's millisecond `lastAt` would leave a comment new for ever.
- **`POST /v1/threads/read`**, not per document: decided thread by thread, skipping silently what the
  caller may not read, ids capped. A baseline's threads may no longer be placed in the document.
- **A thread that does not open is never new**: a component thread with empty `places` (COL-067).
- **`thread_read` has no RLS, grants or deletion list to join.** Tenant schemas have none. `erasePerson`
  removes its rows, with a test. Pass `drafted_by` only when defined (`every-kind.ts` runs old schemas).
- **`ThreadView` carries each comment's `drafted`**, joined to `generation_run`; the model is left out
  for one from outside on every act's answer, and is nullable, so "Assistant drafted" stands alone.
- **`ThreadPage` shows the drafted mark too** and does not mark read.
- **Authoring needs people**: `wantsPeople` includes `threadsShown`.
- **The baseline's panel** passes `people={[]}`: it gets people and `principalId`, and its `onThreads` the
  ids Show leaves. It has no dock, so the whole panel bounds its own height there.
- **Dock layout**: `.assistantTab`'s selectors generalise to Threads, and the `h2` is suppressed.
- **`comment()`** waits for a `textarea` in the panel: an arrival prop opens New thread and focuses it.
- **Keys**: J and K registered, scoped to the thread, stopping `useGoToKeys`' G wait. Esc closes suggestions
  and menus first, and leaves a typed draft alone.
- **Composer**: the 20 counts occurrences; words count code points; blank stays refused; a pasted tab
  becomes a space.
- **`MenuButton`**: its label says the choice ("Show: Open").
- **Marking read updates the summary locally**, never `read()`, which rebuilds the marks.
- **Kept**: the CSS classes `RoundsPanel` and `SuggestionsPanel` import, and `anchorValues`, `personValues`.
- **Also moved**: `DocumentPage.review.test.tsx`, `BaselinePage.test.tsx` fakes, `audit-census.test.ts`.

## Review focus

For the pre-flight and the final review, to drive rather than read:

1. A reader from outside: any name, count, internal thread or model reachable through strip, search, badge?
2. Fifty threads with long words and thirty people: strip, stack and two-line cut at 400px and at the dock's
   narrowest; zoomed text.
3. A thread changing under an open card: resolved by somebody else, reply refused, component deleted.
4. Mentions: paste over a range, undo, two Adas, 21 people, an erased person, an RTL name.
5. A baseline's panel (COL-031): reading marks, opening, no acts it cannot take.
