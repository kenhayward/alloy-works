# COL - Collaboration and review

> **Status: v1, for review.**

## 1. Purpose

Several people working on one document without treading on each other, and the review that turns a
draft into something somebody will sign. This area owns presence, soft component locks, review
threads, suggested edits, review rounds and the notifications that carry them.

Scope §4 names review as an entry requirement rather than a differentiator: it must feel at least as
good as a word processor, or the product loses the room regardless of what else it does.

## 2. Depends on

| Rests on                                           | What it fixes                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| [`Project_Scope.md`](../Project_Scope.md) §7.7, §9 | Soft locks rather than real-time co-editing; suggestions are first-class  |
| [CNT](CNT-content-and-authoring.md)                | Suggestion and comment anchor marks are in the T1 schema                  |
| [IAM](IAM-identity-tenancy-and-access-control.md)  | Who may comment, suggest, accept or approve, external principals included |
| [LIF](LIF-lifecycle-workflow-and-audit.md)         | The audit log review metadata is retained in, and its retention policy    |

| Not here                                                | There   |
| ------------------------------------------------------- | ------- |
| The marks themselves                                    | **CNT** |
| Approval gates and signatures                           | **LIF** |
| What a version is, cut when a lock releases             | **VER** |
| Who may comment, suggest or approve                     | **IAM** |
| Whether a mark survives an edit to the content under it | **CNT** |
| Delivering a webhook, and its transport                 | **API** |
| How long review metadata is kept                        | **LIF** |

## 3. Presence

| ID          | Requirement                                                                                                                                                                                                      | Tranche    | Status    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **COL-001** | A user must be able to see who else is in a document, and roughly where                                                                                                                                          | T3         | Specified |
| **COL-002** | Presence must show what each person is doing: reading, reviewing or editing (**CNT-104**)                                                                                                                        | T3         | Specified |
| **COL-003** | Presence must respect permissions - a user must not be shown somebody working in a component they may not read                                                                                                   | Constraint | Specified |
| **COL-004** | Presence must degrade to absence rather than to a wrong answer when a connection drops                                                                                                                           | T3         | Specified |
| **COL-055** | A presence claim must be bounded by a declared heartbeat: a mode not refreshed within that period must be shown as stale, and then as absence, never as a live claim                                             | T3         | Specified |
| **COL-056** | Where a component is deleted or moved, locks and presence against it must degrade to absence exactly as a dropped connection does (COL-004), and threads anchored into it must be surfaced as orphaned (COL-017) | T3         | Specified |

**COL-055 bounds the case COL-004 does not.** A dropped connection is visible; a slow one is not,
and a heartbeat that arrives late is indistinguishable from a person who left an hour ago. Presence
that keeps asserting "editing component 12" after somebody closed their laptop is worse than no
presence at all, because a colleague waits on it.

## 4. Locks

| ID          | Requirement                                                                                                                                                                                                                                                                                   | Tranche    | Status    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **COL-005** | A component must be editable by one user at a time, and claiming it must be automatic on beginning to edit rather than a separate act                                                                                                                                                         | T3         | Specified |
| **COL-006** | A lock must never prevent anybody from reading, commenting on or suggesting against the component                                                                                                                                                                                             | Constraint | Specified |
| **COL-007** | A held lock must be visible wherever the component appears, naming the holder and when it is expected to release (**CNT-074**)                                                                                                                                                                | T3         | Specified |
| **COL-008** | A lock must release automatically after a declared period of inactivity, and the period must be a tenant setting                                                                                                                                                                              | T3         | Specified |
| **COL-009** | A lock must be takeable from an idle holder, with a warning, and the taking must be audited                                                                                                                                                                                                   | T3         | Specified |
| **COL-010** | Releasing a lock deliberately must cut a version; a lock timing out must not (**CNT-070**, **VER-003**)                                                                                                                                                                                       | Constraint | Specified |
| **COL-011** | Locks must be held per component, never per document, so that a report is worked on by several people at once                                                                                                                                                                                 | Constraint | Specified |
| **COL-044** | Where two users claim an unlocked component at once, exactly one must win. The loser must be told immediately, must never be shown an editable surface for a lock they do not hold, and must lose nothing they typed                                                                          | T3         | Specified |
| **COL-045** | When a lock is taken from its holder (COL-009), the holder's unsaved work must be kept as an iteration against that component (**CNT-089**), the holder must be told at once that the lock has gone and where their work is, and they must be able to recover it when they next hold the lock | T3         | Specified |
| **COL-046** | Taking a lock (COL-009) must require the holder to have been idle for a declared period, which must be shorter than the automatic-release period (COL-008). Both must be tenant settings, and the taking period must never be set longer than the release period                              | T3         | Specified |
| **COL-047** | A holder must be warned before their lock is taken and given a declared grace period in which any activity keeps it. Taking must never be instant, and must never be silent                                                                                                                   | T3         | Specified |

