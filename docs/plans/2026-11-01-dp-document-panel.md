# DP: the document panel's icon rail and the assistant redesigned

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or
> superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** The panels beside a document's text are chosen from a vertical icon rail on the panel's
right-hand edge, and the Assistant panel reads as a ledger of turns with Diariz's best pieces.

**Architecture:** One new part, `PanelRail`, replaces the dock's bottom tab strip and its collapsed
text rail; `DocumentPage` keeps its dock state. `AssistantPanel` keeps its data flow and is
re-laid out; one additive contract field (`contextWindow`) feeds a context gauge.

**Spec:** the canvas https://claude.ai/artifact/JXQBLQbP6tE79gvMyf8RCw (Main, Rail states, design B
"Ledger turns"); Diariz's `apps/web/src/components/ChatPanel.tsx` for the borrowed behaviour.

**One PR** (Ken, 2026-11-01). Tier: UI plus one additive field; one final review.

## Global Constraints

- Every rail tab keeps a name in words: `aria-label`, its hover/focus name, and the open panel's
  header. ADR-0074 amends ADR-0046 decision 6 to say so.
- Tokens only (`theme/tokens.css`); scales from ADR-0046 decision 4; no em or en dashes in copy.
- Every new string in `words/en-GB.json`; icons by name (`icons-named.test.ts`).
- No React rendering of model output as HTML: the answer stays text with citation buttons.

## Review Focus

1. **No part open:** "This part" cannot be chosen; the context button says "The whole document".
2. **The chosen panel leaves the rail** (mode changes, Table offered then not): the rail falls back
   to Part and focus stays in the rail.
3. **Right to left:** the hover name opens towards the text (start side), not off-screen.
4. **No endpoint, or one without a context window:** no gauge, nothing else missing.
5. **Dark theme:** the rail, badges, chips and cited bar pass axe in Dark.

---

### Task 1: ADR-0074 and the rail's icons

**Files:** Create `docs/decisions/0074-panels-chosen-from-an-icon-rail.md`; modify
`docs/decisions/README.md` (index row), `apps/web/src/editor/Icon.tsx` (`PATHS`).

- [ ] ADR: the dock's tabs become a vertical icon rail on the panel's end edge, collapse first;
  names stay in words as above (amends ADR-0046 decision 6; ADR-0046 gets a status line only).
  What would change it: a panel set small enough to fit as worded tabs again.
- [ ] Icons, 24-unit stroke paths as drawn on the canvas, added to `PATHS`: `Part`, `Lists`,
  `Assistant`, `Versions`, `Publishing`, `Threads`, `Suggestions`, `Rounds`, `PanelHide`,
  `PanelShow`. Reuse `Document`, `Table`, `Source`. The existing icon path test covers them.
- [ ] `pnpm --filter @alloy-works/desktop test` (decisions index) and the web icon tests pass. Commit.

### Task 2: `PanelRail`

**Files:** Create `apps/web/src/parts/PanelRail.tsx`, `PanelRail.module.css`, `PanelRail.test.tsx`.

**Produces:** `PanelRail({ label, tabs: readonly (PanelTab & { icon: string })[], chosen, onChoose,
ids, pane: Pane, toggleLabel })`, reusing `PanelTab` from `PanelTabs.tsx` (`count`, `tone`,
`disabled`, `name`).

- [ ] Failing tests (no requirement cited: layout, as `document-panes.test.ts` says):
  - the toggle is first, a button with `aria-expanded`, outside the `tablist`;
  - `tablist` has `aria-orientation="vertical"`; ArrowDown/ArrowUp wrap, Home/End, skip `disabled`;
  - each tab's accessible name is `name ?? label`, plus its count (`Threads, 3`);
  - a tab clicked while the pane is collapsed opens the pane and chooses it.
- [ ] Implement: 44px rail (`--dock-rail` becomes 44px), 32px buttons, chosen bar on the end edge;
  the name is a CSS-shown sibling on `:hover` (250 ms delay) and `:focus-visible` (none), placed on
  the start side using `--inline-sign`; badge `--accent`, `warn` tone `--warn`.
- [ ] Tests pass. Commit.

### Task 3: the rail in `DocumentPage`

