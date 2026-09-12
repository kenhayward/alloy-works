# LIF - Lifecycle, workflow and audit

> **Status: v1, reviewed.**

## 1. Purpose

How something moves from draft to issued, who is allowed to move it, what they attest to when they
do, and the record that survives afterwards. This area owns workflow states and gates, electronic
signature, effective and review dates, retention and legal hold, and the audit log.

It is what a regulated customer buys. The rest of the product is why they would enjoy using it; this
is why they are allowed to.

## 2. Depends on

| Rests on                                            | What it fixes                                                     |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| [`Project_Scope.md`](../Project_Scope.md) §7.8, §11 | Workflow state, audit, retention, compliance posture              |
| [VER](VER-versioning-baselines-and-comparison.md)   | A gate designates a revision and may take a baseline              |
| [IAM](IAM-identity-tenancy-and-access-control.md)   | Who may pass a gate; re-assertable authentication                 |
| [COL](COL-collaboration-and-review.md)              | The threads and suggestions a gate condition counts (LIF-004)     |
| [DAT](DAT-data-connectivity-and-bindings.md)        | Provenance holds the values audit deliberately does not (LIF-030) |

| Not here                                 | There   |
| ---------------------------------------- | ------- |
| Review rounds and suggestions            | **COL** |
| What a version, revision or baseline is  | **VER** |
| Provenance of a bound value              | **DAT** |
| Cost and usage reporting                 | **ADM** |
| What a publication is, and producing one | **PUB** |
| Comparing two revisions or two lines     | **VER** |

## 3. States and transitions

| ID          | Requirement                                                                                                                                                                                                                                                                            | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **LIF-001** | Workflow states must be declared per artifact type and configurable per tenant, not fixed by the product                                                                                                                                                                               | T3         | Specified |
| **LIF-002** | Transitions must be declared: from which state, to which, and what they require                                                                                                                                                                                                        | T3         | Specified |
| **LIF-003** | A transition must be able to require a permission, an approval, or both                                                                                                                                                                                                                | T3         | Specified |
| **LIF-004** | A transition must be able to require conditions to be met: no unresolved suggestions, no open threads, no failed bindings, no missing required sections                                                                                                                                | T3         | Specified |
| **LIF-005** | An artifact must be in exactly one state at a time, and the state must be visible wherever it appears                                                                                                                                                                                  | T3         | Specified |
| **LIF-006** | A state must be able to make an artifact read-only, so that approved content cannot be edited without a transition back                                                                                                                                                                | Constraint | Specified |
| **LIF-007** | Workflow definitions must be versioned, and an artifact must record the definition version it is moving under                                                                                                                                                                          | T3         | Specified |
| **LIF-048** | State must belong to the artifact rather than to a revision: an artifact must be in exactly one state at a time in each line of revisions it has (LIF-005, LIF-044), and a revision must be an immutable designation made when a gate was passed, which never changes state afterwards | Constraint | Specified |
| **LIF-049** | Reworking an approved artifact must move the artifact to a declared working state while the approved revision stays designated, effective and available to everything referencing it. The next revision is designated by the next gate, not by beginning the rework                    | Constraint | Specified |
| **LIF-054** | Every version of a workflow definition ever used must remain retrievable for as long as any artifact or audit entry references it, so that the rules something moved under can be reconstructed rather than inferred (LIF-007)                                                         | Constraint | Specified |
| **LIF-058** | A transition must be atomic against concurrent transitions and concurrent edits: two gate actions on one artifact must not both succeed, and a transition must not commit over an edit it did not see (**COL-005**, **API-037**)                                                       | Constraint | Specified |
| **LIF-061** | A transition must be able to require a reason, recorded with it. Whether one is required is the workflow definition's to declare, and **LIF-Q01** may make it mandatory for a named regime                                                                                             | T3         | Specified |
| **LIF-050** | Producing a publication is **PUB**'s act and **PUB**'s artifact (**PUB-047**, **PUB-048**). This area owns only that a gate must be able to require or permit it (LIF-003), and that producing one is an audited event (LIF-026)                                                       | T3         | Specified |

