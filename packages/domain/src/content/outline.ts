/**
 * The outline: the ordered structure that gives a document its shape.
 *
 * Sections live here rather than inside content, and that separation is load-bearing. A component
 * reused at depth 2 in one report and depth 4 in another cannot carry its own heading level, so
 * numbering, cross-reference targets and captions are properties of the outline, resolved at
 * publish time in the context of the document doing the resolving.
 *
 * The practical consequence shows up the moment anything is imported: Word puts headings inline in
 * the body, so an importer has to SPLIT a document into an outline plus components rather than
 * loading it as one blob. See case 8.
 */
export interface OutlineSection {
  readonly id: string;
  readonly title: string;
  /** 1 for a top-level section. Depth in this document, never a property of the content. */
  readonly level: number;
  /** The name a foreign format used to reference this section, when it came from one. */
  readonly bookmark?: string;
  readonly componentIds: string[];
}
