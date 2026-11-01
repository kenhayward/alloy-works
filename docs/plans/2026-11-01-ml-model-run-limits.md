# ML: the assistant's turns and tool calls set per model

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Each model says how many model turns and tool calls an assistant run on it may make, beside
its timeout on Models; a run may take ten minutes.

**Spec:** issue #872 and Ken's answers on it, 2026-11-01: per model; turns 1 to 100, default 40; tool
calls 1 to 500, default 100; a run's time from four minutes to ten, one constant (a per-model run time
is #873); prompt runs take the same limits.

**One PR**, stacked on #871 (which raised the constants to 40 and 100). Tier: a stored shape (two
columns) and a contract change, so this plan; one final review.

## Global Constraints

- Follows #854's per-model timeout (0182) member for member: nullable columns, the default where
  null, written only where said so a schema before the migration still takes a write.
- A prompt run (G4) is one model call with no tool loop: it has no turns or tool calls to bound, so
  "the same limits" holds with nothing to change there.
- Ten minutes needs no proxy change: Caddy's `reverse_proxy` and the client's `streamPost` set no
  timeout; `runMs` is the only bound. Ken tests a long run through the LAN proxy.
- Tokens only; every string in `words/en-GB.json`; no em or en dashes in copy.

## Review Focus

1. **An endpoint made before 0184:** its run takes 40 and 100.
2. **Bounds:** 0, 101 turns and 501 calls refused by the schema, the route and the form alike.
3. **A change of one setting** leaves the others as they were (`changeModelEndpoint`'s `changed`).
4. **The run reads the endpoint it runs on,** the one chosen for the turn, not the default.

---

### Task 1: the settings, stored

**Files:** `packages/domain/src/generation/endpoint.ts` and test;
`packages/db/migrations/tenant/0184_model_run_limits.sql`; `packages/db/src/model-endpoints.ts` and a
migration test; every pinned migration list in `packages/db/src`; `packages/api-contract/src/
model-endpoints.ts`; `openapi.json` and the client regenerated.

- [ ] Failing tests: the schema takes `turnsPerRun` 1 to 100 and `toolCallsPerRun` 1 to 500, refusing
      past either; `runLimitsOf` gives an endpoint's own or the defaults; a stored endpoint carries
      both and a change of one keeps the other.
- [ ] Migration: `turns_per_run integer check (between 1 and 100)`, `tool_calls_per_run integer check
(between 1 and 500)`, both nullable.

### Task 2: the run reads them

**Files:** `apps/service/src/generation/assistant.ts`, its route tests.

- [ ] Failing test: a turn on an endpoint whose `toolCallsPerRun` is 1 refuses its second call.
- [ ] Both runs take `{ ...ASSISTANT_LIMITS, ...runLimitsOf(endpoint) }`; `runMs` 600 000.

### Task 3: the Models form

**Files:** `apps/web/src/admin/Models.tsx` and test; `words/en-GB.json`.

- [ ] Failing test: the form shows **Turns a run** and **Tool calls a run**, empty for the default,
      and sends them; out of bounds says so.
- [ ] Docs: `docs/design/generation.md` (limits paragraph, endpoint settings), `docs/features.md`.