**LIF-048 and LIF-049 answer the document's largest ambiguity, which review found exactly.** State
and revision are different things and the document used both without saying how they relate. The
awkward case review named - approved at revision 3, baselined, and then reworked - resolves like
this: the artifact moves to a working state, revision 3 stays designated and stays effective, and
revision 4 comes into existence when the next gate is passed. Nothing is in limbo, and no reader
loses the approved revision while somebody is editing.

**LIF-054 is the other half of LIF-007.** Recording which definition version an artifact moved under
answers nothing if that version is gone; the reconstruction an auditor asks for needs the rules
themselves.

**LIF-050 stops this document auditing something it never defines.** Publication appeared in
LIF-026 as an event and in LIF-023 as a deletion blocker, and nowhere as a thing - so the boundary
table now names **PUB** as its owner, and the one requirement here says what this area does with it.

**LIF-007 is easy to skip and expensive to add later.** A workflow that changes while documents are
in flight leaves those documents governed by rules nobody can reconstruct, which is precisely the
question an auditor asks.

## 4. Approvals and signature

| ID          | Requirement                                                                                                                                                                                | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **LIF-008** | An approval must record who approved, when, against which version, and against which gate                                                                                                  | T3         | Specified |
| **LIF-009** | A gate must be able to require more than one approver, and to require them to be distinct people                                                                                           | T3         | Specified |
| **LIF-010** | A gate must be able to require that the approver is not the author                                                                                                                         | T3         | Specified |
| **LIF-011** | A signing act must be able to require re-authentication (**IAM-012**) and an attributed statement of intent                                                                                | T3         | Specified |
| **LIF-012** | The statement of intent must be recorded verbatim alongside the signature, because what somebody attested to is the point of attesting                                                     | T3         | Specified |
| **LIF-013** | Passing a gate must designate a revision (**VER-013**), and must be able to take a baseline (**VER-021**)                                                                                  | T3         | Specified |
| **LIF-014** | An approval must be revocable only by a further recorded act, never by deletion                                                                                                            | Constraint | Specified |
| **LIF-051** | A gate must be refusable as well as passable: an approver must be able to reject, and the rejection must record who, when, against which version, against which gate, and the reason given | T3         | Specified |
| **LIF-052** | A rejection must return the artifact to a declared state, and the rework path must be expressible in the workflow definition (LIF-002) rather than improvised around it                    | T3         | Specified |
| **LIF-053** | A rejection must be an audited event of its own, distinct from a refused authorisation (LIF-026). One is an approver saying no; the other is somebody who was never allowed to ask         | Constraint | Specified |

**LIF-066 reconciles two sets of rules that are each right in their own context.** In life,
nothing deletes a baseline and deletion is refused while anything depends on it; at the end of a
tenant, everything becomes unreadable on a stated timetable. Both hold, in their own moment, and a
legal hold survives both - which is the only carve-out an inspector would accept.

**LIF-051 to LIF-053 answer the question that follows "who approved".** It is "what happened when it
was sent back", and the document had no way to express it: a refused authorisation (LIF-026) is a
permission failure, not an approver's decision, and nothing required a rework path to exist at all.
A rejection is a decision somebody took, with a reason, and it belongs in the record beside the
approvals.

**LIF-010 exists because it is the control an auditor looks for first**, and because it cannot be
retrofitted onto a model where an approval is just a permission - it needs the identity of the author
of the version being approved, which means the version has to carry it.

## 5. Components have lifecycles of their own

**LIF-Q04 is settled, and the answer is yes.** Customers were unambiguous: the approved version of a
component - a stability conclusion, a standard method, a piece of labelling text - carries value on
its own, and it stays approved while the report around it is still being polished. Approving
components one at a time and then approving the assembled document is not a convenience, it is the
shape of the work.

