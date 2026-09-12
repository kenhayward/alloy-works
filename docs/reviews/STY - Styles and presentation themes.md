## Issues in the requirements themselves

STY-007 mixes modalities. "A style should be able to derive… the chain must be finite." Either inheritance is a T2 capability you're committing to (make it must) or derivation's absence needs defined resolution behaviour for STY-035. As written, an implementer can drop inheritance and nothing fails.

STY-036 enumerates illustratively ("typefaces, sizes, colours and spacing") while the rest of the document speaks in "every style property." Make it exhaustive: all declared paragraph/character properties, or STY-053 will test more than STY-036 obliges.

STY-018 vs STY-011/CNT-094. Image styles declare block placement with alignment, while alignment "must not be offerable as a free per-block control." If authors choose among image styles differing only in placement/alignment, that is de facto per-block control by style choice. One sentence of interpretation — style selection is theme-vocabulary, not free control — would stop implementers reading the two together from picking different models.

STY-052 and STY-038/053 are in surface tension. Determinism says same inputs always produce the same appearance; STY-052 mandates a reported Word substitution, i.e., a sanctioned cross-format deviation. The STY-053 suite needs an explicit whitelist of these approved exceptions or "must render the same measured value" is unimplementable for exactly the faces STY-052 exists to cover.

"Named error" is used five times but never defined as machine-stable. Given how central errors are to this spec's philosophy, add one requirement that named errors carry stable identifiers (so they're referenceable in docs and automation), not just human strings.

STY-054 depends on typefaces carrying vertical metrics, but no requirement mandates them. STY-045 admits open-licence faces, and a meaningful share of those have poor or missing metrics. Mirror the AST pattern: validate complete vertical metrics on ingest (product faces at build time, tenant uploads per STY-046), failing rather than tolerating.

## Missing areas, ranked

Admonition styles have no substance. STY-003 requires a catalogue of admonition styles, and nothing else in the document says what an admonition style declares (treatment by severity/type — icon, border, background) or how the mapping from admonition type to appearance is theme-bound the way STY-010 binds marks. The "Not here" table doesn't delegate it either. This looks like a dropped section rather than a deliberate delegation; either add a short subsection (three requirements would do it) or record where it lives in one of the other 20.

Live drafts versus theme version updates. Pinning covers baselines (STY-028), but an unpublished draft sitting under theme v3 when the tenant publishes v4 is unaddressed: does it float and change appearance mid-draft, or pin per draft?

STY-034 previews impact of editing a style; there's no analogue for "theme version bumped, here's which drafts are affected." This is the governance seam most likely to bite in practice.

Composition of conflicting styles across formats. STY-055 shows awareness that Word computes run formatting by combining styles — and overrides it. But no requirement states the canonical rule (e.g., innermost mark wins, or style hierarchy order) for a character mark nested inside already-styled content, in any format. Given this spec's core concern is cross-format identity, that feels conspicuous; if it lives in CNT, add the cross-reference so implementers of both don't invent divergent rules.

Accessibility of themes. Nothing here — or in any visible seam — requires contrast minimums between ink and paper, or print-legibility constraints on a theme's palette. If another document of the 21 owns accessibility, reference it; if not, one constraint ("a theme's body-text colours must maintain [X] contrast ratio in every output format") is cheap insurance for a product whose whole point is legible published documents.

Authoring-time presentation of unresolvable references. The fail-loud rule is stated for publishing (STY-027, -019, -049). What does the editor show when a referenced style or glyph won't resolve? STY-037 covers pagination effects only. One requirement — editor renders an explicit unresolvable marker, never a silent default — completes the philosophy at both ends of the system (your own Purpose section says editor and publisher resolve from the same place).

Import referential integrity. STY-044 covers representability; it doesn't cover an imported catalogue referencing typefaces or catalogues that don't exist in the destination tenant — which would surface later as exactly the STY-027 failure you've worked hard to make early and loud. Extend import validation: report unresolvable references at import time.

## Smaller items

retention of pinned typeface files so a years-old baseline can actually re-publish (seam to the AST/baseline document — confirm it says immutably retained); "add a theme without code change" is implied by themes being data but stated for styles (STY-029) and citation styles (STY-023) only; round-trip fidelity of STY-043 export ("importable" + import reporting implies it, state it).

## Cross-document seams to verify

confirm rather than assume: (a) where admonition treatment actually lives if not here; (b) whether CNT owns conflict-composition semantics or STY does; (c) whether any of the 21 covers accessibility at all; (d) that the baseline spec requires immutable retention of pinned artifacts.

The traceability table could also absorb a provenance row for STY-050–055 — they read as findings from the rendering spike, and linking them to ADR-0013/the Word findings would make the numbering's oddness (topical placement, chronological IDs) self-explanatory.
