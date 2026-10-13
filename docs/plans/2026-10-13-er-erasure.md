# ER: Erasure

> T3's eighth phase, its fourth and last slice ([ADR-0057](../decisions/0057-t3s-order-and-template-moves-leave-for-t9.md),
> [ADR-0060](../decisions/0060-deletion-is-a-tombstone-and-retention-a-minimum.md)), designed in
> [lifecycle.md](../design/lifecycle.md) and [audit.md](../design/audit.md). **Full tier**: identity,
> sign-in and a migration (0087); a pre-flight review (its findings folded in) and a final review. Ken
> asked for the run on 2026-10-13; decisions marked **(default)** are recommendations he may overturn.

**Goal:** a tenant administrator erases a person - their name and address wherever the tenant holds
them as theirs, and every audit label naming them - by one audited act that also ends their access,
and what is erased and what remains is stated (VER-038). Authored content and message text stay;
LIF-Q03 stays open for them (ADR-0060).

One PR, ER1: the plan, the design, the act, its route and its page, and the close (0.163.0).

## Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ER-A | **What is erased**, in one transaction under the principal's row lock: `display_name` becomes a fixed word ("Erased person"), `email` null, `email_verified` false, `erased_at` set (migration 0087); their sessions ended, their tokens deleted, their provider memberships removed, their accepted invitation's row deleted; then, last, `erase_labels`, so no event the act records re-creates a label. A person never accepted is withdrawn and erased in the same act. Ids stay, so every reference, author, thread, grant and event still holds, reading as the fixed word. |
| ER-B | **What remains**, stated in lifecycle.md and shown before erasing: their id and the issuer's pseudonymous subject (which refuses them, ER-D); every act recorded against the id; content, titles, comments and messages they wrote (LIF-Q03); a dataset version's record of how a source saw them (`asSeen`, immutable content), no longer shown for an erased person; audit exports made before; the erasure's own event, naming the administrator and nobody erased. storage-and-versioning.md's VER-038 prose says so.                                                         |
| ER-C | **Who and when**: `administer` at the tenant; refused while a grant names them (default: their access removed first), for oneself and for a service principal. The act itself ends sessions and tokens (default), since nothing else removes a person.                                                                                                                                                                                                                                                                                                                            |
| ER-D | **Never again**: sign-in by an erased principal's issuer and subject is refused (`principal_erased`, a refused authentication event naming nobody), so the IdP's claims never rename them; erasing the erased changes nothing; `principalLabel`, the people picker and user values treat them as erased, never as a name. A new identity is a new person (default).                                                                                                                                                                                                               |
| ER-E | **Audited** `audit.label_erased`, detail `{ labels }`, the subject the person by id; `erase_labels` gains the actor's label (keeping 0061's `search_path`).                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ER-F | **The UI**: in Administration > People, **Erase** on a person (not oneself, not a service, not the erased), stating what is erased and what remains and any grant to remove first, then **Erase**; an **Erased** chip. Withdrawing an invitation does not erase (default).                                                                                                                                                                                                                                                                                                        |

## Task 1: Erasure, and the close - ER1

- Migration 0087 (`principal.erased_at`, `erase_labels` with the actor label); `packages/db/src/erasure.ts`;
  sign-in's refusal; the route; the People page's Erase.
- Tests: every stored name, address and label erased, the count of live labels naming them zero;
  sessions, tokens, memberships and invitation gone; ids hold; sign-in refused and the name never
  restored; what remains stated; refused with a grant, for oneself and a service; once; audited with
  the actor and nothing erased; a racing sign-in serialised; axe in Light and Dark; the whole browser
  suite.
- The final review hunts a name or address still held or re-created anywhere after erasure.
  `features.md`, `README.md`, `architecture.md`, the CHANGELOG, the version (0.163.0) and the baseline.

## Changed while building

| Where | Planned                           | Built, and why                                                                                                                                                                                                                                                                                                                                          |
| ----- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR    | One                               | One, #591                                                                                                                                                                                                                                                                                                                                               |
| ER-A  | Provider memberships removed      | Every membership and grant ended, recorded, before the name goes; erasing the erased ends anything a race left                                                                                                                                                                                                                                          |
| ER-C  | Refused while a grant names them  | Only for one who has signed in: an invitee is withdrawn, which removes and records their grants; erasing is a session's alone, never a token's                                                                                                                                                                                                          |
| ER-D  | Later labels treat them as erased | A trigger on `audit_label` (`audit_label_erased_on_write`, locking the person by id `for key share`) writes any label naming an erased person already erased; grants and memberships naming them refused (`grant_subject_erased`, `group_member_erased`); sign-in holds the row after the epoch and before any membership write, rolling back if erased |
| ER-D  | Sign-in refused                   | 403 `principal_erased`, telling the person alone (Ken agreed); a principal gone mid sign-in is an ordinary failure                                                                                                                                                                                                                                      |

## Final review

Fixed: a request authenticated before the erasure writing the person's name back as a label (H1); a
sign-in racing an erasure re-creating memberships and committing (H2); an uppercase id escaping the
self refusal (M1); erasing the erased cleaning nothing up (M2); grants and memberships to the erased
(M3); an invitee refused for the grant withdrawal removes (L1); a refused withdrawal ignored (L2); a
missing principal answered as erased (L3); titles citing VER-038 for refusals (L4); the dialog's words
(L5). Left: a transaction naming a person in a label before taking the access epoch may deadlock with
their erasure, which Postgres breaks by aborting one side.