| ID          | Requirement                                                                                                                                                                                                                                        | Tranche    | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **LIF-036** | Workflow states, transitions and gates must be declarable for a component as well as for a document (LIF-001), and a component must be approvable on its own                                                                                       | T3         | Specified |
| **LIF-037** | A component's state must be independent of the state of any document using it: an approved component may sit in a draft document, and a document in review may assemble components at different states                                             | Constraint | Specified |
| **LIF-038** | Passing a component's gate must designate a component revision (LIF-013), and a document must be able to reference a component at **its latest approved revision** as well as pinned or floating at latest (**REU-050**, **STR-058**, **CNT-141**) | T3         | Specified |
| **LIF-039** | A document's gate must be able to require that every component it assembles is at an approved revision, and must name any that are not (LIF-004)                                                                                                   | T3         | Specified |
| **LIF-040** | Approving a component must not prevent work continuing on it. Editing an approved component must produce a new working version, leaving the approved revision designated, effective and served to everything referencing it                        | Constraint | Specified |
| **LIF-041** | Where a newer revision of a component is approved, every document referencing its latest approved revision must be able to see that the reference has moved before a publish carries it (**CNT-108**, **CNT-109**, **CNT-141**)                    | T3         | Specified |

**LIF-038 is the requirement that makes the rest of this work.** A reference pinned to a revision is
frozen and a reference floating at latest picks up drafts; neither is what a report needs from an
approved component. "Latest approved" is the third mode, and it is the one a regulated document
actually wants: it moves when somebody approves, never when somebody types.

**LIF-040 is the trap this would otherwise walk into.** Making approval read-only (LIF-006) at the
level of the component would mean a component approved in one report cannot be improved for the
next, which is exactly backwards for reuse. The approval fixes a revision, not a component's future.

## 6. Divergent lines: branch and merge

Two cases customers described, neither expressible before now. A standard operating procedure whose
revision 4 is effective at one plant while revision 3 is still effective at another, because the
second site has not completed training. And a core labelling document revised and approved centrally,
where an affiliate has not yet accepted the change for its market.

Both are the same shape: **more than one approved revision, effective at once, in declared scopes** -
and eventually a decision about what happens when the lines come back together.

| ID          | Requirement                                                                                                                                                                                                                                        | Tranche | Status    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **LIF-042** | More than one revision of an artifact must be able to be effective at the same time, each carrying the scope it is effective for - a site, a market, an affiliate, an organisational unit                                                          | T4      | Specified |
| **LIF-043** | Which revision applies must be answerable for any scope and any date: "what was effective at this plant on that day" must have exactly one answer, and it must be producible without engineering help (LIF-034)                                    | T4      | Specified |
| **LIF-044** | An artifact must be able to carry a divergent line of revisions, and the lines must show which revision each diverged from and when                                                                                                                | T4      | Specified |
| **LIF-045** | Bringing a divergent line back must be an explicit, audited act that states what was carried across and what was left behind. It must never be a silent overwrite, and comparison between the lines must be available first (**VER**, **LIF-Q05**) | T4      | Specified |
| **LIF-046** | An artifact that has diverged must say so wherever it appears, naming the lines and which one is being read                                                                                                                                        | T4      | Specified |
| **LIF-047** | An approved revision must be able to require acceptance by a named party before it becomes effective in that party's scope. Until then the pending revision must be visible as pending and the previous revision must remain effective there       | T4      | Specified |

**LIF-047 is the labelling case stated as a requirement.** Centrally approved and locally not yet
accepted is a real state that products without it force people to fake - by holding the approval
back, which loses the central record, or by applying it everywhere, which is wrong in every market
that has not agreed. Both revisions exist, both are visible, and each is effective exactly where it
is effective.

**Divergence here is a regulated fact, not a development workflow** (LIF-N06). Two revisions
effective in two places is something a customer must be able to show an inspector; it is not a
feature branch, and nothing here rewrites history, rebases or replays.

## 7. Dates

| ID          | Requirement                                                                                                                                                                                                                                             | Tranche | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------- |
| **LIF-015** | An artifact must be able to carry an effective date, distinct from the date it was approved                                                                                                                                                             | T3      | Specified |
| **LIF-016** | An artifact must be able to carry a review-by date                                                                                                                                                                                                      | T3      | Specified |
| **LIF-017** | Periodic review must be promptable, to a named owner, before the date rather than after                                                                                                                                                                 | T3      | Specified |
| **LIF-018** | Content past its review date must be visible as such wherever it is used, including in documents that reference it                                                                                                                                      | T3      | Specified |
| **LIF-059** | What happens when a review date passes with nobody acting must be declared in the workflow definition - a state change, an escalation to a named owner, or visibility alone - rather than decided by the product (LIF-017, **LIF-Q06**)                 | T3      | Specified |
| **LIF-060** | Where an effective date is in the future, the approved revision must be immutable until it: any further change is a new revision through the gate again, and the artifact becoming effective must itself be an audited event that nobody has to perform | T3      | Specified |

