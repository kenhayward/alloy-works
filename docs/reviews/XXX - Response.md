# Response to the Cross Cutting Review of Requirements Specifications

One section here for each numbered section of
[the review](<XXX - Cross Cutting Review.md>), in its order, with its title repeated. Each says what
was decided and what changed. The requirements themselves carry the detail, and each amended document
ends with a **From the cross-cutting review** row in its change history.

**Headline:** 1257 requirements to 1303, with 46 added and 8 superseded across 16 documents. Every
P0 and P1 gap is closed in requirements; the three candidate new areas are answered as cross-cutting
requirements with named owners rather than as new areas, and that choice is itself recorded as
**ADM-Q07** so it can be revisited when the tranches are planned.

---

# 1. Are the 21 areas complete? Are there other full areas that should be separately specified?

**Agreed on the decomposition, and the three operational candidates are answered inside the existing
areas rather than by adding new ones.** Notifications, background work and security/data protection
are real gaps, but each turned out to be a handful of requirements that fit in a document that
already owns the surrounding behaviour: notification mechanics in COL-060 to COL-062 and API-055,
scheduled work in ADM-040, boundaries, backup and derived copies in ADM-041 to ADM-044 and IAM-066.
Adding an area is not a free move here - it changes the scope's ownership map, the index and a test
that asserts twenty-one - so the smaller move is taken first and **ADM-Q07** records the question for
when the tranches are planned. Organisation administration is specified rather than deferred
(IAM-068, IAM-069, and ADM-N02 amended); the three watch items - desktop runtime, HTML reading
experience, billing - are left as watch items, since each depends on a product decision nobody has
taken yet.

---

# 2. Gaps and seams between the documents: missing or incomplete requirements

**All ten P0 seams and all twelve P1 seams are closed in requirements; the four P2 items are closed
or recorded.** The pattern across them was the same: a rule stated once in one document and assumed
by several others, or an enumeration that had quietly become a checklist. Where a list was the
problem, the rule behind it is now stated and the list reads as examples - IAM-066 for derived
copies, PUB-071 for publish failure, API-058 for listability. Section by section below.

## 2.1 The "latest approved" reference mode exists in LIF but not in the core reference model

**Fixed, and it was the most load-bearing one.** LIF-038 introduced a third reference mode that the
core model did not define, so four documents described two modes and one described three. **REU-002
is superseded by REU-050** and **STR-009 by STR-058**, both naming pinned, floating at latest and
tracking the latest approved revision; **CNT-110 is superseded by CNT-141** so the view shows which of
the three a reference takes; and **REU-041 is superseded by REU-051**, which resolves every _movable_
reference once for a cohort rather than only the floating ones - the bug the old wording would have
shipped.

## 2.2 Baseline/publication reproducibility does not pin all referenced artifacts

**Fixed by addition rather than by rewriting VER-018**, which is cited from three other documents and
is not wrong, only incomplete. **VER-054** pins what a resolved document also depends on: the
bibliography entries, terms and vocabulary values it references, and the template version with the
definitions that version owned. **PUB-082** stops a publication's record being weaker than the
baseline's pins and requires it to identify the accepted generated content it contains, with the
prompt, model and context digest retained for it.

## 2.3 The audit event taxonomy is incomplete relative to other documents' "audited" requirements

**Both halves of the suggested fix are taken.** **LIF-064** adds the event types nine areas were
already producing - tool use, generation and its acceptance, a bound-value revision, relationship
changes, asset ingest and re-licensing, shared-publication access, support access, webhook and
channel configuration. **LIF-063** is the more important one: every requirement anywhere that says an
action is audited must name the LIF event type it produces and be covered by a test asserting it
lands in the tenant's log. Otherwise "audited" is an adjective nothing checks.

## 2.4 Document profile initialization and validation are not fully specified between TPL and REU

**Fixed across all three documents.** **TPL-051** lets a template declare default profile values and
which axes a document must set, and requires instantiation to establish the profile rather than leave
it undeclared. **REU-053** fails a publish while an axis its conditional content depends on is unset,
unless exclusion-by-unset is explicitly accepted and recorded - REU-024's safe default stays, and
stops silently withholding a section nobody decided to withhold. **LIF-065** lets a gate require a
complete profile before issue.

