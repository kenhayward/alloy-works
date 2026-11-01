# DQ: the assistant's toolbar, pinned composer, and conversations kept by choice

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** The Assistant panel reads as the canvas's "B refined" artboard: a toolbar on top, the
conversation scrolling, the composer fixed at the bottom; and a conversation is listed again only
if its owner keeps it.

**Spec:** the canvas https://claude.ai/artifact/JXQBLQbP6tE79gvMyf8RCw, artboard `ChatPinned`
("B refined"); Ken, 2026-11-01: "conversations only saved if the user wants to".

**One PR**, stacked on #860 (which is on #858). Tier: a stored shape (one column, a trigger) and a
contract route, so a plan and a pre-flight review; one final review.

## Global Constraints

- A conversation and its runs are never deleted (0127's trigger, GEN audit): "not saved" means not
  listed, never removed. Existing conversations are backfilled as kept, so nobody loses one.
- Tokens only; every string in `words/en-GB.json`; no em or en dashes in copy; icons by name.
- GEN-051 still holds: the endpoint in use, and whether it is outside the data boundary, stays visible.
- No requirement is added or claimed; tests cite only what they cited before.

## Review Focus

1. **An unkept conversation mid-turn:** listing it nowhere must not lose the panel's hold on it.
2. **Naming keeps:** a named conversation is kept (naming one you then lose would surprise).
3. **Another person's conversation:** the new route answers 404, as `getConversation` does.
4. **Narrow panel:** the toolbar's icons and the composer fit at the dock's minimum width.
5. **Dark theme:** the menus, segmented context and chips pass axe in Dark.

---

### Task 1: a conversation kept, and named

**Files:** `packages/db/migrations/tenant/0183_conversation_kept.sql`, `packages/db/src/conversations.ts`
and its test; `packages/api-contract/src/conversations.ts`, `documentation.ts`; `apps/service/src/
generation/assistant.ts`, `conversation-routes.test.ts`; regenerate `openapi.json` and the client.

- [ ] Failing tests: `listConversations` returns only kept ones; `updateConversation` changes a
      title and `kept` and nothing else (the trigger still refuses any other change, and delete); `PATCH /v1/conversations/{id}` as owner sets them, a title also keeping
      it, and answers 404 to anyone else; list and view items carry `kept`.
- [ ] Migration: `kept boolean not null default true`, then `set default false`, so rows made
      before are kept with no update; the trigger allows `title` and `kept`, its owner rule as it was.
      `'0183_conversation_kept'` joins every pinned migration list in `packages/db/src` (34 of them).
- [ ] Route `updateConversation`: strict body, one of the two required, title `.trim().min(1).max(200)`
      (never `titleFrom`). Like the other conversation writes it records nothing: an
      `audit-census` `none` entry, beside `cross-tenant.test.ts`'s ids and input, and in the
      session-only list in `access.test.ts`. Generate; contract and those tests pass. Commit.

Pre-flight review (2026-11-01) folded in above. Panel: hold the open conversation's own view (from
the start and `GET /{id}`), never read it from the list; Keep and Name are disabled until an ask
starts the conversation.

### Task 2: the toolbar

**Files:** `apps/web/src/structure/AssistantPanel.tsx`, `.module.css`, `.test.tsx`, `words/en-GB.json`,
`editor/Icon.tsx` (`History`, `Rename`, `Keep` if missing).

- [ ] Failing tests: a `toolbar` named Conversation; a model menu button named "Model: <name>",
      its menu items each endpoint, one outside the boundary saying so on the button too (GEN-051);
      the gauge beside it; "Earlier conversations" a menu of kept ones; "Name this conversation"
      edits the title in place (Enter saves, Escape cancels); "Keep this conversation" with
      `aria-pressed`; "A new conversation". The old selects and the "Using" line go.
- [ ] Implement; tests pass. Commit.

### Task 3: the pinned composer

**Files:** as Task 2, `PersonalPrompts.tsx` if its heading moves.

- [ ] Failing tests: the context radios as a segmented group above the box; the tray's parts as
      removable chips with "Add a part" opening the finder; a Prompts button opening the personal
      and library prompts; Ask and Stop as before. The panel lays out as three rows, the middle one
      scrolling, so the composer stays at the bottom.
- [ ] Implement; web tests, the browser walks if the stack runs. Commit.

### Task 4: docs, fragment

- [ ] `docs/design/generation.md` (kept conversations, the toolbar), `docs/features.md`, `README.md`
      if it names the panel; `changes/dq-assistant-toolbar.md`. Lint, format, typecheck, trace.