**LIF-059 makes the consequence somebody else's decision rather than nobody's.** LIF-017 prompts
before the date and LIF-018 makes lapsed content visible, and between them sat the question review
asked: what actually happens on the day. A tenant whose procedures escalate should be able to say so
in the workflow; a tenant who wants a flag and nothing else should get that.

**LIF-060 closes the window between approval and effectiveness.** A revision approved today and
effective in a month is a promise about what will be in force, and it cannot be quietly amended in
the meantime - so it is immutable, a change means another gate, and the moment it becomes effective
is recorded even though nobody performed it.

**LIF-018 is the reuse consequence of a review date.** A component that has gone stale is stale in
every document using it, and the author of a report that transcludes it has no other way of knowing.

## 8. Retention and hold

| ID          | Requirement                                                                                                                    | Tranche    | Status    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------- |
| **LIF-019** | Retention policies must be declarable per artifact type and per space                                                          | T3         | Specified |
| **LIF-020** | Archival must be distinct from deletion: archived content must remain retrievable and must stop appearing in ordinary listings | T3         | Specified |
| **LIF-021** | A legal hold must be applicable to an artifact or a space, and must prevent deletion regardless of any retention policy        | Constraint | Specified |
| **LIF-022** | A hold must record who applied it, when and why, and must be removable only by a recorded act                                  | T3         | Specified |
| **LIF-023** | Deletion must be refused where a baseline, a publication or a hold depends on what is being deleted (**VER-023**)              | Constraint | Specified |
| **LIF-024** | What deletion actually removes, and what it leaves in the audit record, must be stated rather than discovered                  | T3         | Specified |

## 9. Audit

| ID          | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Tranche    | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **LIF-025** | The audit log must be append-only, and must be impossible to modify or delete through any product surface                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Constraint | Specified |
| **LIF-026** | It must record at least: authentication, refused authorisation, content change, workflow transition, approval and signature, binding resolution and refresh, publication, export, permission change, and administrative action                                                                                                                                                                                                                                                                                                                                                                                                | T3         | Specified |
| **LIF-027** | Every entry must record who, what, when, and against which version                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | T3         | Specified |
| **LIF-028** | The log must be queryable and exportable by an administrator, and the export must be complete rather than a page of results                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | T3         | Specified |
| **LIF-029** | The log must be readable independently of the content it describes, so that it still answers questions after content is archived                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Constraint | Specified |
| **LIF-030** | The log must not contain secrets, credentials, or the value of a bound datum - it records that something happened, and **DAT** holds what the value was                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Constraint | Specified |
| **LIF-031** | Audit entries must be tenant-scoped like everything else (**IAM-005**)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Constraint | Specified |
| **LIF-032** | Clock skew must not be able to reorder the record: entries must carry a monotonic sequence as well as a timestamp                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | T3         | Specified |
| **LIF-055** | An export of the log must be verifiable by whoever receives it: it must carry a hash chain or a signature over its entries, so that completeness and integrity can be checked without trusting the exporter (LIF-028, LIF-034)                                                                                                                                                                                                                                                                                                                                                                                                | T3         | Specified |
| **LIF-056** | Whether the audit log is itself subject to a retention policy (LIF-019) must be stated, and its retention must never be shorter than that of any artifact it describes (LIF-029)                                                                                                                                                                                                                                                                                                                                                                                                                                              | T3         | Specified |
| **LIF-057** | The list in LIF-026 must also include a legal hold applied or removed (LIF-021, LIF-022), archival (LIF-020), deletion (LIF-024) and a gate rejection (LIF-051). None of these may be left to be inferred as an administrative action                                                                                                                                                                                                                                                                                                                                                                                         | T3         | Specified |
| **LIF-062** | Every recorded time must be an absolute instant in UTC, with the local offset preserved where the local time is part of the act - a signature, an effective date - and displayed in the reader's own zone (**COL-054**)                                                                                                                                                                                                                                                                                                                                                                                                       | Constraint | Specified |
| **LIF-063** | Every requirement in any area that states an action is audited must name the event type in LIF-026 or LIF-064 that it produces, and must be covered by a test asserting that the event appears in the tenant's own log with who, what, when and against which version. "Audited" must not be an adjective nothing checks                                                                                                                                                                                                                                                                                                      | Constraint | Specified |
| **LIF-064** | The list in LIF-026 and LIF-057 must also include, as event types of their own: API and MCP tool use that changes or inspects a governed artifact (**API-023**); a generation run, its acceptance and its discard (**GEN-024**, **GEN-040**); a revision to a bound value (**DAT-058**); a relationship created, changed or removed (**REL-011**, **REL-033**); an asset ingested, replaced or re-licensed (**AST-031**); access to a shared publication (**PUB-060**); a support-access grant, use and revocation (**ADM-024**); and a change to a webhook subscription or a notification channel (**API-054**, **COL-060**) | T3         | Specified |
| **LIF-065** | A gate must be able to require that a document's profile is complete - every axis its conditional content depends on explicitly set (**REU-053**) - before it is issued                                                                                                                                                                                                                                                                                                                                                                                                                                                       | T3         | Specified |
| **LIF-066** | Deletion refusal (LIF-023, **VER-023**) governs a running tenant. Closing one (**ADM-030**) may delete or render unreadable the baselines, publications and pinned artifacts it refuses to delete in life, but only after the declared grace period and the offered export - and never anything under a legal hold (LIF-021), which must be retained and reachable afterwards by a declared, audited path                                                                                                                                                                                                                     | Constraint | Specified |