## 2.5 Notifications, webhooks and scheduled work are under-specified as an operational system

**Specified as cross-cutting requirements in the areas that own the surrounding behaviour.**
**COL-060** makes notification channels tenant configuration - permissioned, audited, exportable;
**COL-061** states the delivery guarantee, the de-duplication identifier and where a failing channel
surfaces; **COL-062** gives the inbox a retention and deprovisioning lifecycle and names it a second
copy of tenant content. **API-055** makes webhook subscriptions administrable with a signing-key
rotation path. **ADM-040** makes scheduled and system work visible per tenant with state, last run,
next due and last failure - the layer nine documents assumed and none owned. Whether this should have
been an area is **ADM-Q07**.

## 2.6 IAM-005's tenant-scoped list is incomplete for derived copies of content

**Fixed by stating the rule behind the list.** **IAM-066** says every second copy, derived
representation or outbound payload of tenant content is tenant-scoped and permissioned like what it
derives from - indexes, caches, embeddings, asset derivatives, export artifacts, notification
messages, webhook payloads, audit exports and backups - with a test per path. IAM-005 is kept and
cited from four other documents; it now reads as the examples rather than the boundary.

## 2.7 AI-proposed edits are not explicitly bound to the same concurrency rules as human edits

**Fixed in GEN, where the assistant lives.** **GEN-060** makes accepting or applying generated
content a write like any other: the component lock, the refusal naming its holder, and the version
precondition at the API all apply, and nothing is applied automatically while somebody else holds the
lock. No new mechanism - the existing one, said out loud, so that the convenient implementation is
not available.

## 2.8 Outline/document-level concurrency is delegated but not fully specified

**Fixed, and the delegation was the defect.** STR sent this to COL, which holds locks per component
and explicitly declines document-level locking, so nothing described two people reordering one
outline. **STR-059** answers it here: a version precondition at the API, conflict detection in the
interface, refusal or surfacing against the current outline, and the component lock still governing
the content a node points at. No document-level lock is introduced.

## 2.9 Realtime connections and shared publications are not fully covered by sign-out/revocation requirements

**Fixed in all three places it shows up.** **IAM-067** stops authorised data flowing on an already
open connection after sign-out or revocation, within a stated bound, with an authentication failure
rather than quiet continuation. **API-054** re-checks authorisation on a live connection at a stated
interval rather than only at connect and reconnect. **PUB-083** stops a revoked or expired share
serving a session that was established while it was live.

## 2.10 Where-used / impact analysis scope is incomplete across artifact types and baselines/publications

**Fixed by addition, since REU-006 is cited from four documents.** **REU-052** covers every
reference-bearing artifact - including bibliography entries, vocabulary values, citation styles,
baselines and publications - and, more usefully, separates **live references**, which a change would
reach, from **pins in a baseline or publication**, which it never will. An impact list that mixes the
two tells an author that correcting a component will alter a report issued two years ago.

## 2.11 Organization-level administration is introduced but not specified

**Specified rather than deferred.** **IAM-068** gives an organisation administrators of its own, with
organisation-level acts - creating a tenant, suspending one, changing the shared identity-provider
configuration - permissioned through roles and audited into both the organisation's record and the
affected tenant's own log. **IAM-069** holds the line that matters: an organisation administrator
sees administrative metadata about its tenants and never their content.

## 2.12 Data residency and external data flows need a central declaration

**Fixed as one tenant-visible declaration.** **ADM-041** requires a single place where a tenant can
see everything that can leave its boundary - model endpoints, embedding, external reference sources,
translation services, malware scanning, data connections, webhooks and notification delivery - each
saying what may leave, whether it is on by default, who may change it and any residency constraint.
The residency commitments themselves remain **ADM-Q01**; this makes the inventory answerable before
that question is settled.

## 2.13 Support access is required but not administratively specified

**Fixed.** **ADM-042** turns the principle into a control: a tenant administrator grants, reviews and
revokes support access, each grant declaring scope - metadata only, diagnostics, content read -
expiry, purpose and recipient, audited into the tenant's own log, shown in ADM-025, and appearing in
the effective-permission view like any other grant.