**COL-044 to COL-047 answer "what happens to the loser", which review found unanswered at every
lock transition but the timeout.** COL-010 reassures that a timeout loses nothing; nothing said the
same about a steal or a claim race, and those are the transitions where somebody has actually been
typing. The answer in both cases is that their work becomes an iteration and they are told
immediately - not that they are told when they next look.

**COL-046 settles the relationship between COL-008 and COL-009**, which review was right to call
ambiguous. Two periods, not one: a shorter idle threshold after which a colleague may take the lock
with a warning, and a longer one after which it releases on its own. The ordering is a constraint
rather than a convention, because a take period longer than the release period would make COL-009
unreachable - the lock would always have released first, and a tenant could configure that state
without noticing.

**COL-010 is where three areas meet, and getting it wrong is quiet.** A version must be a positive
act, so a timeout cannot cut one - and the work is safe anyway, because iterations are retained until
the next version rather than for a fixed window. Cutting a version on timeout would put an
unfinished state into the permanent record with nobody's name against the decision.

## 5. Threads

| ID          | Requirement                                                                                                                                                                                                                                 | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **COL-012** | A thread must be anchorable to a span of text, a component, a table cell, or an outline node                                                                                                                                                | T3         | Specified |
| **COL-013** | A thread must be resolvable, and resolving it must record who did so and when                                                                                                                                                               | T3         | Specified |
| **COL-014** | A thread must support replies, and must show them in order with their authors                                                                                                                                                               | T3         | Specified |
| **COL-015** | A mention must notify the person mentioned, and must respect whether they may read the thing discussed                                                                                                                                      | T3         | Specified |
| **COL-016** | A thread must survive the content around it changing                                                                                                                                                                                        | T3         | Specified |
| **COL-017** | A thread whose anchor no longer exists must be surfaced as orphaned, never silently discarded                                                                                                                                               | Constraint | Specified |
| **COL-018** | Threads must be listable for a whole document, filterable by state, author and age                                                                                                                                                          | T3         | Specified |
| **COL-019** | Threads must not appear in published output in any form                                                                                                                                                                                     | Constraint | Specified |
| **COL-038** | A thread must be markable internal, and an internal thread must be invisible to external principals (**IAM-045**)                                                                                                                           | T4         | Specified |
| **COL-039** | Whether a thread is internal must be evident to everybody who can see it, so that an internal thread is never mistaken for one the client has already read                                                                                  | Constraint | Specified |
| **COL-040** | A reply must inherit the internal marking of the thread it joins, and must never be able to widen it                                                                                                                                        | Constraint | Specified |
| **COL-049** | A thread must not be deletable, by its author, by an author of the component, or by a tenant administrator. A thread that should not have been raised is resolved, and the record of it stays                                               | Constraint | Specified |
| **COL-050** | Review metadata - threads, replies, suggestions, withdrawals, acceptances, rejections and round state - must be retained against the version it was made against, and must be removable through no product surface by anybody (**LIF-025**) | Constraint | Specified |
| **COL-051** | A comment may be edited by its author, and the earlier text must be retained in the record rather than replaced                                                                                                                             | T3         | Specified |

