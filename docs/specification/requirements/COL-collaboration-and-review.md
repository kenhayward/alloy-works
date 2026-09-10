# COL - Collaboration and review

> **Status: v1, for review.**

## 1. Purpose

Several people working on one document without treading on each other, and the review that turns a
draft into something somebody will sign. This area owns presence, soft component locks, review
threads, suggested edits, review rounds and the notifications that carry them.

Scope §4 names review as an entry requirement rather than a differentiator: it must feel at least as
good as a word processor, or the product loses the room regardless of what else it does.

## 2. Depends on

| Rests on                                           | What it fixes                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| [`Project_Scope.md`](../Project_Scope.md) §7.7, §9 | Soft locks rather than real-time co-editing; suggestions are first-class |
| [CNT](CNT-content-and-authoring.md)                | Suggestion and comment anchor marks are in the T1 schema                 |

| Not here                                    | There   |
| ------------------------------------------- | ------- |
| The marks themselves                        | **CNT** |
| Approval gates and signatures               | **LIF** |
| What a version is, cut when a lock releases | **VER** |
| Who may comment, suggest or approve         | **IAM** |

## 3. Presence

| ID          | Requirement                                                                                                    | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **COL-001** | A user must be able to see who else is in a document, and roughly where                                        | T3         | Specified |
| **COL-002** | Presence must show what each person is doing: reading, reviewing or editing (**CNT-104**)                      | T3         | Specified |
| **COL-003** | Presence must respect permissions - a user must not be shown somebody working in a component they may not read | Constraint | Specified |
| **COL-004** | Presence must degrade to absence rather than to a wrong answer when a connection drops                         | T3         | Specified |

## 4. Locks

| ID          | Requirement                                                                                                                           | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **COL-005** | A component must be editable by one user at a time, and claiming it must be automatic on beginning to edit rather than a separate act | T3         | Specified |
| **COL-006** | A lock must never prevent anybody from reading, commenting on or suggesting against the component                                     | Constraint | Specified |
| **COL-007** | A held lock must be visible wherever the component appears, naming the holder and when it is expected to release (**CNT-074**)        | T3         | Specified |
| **COL-008** | A lock must release automatically after a declared period of inactivity, and the period must be a tenant setting                      | T3         | Specified |
| **COL-009** | A lock must be takeable from an idle holder, with a warning, and the taking must be audited                                           | T3         | Specified |
| **COL-010** | Releasing a lock deliberately must cut a version; a lock timing out must not (**CNT-070**, **VER-003**)                               | Constraint | Specified |
| **COL-011** | Locks must be held per component, never per document, so that a report is worked on by several people at once                         | Constraint | Specified |

**COL-010 is where three areas meet, and getting it wrong is quiet.** A version must be a positive
act, so a timeout cannot cut one - and the work is safe anyway, because iterations are retained until
the next version rather than for a fixed window. Cutting a version on timeout would put an
unfinished state into the permanent record with nobody's name against the decision.

## 5. Threads

| ID          | Requirement                                                                                            | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **COL-012** | A thread must be anchorable to a span of text, a component, a table cell, or an outline node           | T3         | Specified |
| **COL-013** | A thread must be resolvable, and resolving it must record who did so and when                          | T3         | Specified |
| **COL-014** | A thread must support replies, and must show them in order with their authors                          | T3         | Specified |
| **COL-015** | A mention must notify the person mentioned, and must respect whether they may read the thing discussed | T3         | Specified |
| **COL-016** | A thread must survive the content around it changing                                                   | T3         | Specified |
| **COL-017** | A thread whose anchor no longer exists must be surfaced as orphaned, never silently discarded          | Constraint | Specified |
| **COL-018** | Threads must be listable for a whole document, filterable by state, author and age                     | T3         | Specified |
| **COL-019** | Threads must not appear in published output in any form                                                | Constraint | Specified |

**COL-017 is the same principle as everywhere else in this specification.** A comment that vanishes
because somebody edited the sentence it referred to is feedback silently discarded, and the person
who wrote it will assume it was read.

## 6. Suggestions