## 2.14 High-risk administrative permissions are too coarse under "administer"

**Fixed without inventing a role list.** **IAM-070** requires the permission model to name the
high-risk acts separately from `administer` - whole-tenant export, audit-log export, legal hold,
suspension and closure, support-access grant, secret rotation, external-service configuration,
webhook and channel configuration - each grantable through a role and explainable in the
effective-permission view. A customer with a compliance officer and a space administrator can now
tell them apart.

## 2.15 Whole-tenant export/import completeness needs to cover administrative configuration and identity remapping

**Both halves fixed.** **IMP-045** puts the administrative configuration inside the export -
connections, model endpoints, external sources, translation policy, workflow definitions, retention
policies, notification channels, webhook subscriptions - with secrets as references. **IMP-046**
requires an explicit identity mapping on import, or refusal, and forbids silently reassigning the
actor of an audit record to somebody who did not act.

## 2.16 Backup, disaster recovery and integrity verification are implied but not fully specified

**Fixed in ADM.** **ADM-043** requires backup frequency, recovery point and recovery time declared per
artifact class and restoring exercised on a schedule - a restore never rehearsed is not a capability.
**ADM-044** requires declared integrity re-verification schedules for assets, version digests and
audit exports, with failures surfaced in diagnostics and audited rather than logged.

## 2.17 Publication sharing needs an explicit external-recipient lifecycle

**Fixed on both sides of the seam.** **PUB-084** makes sharing a publication create a named,
time-bounded grant scoped to that publication alone, with identity proved before first access, the
grant listed in IAM's external-access listing, and every access recorded. **IAM-048 is superseded by
IAM-071**, which grants external access against named artifacts - a space, a document or a
publication - rather than only spaces and documents.

## 2.18 Suspension/closure/legal hold interaction needs explicit rules

**Fixed with the carve-out stated.** **LIF-066** says deletion refusal governs a running tenant, and
closing one may delete or render unreadable the baselines, publications and pinned artifacts it
refuses to delete in life - but only after the declared grace period and the offered export, and
never anything under a legal hold, which is retained and reachable afterwards by a declared, audited
path. **ADM-031 is superseded by ADM-045**, which names shares, webhooks, scheduled work, realtime
connections, model endpoints, indexes, notifications and in-flight publications.

## 2.19 Performance budgets need a central governance mechanism

**Fixed.** **ADM-046** requires every budget in the specification to be registered with its owner, its
reference configuration, whether it is provisional, the tranche by which it is confirmed and how it
is measured in production - and ADM-016's reporting to say, budget by budget, whether it is being
met. That makes API-Q07, CNT-Q13 and the other provisional numbers visible as a set rather than as
paragraphs in nine documents.

## 2.20 A global error and correlation-ID contract should apply across all surfaces

**Fixed corpus-wide.** **API-056** takes API-005 and API-006 beyond the synchronous API: every failure
surfaced to a user, administrator or integrator uses the structured contract with a stable
identifier, and every request, job, event, webhook delivery, realtime message, notification and
publishing-pipeline stage carries a correlation identifier that appears in logs, in diagnostics and
in any error about it.

## 2.21 Idempotency and pagination need to cover jobs, bulk operations and large lists

**Fixed.** **API-057** makes job submission and bulk operations safely retryable, so a retry returns
the original work rather than starting a second export or cohort, and requires the specification to
say what a retry does where an operation cannot be idempotent. **API-058** gives everything any area
calls listable a paging, cap and stable-order contract - which matters most for exactly the listings
this review added.

## 2.22 Secret dependency visibility should cover all outbound service credentials

**Fixed by generalising.** **ADM-032 is superseded by ADM-047**, which covers every tenant secret and
outbound credential - connections, model endpoints, external reference sources, translation services,
scanning services, notification channels, webhook signing keys and scheduled work - and requires a
rotation failure to be reported once against the secret, naming every dependent capability. DAT-066's
citation follows.

## 2.23 Inbound document import sanitization is not as explicit as paste sanitization

**Fixed.** **IMP-047** holds every inbound document to the same rule as a paste: scripts, macros,
event handlers, embedded objects and non-allowlisted link targets never stored, and anything removed
named in the import report. AST-Q01 on SVG remains open and is now the blocking question it always
was.

