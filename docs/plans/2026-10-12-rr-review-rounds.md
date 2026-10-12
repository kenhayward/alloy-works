# RR: Review rounds

> T3's seventh phase, its first half ([ADR-0057](../decisions/0057-t3s-order-and-template-moves-leave-for-t9.md)),
> designed in [collaboration.md](../design/collaboration.md#review-rounds). **Full tier**: a migration,
> stored shapes, new contracts; a pre-flight review (its findings folded in: RR-A, RR-G, RR-H and RR-J
> were reshaped by it) and a final review. Ken
> asked for the run on 2026-10-12; decisions marked **(default)** are recommendations he may overturn.
> **SCH-068, Home's "waiting on you", is phase 7's second half, the HM slice (default)**: none of its
> four items is a round, and "a document that cannot publish" needs a readiness check per document, a
> design of its own. HM is still phase 7, so ADR-0057 stands.

**Goal:** a document's author opens a round naming its reviewers, its scope and its due date,
against the document as it moves or against one of its baselines; each reviewer is not started, in
progress or complete, and says complete with comments or with nothing to say, and may take it back
while the round is open; anybody on it sees at once whether everybody has reviewed.

| PR  | Holds                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------- |
| RR1 | This plan and the design; `reviewerState` and `roundSummary` in the domain (Task 1)                           |
| RR2 | Migration 0079; rounds opened, read, listed, closed; reviewers starting, completing, reopening; told (Task 2) |
| RR3 | Review over a baseline: threads listed and judged against the pins, the review flags, the panels (Task 3)     |
| RR4 | The Rounds panel and the inbox; the final review and the close (0.158.0) (Task 4)                             |

## Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RR-A | **Tables**: `review_round` (document, title, scope, due, the baseline or none, `made_against` - the document version it opened on, or the baseline's - opened by and at) and `review_round_reviewer` (round, principal), fixed once written; `review_round_event`, insert-only: a reviewer's `started`, `completed` with `outcome` `commented` or `nothing_to_say` and the document version completed against, `reopened`, and the round's `closed`. State is derived, never stored, and kept against the version it was made against (COL-050's round state). The audit kinds `round.opened`, `round.closed`, `review.completed` and `review.reopened`. |
| RR-B | **Scope** is the whole document or outline nodes of it, each with what is beneath it, checked against `made_against`'s outline (COL-028); **due** a `timestamptz` (COL-054) after the opening; a title of 1 to 200 characters. Reviewers 1 to 50, **people only** (`kind = 'user'`; an external principal is COL-059's, T4), each holding `comment` or `suggest` on the document and `read` on every component in scope when named, else refused by count.                                                                                                                                                                                               |
| RR-C | **Who may**: open and close with `edit` on the document **(default)**; read with `read` on the document, decided as TH-J decides a thread; act as a named reviewer holding `comment` or `suggest` now, while the round is open, else not found. Closing is final; a round past its due date stays open until closed **(default)**.                                                                                                                                                                                                                                                                                                                       |
| RR-D | **A reviewer's state** (COL-029, COL-058): `complete` where their latest act is a completion; `in progress` where it is **Start** - a button, never a page opened - or a reopening; `not started` otherwise. Never read from silence or activity elsewhere. Completion names its outcome (COL-032). The summary marks a reviewer who can no longer review, and beside each the count of threads and suggestions they made in scope since the round opened.                                                                                                                                                                                               |
| RR-E | **"Has everybody reviewed"** (COL-030): the round's summary - every reviewer by state, the count complete of all - on the round itself, to anybody who may read it. The inbox carries no text (COL-036): it links to the round.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| RR-F | **Acts and races** (COL-057): each act and closing take an advisory lock on the round (as `lockedThread`), then read whether it is closed. **Start** once; completing when complete is refused (reopen to change the outcome); reopening when not complete is refused; closing twice answers the first. After closing, nothing changes.                                                                                                                                                                                                                                                                                                                  |
| RR-G | **Against a baseline** (COL-031): a round may name a baseline of the document; its reviewers review the baseline's page in Review mode - threads started on the pinned versions, listed and judged against the pins by a baseline-scoped list, and the review flags on the baseline view. A suggestion is made on the document as it is **(default)**: drafting from a pinned version is a later step, and the SG merge applies a suggestion to the component as it is anyway.                                                                                                                                                                           |
| RR-H | **Told** (`round`, a new kind, at once by default): each reviewer named. 0079 adds `round_id` to `notification` and `notification_held`, makes the checks thread xor round by kind, adds `rounds` to the digest's counts (a stored digest without it reads as 0), widens `NOTIFICATION_KINDS`, `tell`, the contract's kinds, the preferences and the inbox's redaction (by the round's document).                                                                                                                                                                                                                                                        |
| RR-I | **Not a gate**: closing applies nothing (COL-043) and approves nothing; requiring a round complete before issue is T9's LIF.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Task 1: The state - RR1

