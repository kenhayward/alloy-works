## Quality issues

Modal verb hygiene. Nearly every row says "must"; TAB-005 alone says "should" ("Column width should be governed by the table style"). If this set follows RFC 2119 semantics that's a meaningful downgrade and almost certainly unintentional — column-width governance reads like it ought to bind. Pick one keyword discipline across all rows or state that non-musts are deliberate.

Capability-level phrasing leaves mechanism open. "Must be able to select which columns appear, in what order" (TAB-001), "must not wrap" override (TAB-005), "aggregation named" (TAB-009) — these state that something exists without the data shape. That may be intentional deferral to STY/DAT, but it means you can't write acceptance criteria from the rows alone. At minimum, each should name what carries the declaration: by column key or ordinal index; declared in the table definition or in a style reference.

The format requirements overlap without a precedence rule. TAB-012 (take formatting by type, may override), -013 (types covered), -014 (precision per column), -015 (rounding declared) interact unstated. When the style says "currency, 2 dp" and a column overrides precision to 4 dp — what wins, and where is that stated? This is the one cluster I'd tighten most; it's the sort of thing that produces inconsistent output between two tables of the same kind, which is exactly the failure TAB-029's rationale worries about for emphasis.

TAB-019 contradicts its own scope on unit conversion. The justification says provenance must record "the number the source gave, not with the rounded, unit-converted thing on the page." That implies unit conversion happens at presentation layer — but no requirement authorizes (or forbids) it. Either grant/forbid conversion explicitly in this doc or state it belongs to query/DAT and add a line to §2's "Not here" table. As written, the spec references a capability it never defines.

Accessibility is thin for a tabular spec. §9 carries only TAB-031 (header association) plus visual page-break behaviour (TAB-032, deferred to STY-013) and wide-table strategy (TAB-033). But you cite accessibility as a binding concern in TAB-030, so the gap reads as under-covered rather than out-of-scope. Missing within this layer: caption association for assistive tech (TAB-034 only requires a caption exist and be numbered), header/row repetition exposed to AT across page breaks (not just visual repeat), and table semantic roles / reading order. If these live in PUB, say so with IDs the way you do elsewhere; right now "the document's locale" (TAB-018) is another cross-doc term that carries no ID while DAT/STY/PUB all do — a small traceability inconsistency worth closing for consistency.

Grouping and page breaks interact badly and nobody owns it. TAB-008 requires group headings; TAB-032 defers break behaviour to STY-013. Nothing addresses a subtotal row orphaned from its group across a break, or a group heading stranded at the bottom of a page (keep-with-next for group/subtotal rows). For measurement tables this is a realistic bad case and it's uncovered in both docs' territory — worth one requirement here or an explicit deferral with ID. Also: TAB-008 states single-column grouping only; nested/multi-level grouping (by A then B) is unstated, and the interaction between a declared sort (TAB-007) and group order within a group isn't defined.

Closed lists are missing where you've otherwise used them. You correctly make emphasis rules non-authorable per document (TAB-029) and constrain reshaping to a "declared, narrow set" (TAB-021). But the local aggregation set for totals/subtotals is never enumerated — "with the aggregation named" leaves it open. Given TAB-N02 forbids cell formulas and Q04 openly doubts whether local totals should exist at all, this should be a closed enumeration (sum / avg / min-max / count?), so the boundary is as tight on aggregations as you've made it on emphasis.

Ownership of "declared X" artifacts. Several requirements point at a declaration without naming its home: TAB-011's declared empty-state text, TAB-033's declared wide-table strategy, TAB-022's reshaping statement. Each says that something is declared, not where. If it's the table definition, say so; if some are in styles (TAB-012's override clearly is), make that explicit per row.

## Likely missing / verify against sibling docs

These may be covered by another of the 21 — flagging as "confirm assigned" rather than asserting gaps:

Locale definition ("the document's locale", TAB-018) — no ID, unlike every other cross-reference in §2.
Number/decimal alignment (right-alignment of numerics, decimal-point alignment). Your own TAB-003 rationale is about numbers being "comparable at a glance" — horizontal alignment serves that and sits squarely in this layer's scope; it's neither stated nor deferred to STY explicitly.
Provenance for locally-computed totals. TAB-019 covers source values only. If Q04 resolves toward allowing local totals, TAB-019 needs an amendment stating how a computed total records its inputs and rule.

## Two smaller notes:

no requirement closes the edge of redundant column selection (same result column twice) — fine to omit deliberately, but it's unaddressed either way; and note that the T1 tranche contains no column or row requirement at all, so tranche 1 produces only table frame (accessibility hooks, caption, page-break), never an actual data-bearing table. If that's intentional sequencing, fine — just confirm it is.