**LIF-063 is the requirement that stops "audited" meaning whatever an implementer assumed.** Nine
areas say an action is audited and LIF's list named ten event types, so two teams could reasonably
file MCP tool use under "administrative action" and a bound-value revision under "content change" -
and a query for either would come back empty in one tenant and full in another. Naming the event type
at the point of the claim, and testing that it lands, is what makes the word mean something.

**LIF-055 is what LIF-034 needs to be answerable by somebody else.** "Can it be reproduced" is
asked of an export handed to an auditor, and an export nobody can check is evidence only as far as
the exporter is trusted - which is the one assumption an audit is not allowed to make. LIF-Q02 asks
whether the log is immutable at the storage layer; this is the adjacent and separate question of
whether the copy in somebody's hands is intact.

**LIF-057 turns an inference into a list.** Holds, archival and deletion were presumably meant to
arrive as "administrative action", which is exactly the reading that produces a log missing the
events a hold dispute needs.

**LIF-062 is small and is the thing a Part 11 regime will ask about first.** A signature timestamped
without a zone is a signature nobody can place in a sequence of events across two sites.

**LIF-030 is where audit and provenance divide.** An audit entry saying "this binding resolved" plus
a provenance record saying "to 31.9, from this query, at this time" is two systems each doing one
job. An audit log carrying values becomes a second copy of the data, with none of the access controls
that protect the first.

## 10. Compliance

| ID          | Requirement                                                                                                                                           | Tranche    | Status    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------- |
| **LIF-033** | The product must state which capabilities support a customer's compliance, and must not claim certification it does not hold                          | Constraint | Specified |
| **LIF-034** | Evidence an auditor asks for - who approved what, when, against which version, and can it be reproduced - must be producible without engineering help | T3         | Specified |
| **LIF-035** | Where a capability is built for a named regime, the requirement it satisfies must be recorded, so that a claim can be traced rather than asserted     | T3         | Specified |

**LIF-033 restates scope §11 because it is the requirement most likely to be softened by somebody
writing a sales page.** Capabilities that support compliance, never certifications of the product.

## 11. Non-requirements

| ID          | Not this                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **LIF-N01** | **Not an electronic signature provider.** The product records an attested act; a qualified signature is somebody else's business                                                                       |
| **LIF-N02** | **No editing or deletion of audit entries**, by anybody, including an administrator                                                                                                                    |
| **LIF-N03** | **No workflow scripting.** Transitions are declared, not programmed; an escape hatch here becomes an unauditable path                                                                                  |
| **LIF-N04** | **Not a records management system** for anything other than this product's own content                                                                                                                 |
| **LIF-N05** | **No branching by copying.** A divergent line (LIF-044) is a declared relationship between revisions of one artifact, never a duplicate artifact somebody keeps in step by hand                        |
| **LIF-N06** | **Not a version control system.** Divergence here is a regulated fact - two revisions effective in two places - not a development workflow. Nothing rebases, cherry-picks, replays or rewrites history |