- `packages/domain/src/review/rounds.ts`: `reviewerState(events)`, `roundSummary(reviewers, events)`.
- Tests: **`COL-029`** each state from its events; **`COL-058`** none read from silence; **`COL-032`**
  the outcomes told apart; **`COL-057`** reopened is in progress; **`COL-030`** the summary.
- Design: collaboration.md's Review rounds, claiming COL-028 to COL-032, COL-057 and COL-058.

## Task 2: The store and the routes - RR2

- Migration 0079 (RR-A, RR-H); `packages/db/src/rounds.ts`; `apps/service/src/rounds.ts`; routes
  `POST /v1/documents/{id}/rounds`, `GET /v1/documents/{id}/rounds`, `GET /v1/rounds/{id}`,
  `POST /v1/rounds/{id}/closure`, `.../start`, `.../completion`, `.../reopening`; the `{ round }`
  target; audit; the inbox's kind; wire codes and rules; the sweeps.
- Tests: **`COL-028`**, **`COL-029`**, **`COL-030`**, **`COL-032`**, **`COL-057`**, **`COL-058`**;
  a non-person, a reviewer without `comment` or `suggest` or unable to read the scope refused; each act
  racing closing; a round invisible to whoever may not read its document; insert-only.

## Task 3: Review over a baseline - RR3

- The baseline view's review flags; `GET /v1/baselines/{id}/threads`, threads judged against the pins;
  Review mode on the baseline's page with the Threads panel; a suggestion offered on the document.
- Tests: **`COL-031`** a thread started on a pinned version, listed there and not judged by the live
  text; the page in Review; axe.

## Task 4: Rounds on the page, and the close - RR4

- Review's **Rounds** panel: open a round (title, reviewers, scope, due, baseline); each round's
  reviewers by state with their threads and suggestions counted; **Start**, **Done, with comments**,
  **Done, nothing to say**, **Reopen**; **Close**. The inbox's round notifications and preference.
- Tests: the panel, the states, axe in Light and Dark, the whole browser suite.
- The final review hunts a state read from silence, a completion changed after closing, and a round
  shown to whoever may not read its document. `features.md`, `README.md`, `architecture.md`, the
  CHANGELOG, the version (0.158.0) and the baseline.

## Changed while building

| Where | Planned                                                 | Built, and why                                                                                                         |
| ----- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| PRs   | Four PRs                                                | One, #582: the four parts were stacked while RV3 waited on CI, and one PR is what ADR-0039 prefers                     |
| RR-B  | The reviewers' check after opening                      | Before anything is recorded or anybody told: `openRound` asks the caller how many may not review (the final review, 7) |
| RR-B  | People                                                  | People who have signed in: an invitation not yet accepted is refused, since withdrawing it removes its principal       |
| RR-D  | Counts since the round opened                           | Counted on what the round covers, at the version it opened on, and up to its closing                                   |
| RR-G  | Review on a baseline for whoever may comment or suggest | For whoever may comment: Review there starts threads alone                                                             |

## Final review

Fixed: an invitation not yet accepted named as a reviewer, which withdrawing it would then fail on (1);
a completion on a baseline round recorded against the document as it is, not the baseline's text
(2); COL-050 and COL-057's who and when untested (3, 4); counts outside the round's scope and after
it closed (5); the reviewers' check after the round was recorded and its reviewers told (7); an
outcome assumed where none was given (8); the panel's acts unnamed by their round, its due date's
zone unsaid, and a refusal leaving it stale (10); Review offered on a baseline to one who may only
suggest (12); a digest able to name a round (13); HM's row (14). Left: the race of an act with
closing and a scope node's descendants are untested beyond the lock and the walk; the inbox opens the
document, not its Rounds tab; a baseline's Review mentions nobody; principals cannot be deleted while a
round names them, which erasure (LIF) must meet, as the other review tables already ask.

## Risks

- **A suggestion on a baseline round** is made on the document as it is (RR-G): a reviewer reading the
  fixed text drafts against today's, which the panel says.
