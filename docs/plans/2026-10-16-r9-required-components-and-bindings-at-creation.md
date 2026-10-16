# R9: Required components, and bindings at creation

> T4's ninth slice, extending [templates.md](../design/templates.md). **Full tier**: a stored shape
> (the template definition and the outline's reference node), a process boundary (creation runs the
> connector), a contract change. Built inline, one final review at the slice's end. Decisions marked
> **(default)** are recommendations Ken may overturn; ADR-0062 holds the two he answered.

**Goal:** a template declares components every document from it includes, each at a place in its
starting outline and with the reference mode it chooses; making a document places them, runs their
bindings' queries and stores the results, or makes nothing; the template's query set is computed from
them and must resolve first; and a required component goes only with a reason, a publish failing
where one is missing.

| PR  | Holds                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------- |
| R9a | This plan, ADR-0062, the requirement changes; required components declared, resolved, placed, protected  |
| R9b | Bindings at creation through the service; cohorts refused a bound template; the page; the close, 0.180.0 |

## Decisions

| ID   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R9-A | **Declared on the template** (TPL-014, TPL-049; default): `components`, at most 50, each `{ key, component, mode, place: { section: key \| null, at: 'start' \| 'end' } }`. `mode` is the outline's reference mode, `approved` unless declared (ADR-0062). `section: null` places it at the outline's top level. Keys are one namespace with the starting sections', so a waiver names either.                                                                                                                                                                  |
| R9-B | **Placed as a reference** (TPL-062's materialising): a reference node carrying `origin`, its key, as a starting section does: additive at outline schema 3, as `overrides` is, so no stored outline's digest moves.                                                                                                                                                                                                                                                                                                                                             |
| R9-C | **Resolved before anything is written** (TPL-004, TPL-070): each component must be a component the creator may read, a pinned version its own, and an `approved` one hold an approved revision. Its version so chosen gives its bindings, and each binding's definition must be one the creator may read: that is the query set. Any failure is `template_unresolved`, naming the key and why.                                                                                                                                                                  |
| R9-D | **Removed only with a reason** (TPL-044): removing a reference whose `origin` the template requires needs a reason, recorded as a waiver as a section's is (`section_waiver`, keyed by the template key); a restore dropping one is refused; publishing fails `component_required`, naming it, where one is absent and not waived.                                                                                                                                                                                                                              |
| R9-E | **Queries first, the document second** (TPL-063, TPL-065, TPL-024; R9b, default): creation from a template with a non-empty query set decides each binding's question from the outline it would write and the parameters asked, runs them through the connector outside any transaction, as resolve does, then in one transaction makes the document and records each result as the binding's resolution. A query that fails refuses the creation, naming it, and nothing is written; a result already in the object store is unreferenced bytes, kept by hash. |
| R9-F | **Cohorts wait** (R9b, default): the worker holds no connector (DAT-088), so a cohort asked of a template whose query set is not empty is refused, `cohort_bound`, until bulk generation can run queries.                                                                                                                                                                                                                                                                                                                                                       |
| R9-G | **The page** (R9b): the outline marks a required component as the template's; removing it asks for a reason, as a required section does. No template editor exists; templates are made through the API.                                                                                                                                                                                                                                                                                                                                                         |
| R9-H | **Not here**: TPL-049's other half, a component placed as document-level matter by the layout, since no layout places a component (PUB-088 places generated matter); variables, profile defaults and REU-037 (R10).                                                                                                                                                                                                                                                                                                                                             |

## Task 1: Required components - R9a

- Domain: the definition member and its checks; `materialiseTemplate` placing references; resolution
  of components, versions and the query set; the reference's `origin`; `missingComponents` beside
  `missingSections`.
- Db: `resolveForDocument` reading the components, their versions and bindings' definitions;
  `editOutline` and restore protecting a required reference; `resolvePublishable` failing
  `component.required`.
- Tests: placed at start and end of a section and at the top, in each mode; unresolved by an
  unreadable component, a foreign pin, no approved revision and an unreadable definition; removal
  refused without a reason and waived with one; a publish refused where one is missing.

## Task 2: Bindings at creation - R9b

- Service: creation's three phases beside `resolveAct`, sharing its `prepare` and `runOnce`; the
  cohort refusal; contract and documentation.
- Web: the outline's required-component mark and reason.
- Tests: a document made with each binding held; a failing query leaving no document; parameters
  reaching `{ document }` arguments at creation; a cohort refused; the browser walks; the close.

## Built

R9a in #655, R9b with the close (0.180.0) in #656. A bound creation is prepared in a savepoint it rolls back, its queries run after the deciding transaction commits, and it is made with the same identifiers beside its results. Creation refuses an idempotency key there (R9-E). The final review found a result holding images the space did not hold leaving pending results nobody would finish (now refused, `images_pending`), `create` in the space not decided again after the queries ran (now decided), and a move to a version requiring a new component reporting nothing (now reported); all fixed, each with a test. Left: TPL-049's layout-placed half, a cohort of a bound template (`cohort_bound`), and a way to place a component a move newly requires.
