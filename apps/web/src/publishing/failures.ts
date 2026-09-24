/** One failure as the service answers it (`PublishFailureView`). */
export interface Failure {
  readonly stage: string;
  readonly code: string;
  readonly node: string | null;
  readonly block: string | null;
  readonly detail: string | null;
}

const BLOCKS: Readonly<Record<string, string>> = {
  list: 'A list',
  table: 'A table',
  figure: 'A figure',
  preformatted: 'Preformatted text',
  blockquote: 'A quotation',
  equation: 'An equation',
};

/**
 * What an inline item an author can place is called, when it cannot be published yet. A footnote is
 * published under a layout since footnotes 2, so this sentence is left for a request made before
 * layouts, which could never publish one. A cross-reference is resolved and printed under a layout
 * since cross-references 2 (`cross_reference_unresolved` and `cross_reference_form_unavailable` say
 * why one there fails); this sentence is what is left for a request made before layouts, which has no
 * layout to resolve one under at all. So it names no layout - the request has none - and says what
 * mends it: every publish asked for now is made under the document's layout (the final review of
 * cross-references 2).
 */
const INLINES: Readonly<Record<string, string>> = {
  image: 'An image in a line of text cannot be published yet.',
  footnote: 'A footnote cannot be published yet.',
  crossReference: 'A cross-reference cannot be published from this request. Publish again.',
  // An equation in a line of text, named as one now an author can place it (equations 1, ruling R9),
  // in the words a block equation's `block_not_publishable` says, until equations 2 publishes both.
  equation: 'An equation cannot be published yet.',
};

/**
 * The form a cross-reference asked for, in the words the dialog offers it in (`FORM_WORDS`,
 * `referenceChoices.ts`), for `cross_reference_form_unavailable`'s detail: never the author's text,
 * only which of the five forms could not be shown, and why - a paragraph or a list has no number or
 * title (R3); a section's title cannot hold a page, since the running heads and the contents set the
 * title again in a different place (R6); above and below need words the layout may not give (R2); and
 * a target standing in a table's header row cannot be pointed at for its page or as above or below,
 * since the header repeats it and a repeated label refuses the compile (cross-references 2, task 4).
 */
const FORMS: Readonly<Record<string, string>> = {
  number:
    'A cross-reference asks for a number, and what it points at has none: a paragraph, a list, or a section with no number of its own.',
  title:
    'A cross-reference asks for a title, and what it points at has none: a paragraph, a list, or a footnote.',
  numberAndTitle:
    'A cross-reference asks for a number and a title, and what it points at is missing one: a paragraph, a list, a footnote, or a section with no number of its own.',
  page: "A cross-reference asks for a page. A section's title cannot hold one, since the running heads and the contents set the title again in a different place; nor can something standing in a table's header row, which the page repeats.",
  relative:
    "A cross-reference asks for above or below. Either this publication's layout has no words for them, or what it points at stands in a table's header row, which repeats.",
};

/**
 * What a failure says to the author, in words: never a code, never an engine's diagnostic, and never
 * anything of a component they may not read - an unreadable place is named by where it is, which the
 * caller supplies, and this says only that a component is there.
 */