## 12. Open questions

| ID          | Question                                                                                                                                                                                                                 | What would settle it                                                                                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **LIF-Q01** | **Which regimes are targeted first?** 21 CFR Part 11, SOX and GxP overlap but differ in what they require of a signature and a record                                                                                    | The first customer. It decides how much of section 4 is needed at once                                                                                                                                                                                                         |
| **LIF-Q02** | **Is the audit log write-once at the storage layer, or only by policy?** LIF-025 says impossible through any product surface, which is weaker than immutable                                                             | The storage decision, and whether an auditor will accept application-enforced immutability                                                                                                                                                                                     |
| **LIF-Q03** | **How does erasure of personal data work against LIF-025 (see VER-038)?**                                                                                                                                                | One design decision covering both, taken with legal input                                                                                                                                                                                                                      |
| **LIF-Q04** | **Do components have their own lifecycle, or only documents?** A component approved once and reused in forty reports is attractive and hard                                                                              | **Settled: yes, and it is not optional.** Customers were unambiguous - an approved component carries value on its own and stays approved while the document around it is still being polished. Section 5, LIF-036 to LIF-041, with "latest approved" as a third reference mode |
| **LIF-Q05** | **How far does bringing a divergent line back go (LIF-045)?** Choosing a side is simple and loses work; reconciling two changed revisions is a three-way merge of content, which is a large piece of work                | The first customer who diverges and then converges. Until then LIF-045 requires comparison, an explicit act and a record of what was left behind, which is the part that cannot be added later                                                                                 |
| **LIF-Q06** | **What happens by default when a review date passes and nobody acts (LIF-059)?** A state change is safe and disruptive; a flag is gentle and ignorable                                                                   | House procedure at the first regulated customer. LIF-059 makes it declarable either way, so this decides the default rather than the capability                                                                                                                                |
| **LIF-Q07** | **Is the scope a revision is effective for (LIF-042) the same axis as a profiling condition (**REU**)?** A plant and a market look like conditions, and effectiveness is a property of a revision rather than of content | A decision with **REU**. Sharing the axis makes one vocabulary; separating them stops a content filter deciding what is legally in force                                                                                                                                       |

## 13. Traceability

| This document      | Rests on                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Sections 3, 4      | Scope §7.8                                                                                                    |
| LIF-013            | VER-013, VER-021 - a gate designates a revision                                                               |
| LIF-011            | IAM-012 - re-assertable authentication                                                                        |
| LIF-030            | DAT section 9 - provenance holds values, audit holds events                                                   |
| LIF-033            | Scope §11 - capabilities, not certifications                                                                  |
| Section 5          | LIF-Q04, settled by customer practice; CNT-108 to CNT-110 carry the reference                                 |
| Section 6          | Customer practice: an SOP effective at two plants at once, and a core label an affiliate has not yet accepted |
| LIF-050            | PUB-047, PUB-048 - a publication is PUB's artifact                                                            |
| LIF-058            | COL-005, API-037 - the lock and the version precondition                                                      |
| LIF-062            | COL-054 - an absolute instant, shown in the reader's zone                                                     |
| LIF-036 to LIF-062 | [The v1 review](<../../reviews/LIF - Lifecycle, workflow and audit.md>); section 14                           |

## 14. Change history

