# The rest of T1

**Goal:** finish tranche T1 - "a single-author product that already publishes better than a word
processor" - from where it stands at 0.69.0, in the order that builds each thing once.

**Argues from:** [the T1 audit against the code](<../reviews/T1 - Audit against the code.md>), which
read every T1 requirement not yet `Covered` against the code and moved out of T1 what depends on a
later tranche. This plan is the map; each workstream below gets its own design (where it has none)
and its own plan, written when its turn comes, as every slice so far has.

**Status: agreed.** Ken approved the order (K1) on 2026-09-25, which makes this the plan for the
rest of T1. Each workstream's design and plan still come to him as they arrive, with their own
decisions.

## Where T1 stands after the rescoping

|                                       | Count |
| ------------------------------------- | ----: |
| T1 requirements in force              |   331 |
| Covered                               |   184 |
| Left to demonstrate                   |   147 |
| - of which built, needing only a test |    22 |
| - of which a budget or a practice     |     8 |

`pnpm trace tranche T1` is the live count; the figures here are from the day this plan landed.

## The workstreams

Each is one piece of work: one design where it needs one, then build slices of a pull request each.
Sizes are in pull requests, a design counted as one. The identifiers are the requirements it
closes, after the rescoping; the audit's appendix says what each one lacks.

| #   | Workstream                                         | Closes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Design                                                                                                                                               |   PRs | Needs first                                        |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----: | -------------------------------------------------- |
| W1  | **Test debt** - built, uncited; and CI's test time | CNT-014, CNT-019, CNT-026, CNT-061, CNT-062, CNT-081, CNT-085, STR-024, VER-009, IAM-053, API-003, API-005, STY-019 (once reworded, K7), PUB-069, PUB-031, TAB-050, CNT-160, CNT-164, CNT-166, CNT-169, STR-068, IAM-078; and CNT-124, whose one citation shows only its first sentence . And three changes to how CI runs the tests (Ken, 2026-09-25): Turbo's logs streamed in CI, so a long suite shows itself running rather than the last one to finish looking stuck; the worker's login roles set up once for the run, so its test files can run in parallel; and one veraPDF kept warm for the run instead of one started per check | four need a design claim before a test may cite them: PUB-069 and PUB-031 in publishing.md, CNT-160 in structure.md, CNT-166 in content-model.md     |     3 | -                                                  |
| W2  | **Small fixes found by the audit**                 | CNT-075, CNT-079, CNT-074, API-012, API-037, API-047, API-006, CNT-069 (history depth), PUB-003 (order, and its swap tests), CNT-167 (Word's footnotes kept on paste), API-003 (moved from W1: a status the contract does not declare is sent unchecked, issue #240); and the design text the audit found stale: publishing.md's `citation_unresolved`, where veraPDF runs, and docs/features.md on the document view                                                                                                                                                                                                                       | claims to add first: CNT-075, CNT-079 and CNT-074 in component-editor.md, API-037 and API-047 in service-foundations.md, CNT-167 in content-model.md |     3 | -                                                  |
| W3  | **Word output**                                    | PUB-023, PUB-024, PUB-025, PUB-026, PUB-027, PUB-029, PUB-035, PUB-067, and the Word halves of PUB-012, PUB-034, PUB-092, CNT-045, CNT-084, CNT-128, TAB-039, TAB-049, STY-053                                                                                                                                                                                                                                                                                                                                                                                                                                                              | word-output.md, refreshed and measured                                                                                                               |     6 | -                                                  |
| W4  | **Templates**                                      | TPL-001, TPL-059, TPL-053, TPL-004, TPL-006, TPL-012, TPL-013, TPL-015, TPL-025, TPL-027, TPL-062, TPL-054, TPL-055, STY-025, STR-060, VER-056, IAM-018, IAM-024                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | new: templates.md                                                                                                                                    |     5 | -                                                  |
| W5  | **Definitions and the metadata panel**             | MET-008, MET-012, MET-031, MET-037, MET-040, MET-041, MET-021, MET-033, MET-038, MET-023. MET-040 and MET-037 find where a schema applies by a query over component types and templates, not by MET-025's where-used (T2)                                                                                                                                                                                                                                                                                                                                                                                                                   | new: the management design metadata.md defers to; the panel is in component-editor.md                                                                |     4 | W4 for the document and section places             |
| W6  | **Search**                                         | SCH-054, SCH-002, SCH-010, SCH-011, SCH-012, SCH-016, SCH-017, SCH-034, SCH-039, SCH-046, SCH-057, SCH-059, SCH-062, SCH-066, IAM-075                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | search.md, planned                                                                                                                                   |     4 | W4, W5 (templates and metadata to index and facet) |
| W7  | **Listings and the API**                           | API-007, SCH-022, SCH-064, API-008, API-004                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | service-foundations.md                                                                                                                               |     2 | W4 (a templates listing)                           |
| W8  | **The theme in the editor, and choosing a style**  | STY-058, STY-039, STY-070, CNT-082, CNT-097, CNT-115, CNT-094, CNT-121, CNT-122, STR-025                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | themes.md, a section of its own                                                                                                                      |     4 | K8 (a caption placement row)                       |
| W9  | **The document view**                              | CNT-072, CNT-073, CNT-075, CNT-154, CNT-105, CNT-156, IAM-023, CNT-158, CNT-160, CNT-162, STR-035, STR-045, STR-065                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | new: layout C moved from docs/interface into a design                                                                                                |     4 | -                                                  |
| W10 | **Preview**                                        | CNT-150, PUB-005, PUB-006; and CNT-151, CNT-096, PUB-080 unless K2 takes them out                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | publishing.md                                                                                                                                        | 1 (3) | K2                                                 |
| W11 | **Recovery**                                       | CNT-067, CNT-069 (across a reload), CNT-089, CNT-090, VER-003, VER-004                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | component-editor.md; the retention defect fixed in storage-and-versioning.md                                                                         |     2 | -                                                  |
| W12 | **Identity**                                       | IAM-009, IAM-029, and IAM-033, IAM-034, IAM-035 unless K3 moves them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | access.md; a service-identity design                                                                                                                 |     4 | W4 (templates as a level)                          |
| W13 | **A browser suite, and verified accessibility**    | CNT-139, CNT-078, STR-039, CNT-076, STR-006, the editor half of STY-053                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | docs/testing.md                                                                                                                                      |     3 | K4; W8 and W9 for what it measures                 |
| W14 | **Publishing, finished**                           | PUB-087, PUB-090, PUB-091, PUB-085, TAB-034 and STR-023 (with issue #129), CNT-148, CNT-057                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | publishing.md                                                                                                                                        |     5 | K5, K6                                             |

About 51 pull requests in all.

## Decisions to take before the work that needs them

From [the audit](<../reviews/T1 - Audit against the code.md#decisions-for-ken>), where each is argued:
K1 the order (below), K2 the warm range preview, K3 service identities, K4 a browser suite in CI,
K5 PUB-085 against PUB-091, K6 headings deeper than six, K7 eight rewordings, K8 caption
placement. **K1 is decided: approved on 2026-09-25.** K2, K3 and K8 are needed before W10, W12 and
W8.

## The order, and why

1. **W1 and W2 first**, because they are small, they need nothing, and every one of them makes the
   trace tell the truth sooner.
2. **Word output (W3)**, as ordered. It needs nothing that is not built: the maths tree, the theme's
   Word projection and the published document all exist.
3. **Templates (W4), then definitions and the metadata panel (W5).** This departs from the order of
   2026-09-23, which had search next (decision K1). Search indexes metadata values and templates,
   narrows by them and facets over them. Built before anybody can enter a value or make a template,
   it would be built twice.
4. **Search (W6) and listings (W7)**, over what then exists.
5. **The editor's half of T1 (W8, W9, W10, W11)**, the theme first because the document view renders
   it.
6. **Identity, the browser suite, and publishing's last rows (W12, W13, W14).**

## The week

A working day here has been one design and its first slice, or two or three build slices, each
through its review. So a week holds about 20 pull requests, not 50. This is the week's share; the
rest is the second week's.

**As run:** Word output (W3) started first, on Ken's word of 2026-09-25, and was built in four pull
requests by 2026-09-26, word-output.md's four slices; the test debt and the small fixes (W1, W2)
follow it.

| Day | Work                                                                                                                                  | PRs |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | --: |
| 1   | This audit. W1: the test debt, in two PRs. W2: the first fixes (CNT-075, CNT-079, CNT-074, API-012, API-047)                          |   4 |
| 2   | W2's second PR (API-006, API-037, CNT-069, PUB-003). W3: the Word output design, measured in Word                                     |   2 |
| 3   | W3: the writer, styles, language and links; then headings, footnotes and cross-reference fields                                       |   2 |
| 4   | W3: tables, figures and accessibility with the publication's report; equations as OMML and the keep rules; the verification practice  |   3 |
| 5   | W4: the templates design; the template artifact and its bindings                                                                      |   2 |
| 6   | W4: the starting outline, instantiation, a document taking its template's theme and layout; schema assignments and publish validation |   3 |
| 7   | W5: the definitions design; fields, schemas and types managed; the metadata panel                                                     |   3 |

**By the end of the week:** Word output done, templates done, metadata well along, and the trace
counting every built thing. **Left for the second week:** W2's last PR (Word paste footnotes and
the stale design text), the metadata panel's last slice, and W6 to W14 - search, listings, the theme
in the editor, the document view, preview, recovery, identity, the browser suite and publishing's
last rows: about 31 PRs, or 33 if the warm range preview stays in T1.

## How each workstream runs

As every slice since footnotes has: a design measured against the pinned tools, with lettered
decisions for Ken where there is a choice; a plan in this folder; implementation test first by task;
a whole-branch review that drives the code and compiles real output; its findings fixed test first;
a scoped re-review; one pull request, one version bump, one changelog entry. The test-debt PRs are
the exception: each new test is watched fail by breaking the code it covers, then the break is
undone, since the code already exists.

## Tracking

This table is updated as each workstream lands.

| #   | Workstream                         | Status                                                                                    |
| --- | ---------------------------------- | ----------------------------------------------------------------------------------------- |
| W1  | Test debt                          | In progress ([plan](2026-09-26-w1-test-debt-and-ci.md); W1.1 is PR #239, W1.2 is PR #241) |
| W2  | Small fixes                        | Not started                                                                               |
| W3  | Word output                        | Built (PRs #231, #236, #237, #238)                                                        |
| W4  | Templates                          | Not started                                                                               |
| W5  | Definitions and the metadata panel | Not started                                                                               |
| W6  | Search                             | Not started                                                                               |
| W7  | Listings and the API               | Not started                                                                               |
| W8  | The theme in the editor            | Not started                                                                               |
| W9  | The document view                  | Not started                                                                               |
| W10 | Preview                            | Not started                                                                               |
| W11 | Recovery                           | Not started                                                                               |
| W12 | Identity                           | Not started                                                                               |
| W13 | A browser suite                    | Not started                                                                               |
| W14 | Publishing, finished               | Not started                                                                               |