**COL-017 is the same principle as everywhere else in this specification.** A comment that vanishes
because somebody edited the sentence it referred to is feedback silently discarded, and the person
who wrote it will assume it was read.

**COL-038 to COL-040 stopped being an open question the moment external reviewers did.** Nobody
reviews a document in front of their client without somewhere to talk first, so an internal thread is
not a refinement of review, it is what makes reviewing alongside a client possible at all. COL-039
matters more than it looks: the dangerous mistake is not an internal thread the client can read, which
a permission check prevents, but an internal thread somebody believes is internal when it is not. See
[ADR-0011](../../decisions/0011-external-participation-guests-and-identified-links.md).

**COL-049 to COL-051 say what "audited" was assuming.** Review was right that attributable
(COL-N04) is not the same as retained: a document whose comment history an administrator can tidy
away is not audited, it is merely attributed while nobody has had a reason to edit it. So deletion
does not exist here, editing a comment keeps what it said before, and the guarantee is stated rather
than implied by the word audit appearing elsewhere. **LIF** owns how long the record is kept and
**LIF-021** owns what a legal hold does to that.

## 6. Suggestions

| ID          | Requirement                                                                                                                                                                                                                          | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **COL-020** | A reviewer must be able to propose a change as a suggestion, rendered as a redline, without altering the content                                                                                                                     | T3         | Specified |
| **COL-021** | A suggestion must be attributable to its author and its time                                                                                                                                                                         | T3         | Specified |
| **COL-022** | A suggestion must be acceptable or rejectable individually, and in bulk by author or by scope                                                                                                                                        | T3         | Specified |
| **COL-023** | Accepting or rejecting must act on the whole suggestion in one operation, across every fragment of it (**CNT-005**)                                                                                                                  | Constraint | Specified |
| **COL-024** | Accepting a suggestion must be audited, and must be attributable to the person who accepted it rather than to the person who proposed it                                                                                             | T3         | Specified |
| **COL-025** | Suggestions must be visible against a locked component, so that review does not wait for an author to finish                                                                                                                         | T3         | Specified |
| **COL-026** | An author must be able to see what they themselves changed in the current session, distinctly from what others have suggested (**CNT-113**)                                                                                          | T1         | Specified |
| **COL-027** | Unresolved suggestions must be reportable, and a lifecycle gate must be able to require that there are none (**LIF**)                                                                                                                | T3         | Specified |
| **COL-041** | Accepting or rejecting a suggestion writes to the component and is therefore an edit: the person doing it must hold the lock, claimed automatically where the component is free (COL-005)                                            | Constraint | Specified |
| **COL-042** | Where another user holds the lock, accepting or rejecting must be refused, naming the holder and when the lock is expected to release (COL-007). The suggestion must stay pending                                                    | T3         | Specified |
| **COL-043** | A suggestion must only ever be applied by a deliberate act of a person holding the lock. Nothing must apply one automatically - not a lock releasing, not a timeout, not a round closing, and not a queue of decisions taken earlier | Constraint | Specified |
| **COL-048** | The author of a suggestion must be able to withdraw it while it is unresolved. A withdrawal must record who and when, exactly as a rejection does, and must not remove the record that the suggestion was made                       | T3         | Specified |
| **COL-052** | Where accepting one suggestion leaves another no longer applicable, the second must be surfaced as stale, saying what happened to it. It must never be silently dropped, and must never be rejected on its author's behalf           | T3         | Specified |

**COL-041 to COL-043 close the interaction review ranked first, and the answer is the boring one.**
Accepting a suggestion writes content, and so does rejecting one - the suggestion mark lives in the
stored content, so resolving it either way is a change to the component. That makes it an edit,
which means the lock governs it. Suggesting still never needs the lock (COL-006); deciding always
does.