One row per change, against
[the review](<../../reviews/LIF - Lifecycle, workflow and audit.md>) that prompted it. The rules for
what gets a new identifier are in [the index](README.md#how-a-requirement-is-written).

### The question the review answered

| Point                                       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LIF-Q04: do components have lifecycles?** | **Settled: yes, and not optionally.** A new section 5, LIF-036 to LIF-041. A component is approvable on its own, its state is independent of any document using it, and approving it designates a component revision. The load-bearing one is **LIF-038**: a document can reference a component at **its latest approved revision**, a third mode beside pinned and floating - pinned is frozen and floating picks up drafts, and neither is what a regulated report wants. **LIF-040** stops the obvious mistake: approval fixes a revision, it does not stop the component being improved for the next report |

### The gap worth documenting now

| Point            | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch and merge | **A new section 6, LIF-042 to LIF-047**, from the two cases the review named. More than one revision effective at once, each in a declared scope (LIF-042), with "what was effective at this plant on that day" answerable in one answer (LIF-043); divergent lines that show what they diverged from (LIF-044); convergence as an explicit audited act that says what was left behind, never a silent overwrite (LIF-045); divergence visible wherever the artifact appears (LIF-046). **LIF-047 is the labelling case**: centrally approved, not yet accepted by an affiliate, both revisions real and each effective where it is effective. **LIF-N05** and **LIF-N06** keep this a regulated fact rather than a source-control system, and **LIF-Q05** leaves the depth of a merge open |

### The ranked gaps

| Gap                                     | Change                                                                                                                                                                                                                                                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where state lives relative to revisions | **LIF-048 and LIF-049**, and they resolve exactly the case review named. State belongs to the artifact; a revision is an immutable designation. Approved at revision 3 and reworked: the artifact moves to a working state, revision 3 stays designated and effective, revision 4 exists when the next gate is passed |
| Publication is referenced, never owned  | **LIF-050** plus a boundary row. A publication is **PUB**'s artifact (PUB-047, PUB-048); this area owns only that a gate can require or permit producing one, and that doing so is audited                                                                                                                            |
| Rejection has no requirements           | **LIF-051 to LIF-053.** A gate is refusable, the rejection records who, when, against what and why, the rework path is in the workflow definition rather than improvised, and a rejection is its own audit event - an approver saying no is not the same event as somebody who was never allowed to ask               |
| Old workflow definitions must survive   | **LIF-054**: every version ever used stays retrievable while anything references it. Recording the version number was half the control                                                                                                                                                                                |
| The log's integrity and retention       | **LIF-055** (an export carries a hash chain or signature, so a recipient can check it without trusting the exporter - which is what LIF-034 asks of somebody else) and **LIF-056** (the log's own retention is stated, and never shorter than that of what it describes)                                              |

### The smaller items

| Item                         | Change                                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LIF-026's event list         | **LIF-057** adds holds, archival, deletion and rejection explicitly, rather than leaving them to be inferred as administrative actions                          |
| Transition concurrency       | **LIF-058**: atomic against concurrent transitions and concurrent edits, pointing at the lock and the version precondition rather than inventing a third answer |
| A missed review date         | **LIF-059** makes the consequence declarable - state change, escalation, or visibility alone - and **LIF-Q06** asks what the default should be                  |
| Approval-to-effective window | **LIF-060**: the approved revision is immutable until it takes effect, a change means another gate, and becoming effective is an audited event nobody performs  |
| A reason for a transition    | **LIF-061**: requirable by the workflow definition, recorded with the transition. LIF-Q01 may make it mandatory for a named regime                              |
| Timestamps                   | **LIF-062**: absolute instants in UTC, the local offset kept where it is part of the act, displayed in the reader's zone                                        |

### What the review said not to change, and what was not changed

The "able to" phrasing, the tranche and `Constraint` split, LIF-N03 on workflow scripting, and
LIF-012's verbatim statement of intent are all untouched. New requirements in sections 5 and 6 are
written in the same voice deliberately: capability requirements, not prescribed behaviour.

### Counts

|                  | Before | After                              |
| ---------------- | ------ | ---------------------------------- |
| Requirements     | 35     | 62                                 |
| Non-requirements | 4      | 6                                  |
| Open questions   | 4      | 7, of which LIF-Q04 is now settled |

### From the cross-cutting review

A later review read all twenty-one documents against each other. Its sections are answered in
[XXX - Response.md](<../../reviews/XXX - Response.md>); what changed here:

| Review sections       | Change                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.3, 2.4, 2.18, 3.2.4 | **LIF-063** requires every requirement that says "audited" to name its event type and be tested, so the word stops being an adjective nothing checks. **LIF-064** adds the event types nine areas were already producing. **LIF-065** lets a gate require a complete profile. **LIF-066** reconciles deletion refusal in life with tenant closure at the end, with legal hold surviving both |
