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
};

/**
 * What an inline item an author can place is called, when it cannot be published yet. A footnote is
 * published under a layout since footnotes 2, so this sentence is left for a request made before
 * layouts, which could never publish one. A cross-reference is resolved and printed under a layout
 * since cross-references 2 (`cross_reference_unresolved` and `cross_reference_form_unavailable` say
 * why one there fails); this sentence is what is left for a request made before layouts, which has no
 * layout to resolve one under at all. So it names no layout - the request has none - and says what
 * mends it: every publish asked for now is made under the document's layout (the final review of
 * cross-references 2). An equation is published under a layout too, since equations 2
 * (`equation_unrenderable`, `equation_unnumbered`, `alternative_missing` and `math_glyph_missing` say
 * why one there fails); this sentence is worded the same way, for the same reason, in place of the
 * words equations 1 left it with.
 */
const INLINES: Readonly<Record<string, string>> = {
  image: 'An image in a line of text cannot be published yet.',
  footnote: 'A footnote cannot be published yet.',
  crossReference: 'A cross-reference cannot be published from this request. Publish again.',
  equation: 'An equation cannot be published from this request. Publish again.',
};

/**
 * What `word_not_yet` names (Word 1, ruling R3): a block or an inline the Word writer does not write
 * yet, by its stored type - an equation is one word whether it stands alone or in a line - and a list
 * after the contents by its sequence. Each later slice of Word output takes its own off this list.
 */
const NOT_YET_IN_WORD: Readonly<Record<string, string>> = {
  list: 'A list',
  blockquote: 'A quotation',
  preformatted: 'Preformatted text',
  table: 'A table',
  figure: 'A figure',
  equation: 'An equation',
  image: 'An image in a line of text',
  footnote: 'A footnote',
  crossReference: 'A cross-reference',
  'listOf:figure': 'The list of figures after the contents',
  'listOf:table': 'The list of tables after the contents',
  'listOf:equation': 'The list of equations after the contents',
};

/**
 * What `numbering_not_in_word` names (Word 1, ruling R7): `detail` is `section:<matter>:<why>`, the
 * matter whose headings the layout numbers and what in its rule Word would number otherwise.
 */
const NUMBERED_IN: Readonly<Record<string, string>> = {
  front: 'the headings in front matter',
  body: 'the headings in the body',
  appendix: 'the headings in the appendices',
};
const NOT_IN_WORD_BECAUSE: Readonly<Record<string, string>> = {
  separator: 'its separator holds a % sign, which Word reads as a number',
  letters: 'a number in letters goes past z, which Word writes differently',
  roman: 'a number in roman numerals goes past 3999',
  depth: 'a heading is numbered more than nine levels deep, and Word numbers nine',
};

/** The sentence for `numbering_not_in_word`: the layout's to change, and the PDF can be made. */
function notInWord(detail: string | null): string {
  const [, matter = '', why = ''] = (detail ?? '').split(':');
  const where = NUMBERED_IN[matter] ?? 'the headings';
  const because = NOT_IN_WORD_BECAUSE[why];
  return (
    `The layout numbers ${where} in a way Word cannot${because === undefined ? '' : `: ${because}`}. ` +
    'Publish this document as a PDF only, or under a layout Word can number.'
  );
}

/**
 * What `equation_unrenderable` names of the construct an equation held that the converter refused
 * (`REFUSAL_NAMES`, `assemble.ts`), in words - never the equation's text, its values or its elements,
 * which `detail` never carries either (R5). `mathvariant`, `element` and `attribute` each name part of
 * the equation's own markup that an author cannot act on by name, so all three read the same way.
 * `space`, `accent` and `empty` are the final review of equations 2's: a space wider than the converter
 * sets, an accent of more than one character, and an equation that draws nothing at all.
 */