**The alternative - queue the decision and apply it when the lock frees - was considered and
refused** (COL-043). A queued acceptance is a change to a document made by nobody, at a time nobody
chose, against content that has moved since the decision was taken. "Refused, here is who holds it,
try again in four minutes" is a worse interaction and a far better guarantee. One consequence is
**COL-Q06**: a principal who may accept suggestions but may not author now needs the lock to do it.

**COL-052 extends COL-017's principle from threads to suggestions**, which review was right to say
was left to inference. The symmetry is exact: a suggestion that quietly becomes unapplicable is
feedback silently discarded, and its author will assume it was considered. **CNT** owns whether the
mark survives an edit under it; this area owns what the reviewer is shown when it does not.

## 7. Review rounds

| ID          | Requirement                                                                                                                                                                   | Tranche    | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **COL-028** | A review round must name its reviewers, its scope and its due date                                                                                                            | T3         | Specified |
| **COL-029** | Each reviewer's state must be visible: not started, in progress, or complete                                                                                                  | T3         | Specified |
| **COL-030** | "Has everybody reviewed this" must be answerable without asking anybody                                                                                                       | T3         | Specified |
| **COL-031** | A round must be able to be run against a baseline, so that reviewers see a fixed document rather than a moving one                                                            | T3         | Specified |
| **COL-032** | A reviewer must be able to record that they have finished with nothing to say, which is different from not having looked                                                      | T3         | Specified |
| **COL-057** | A reviewer's completion must be reversible while the round is open, and reopening must be recorded with who and when                                                          | T3         | Specified |
| **COL-058** | "Has everybody reviewed this" (COL-030) must be answered from explicit completion alone (COL-029, COL-032). Inactivity must never be read as completion                       | Constraint | Specified |
| **COL-059** | A review round must be able to name an external principal as a reviewer on the same terms as an internal one; what that principal may then do remains **IAM**'s (**IAM-045**) | T4         | Specified |

**COL-058 is the difference between a report and a guess.** A reviewer who has not looked and a
reviewer who has looked and had nothing to say are different states (COL-032), and reading silence
as either one makes COL-030 unanswerable in exactly the case somebody asks it. COL-057 is its
companion: completion is a statement, and a statement made early must be retractable while the round
is still open.

**COL-059 confirms what the prose assumed.** Review noticed that external participation is heavier in
this document's prose than in its requirements, and asked for the boundary to be stated rather than
inferred. A round may name an external principal; **IAM** decides what they may do once named.

**COL-031 is what makes a round meaningful.** Reviewing a document that changes underneath you
produces comments about text that no longer exists, and it is the commonest reason a review is
repeated.

## 8. Notifications

| ID          | Requirement                                                                                                                                                                                                                         | Tranche    | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **COL-033** | Notifications must be deliverable in an in-app inbox and by email                                                                                                                                                                   | T3         | Specified |
| **COL-034** | A user must be able to choose what they are notified about and how often                                                                                                                                                            | T3         | Specified |
| **COL-035** | Notifications must be digestible into a single message rather than one per event                                                                                                                                                    | T3         | Specified |
| **COL-036** | A notification must not disclose content the recipient may not read - it must say that something happened, not what                                                                                                                 | Constraint | Specified |
| **COL-037** | Notification events must also be available as webhooks (**API**)                                                                                                                                                                    | T5         | Specified |
| **COL-053** | The rule in COL-036 must hold wherever review material leaves the document: a report of unresolved suggestions (COL-027), an export, a digest and a webhook payload (COL-037) must each carry no content the recipient may not read | Constraint | Specified |

**COL-036 is a leak that arrives by email.** A notification quoting the sentence somebody commented
on sends that sentence to whoever is on the thread, past whatever permissions the document had.

**COL-053 is the same leak by a different door**, and review was right that the principle had been
written down once and scoped to notifications. A report of unresolved suggestions, an export of a
review round and a webhook payload all carry review text out of the document, and each reaches
somebody whose permissions were checked somewhere other than where the text was assembled.