| ID          | Requirement                                                                                                                                 | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **COL-020** | A reviewer must be able to propose a change as a suggestion, rendered as a redline, without altering the content                            | T3         | Specified |
| **COL-021** | A suggestion must be attributable to its author and its time                                                                                | T3         | Specified |
| **COL-022** | A suggestion must be acceptable or rejectable individually, and in bulk by author or by scope                                               | T3         | Specified |
| **COL-023** | Accepting or rejecting must act on the whole suggestion in one operation, across every fragment of it (**CNT-005**)                         | Constraint | Specified |
| **COL-024** | Accepting a suggestion must be audited, and must be attributable to the person who accepted it rather than to the person who proposed it    | T3         | Specified |
| **COL-025** | Suggestions must be visible against a locked component, so that review does not wait for an author to finish                                | T3         | Specified |
| **COL-026** | An author must be able to see what they themselves changed in the current session, distinctly from what others have suggested (**CNT-113**) | T1         | Specified |
| **COL-027** | Unresolved suggestions must be reportable, and a lifecycle gate must be able to require that there are none (**LIF**)                       | T3         | Specified |

## 7. Review rounds

| ID          | Requirement                                                                                                              | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ | ------- | --------- |
| **COL-028** | A review round must name its reviewers, its scope and its due date                                                       | T3      | Specified |
| **COL-029** | Each reviewer's state must be visible: not started, in progress, or complete                                             | T3      | Specified |
| **COL-030** | "Has everybody reviewed this" must be answerable without asking anybody                                                  | T3      | Specified |
| **COL-031** | A round must be able to be run against a baseline, so that reviewers see a fixed document rather than a moving one       | T3      | Specified |
| **COL-032** | A reviewer must be able to record that they have finished with nothing to say, which is different from not having looked | T3      | Specified |

**COL-031 is what makes a round meaningful.** Reviewing a document that changes underneath you
produces comments about text that no longer exists, and it is the commonest reason a review is
repeated.

## 8. Notifications

| ID          | Requirement                                                                                                         | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **COL-033** | Notifications must be deliverable in an in-app inbox and by email                                                   | T3         | Specified |
| **COL-034** | A user must be able to choose what they are notified about and how often                                            | T3         | Specified |
| **COL-035** | Notifications must be digestible into a single message rather than one per event                                    | T3         | Specified |
| **COL-036** | A notification must not disclose content the recipient may not read - it must say that something happened, not what | Constraint | Specified |
| **COL-037** | Notification events must also be available as webhooks (**API**)                                                    | T5         | Specified |

**COL-036 is a leak that arrives by email.** A notification quoting the sentence somebody commented
on sends that sentence to whoever is on the thread, past whatever permissions the document had.

## 9. Non-requirements

| ID          | Not this                                                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **COL-N01** | **No real-time character-level co-editing.** Scope §9 decision 4; the parallelism authors want is across components (**COL-011**)                  |
| **COL-N02** | **No document-level locking.** It defeats the point of components                                                                                  |
| **COL-N03** | **No comments in published output** (COL-019)                                                                                                      |
| **COL-N04** | **No anonymous review.** Every comment, suggestion and acceptance is attributable, because an audited document cannot contain unattributed changes |

## 10. Open questions

| ID          | Question                                                                                                                                        | What would settle it                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **COL-Q01** | **May a reviewer who also holds authoring rights edit directly instead of suggesting?** Carried from CNT-Q10                                    | Whether review in this market is a separate pass or a mode anybody drops into           |
| **COL-Q02** | **What is the default lock timeout (COL-008)?** Too short interrupts thinking; too long blocks a colleague                                      | Observed behaviour. Fifteen minutes is a guess, not a finding                           |
| **COL-Q03** | **Can a thread be private to some reviewers?** Internal comments before a client sees a document are ordinary in consulting                     | Whether early customers review in front of their clients. It interacts with **IAM-Q04** |
| **COL-Q04** | **Does the soft-lock bet survive contact with users?** Scope §13 names it as a risk, and it is the one thing here that a demo will be judged on | Early evaluations. The content model stays CRDT-compatible either way                   |

## 11. Traceability

| This document | Rests on                                                  |
| ------------- | --------------------------------------------------------- |
| Sections 4, 6 | Scope §9 decision 4 - soft locks, suggestions first-class |
| COL-010       | CNT-070, VER-003 - a version is a positive act            |
| COL-023       | CNT-005, spike case 1 - one action across every fragment  |
| COL-026       | CNT-113 - what I changed this session                     |
| COL-036       | Scope §11 - permissions hold outside the product too      |