const EQUATION_PROBLEMS: Readonly<Record<string, string>> = {
  unreadable: 'is MathML that cannot be read at all',
  merror: 'holds an error mark',
  rtl: 'is written with maths right to left',
  multiscripts: 'holds more than one prescript or postscript on one side',
  voffset: 'holds a raised or lowered box',
  spanningCell: 'holds a cell spanning others',
  mathvariant: 'holds something the typesetter cannot set',
  element: 'holds something the typesetter cannot set',
  attribute: 'holds something the typesetter cannot set',
  text: 'holds something the typesetter cannot set',
  space: 'holds a space too wide to be set',
  accent: 'holds an accent made of more than one character',
  empty: 'draws nothing',
};

/**
 * The form a cross-reference asked for, in the words the dialog offers it in (`FORM_WORDS`,
 * `referenceChoices.ts`), for `cross_reference_form_unavailable`'s detail: never the author's text,
 * only which of the five forms could not be shown, and why - a paragraph or a list has no number or
 * title (R3); a section's title cannot hold a page, since the running heads and the contents set the
 * title again in a different place (R6); above and below need words the layout may not give (R2); and
 * a target standing in a table's header row cannot be pointed at for its page or as above or below,
 * since the header repeats it and a repeated label refuses the compile (cross-references 2, task 4).
 * An equation has no title of its own (equations 2, ruling R7 - its number is its label, and what it
 * says is maths, which a reference cannot print as words), and neither does a section or a caption
 * whose title holds one, which `title` and `numberAndTitle` now cover as well.
 */