## 9. Time, and what a date means

Everything here happens at a time and several things are due at one, and review pointed out that the
document never said what a time is. For an audited product with reviewers in other countries, that
is not a detail: a due date that means a different instant to the person who set it and the person
who has to meet it is a dispute waiting for a deadline.

| ID          | Requirement                                                                                                                                                                                                                                                 | Tranche | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **COL-054** | Every time this area records - a suggestion's time, a resolution, an expected lock release, a round's due date - must be stored as an absolute instant, displayed in the reader's own time zone, and shown as an instant rather than as a bare calendar day | T3      | Specified |

## 10. Non-requirements

| ID          | Not this                                                                                                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **COL-N01** | **No real-time character-level co-editing.** Scope §9 decision 4; the parallelism authors want is across components (**COL-011**)                                                                    |
| **COL-N02** | **No document-level locking.** It defeats the point of components                                                                                                                                    |
| **COL-N03** | **No comments in published output** (COL-019)                                                                                                                                                        |
| **COL-N04** | **No anonymous review.** Every comment, suggestion and acceptance is attributable, because an audited document cannot contain unattributed changes                                                   |
| **COL-N05** | **No live cursors.** Presence says which component each person is in and their mode (COL-001, COL-002), not where their cursor is; cursor-level presence belongs to the co-editing COL-N01 rules out |
| **COL-N06** | **No deleting review history.** Not by its author, not by an author of the component, not by a tenant administrator (COL-049, COL-050). Resolution is how a thread stops mattering                   |
| **COL-N07** | **No queued or automatic application of a suggestion** (COL-043). A change to a document is made by a person, at a moment they chose, against the content in front of them                           |

## 11. Open questions

| ID          | Question                                                                                                                                                                                   | What would settle it                                                                                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **COL-Q01** | **May a reviewer who also holds authoring rights edit directly instead of suggesting?** Carried from CNT-Q10                                                                               | Whether review in this market is a separate pass or a mode anybody drops into                                                                                                                               |
| **COL-Q02** | **What is the default lock timeout (COL-008)?** Too short interrupts thinking; too long blocks a colleague                                                                                 | Observed behaviour. Fifteen minutes is a guess, not a finding                                                                                                                                               |
| **COL-Q03** | **Can a thread be private to some reviewers?**                                                                                                                                             | **Settled.** Internal threads are required, not optional, because external reviewers exist (COL-038 to COL-040). See [ADR-0011](../../decisions/0011-external-participation-guests-and-identified-links.md) |
| **COL-Q04** | **Does the soft-lock bet survive contact with users?** Scope §13 names it as a risk, and it is the one thing here that a demo will be judged on                                            | Early evaluations. The content model stays CRDT-compatible either way                                                                                                                                       |
| **COL-Q05** | **What are the two idle periods in COL-046 - the one after which a lock may be taken, and the one after which it releases?** COL-Q02 asks half of this question; COL-046 is why it is two  | Observed behaviour, as with COL-Q02. The ordering is fixed by COL-046; the numbers are not                                                                                                                  |
| **COL-Q06** | **May a principal who can accept suggestions but cannot author hold a lock in order to accept one?** COL-041 makes accepting an edit, which ties it to the lock and so to authoring rights | A decision in **IAM**. If such a principal exists, either the lock admits a narrower claim or the right implies the other                                                                                   |

## 12. Traceability

| This document      | Rests on                                                                       |
| ------------------ | ------------------------------------------------------------------------------ |
| Sections 4, 6      | Scope §9 decision 4 - soft locks, suggestions first-class                      |
| COL-010            | CNT-070, VER-003 - a version is a positive act                                 |
| COL-023            | CNT-005, spike case 1 - one action across every fragment                       |
| COL-026            | CNT-113 - what I changed this session                                          |
| COL-036, COL-053   | Scope §11 - permissions hold outside the product too                           |
| COL-038, COL-059   | IAM-045, ADR-0011 - external principals                                        |
| COL-027, COL-050   | LIF - gates, the audit log, retention                                          |
| COL-037, COL-053   | API - webhooks and their payloads                                              |
| COL-041 to COL-059 | [The v1 review](<../../reviews/COL - Collaboration and review.md>); section 13 |
| COL-045            | CNT-089 - an iteration is where unsaved work lives                             |
| COL-052            | CNT-003 to CNT-005 - marks, and what survives an edit                          |

