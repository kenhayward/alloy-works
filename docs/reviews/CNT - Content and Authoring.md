Quality issues with the requirements as written

## Some IDs bundle several independent facets.

CNT-088 carries roughly five testable claims (named style, catalogue selection, publisher resolution, no pixel sizes in model); CNT-015 bundles nesting depth, start number and numbering format. When one facet fails verification you cannot mark the requirement partially met. Consider splitting at least the image-style cluster.

## Normative prose without IDs.

"The model here must accommodate what those areas need from day one" is a binding statement living in a paragraph. Either give it an ID or demote it explicitly to rationale. A couple of bolded sentences (e.g., "Strong renders bold in most themes") read as requirements but carry none.

## Accessibility is thin relative to the document's own standard elsewhere.

Section 13 has four requirements for an entire editor, while footnotes and language tagging each got several. Missing at minimum: assistive-technology announcement of suggestion/comment insert and resolve (these are central review actions), redlines distinguishable without colour alone, and what "verified rather than asserted" means as a testable acceptance path.

## ID allocation follows review rounds, not topics.

Section 12 interleaves view requirements with spelling (CNT-098–101), version-reference management and comparison UI;
section 4 contains image-style semantics that now arguably belong to STY once CNT-Q09 lands. Nothing is wrong, but navigability suffers and the STY boundary isn't yet reflected in requirement text — CNT-020 still says admonition vocabulary is "declared by the presentation theme".

## Small ambiguity pockets, each fixable in a sentence:

CNT-040's footnote content list omits variables (CNT-029) and data bindings (CNT-030). they should be included the list reads as closed but isn't marked.

Can a cross-reference target a plain paragraph? CNT-081's phrasing ties xref targeting to caption-bearing blocks, while CNT-002 gives every block an id. State the addressable set once.

CNT-096 defers to "a budget stated in the requirements"; only CNT-114 has a number (≤ 2 s for 300 pages, provisional) and it names no hardware baseline against which anyone can confirm it.

## Missing areas

Hyperlinks. The inline vocabulary has text, equations, footnotes, cross-references, citations, variables, bindings, character marks, images — but no URL/external link node type, and no non-requirement saying they are out. Nothing in the boundary table assigns them either. Decide: if links exist you also need a sanitisation requirement for pasted HTML (CNT-065 strips only appearance); if not, add CNT-Nxx so paste reports can name dropped hyperlinks explicitly. Hyperlinks should be included.

Internal copy/paste. Section 10 covers foreign-format import only. Cut-and-paste within the product is unowned: a copied block must be re-identified (CNT-002 forbids reuse and requires uniqueness), cross-component pasting needs stated semantics, and what happens when content from an older schema version enters a component should be one sentence. This interacts directly with CNT-002 and deserves IDs.

Headings' absence is by design but unstated. The block vocabulary has no heading because STR owns the outline — fine — but anyone reading this document alone cannot tell whether that's a decision or an oversight. One line in section 14 ("no headings in component content; structure belongs to STR") closes it.

Minimum component shape. What does an empty/new component contain? The spike reportedly settled "the settled position on empty paragraphs" but this document carries no requirement stating that a component always holds at least one block (every editor needs an empty paragraph as cursor target, and CNT-023 forbids spacing empties). One line makes section 4 self-contained.

Unowned neighbours. Managed assets referenced by figures have no stated owner (asset upload/storage isn't in the depends-on table); translation is named in section 4's rationale ("must survive … translation") but no area owns it and it isn't a non-requirement; component-level metadata (title, tags) has no boundary row.