**Files:** Modify `apps/web/src/structure/DocumentPage.tsx` (`DOCK_PANELS` gains `icon`; the
`dockStrip` at ~3024 and the collapsed `OutlineRail` at ~2690 go), `DocumentPage.module.css`;
tests `DocumentPage.*.test.tsx` that find dock tabs; `tests/browser/src/document-panes.test.ts`.

- [ ] Update the failing expectations first: the rail stands whether collapsed or not; each open
  panel has a header `h2` naming it; Review Focus 2 (`Table` offered then withdrawn).
- [ ] Implement: `aside` then `PanelRail`, rail always rendered; header per panel from its label.
- [ ] Web tests, then the browser walks (`document-panes`, accessibility, navigation) in Light and
  Dark (Review Focus 3, 5 via a `dir="rtl"` unit test). Commit.

### Task 4: the context window reaches the assistant

**Files:** `packages/api-contract/src/conversations.ts` (`ConversationEndpoints` items gain
`contextWindow: z.number().int().positive().nullable()`), `apps/service/src/generation/assistant.ts`,
`apps/service/src/conversation-routes.test.ts`; regenerate `openapi.json` and the client.

- [ ] Failing service test: the listing carries each endpoint's context window, `null` when unset.
- [ ] Implement from the endpoint row; `api-contract generate`, `api-client generate`; contract
  tests pass. Commit.

### Task 5: the assistant as ledger turns

**Files:** `apps/web/src/structure/AssistantPanel.tsx`, `.module.css`, `.test.tsx`; `words/en-GB.json`.

Keep every GEN/LIB test title (GEN-009, -010, -011, -021, LIB-040); change only their queries.

- [ ] Failing tests:
  - header: `Assistant`, the conversation's title as a menu button listing earlier ones, and
    "A new conversation" as an icon button (replaces the `select`);
  - each turn: "You" plus the ask, then the answer; citations `[n]` are buttons named
    "Source n" calling `onCite`; Sources listed under the turn;
  - "What it did (n steps)" is a disclosure, closed by default;
  - Copy writes the answer without citation markers; "Ask again" resubmits the ask;
  - while running: one `role="status"` line naming the latest step (`stepLine`), Ask replaced by
    Stop in the same place; the token progress bar stays for screen readers.
- [ ] Proposals as cards: title, place, the proposed text marked as an insertion, "Show in page"
  (`onCite`), Accept / Keep as suggestion / Discard. **Not a before/after diff:** a proposal holds
  only its new text (`Proposal['proposed']`). A real diff is a follow-up.
- [ ] Tests pass. Commit.

### Task 6: the composer

**Files:** as Task 5, plus `PersonalPrompts.tsx` if its trigger moves.

- [ ] Failing tests:
  - a context button names the scope ("This part" / "The whole document") and opens a two-choice
    menu, the existing current/all choice; the label is fixed when the textarea gains focus (Diariz);
    Review Focus 1;
  - parts added each turn show as removable chips beside it, "Add a part" opening today's finder;
  - Enter asks, Shift+Enter is a newline;
  - endpoint button, then a gauge of the last turn's `tokensIn` over `contextWindow`:
    below 50% `--accent`, to 75% `--warn`, above `--danger`, `role="img"` with the percentage;
    none without a window (Review Focus 4);
  - "Prompts" opens the personal and library prompts that sit in the panel today.
- [ ] Implement; tests pass. Commit.

### Task 7: the cited bar, docs and the fragment

**Files:** `DocumentPage.tsx` (bar above the sheet), `docs/design/document-view.md`,
`docs/design/generation.md`, `docs/features.md`, `README.md`, `changes/dp-document-panel.md`.

- [ ] Failing test: after an answer with citations, "Cited by the assistant, k of n" with previous,
  next and clear; next scrolls to and marks the next cited part (`setMarked`).
- [ ] Implement from the citations `AssistantPanel` reports (new prop `onCitations(list)`).
- [ ] Docs and fragment; `pnpm lint`, `format`, `typecheck`, web and browser tests, `pnpm trace check`
  (trace pins move with test edits: regenerate). Push, open the PR.

## Left out

- A before/after diff in proposals (needs the part's current text beside the proposal).
- Diariz's slash commands and its model menu overhanging the panel: worth a later PR.
- A third context choice, "only the parts I add": the service has no such scope today.