## 13. Change history

One row per change, against [the review](<../../reviews/COL - Collaboration and review.md>) that
prompted it. The rules for what gets a new identifier are in
[the index](README.md#how-a-requirement-is-written).

### The gaps the review ranked, in its order

| Gap                                               | Change                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Applying a suggestion against an active lock   | **Decided: accepting and rejecting are edits and need the lock.** COL-041 says so, COL-042 refuses the attempt and names the holder rather than queueing it, COL-043 forbids anything applying a suggestion automatically. **COL-N07** states the refusal of queueing as a non-requirement, **COL-Q06** records the consequence for a principal who may accept but may not author |
| 2. In-flight work at every lock transition        | **COL-044** (claim race: one winner, the loser told at once and losing nothing) and **COL-045** (a taken lock leaves the holder's work as an iteration, CNT-089, and tells them where it went)                                                                                                                                                                                    |
| 3. COL-008 against COL-009                        | **COL-046**: two declared periods, the take threshold necessarily shorter than the release period, both tenant settings, the ordering a constraint rather than a convention. **COL-047** adds the warning and a grace period in which activity keeps the lock. **COL-Q05** asks what the two numbers are                                                                          |
| 4. Deletion, withdrawal and audit retention       | **COL-048** (an author may withdraw their own unresolved suggestion, recorded like a rejection), **COL-049** (a thread is deletable by nobody, administrators included), **COL-050** (review metadata retained against its version, removable through no surface), **COL-051** (a comment may be edited, the earlier text kept). **COL-N06** says it as a non-requirement         |
| 5. Does COL-017's principle extend to suggestions | **Yes: COL-052.** A suggestion made unapplicable by accepting another is surfaced as stale, never silently dropped and never rejected on its author's behalf. **CNT** owns whether the mark survives; this area owns what the reviewer sees                                                                                                                                       |
| 6. The leak principle stops at notifications      | **COL-053** generalises COL-036 to every way review material leaves the document: the unresolved-suggestions report, exports, digests and webhook payloads                                                                                                                                                                                                                        |

### Smaller precision points

| Point                                    | Change                                                                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Time semantics unspecified               | A new section 9 and **COL-054**: absolute instants, displayed in the reader's zone, and a due date that means an instant rather than a calendar day whose meaning changes with the reader   |
| Presence staleness while connected       | **COL-055**: a presence claim is bounded by a declared heartbeat, and goes stale and then absent rather than staying asserted                                                               |
| A component deleted mid-collaboration    | **COL-056**: locks and presence degrade to absence as they do for a dropped connection (COL-004); threads anchored into it are orphaned (COL-017)                                           |
| "Complete" in COL-029, and COL-030       | **COL-057** (completion is reversible while the round is open, and reopening is recorded) and **COL-058** (the answer comes from explicit completion alone; inactivity is never completion) |
| Traceability does not match the document | IAM, LIF and API added to section 2 and to the traceability table, which is where COL-038, COL-027 and COL-037 were already pointing                                                        |

### Verified rather than assumed

| Check                                       | Finding                                                                                                                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| External principals can be named in a round | **Confirmed and now stated: COL-059.** A round may name an external principal on the same terms as an internal one; IAM-045 and ADR-0011 decide what they may then do. The prose assumed it, the requirements did not say it |

### Counts

|                  | Before | After |
| ---------------- | ------ | ----- |
| Requirements     | 40     | 59    |
| Non-requirements | 5      | 7     |
| Open questions   | 4      | 6     |
