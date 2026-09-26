/**
 * Where a failure arose (PUB-086): resolving the document at the request, composing it in `assemble`,
 * the engine, or storing what it made.
 */
export type PublishStage = 'resolve' | 'compose' | 'engine' | 'store';

/**
 * Every failure a publish can end in, closed, and only ever added to: a request's stored failures are
 * read back through the contract's enum, so a code once written is never renamed or removed.
 */
export const publishFailureCodes = [
  // resolve: at the request, as the publisher.
  'occurrence_unreadable',
  'occurrence_unresolved',
  // resolve, from figures 3: a figure whose image the publisher may not read, or that names no image
  // at all - the two told apart no more than an occurrence's are, and naming the figure, never the
  // image (issue #143).
  'asset_unreadable',
  // compose: in `assemble`, before Typst is started.
  'title_not_publishable',
  'block_not_publishable',
  'inline_not_publishable',
  'style_missing',
  'language_not_publishable',
  'glyph_missing',
  'character_disallowed',
  // No outline node survives conditions, and the layout declares nothing with something to show: no
  // cover, and a contents would hold no entry (PUB-079, decision K). Never an empty artifact.
  'nothing_to_publish',
  // The layout's, not the document's: a character in the layout's own words that the engine cannot
  // set, and a layout language it cannot carry. Named apart so that neither reads as the document's.
  'layout_glyph_missing',
  'layout_language_not_publishable',
  // compose, from editor 5: a character the monospace face cannot set, in preformatted text or an
  // inline code run - named apart from `glyph_missing` because the body face could set it, so the
  // author is not told the character is in no typeface at all - and a preformatted line wider than
  // the page, which would otherwise be wrapped or cut off.
  'code_glyph_missing',
  'line_too_wide',
  // compose, from tables 2: a table whose caption says nothing, refused at publish rather than at save
  // because an author types the caption after inserting the table (decision T-F). A caption is what
  // names a table in the PDF and to a screen reader (TAB-034, TAB-039).
  'table_without_caption',
  // compose, from tables 2: a cell that starts in the header rows and spans below them. The pinned
  // engine grows the header to take in every row such a cell reaches, so a data cell beside it would
  // be read out as a column header; refused, naming the table, rather than published saying that.
  'table_header_spans_body',
  // compose, from figures 3: a figure whose caption says nothing - CNT-017's caption, refused at
  // publish as a table's is - and one given alternative text by neither itself nor its image, which
  // the engine would refuse the whole document for without saying which (PUB-033, AST-014).
  'figure_without_caption',
  'alternative_missing',
  // compose, from the final review of figures 3: a caption too long to stand on a page beside even a
  // small image. A figure does not break, so it would run off the page; refused, naming the figure.
  'caption_too_long',
  // compose, from figures 5: an image in a run of text wider than the room it stands in - a line, or
  // a table's cell - which the engine would let run past its edge, as a preformatted line would.
  'image_too_wide',
  // compose, from the final review of figures 5: an image in a figure's or a table's caption, which
  // the caption's height is not estimated with and which the list after the contents would set again.
  'image_in_caption',
  // compose, from footnotes 2: a footnote anywhere but a paragraph's text, or anchored to a table as a
  // whole (FN-B, FN-C); one anchored to a cell its table does not have (CNT-042); and one with no text.
  'footnote_not_publishable_here',
  'footnote_anchor_unresolved',
  'footnote_empty',
  // compose, from the final review of footnotes 2: a footnote the layout's scheme gives no number,
  // which would print as a mark with nothing in it.
  'footnote_unnumbered',
  // compose, from cross-references 2 (XR-F): a reference whose target the document publishing it does
  // not hold, or holds more than once where it names another component (STR-029, STR-062); and one
  // asking its target for a form it lacks - a number of a paragraph, a title of a footnote, a page in a
  // section's title, or above and below under a layout with no words for them. Each names the
  // reference, and the target or the form, never the author's text.
  'cross_reference_unresolved',
  'cross_reference_form_unavailable',
  // compose, from equations 2 (EQ-B, CNT-049): an equation holding what the maths tree cannot set -
  // an error its converter reported, maths set right to left, more than one pair of scripts on a side,
  // a box moved up or down, a spanning cell, an unknown variant, or an element, an attribute or text
  // the mapping does not know - named by the block it stands in, and the construct from a fixed list
  // of names, never the equation's text, its values or its elements. A numbered equation the layout's
  // scheme gives no number is named apart from `footnote_unnumbered`, whose words are a footnote's:
  // it would be set with nothing beside it, and a reference to it could print nothing.
  'equation_unrenderable',
  'equation_unnumbered',
  // compose, from equations 2: a character the maths face cannot set, in an equation's tree - named
  // apart from `glyph_missing` as `code_glyph_missing` is, because the body face may well have it, and
  // the author needs to know it is the equation that cannot carry it. The engine's fallback is off
  // for maths, so it would otherwise be set as nothing.
  'math_glyph_missing',
  // compose, from themes 1: a style the theme's catalogue holds used where its `appliesTo` does not
  // reach - a heading's style on a paragraph of running text, an inline image's on a figure (STY-006) -
  // naming the block and the style, as `style_missing` names a style the catalogue does not hold; and
  // a typeface that sets text in the document whose licence, as the theme records it, does not permit
  // embedding it in a PDF (STY-042), naming its family and nothing of the document, since nothing in
  // the document can mend it.
  'style_not_applicable',
  'typeface_not_embeddable',
  // Before `assemble`, from themes 1 (ruling R5): a typeface the theme names whose files - each by its
  // hash - the worker does not hold among its pinned faces, naming its family. The worker sets text in
  // no face it was not given, so every character would otherwise be `glyph_missing` and the face
  // itself never named.
  'typeface_unavailable',
  // compose, from themes 2 (ruling R2): a table whose style asks for a continuation label, set in the
  // layout's words, under a layout that has none - one stored before its schema 4 - naming the table
  // and the style. The label would otherwise be a table's number with nothing after it.
  'continuation_words_missing',
  // compose, from Word 1 (ruling R3): where Word is asked for, a block or an inline the Word writer
  // did not write yet, naming where it stands and, in `detail`, what it is, by its stored type; and a
  // list after the contents, naming no place and its sequence as `listOf:<sequence>`. Words 2 to 4
  // took every construct off it, the last - equations, a reference to one and the list of equations -
  // in Word 4 (ruling R1), so `assemble` no longer says it; it is kept because a request refused for
  // one before then still holds it, and reads it back by name. And a
  // request for a format its layout has no page for, `detail` the format: refused when the request is
  // made (PUB-014), so met here only by a request built past that check, and said rather than thrown.
  'word_not_yet',
  'format_unsupported',
  // compose, from Word 1 (ruling R7): where Word is asked for, a heading number the layout's scheme
  // writes that Word would compute differently - `detail` is `section:<matter>:<why>`: a separator
  // holding `%` (no node), letters past z, a roman numeral past 3999, or a heading numbered past the
  // ninth level (the first heading that meets it). From Word 2 (ruling R1), a figure's or a table's
  // number Word's caption fields would compute differently - `figure:<matter>:<why>` or
  // `table:<matter>:<why>`, naming the first caption that meets it: a separator a run cannot carry, a
  // prefix or a count Word's fields reach otherwise, letters past z, or a roman numeral past 3999. From
  // Word 4, a numbered equation's, `equation:<matter>:<why>`, for the same reasons. The PDF is
  // unaffected.
  'numbering_not_in_word',
  // compose, from Word 2 (ruling R4): where Word is asked for, a list Word would not print as the PDF
  // does, naming it - `detail` `depth` for one nested past Word's ninth level, counted through items
  // and quotations and afresh in a table's cell (WO-I); `letters` for one numbered in letters past
  // the 27th, where Word writes bb and the PDF ab; `roman` for one numbered past 3999. The PDF is
  // unaffected.
  'list_not_in_word',
  // compose, from Word 3 (ruling R5): where Word is asked for, a cross-reference Word's field would
  // not print as the PDF does, naming it as the other reference failures do - `detail`
  // `<form>:<why>`: `relative:footnote` for above or below between a footnote's text and the text
  // outside it, where Word's `REF \p` prints its bookmark's words; `relative:float` for above or
  // below in a floated figure's caption, which Word writes in a text box, where it printed nothing;
  // `title:caption` or `numberAndTitle:caption` for a caption's words named in that caption, which
  // Word's `REF` refuses as a reference to itself; `title:nested` or `numberAndTitle:nested` for a
  // caption's words named where they hold a reference that is not a number (each measured in Word
  // 16). The PDF is unaffected.
  'cross_reference_not_in_word',
  // engine and store: the platform's, recorded after the last attempt.
  'engine_failed',
  'store_failed',
] as const;

export type PublishFailureCode = (typeof publishFailureCodes)[number];

/**
 * One failure, naming its stage, its code and the place it concerns: the outline node, and the block
 * within that node's component where there is one. `detail` is what the author needs to act and the
 * code does not say - the kind of block or mark that cannot be published yet, the style, the language
 * tag exactly as stored, the construct an equation holds that cannot be set, from a fixed list of
 * names, or the character as `U+XXXX`, never the character itself - and is `null`
 * where the failure is about something the publisher may not read: **an unreadable occurrence carries
 * its node and nothing else** (issue #143).
 */
export interface PublishFailure {
  readonly stage: PublishStage;
  readonly code: PublishFailureCode;
  readonly node: string | null;
  readonly block: string | null;
  readonly detail: string | null;
}
