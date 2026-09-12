## Missing or under-specified areas

Semantic search has no latency story. SCH-033 carves embedding the query out of the 250ms budget, but nothing bounds it — for T5 semantic queries that carve-out removes the dominant cost from all constraints, and SCH-031 covers index-down but not slow-embedding. Needs an embedding-specific budget or a total time-to-first-result figure.

Threads are named in SCH-001 with no indexing semantics. What part of a thread is searched (title? messages?), per-message or whole-thread granularity, how re-indexing works as messages accumulate, and whether filtering applies at message level where threaded content may carry finer permissions. Assets get exactly this treatment (SCH-004); threads don't.

The query surface is unhandled. Malformed/empty queries have no defined behaviour (error? empty set? fallback to full text?). There is no autocomplete, suggestion or did-you-mean anywhere — the word "discovery" in the title is supported only by saved listings and structural queries, so either add requirements or say explicitly these are out of scope, or reviewers will raise them ad hoc. Also, typo tolerance exists only via character normalisation (SCH-012); edit-distance/fuzzy matching is unmentioned — deliberate?

Relevance has no affirmative bar, and tie-breaking is unspecified. The spec defines what ranking must not leak but says nothing about what a good order looks like for equally-permissioned users beyond determinism. More concretely: SCH-022's "no repeat or skip" paging only holds if ordering is a total order — without a stated tie-break, equally-relevant items can reorder between pages and break that requirement.

Structural responses carry counts. "Where used in 14 places" where the user may read nine of them leaks existence exactly as SCH-032 forbids for text search; SCH-026 borrows "the same terms" by reference, but the no-inference rule should be stated to apply explicitly to structural-query counts and listings. Paging/capping of large "where used" answers is also unstated.

Saved-search lifecycle. SCH-021 re-evaluates on open (correct), but nothing covers a saved search referencing term labels after the LIB thesaurus has evolved, or metadata values that no longer exist — silently re-resolved to current labels, or surfaced as stale?

Deep links can dangle. SCH-017 promises links "to the exact place it was found"; if that content is superseded or removed between index and click, where does the user land? Related: when a result comes from earlier-version search (SCH-003), does its link point at the older version — worth stating here or cross-referencing STR's anchor-resolution contract.

Facet mechanics are thin. "Metadata value" as a facet dimension is open-ended (which fields?), date facets need bucketing/range semantics, and whether facet counts recompute when other facets are selected is implied by SCH-007/034 but not stated.

Multilingual analysis is silent. No tokenisation/stemming strategy, no statement of whether cross-language matching is expected — one line either way would prevent a late argument, especially with LIB alternative labels already in the model.

"What changed since" has no lower bound (SCH-025): presumably capped by version-retention policy elsewhere; needs a cross-reference or a stated window.

Query paths are assumed to be UI-only. SCH-010 tests "every access-filtering path", but if search is reachable via API, export or integration nothing says those share the filter and budget — likely ADM-owned, worth one cross-referencing line so it isn't implicit.

## Small consistency notes

SCH-027 requires a stated indexing interval without giving a provisional value, while SCH-033 does give provisional figures. Pick one pattern: both provisional or both deferred to the ADR.
