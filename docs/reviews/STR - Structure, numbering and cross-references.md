# Missing areas and weak points, ranked by risk

The resolution order exists only in prose. "Conditions first, numbering second" appears twice as commentary; normatively it is enforced piecemeal (STR-020, STR-030, STR-042). One normative constraint — numbering must be computed only over content that survives condition evaluation, and cross-reference resolution only over numbered content — would anchor the spine of the document and prevent a future requirement from silently assuming an earlier stage's output.

Renumbering drift across baselines. Numbering is recomputed, so editing between baseline 3 and baseline 4 can shift "section 4.2" that external parties have already cited in paper or companion filings — the exact audience this document cares about (see Q01). The outline is pinned by a baseline (STR-012), but nothing pins layout and profile into that baseline, nor anything records which numbers a published artifact used. Either add one constraint ("the numbering of any baseline must be reproducible from that baseline's pinned inputs") or confirm with VER that baselines pin the full input set — outline plus layout version plus profile.

Identifier scope is unstated. STR-003 says "stable identifier… never reused" but not whether IDs are unique per document or platform-wide. Fine while Q02 stays open, but a cross-document reference makes collisions live, and the spec should state today what identity is scoped to.

"Ordered tree" has no stated root or minimum. Is an outline allowed to be empty? Is there an implicit root node (the document itself)? This matters for deep links (STR-044 — link to what, at top level?) and TOC rendering. Two sentences would close it.

Asymmetry between page breaks and page-form references. STR-050 says break declarations are ignored without error in formats with no pages; the "page" display form in STR-027 has no analogue. A page-number reference rendered into a non-paged format currently falls through the gap between this document's rules — either it should fail like STR-030 or be omitted cleanly, and that needs stating (probably alongside the Q04 publishing-engine decision).

Local references rebasing per occurrence is implied but not said. A component containing "see Figure 2" resolves differently when embedded as first vs second occurrence — STR-021 + STR-028 imply it, but this is subtle enough to generate implementation disagreement. One sentence: an intra-component reference targets its own occurrence's nodes.

Referenceable target set. STR-026 limits cross-reference targets to outline nodes, caption-bearing blocks, footnotes and bibliography entries — i.e., identity-carrying things per CNT-081. If that deliberately excludes bookmarks on arbitrary paragraphs, it is worth a non-requirement row so nobody later "fixes" it by accident; if accidental, it's the one functional gap in §6.

Concurrency on outline edits. STR-006 requires editing via pointer/keyboard/API and STR-008 makes moves undoable, but nothing addresses two editors moving the same node — presumably owned by VER or IAM; if so, add a row to "Not here" so it's visibly delegated rather than absent.

Minor: STR-038 uses "bindings" in normative text without defining it or pointing at the document that does; and STR-011's phrasing ("the outline must not contain itself") is loose for what is actually a cycle check across chains of component references — say which graph you're walking.