## 2.24 Extension governance needs more administrative detail

**Fixed at the administrative layer.** **API-059** makes installing, updating and removing an
extension permissioned, audited and tenant-visible, and requires an extension to declare what leaves
the tenant boundary so that it appears in ADM-041's inventory. Per-tenant version pinning stays
**API-Q06**, which is the architecture question API-Q03 has to answer first.

## 2.25 Several `should` requirements need explicit decision records if not implemented

**Fixed as a rule in the index rather than as a list that would go stale.** The Requirement column's
definition now says that a `should` a tranche does not deliver needs a decision record citing it and
saying why. That keeps every `should` in the corpus - API-031, IMP-016, PUB-041, STR-043 and the rest

- accountable at the moment it is skipped, without a register somebody has to maintain.

## 2.26 Cost attribution is strong for AI/data but incomplete for other external operations

**Fixed.** **ADM-048** extends attribution to every chargeable external operation: external reference
searches, translation jobs, malware scanning, notification and email delivery, webhook delivery,
indexing and embedding, and bulk generation. It matters more if ADM-Q02 settles towards metering for
pricing, and it is worth having for visibility either way.

---

# 3. Inconsistencies between the documents

**All nine citation inconsistencies are corrected and all nine semantic tensions are resolved.** The
citation set was the more useful finding: seven of the nine were citations to requirements this
year's review pass had superseded, which is the exact failure the supersede-don't-edit rule is
supposed to make visible and does not make self-correcting.

## 3.1 Direct citation and status inconsistencies

**All nine fixed.** Every area document's status line now reads `v1, reviewed` (3.1.1); ADM cites
API-051 (3.1.2); AST-039 and its traceability row cite CNT-140 and CNT-084, typo corrected (3.1.3);
CNT-N07 cites CNT-129 (3.1.4); REU-N04 cites REU-048 (3.1.5); LOC-N04 cites LOC-037 (3.1.6); PUB's
traceability row cites PUB-072 (3.1.7); STY's image-style traceability row cites CNT-121 to CNT-123
(3.1.8); and STY-048 cites the supported locales and CNT-059's bidirectional text rather than
LOC-004, which is about interface layout (3.1.9).

## 3.2 Semantic tensions between documents

**All nine resolved**, each in the document that owns the answer. 3.2.1 is fixed by section 2.1's
reference-mode work. 3.2.2 by IAM-071 and PUB-084. 3.2.3 by IMP-048, which scopes IMP-003 to foreign
content needing a human split judgement. 3.2.4 by LIF-066's closure carve-out. 3.2.5 by amending
ADM-N02 to admit organisation-level administrative and cost reporting while keeping the ban on
cross-tenant content and analytics. **3.2.6 is settled rather than deferred: CNT-Q15 is closed, and
CNT-091, CNT-092 and CNT-093 are superseded by STY-016, STY-017 and STY-029**, leaving CNT what
content carries and STY how a style resolves, with `docs/design/themes.md` following. 3.2.7 by
REU-052. 3.2.8 by API-025 being superseded by API-060, which includes notification events. 3.2.9 by
STR-059.

---

# Recommended next actions

**Waves 1 and 2 are done in full; wave 3 is answered as requirements with the area question
recorded.** The citation corrections and status lines are complete, every P0 semantic fix is a
requirement rather than a note, and the operational architecture seams - notifications, background
work, security and data protection, organisation administration - are specified inside the areas that
own the surrounding behaviour, with **ADM-Q07** carrying whether any of them should graduate to an
area of its own. The open questions the review lists as blocking remain open and are unchanged by
this pass, except **CNT-Q15**, which is settled here.

## Bottom line

**Agreed, and the seven named risks are now closed or tracked.** Reference-mode inconsistency,
reproducibility gaps, the audit taxonomy, the operational seams, tenant-isolation completeness for
derived copies, the lifecycle edge cases and the stale citations each have requirements behind them
rather than reasonable-sounding prose. What remains deliberately open is the shape of the
decomposition itself: twenty-one areas held, three candidates were answered inside them, and whether
that holds is a question for the first tranche that has to build one of them.