const FORMS: Readonly<Record<string, string>> = {
  number:
    'A cross-reference asks for a number, and what it points at has none: a paragraph, a list, or a section with no number of its own.',
  title:
    'A cross-reference asks for a title, and what it points at has none: a paragraph, a list, a footnote, or an equation. A section or a caption holding an equation has none either, since the equation cannot be printed as a title.',
  numberAndTitle:
    'A cross-reference asks for a number and a title, and what it points at is missing one: a paragraph, a list, a footnote, an equation, or a section with no number of its own. A section or a caption holding an equation is missing one too, since the equation cannot be printed as a title.',
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
      // A block equation reaches this code only from a request made before layouts (equations 2): it
      // publishes under one now, so its sentence says what mends it, worded as the inline equation's
      // and the cross-reference's are, rather than naming a feature that is not built.
      return failure.detail === 'equation'
        ? 'An equation cannot be published from this request. Publish again.'
        : `${BLOCKS[failure.detail ?? ''] ?? 'This block'} cannot be published yet.`;
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
    // Since themes 1 the styles are the theme's catalogues', so it is the theme that lacks one, and
    // `detail` is the style's identifier as stored, never the author's text.
    case 'style_missing':
      return `This paragraph, table or figure uses the style ${failure.detail ?? ''}, which the publication's theme does not have.`;
    // Themes 1: the style is the theme's, and declares where it applies (STY-006) - a heading's style
    // on running text, a footnote's in a list. `detail` is the style's identifier, which the theme
    // wrote, never the author's text; the block is named by where it is, as for `style_missing`.
    case 'style_not_applicable':
      return `This paragraph, table or figure uses the style ${failure.detail ?? ''}, which cannot be used where it stands.`;
    // Themes 1 (STY-042): the theme records each typeface's licence, and this one's forbids embedding
    // it in a PDF, or since Word 1 in a Word document. Nothing in the document caused it and another
    // attempt fails the same way, so it blames the theme, as `layout_glyph_missing` blames the layout,
    // and never says to publish again. `detail` is the family, and where Word refused it the family
    // and the format, `<family>: docx` (the final review of Word 1, M6).
    case 'typeface_not_embeddable': {
      const detail = failure.detail ?? '';
      const word = detail.endsWith(': docx');
      const family = word ? detail.slice(0, -': docx'.length) : detail;
      return `The typeface ${family} cannot be embedded in ${word ? 'a Word document' : 'a PDF'}: its licence does not permit it. The publication's theme has to change before this document can be published.`;
    }
    // Themes 1 (ruling R5): the theme names a typeface by its files' hashes, and the worker holds only
    // the faces pinned in its image, so a face it does not hold cannot set a word. As the licence's
    // refusal, it is the theme's to change, and another attempt finds the same faces. `detail` is the
    // family and why, `<family>: <files | metrics | maths>` (the final review of themes 1, M1): a family
    // the theme wrote, which cannot hold a colon, and a word from a fixed list, never a hash or a
    // number. A reason this page does not know is said as the service not holding the face.
    case 'typeface_unavailable': {
      const theme = "The publication's theme has to change before this document can be published.";
      const detail = failure.detail ?? '';
      const at = detail.lastIndexOf(': ');
      const family = at < 0 ? detail : detail.slice(0, at);
      const reason = at < 0 ? '' : detail.slice(at + 2);
      if (reason === 'maths') {
        return `The typeface ${family} cannot set this publication's equations: it is not a typeface made for mathematics. ${theme}`;
      }
      const because =
        reason === 'metrics'
          ? "the measurements the theme records for it are not its files' own"
          : reason === 'files'
            ? 'the publishing service does not hold the files the theme names for it'
            : 'the publishing service does not hold it';
      return `The typeface ${family} is not one this publication can be set in: ${because}. ${theme}`;
    }
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
    // CNT-049, ruling R5: what the equation held is never quoted, only the fixed construct
    // `EQUATION_PROBLEMS` names; opening the equation is the one way to change what it holds.
    case 'equation_unrenderable':
      return `An equation ${EQUATION_PROBLEMS[failure.detail ?? ''] ?? 'holds something the typesetter cannot set'}, so it cannot be published. Open it and rewrite it, or delete it.`;
    // As `footnote_unnumbered`: a layout whose scheme prefixes equations with their chapter gives none
    // in a part with no numbered section before it, and an equation the author numbered is refused
    // rather than published with the number it asked for missing (R5).
    case 'equation_unnumbered':
      return 'An equation here would print with no number: the layout numbers equations within sections, and no numbered section comes before it.';
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
    // Figures 3's ruling R10 (the comment above `figure_without_caption` covers this code too), and
    // equations 2's R5 beside it: a figure's image with no description of its own and none on the
    // figure either, or an equation with no alternative text, fail alike - never which, since the
    // code is one whichever it is.
    case 'alternative_missing':
      return "This has no way to be read aloud: an image with no description, and its figure not given one either, or an equation with no alternative text. Describe an image in its figure's panel, or mark it decorative; write an equation's alternative by opening it again.";
    // Named by where the figure is, never by the image, which the author may not read.
    case 'asset_unreadable':
      return 'A figure shows an image you may not see, so you cannot publish it.';
    // A figure does not break across pages, so its image and caption must stand on one together.
    case 'caption_too_long':
      return "A figure's caption is too long to stand on a page with its image. Shorten the caption.";
    // Themes 2's ruling R2: the label is the table style's and its words the layout's, and nothing in
    // the document mends either, so it is theirs to change and another attempt fails the same way.
    // `detail` is the style's identifier, as `style_missing` names one.
    case 'continuation_words_missing':
      return `This table's style, ${failure.detail ?? ''}, labels each page the table continues onto, but the publication's layout has no words for the label. The layout or the theme has to change before this document can be published.`;
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
    // Word 1's ruling R3: nothing in the document is wrong, and the PDF can be made of it, so the
    // sentence says so rather than asking for a change or another attempt.
    case 'word_not_yet':
      return `${NOT_YET_IN_WORD[failure.detail ?? ''] ?? 'Something here'} cannot be published in Word yet. Publish this document as a PDF only.`;
    // Refused when the request is made (PUB-014), so met only by a request built past that check: the
    // layout's to change, as its words are.
    case 'format_unsupported':
      return "This publication's layout has no page for Word, so it cannot be published in Word. Publish it as a PDF, or under a layout with a Word page.";
    // Word 1's ruling R7: nothing in the document is wrong; the layout's scheme asks Word for a number
    // it would print differently from the PDF's.
    case 'numbering_not_in_word':
      return notInWord(failure.detail);
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