export function failureWords(failure: Failure): string {
  switch (failure.code) {
    case 'occurrence_unreadable':
      return 'A component you may not read is placed here. Only someone who may read every component can publish this document.';
    case 'occurrence_unresolved':
      return 'This reference waits on an approved version, and nothing can approve one yet.';
    case 'title_not_publishable':
      return 'This title holds something that cannot be published yet.';
    case 'block_not_publishable':
      return `${BLOCKS[failure.detail ?? ''] ?? 'This block'} cannot be published yet.`;
    // "This text", not "this paragraph": `assemble` raises this code for a definition list's **term**
    // as well as for a paragraph, and names the LIST in that case, because a term carries no
    // identifier of its own. A sentence that said paragraph while pointing at a list would send an
    // author looking for something that is not there.
    // An image in a line of text is named as one, now an author can place it (figures 4), and so is a
    // footnote (footnotes 1).
    case 'inline_not_publishable':
      return (
        INLINES[failure.detail ?? ''] ??
        'This text holds formatting or an inline item that cannot be published yet.'
      );
    // A table has a style of its own as a paragraph does (tables 2), and a figure an image style
    // (figures 3); the failure names the block but not its kind, so the sentence names all three.
    case 'style_missing':
      return 'This paragraph, table or figure uses a style the publication template does not set.';
    // Decision K, as Ken reversed it: a tag the engine cannot carry is refused, never shortened, and
    // the author is told what a publication takes (pre-flight finding 9).
    case 'language_not_publishable':
      return `The language ${failure.detail ?? ''} cannot be published: a publication takes a language of two or three letters and, if any, a region of two, such as en-GB.`;
    case 'glyph_missing':
      return `The character ${failure.detail ?? ''} is in no typeface this publication can use.`;
    case 'character_disallowed':
      return `An invisible character, ${failure.detail ?? ''}, cannot be published. Delete it and publish again.`;
    // Another attempt would make the same nothing, so this never says to publish again (PUB-079).
    case 'nothing_to_publish':
      return 'There is nothing to publish: no part of the outline is left, and the layout sets no cover.';
    // The layout's own words and language: nothing in the document caused these, and another attempt
    // would fail the same way, so they blame the layout and never say to publish again.
    case 'layout_glyph_missing':
      return `This publication's layout uses a character, ${failure.detail ?? ''}, that no typeface it can use has. The layout has to change before this document can be published.`;
    case 'layout_language_not_publishable':
      return `This publication's layout is in the language ${failure.detail ?? ''}, which cannot be published. The layout has to change before this document can be published.`;
    // Named apart from `glyph_missing`: the body face has this character, so "in no typeface" would
    // be untrue, and the author needs to know it is the code that cannot carry it.
    case 'code_glyph_missing':
      return `The character ${failure.detail ?? ''} is not in the monospace typeface that preformatted text and inline code are set in.`;
    // Equations 2, as `code_glyph_missing`: the body face may have this character, so "in no
    // typeface" would be untrue; it is the equation's maths typeface that cannot set it.
    case 'math_glyph_missing':
      return `The maths typeface that equations are set in cannot set the character ${failure.detail ?? ''} in this equation.`;
    case 'line_too_wide':
      return `A line of this preformatted text is too wide for the page, so it would be cut off: ${failure.detail ?? ''}. Shorten the line or break it.`;
    // Tables 2's ruling R8: what a caption is for, so the author knows why it is asked for.
    case 'table_without_caption':
      return 'A table has no caption. Give it one: the caption names the table in the PDF and to a screen reader.';
    case 'table_header_spans_body':
      return 'A header cell of this table spans down into rows that are not header rows, so the PDF would present them as headers too. Shorten its span, or make those rows header rows.';
    // Figures 3's ruling R10: what a caption and a description are for, and where each is given.
    case 'figure_without_caption':
      return 'A figure has no caption. Give it one: the caption names the figure in the PDF and to a screen reader.';
    case 'alternative_missing':
      return "A figure's image has no description, and the figure is not given one. Describe it in the figure's panel, or mark it decorative.";
    // Named by where the figure is, never by the image, which the author may not read.
    case 'asset_unreadable':
      return 'A figure shows an image you may not see, so you cannot publish it.';
    // A figure does not break across pages, so its image and caption must stand on one together.
    case 'caption_too_long':
      return "A figure's caption is too long to stand on a page with its image. Shorten the caption.";
    // Figures 5's ruling R7: an image set in a line has only the line's room, or its cell's.
    case 'image_too_wide':
      return 'An image in a line of text is wider than the room it stands in. Use a narrower image, or make it a figure.';
    // The final review of figures 5: a caption is estimated from its words and set again in the lists.
    case 'image_in_caption':
      return 'A caption holds an image, which a caption cannot publish. Take the image out of the caption.';
    // Footnotes 2's ruling R9: where a footnote may stand, and what a note on a whole table is.
    case 'footnote_not_publishable_here':
      return "A footnote stands where it cannot be published. A footnote can stand only in a paragraph's text; a note on a whole table is the table's note.";
    case 'footnote_anchor_unresolved':
      return 'A footnote is anchored to a cell its table does not have.';
    case 'footnote_empty':
      return 'A footnote has no text. Write it, or delete its mark.';
    // The layout's rule, not the document's: its scheme prefixes footnotes with their section's
    // number, and this part of the document has no numbered section before it (final review).
    case 'footnote_unnumbered':
      return 'A footnote here would print with no number: the layout numbers footnotes within sections, and no numbered section comes before it.';
    // Cross-references 2's ruling R7: the target is missing from this document, a component target's
    // document holds it more than once, or not at all - never which, since neither is the author's to
    // read from another component (STR-062).
    case 'cross_reference_unresolved':
      return 'A cross-reference points at something this document does not hold, or at a component it holds more than once.';
    // Ruling R7 again: `detail` is the form asked, never the author's text.
    case 'cross_reference_form_unavailable':
      return (
        FORMS[failure.detail ?? ''] ??
        'A cross-reference asks for a form of its target that cannot be shown.'
      );
    case 'store_failed':
      return 'The publication could not be stored. Publish again.';
    default:
      return 'The publication could not be made. Publish again.';
  }
}

/**
 * Whether every failure is the product's own - the engine's or the store's, a face changed under the
 * worker included - so that nothing in the document caused it and nothing in it should be put right.
 */
export function isProductsOwn(failures: readonly Failure[]): boolean {
  return (
    failures.length > 0 &&
    failures.every((each) => each.stage === 'engine' || each.stage === 'store')
  );
}
