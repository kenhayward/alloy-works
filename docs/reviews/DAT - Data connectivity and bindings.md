## Gaps and ambiguities worth settling before review closes

Feedback from customers is that there is always a need to revise data values in the final document - we need the opportunity to revise an entry, have it marked as changed and flagged up for review. It should always be visible to reviewers that it has been revised by a human and be able to be refreshed when the source value has changed, refresh must be a deliberate action with accept/reject changes to overridden values

Connection lifecycle vs dependents. DAT-016 requires usage previews before query changes, but there is no equivalent for connections: deleting a connection with live queries against it, or rotating credentials under them, has unspecified behaviour. Blocked delete (or preview) plus "what happens to dependent bindings" should be stated, ideally in section 3.

Inline binding row selection. DAT-029 says an inline binding names "which value of the result", and DAT-031 fails on more than one value — but nowhere is it said how a binding picks a row from a keyed multi-row result (the keys DAT-012 demands). Either state that inline bindings require single-row results, or define key-based row selection; as written the interaction of 029/031 with keyed queries is ambiguous.

Empty block results. DAT-046 forbids publishing a placeholder for an unresolved value, but says nothing about a successful query returning zero rows. A genuinely empty table (headers only?) and a failure look identical to a reader; the validity decision belongs in this spec even if rendering is TAB's.

Floating bindings vs definition drift. DAT-015 lets a binding float at latest and DAT-016 warns authors before changes, but there's no requirement that a floating binding be re-resolved or flagged when the underlying version actually advances. Its provenance will record the version (DAT-040), which helps, yet a document can silently change semantics between publishes without any staleness signal (DAT-036 is about source data only).

Aggregate execution load. Limits are per-query (DAT-050) and cost attribution goes to ADM (DAT-053), but throttling of aggregate volume — many live bindings across a baseline all hitting one source at once — isn't owned anywhere, and it's not in the "Not here" table. That's an ownership vacuum rather than just a missing line.

Concurrency of pin/refresh. DAT-037 makes refresh explicit and audited per act, but two authors refreshing or re-pinning overlapping bindings has no stated behaviour (last-write-wins? conflict?). One sentence is probably enough given CNT likely owns document-level concurrency — say which.

## Minor nits

Traceability covers sections 4–10 and 9 only; sections 7–8 have no row, so either make it exhaustive or mark it as sampling sources.
DAT-Q02's framing ("row version, etag, modified timestamp") is a good forcing function — consider whether the answer should become a declared capability on connectors in section 12 (alongside DAT-055's list) once settled, since that's where it structurally belongs.
Nothing here changes the shape of the document; items 1–4 are addable as new requirements without restructuring anything.
