import type { PublishFailureCode } from '@alloy-works/domain';
import { words } from '../words/words.js';

/** One failure as the service answers it (`PublishFailureView`). */
export interface Failure {
  readonly stage: string;
  readonly code: string;
  readonly node: string | null;
  readonly block: string | null;
  readonly detail: string | null;
}

const BLOCKS: Readonly<Record<string, string>> = {
  get list() {
    return words('publishing.a-list');
  },
  get table() {
    return words('publishing.a-table');
  },
  get figure() {
    return words('publishing.a-figure');
  },
  get preformatted() {
    return words('publishing.preformatted-text');
  },
  get blockquote() {
    return words('publishing.a-quotation');
  },
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
  get image() {
    return words('publishing.an-image-in-a-line');
  },
  get footnote() {
    return words('publishing.a-footnote-cannot-be-published');
  },
  get crossReference() {
    return words('publishing.a-cross-reference-cannot-be');
  },
  get equation() {
    return words('publishing.an-equation-cannot-be-published');
  },
};

/**
 * What `word_not_yet` names (Word 1, ruling R3): a block or an inline the Word writer did not write
 * yet, by its stored type - an equation is one word whether it stands alone or in a line - and a list
 * after the contents by its sequence. Words 2 to 4 took each off it, and nothing is refused so now,
 * but a request refused before then still holds its failure, and is read back by these words.
 */
const NOT_YET_IN_WORD: Readonly<Record<string, string>> = {
  get list() {
    return words('publishing.a-list');
  },
  get blockquote() {
    return words('publishing.a-quotation');
  },
  get preformatted() {
    return words('publishing.preformatted-text');
  },
  get table() {
    return words('publishing.a-table');
  },
  get figure() {
    return words('publishing.a-figure');
  },
  get equation() {
    return words('publishing.an-equation');
  },
  get image() {
    return words('publishing.an-image-in-a-line-2');
  },
  get footnote() {
    return words('publishing.a-footnote');
  },
  get crossReference() {
    return words('publishing.a-cross-reference');
  },
  get 'listOf:figure'() {
    return words('publishing.the-list-of-figures-after');
  },
  get 'listOf:table'() {
    return words('publishing.the-list-of-tables-after');
  },
  get 'listOf:equation'() {
    return words('publishing.the-list-of-equations-after');
  },
};

/**
 * What `numbering_not_in_word` names (Word 1, ruling R7; Word 2, ruling R1): `detail` is
 * `<sequence>:<matter>:<why>` - the headings', the figures', the tables', the equations' (Word 4) or
 * the footnotes' numbers, the matter the layout numbers them in, and what in its rule Word would
 * number otherwise. An equation's number is judged as a caption's, and said in a caption's words.
 */
const NUMBERED: Readonly<Record<string, string>> = {
  get section() {
    return words('publishing.the-headings');
  },
  get figure() {
    return words('publishing.the-figures');
  },
  get table() {
    return words('publishing.the-tables');
  },
  get equation() {
    return words('publishing.the-equations');
  },
  get footnote() {
    return words('publishing.the-footnotes');
  },
};
const NUMBERED_IN: Readonly<Record<string, string>> = {
  get front() {
    return words('publishing.in-front-matter');
  },
  get body() {
    return words('publishing.in-the-body');
  },
  get appendix() {
    return words('publishing.in-the-appendices');
  },
};
const NOT_IN_WORD_BECAUSE: Readonly<Record<string, string>> = {
  get separator() {
    return words('publishing.its-separator-holds-a-sign');
  },
  get letters() {
    return words('publishing.a-number-in-letters-goes');
  },
  get roman() {
    return words('publishing.a-number-in-roman-numerals');
  },
  get depth() {
    return words('publishing.a-heading-is-numbered-more');
  },
  get prefix() {
    return words('publishing.a-number-s-prefix-is');
  },
  get restart() {
    return words('publishing.a-number-starts-again-or');
  },
};
/** A caption's separator is words between Word's fields, where only a control character fails. */
const CAPTION_SEPARATOR = (): string => words('publishing.its-separator-holds-a-character');
/**
 * Word 3's ruling R2: Word numbers a footnote itself, with nothing beside the number, and starts the
 * count again only where a matter's section begins.
 */
const FOOTNOTE_NOT_IN_WORD_BECAUSE: Readonly<Record<string, string>> = {
  get label() {
    return words('publishing.a-word-stands-before-the');
  },
  get prefix() {
    return words('publishing.a-chapter-s-number-stands');
  },
  get restart() {
    return words('publishing.they-start-again-or-carry');
  },
};

/** The sentence for `numbering_not_in_word`: the layout's to change, and the PDF can be made. */
function notInWord(detail: string | null): string {
  const [sequence = '', matter = '', why = ''] = (detail ?? '').split(':');
  const numbered = NUMBERED[sequence] ?? words('publishing.the-headings');
  const where = NUMBERED_IN[matter] === undefined ? numbered : `${numbered} ${NUMBERED_IN[matter]}`;
  const because =
    sequence === 'footnote' && FOOTNOTE_NOT_IN_WORD_BECAUSE[why] !== undefined
      ? FOOTNOTE_NOT_IN_WORD_BECAUSE[why]
      : why === 'separator' && sequence !== 'section'
        ? CAPTION_SEPARATOR()
        : NOT_IN_WORD_BECAUSE[why];
  return (
    (because === undefined
      ? words('publishing.the-layout-numbers-in-a', { where })
      : words('publishing.the-layout-numbers-in-a-because', { where, because })) +
    ' ' +
    words('publishing.publish-this-document-as-a')
  );
}

/**
 * What `list_not_in_word` names (Word 2, ruling R4): `detail` is why Word would print the list
 * otherwise than the PDF does. The list is the author's to change, and the PDF can be made.
 */
const LIST_NOT_IN_WORD: Readonly<Record<string, string>> = {
  get depth() {
    return words('publishing.is-nested-more-than-nine');
  },
  get letters() {
    return words('publishing.is-numbered-in-letters-past');
  },
  get roman() {
    return words('publishing.is-numbered-in-roman-numerals');
  },
};

/**
 * What `cross_reference_not_in_word` names (Word 3, ruling R5): `detail` is `<form>:<why>`, and the why
 * alone decides the sentence - above or below between a footnote and the text outside it, or in a
 * floated figure's caption, which Word sets in a text box of its own; a caption's own words named in
 * it; or a caption's words named where they hold a reference Word would print in its own form, all of
 * which Word's fields print otherwise than the PDF. The reference is the author's to change, and the
 * PDF can be made.
 */
const REFERENCE_NOT_IN_WORD: Readonly<Record<string, string>> = {
  get footnote() {
    return words('publishing.a-cross-reference-asks-for');
  },
  get float() {
    return words('publishing.a-cross-reference-in-a');
  },
  get caption() {
    return words('publishing.a-cross-reference-in-a-2');
  },
  get nested() {
    return words('publishing.a-cross-reference-asks-for-2');
  },
};

/**
 * What `equation_unrenderable` names of the construct an equation held that the converter refused
 * (`REFUSAL_NAMES`, `assemble.ts`), in words - never the equation's text, its values or its elements,
 * which `detail` never carries either (R5). `mathvariant`, `element` and `attribute` each name part of
 * the equation's own markup that an author cannot act on by name, so all three read the same way.
 * `space`, `accent` and `empty` are the final review of equations 2's: a space wider than the converter
 * sets, an accent of more than one character, and an equation that draws nothing at all.
 */
const EQUATION_PROBLEMS: Readonly<Record<string, string>> = {
  get unreadable() {
    return words('publishing.is-mathml-that-cannot-be');
  },
  get merror() {
    return words('publishing.holds-an-error-mark');
  },
  get rtl() {
    return words('publishing.is-written-with-maths-right');
  },
  get multiscripts() {
    return words('publishing.holds-more-than-one-prescript');
  },
  get voffset() {
    return words('publishing.holds-a-raised-or-lowered');
  },
  get spanningCell() {
    return words('publishing.holds-a-cell-spanning-others');
  },
  get mathvariant() {
    return words('publishing.holds-something-the-typesetter-cannot');
  },
  get element() {
    return words('publishing.holds-something-the-typesetter-cannot');
  },
  get attribute() {
    return words('publishing.holds-something-the-typesetter-cannot');
  },
  get text() {
    return words('publishing.holds-something-the-typesetter-cannot');
  },
  get space() {
    return words('publishing.holds-a-space-too-wide');
  },
  get accent() {
    return words('publishing.holds-an-accent-made-of');
  },
  get empty() {
    return words('publishing.draws-nothing');
  },
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
 * whose title holds one, which `title` and `numberAndTitle` now cover as well. A figure or a table
 * the author left unnumbered has no number either (STR-071, W14.4), which `number` and
 * `numberAndTitle` name, as `number` names an unnumbered equation.
 */
const FORMS: Readonly<Record<string, string>> = {
  get number() {
    return words('publishing.a-cross-reference-asks-for-3');
  },
  get title() {
    return words('publishing.a-cross-reference-asks-for-4');
  },
  get numberAndTitle() {
    return words('publishing.a-cross-reference-asks-for-5');
  },
  get page() {
    return words('publishing.a-cross-reference-asks-for-6');
  },
  get relative() {
    return words('publishing.a-cross-reference-asks-for-7');
  },
};

/**
 * What a failure says to the author, in words: never a code, never an engine's diagnostic, and never
 * anything of a component they may not read - an unreadable place is named by where it is, which the
 * caller supplies, and this says only that a component is there.
 *
 * `wordOffered` is whether Word could be asked for instead: a publish under a layout with a Word page.
 * A preview is always a PDF, and a layout with no Word page makes none, so neither offers it.
 */
export function failureWords(failure: Failure, wordOffered = false): string {
  switch (failure.code) {
    case 'occurrence_unreadable':
      return words('publishing.a-component-you-may-not');
    // REU-005: told apart from one there the publisher may not read (REU-043).
    // REU-017: never printed as its name, never blank.
    case 'variable_unresolved':
      return words('publishing.the-variable-has-no-value', { value1: failure.detail ?? 'here' });
    // REU-048: never published with excluded text in it, however it got there.
    case 'condition_leaked':
      return words('publishing.text-this-profile-leaves-out', {
        value1: failure.detail === 'docx' ? 'Word document' : 'PDF',
      });
    // GEN-025 (the G3 plan, G3-F): generated content waits to be accepted or rejected.
    case 'generated_unaccepted':
      return words('publishing.this-part-has-waiting-to', {
        count: failure.detail === null ? 'some' : Number(failure.detail),
      });
    // REU-053: an unset axis leaves text out only where the document accepts it.
    case 'axis_unset':
      return words('publishing.content-here-depends-on-which', {
        value1: failure.detail ?? words('publishing.a-condition'),
      });
    // REU-015: never applied over a changed paragraph, and never dropped without saying so.
    case 'override_stale':
      return words('publishing.this-document-overrides-a-paragraph');
    case 'occurrence_gone':
      return words('publishing.the-component-placed-here-is');
    // MET-023: `detail` is the field's name and what is wrong with it, as the definitions word it -
    // never the value, which is the component's.
    case 'component_metadata_invalid':
      return words('publishing.this-component-s-fields-are', {
        value1: failure.detail ?? words('publishing.a-field'),
      });
    case 'occurrence_unresolved':
      return words('publishing.this-reference-waits-on-an');
    case 'title_not_publishable':
      return words('publishing.this-title-holds-something-that');
    case 'block_not_publishable':
      // A block equation reaches this code only from a request made before layouts (equations 2): it
      // publishes under one now, so its sentence says what mends it, worded as the inline equation's
      // and the cross-reference's are, rather than naming a feature that is not built.
      return failure.detail === 'equation'
        ? words('publishing.an-equation-cannot-be-published')
        : words('publishing.cannot-be-published-yet', {
            value1: BLOCKS[failure.detail ?? ''] ?? 'This block',
          });
    // "This text", not "this paragraph": `assemble` raises this code for a definition list's **term**
    // as well as for a paragraph, and names the LIST in that case, because a term carries no
    // identifier of its own. A sentence that said paragraph while pointing at a list would send an
    // author looking for something that is not there.
    // An image in a line of text is named as one, now an author can place it (figures 4), and so is a
    // footnote (footnotes 1).
    case 'inline_not_publishable':
      return INLINES[failure.detail ?? ''] ?? words('publishing.this-text-holds-formatting-or');
    // A table has a style of its own as a paragraph does (tables 2), and a figure an image style
    // (figures 3); the failure names the block but not its kind, so the sentence names all three.
    // Since themes 1 the styles are the theme's catalogues', so it is the theme that lacks one, and
    // `detail` is the style's identifier as stored, never the author's text.
    case 'style_missing':
      return words('publishing.this-paragraph-table-or-figure', { value1: failure.detail ?? '' });
    // Themes 1: the style is the theme's, and declares where it applies (STY-006) - a heading's style
    // on running text, a footnote's in a list. `detail` is the style's identifier, which the theme
    // wrote, never the author's text; the block is named by where it is, as for `style_missing`.
    case 'style_not_applicable':
      return words('publishing.this-paragraph-table-or-figure-2', { value1: failure.detail ?? '' });
    // Themes 1 (STY-042): the theme records each typeface's licence, and this one's forbids embedding
    // it in a PDF, or since Word 1 in a Word document. Nothing in the document caused it and another
    // attempt fails the same way, so it blames the theme, as `layout_glyph_missing` blames the layout,
    // and never says to publish again. `detail` is the family, and where Word refused it the family
    // and the format, `<family>: docx` (the final review of Word 1, M6).
    case 'typeface_not_embeddable': {
      const detail = failure.detail ?? '';
      const word = detail.endsWith(': docx');
      const family = word ? detail.slice(0, -': docx'.length) : detail;
      return words('publishing.the-typeface-cannot-be-embedded', {
        family,
        value2: word ? 'a Word document' : 'a PDF',
      });
    }
    // Themes 1 (ruling R5): the theme names a typeface by its files' hashes, and the worker holds only
    // the faces pinned in its image, so a face it does not hold cannot set a word. As the licence's
    // refusal, it is the theme's to change, and another attempt finds the same faces. `detail` is the
    // family and why, `<family>: <files | metrics | maths>` (the final review of themes 1, M1): a family
    // the theme wrote, which cannot hold a colon, and a word from a fixed list, never a hash or a
    // number. A reason this page does not know is said as the service not holding the face.
    case 'typeface_unavailable': {
      const theme = words('publishing.the-publication-s-theme-has');
      const detail = failure.detail ?? '';
      const at = detail.lastIndexOf(': ');
      const family = at < 0 ? detail : detail.slice(0, at);
      const reason = at < 0 ? '' : detail.slice(at + 2);
      if (reason === 'maths') {
        return words('publishing.the-typeface-cannot-set-this', { family, theme });
      }
      const because =
        reason === 'metrics'
          ? words('publishing.the-measurements-the-theme-records')
          : reason === 'files'
            ? words('publishing.the-publishing-service-does-not')
            : words('publishing.the-publishing-service-does-not-2');
      return words('publishing.the-typeface-is-not-one', { family, because, theme });
    }
    // Decision K, as Ken reversed it: a tag the engine cannot carry is refused, never shortened, and
    // the author is told what a publication takes (pre-flight finding 9).
    case 'language_not_publishable':
      return words('publishing.the-language-cannot-be-published', { value1: failure.detail ?? '' });
    case 'glyph_missing':
      return words('publishing.the-character-is-in-no', { value1: failure.detail ?? '' });
    case 'character_disallowed':
      return words('publishing.an-invisible-character-cannot-be', { value1: failure.detail ?? '' });
    // Another attempt would make the same nothing, so this never says to publish again (PUB-079).
    case 'nothing_to_publish':
      return words('publishing.there-is-nothing-to-publish');
    // The layout's own words and language: nothing in the document caused these, and another attempt
    // would fail the same way, so they blame the layout and never say to publish again.
    case 'layout_glyph_missing':
      return words('publishing.this-publication-s-layout-uses', { value1: failure.detail ?? '' });
    case 'layout_language_not_publishable':
      return words('publishing.this-publication-s-layout-is', { value1: failure.detail ?? '' });
    // Named apart from `glyph_missing`: the body face has this character, so "in no typeface" would
    // be untrue, and the author needs to know it is the code that cannot carry it.
    case 'code_glyph_missing':
      return words('publishing.the-character-is-not-in', { value1: failure.detail ?? '' });
    // Equations 2, as `code_glyph_missing`: the body face may have this character, so "in no
    // typeface" would be untrue; it is the equation's maths typeface that cannot set it.
    case 'math_glyph_missing':
      return words('publishing.the-maths-typeface-that-equations', {
        value1: failure.detail ?? '',
      });
    // CNT-049, ruling R5: what the equation held is never quoted, only the fixed construct
    // `EQUATION_PROBLEMS` names; opening the equation is the one way to change what it holds.
    case 'equation_unrenderable':
      return words('publishing.an-equation-so-it-cannot', {
        value1:
          EQUATION_PROBLEMS[failure.detail ?? ''] ?? 'holds something the typesetter cannot set',
      });
    // As `footnote_unnumbered`: a layout whose scheme prefixes equations with their chapter gives none
    // in a part with no numbered section before it, and an equation the author numbered is refused
    // rather than published with the number it asked for missing (R5).
    case 'equation_unnumbered':
      return words('publishing.an-equation-here-would-print');
    case 'line_too_wide':
      return words('publishing.a-line-of-this-preformatted', { value1: failure.detail ?? '' });
    // Tables 2's ruling R8: what a caption is for, so the author knows why it is asked for.
    case 'table_without_caption':
      return words('publishing.a-table-has-no-caption');
    case 'table_header_spans_body':
      return words('publishing.a-header-cell-of-this');
    // Figures 3's ruling R10: what a caption and a description are for, and where each is given.
    case 'figure_without_caption':
      return words('publishing.a-figure-has-no-caption');
    // Figures 3's ruling R10 (the comment above `figure_without_caption` covers this code too), and
    // equations 2's R5 beside it: a figure's image with no description of its own and none on the
    // figure either, or an equation with no alternative text, fail alike - never which, since the
    // code is one whichever it is.
    case 'alternative_missing':
      return words('publishing.this-has-no-way-to');
    // Named by where the figure is, never by the image, which the author may not read.
    case 'asset_unreadable':
      return words('publishing.a-figure-shows-an-image');
    // A figure does not break across pages, so its image and caption must stand on one together.
    case 'caption_too_long':
      return words('publishing.a-figure-s-caption-is');
    // Themes 2's ruling R2: the label is the table style's and its words the layout's, and nothing in
    // the document mends either, so it is theirs to change and another attempt fails the same way.
    // `detail` is the style's identifier, as `style_missing` names one.
    case 'continuation_words_missing':
      return words('publishing.this-table-s-style-labels', { value1: failure.detail ?? '' });
    // W10.1 (PV-D): a preview says so in the layout's words, and this layout has none - one stored
    // before its schema 6 - so, as `continuation_words_missing`, it blames the layout and never says to
    // try again.
    case 'preview_words_missing':
      return words('publishing.the-layout-has-no-words');
    // Figures 5's ruling R7: an image set in a line has only the line's room, or its cell's.
    case 'image_too_wide':
      return words('publishing.an-image-in-a-line-3');
    // The final review of figures 5: a caption is estimated from its words and set again in the lists.
    case 'image_in_caption':
      return words('publishing.a-caption-holds-an-image');
    // Footnotes 2's ruling R9: where a footnote may stand, and what a note on a whole table is.
    case 'footnote_not_publishable_here':
      return words('publishing.a-footnote-stands-where-it');
    case 'footnote_anchor_unresolved':
      return words('publishing.a-footnote-is-anchored-to');
    case 'footnote_empty':
      return words('publishing.a-footnote-has-no-text');
    // The layout's rule, not the document's: its scheme prefixes footnotes with their section's
    // number, and this part of the document has no numbered section before it (final review).
    case 'footnote_unnumbered':
      return words('publishing.a-footnote-here-would-print');
    // Cross-references 2's ruling R7: the target is missing from this document, a component target's
    // document holds it more than once, or not at all - never which, since neither is the author's to
    // read from another component (STR-062).
    case 'cross_reference_unresolved':
      return words('publishing.a-cross-reference-points-at');
    // STR-030 (the R11 plan, R11-D): the target is there, and the profile leaves it out.
    case 'cross_reference_excluded':
      return words('publishing.a-cross-reference-points-at-2');
    // Ruling R7 again: `detail` is the form asked, never the author's text.
    case 'cross_reference_form_unavailable':
      return FORMS[failure.detail ?? ''] ?? words('publishing.a-cross-reference-asks-for-8');
    // Word 1's ruling R3: nothing in the document is wrong, and the PDF can be made of it, so the
    // sentence says so rather than asking for a change or another attempt.
    case 'word_not_yet':
      return words('publishing.cannot-be-published-in-word', {
        value1: NOT_YET_IN_WORD[failure.detail ?? ''] ?? 'Something here',
      });
    // Refused when the request is made (PUB-014), so met only by a request built past that check: the
    // layout's to change, as its words are.
    case 'format_unsupported':
      return words('publishing.this-publication-s-layout-has');
    // Word 1's ruling R7: nothing in the document is wrong; the layout's scheme asks Word for a number
    // it would print differently from the PDF's.
    case 'numbering_not_in_word':
      return notInWord(failure.detail);
    // Word 2's ruling R4: nothing else in the document is wrong, and the PDF can be made of it.
    case 'list_not_in_word':
      return words('publishing.a-list-here-publish-this', {
        value1:
          LIST_NOT_IN_WORD[failure.detail ?? ''] ??
          'cannot be printed by Word as the PDF prints it',
      });
    // Word 3's ruling R5: nothing else in the document is wrong, and the PDF can be made of it.
    case 'cross_reference_not_in_word': {
      const why = (failure.detail ?? '').split(':')[1] ?? '';
      return words('publishing.publish-this-document-as-a-2', {
        value1:
          REFERENCE_NOT_IN_WORD[why] ??
          'A cross-reference here cannot be printed by Word as the PDF prints it.',
      });
    }
    // W14.2 (W-E, ADR-0031): the place names the heading, a section's or a component's; nothing else in
    // the document is wrong, and Word, which tags nine levels, can be made of it - where Word can be
    // asked for at all, which a preview and a layout with no Word page cannot.
    case 'heading_too_deep':
      return words('publishing.this-heading-is-nested-more', {
        word: wordOffered ? 'yes' : 'no',
      });
    // The binding stage (B3): a value with no result recorded for this document, which the service
    // refuses at the door, so this is met only by a request built past it; a take that holds no value;
    // and a stored result the worker could not read whole. `detail` is the binding, never a value.
    case 'binding_unresolved':
      return words('publishing.this-value-has-no-result');
    case 'value_none':
      return words('publishing.this-value-s-result-has', { CHANGE_THE_VALUE: CHANGE_THE_VALUE() });
    case 'value_many':
      return words('publishing.this-value-s-result-has-2', {
        CHANGE_THE_VALUE: CHANGE_THE_VALUE(),
      });
    case 'row_missing':
      return words('publishing.this-value-s-result-has-3', {
        CHANGE_THE_VALUE: CHANGE_THE_VALUE(),
      });
    case 'value_null':
      return words('publishing.this-value-s-cell-in', { CHANGE_THE_VALUE: CHANGE_THE_VALUE() });
    case 'value_empty':
      return words('publishing.this-value-s-cell-in-2', { CHANGE_THE_VALUE: CHANGE_THE_VALUE() });
    case 'take_invalid':
      return words('publishing.this-value-names-a-column', {
        CHANGE_THE_VALUE: CHANGE_THE_VALUE(),
      });
    case 'result_unreadable':
      return words('publishing.this-value-s-stored-result');
    // B6: a bound image with no description in its row, one in a footnote, and a figure's binding
    // taking a column that holds no image.
    case 'image_description_missing':
      return words('publishing.this-image-s-row-has', { CHANGE_THE_VALUE: CHANGE_THE_VALUE() });
    case 'image_not_placeable':
      return words('publishing.this-image-stands-in-a');
    case 'value_not_image':
      return words('publishing.this-figure-s-value-is');
    // TB1 (TB1-H, TB1-G): a bound table its stage could not lay out. `detail` is the column, the
    // column and the format member as `<column>: <member>`, the row count, or the words missing.
    case 'column_missing':
      return words('publishing.this-table-shows-or-sorts', { value1: failure.detail ?? '' });
    case 'column_image':
      return words('publishing.this-table-shows-the-image', { value1: failure.detail ?? '' });
    case 'format_mismatch': {
      const [column, member] = (failure.detail ?? '').split(': ');
      return words('publishing.this-table-s-column-has', {
        value1: column ?? '',
        value2: member ?? '',
      });
    }
    case 'table_too_long':
      return words('publishing.this-table-s-result-has', { value1: failure.detail ?? '' });
    // TG (TG1): a subtotal column holding something other than true or false, and a row marked a
    // subtotal at two levels of grouping, `detail` its index in the result.
    case 'subtotal_not_boolean':
      return words('publishing.this-table-marks-its-subtotals', { value1: failure.detail ?? '' });
    case 'subtotal_ambiguous':
      return words('publishing.row-of-this-table-s', { value1: Number(failure.detail ?? '0') + 1 });
    // TG2: a transposed table's result longer than a table turns on its side, `detail` its rows.
    case 'transpose_too_long':
      return words('publishing.this-table-is-transposed-and', { value1: failure.detail ?? '' });
    case 'table_words_missing':
      return words('publishing.the-layout-has-no-words-2');
    // TB3 (TB3-B, TB3-C): a note by key on a definition declaring none; a note whose row is gone,
    // `detail` the note, its key as canonical JSON, the definition and, where the key names other
    // columns than the definition's, the definition's key.
    case 'key_required':
      return words('publishing.this-table-has-a-note');
    case 'note_row_missing': {
      const [, key, , because] = (failure.detail ?? '').split(': ');
      const own = because?.startsWith('the key is ')
        ? words('publishing.its-query-definition-s-key', {
            value1: because.slice('the key is '.length),
          })
        : '';
      return words('publishing.a-note-on-this-table', { value1: key ?? '', own });
    }
    // RV (RV-F; DAT-063): a revised cell whose row is gone, `detail` as `note_row_missing`'s.
    case 'revision_row_missing': {
      const [, key, , because] = (failure.detail ?? '').split(': ');
      const own = because?.startsWith('the key is ')
        ? words('publishing.its-query-definition-s-key', {
            value1: because.slice('the key is '.length),
          })
        : '';
      return words('publishing.a-value-revised-by-hand', { value1: key ?? '', own });
    }
    // RV (RV-F): a revised cell on a column the table no longer shows, or now keys, groups or turns by.
    case 'revision_column_unavailable': {
      const [, column] = (failure.detail ?? '').split(': ');
      return words('publishing.a-value-revised-by-hand-2', { value1: column ?? '' });
    }
    // TB3 (TB3-H): a table too wide for its measure that cannot be set whole, `detail` why.
    case 'table_too_wide':
      return failure.detail === 'turned'
        ? words('publishing.this-table-is-too-wide')
        : failure.detail === 'tall'
          ? words('publishing.this-table-is-too-wide-2')
          : words('publishing.this-table-is-too-wide-3');
    case 'store_failed':
      return words('publishing.the-publication-could-not-be-3');
    // CIc (CNT-054, LIB-012): `detail` names the citation by its place and the entry, or the entry and
    // the variable, by identifier and name alone.
    case 'citation_unresolved': {
      const [place, entry] = (failure.detail ?? '').split(': ');
      return words('publishing.citation-here-names-a-bibliography', {
        value1: place ?? '',
        value2: entry ?? '',
      });
    }
    case 'entry_incomplete': {
      const [entry, variable] = (failure.detail ?? '').split(': ');
      return words('publishing.the-bibliography-entry-lacks-which', {
        value1: entry ?? '',
        value2: variable ?? words('publishing.a-field'),
      });
    }
    case 'style_invalid':
      return failure.detail === 'none'
        ? words('publishing.the-publication-s-theme-names')
        : words('publishing.the-theme-s-citation-style');
    // Publishing in a language (the TR plan, TRb): the document's fallback, or the environment's, refuses.
    case 'occurrence_untranslated':
      return words('publishing.this-component-has-no-translation');
    case 'translation_out_of_date':
      return words('publishing.this-component-s-translation-is');
    // A machine draft not yet accepted (the XL plan, XL-I).
    case 'translation_machine_drafted':
      return words('publishing.this-component-s-translation-was');
    default:
      return words('publishing.the-publication-could-not-be-4');
  }
}

/**
 * Each code in a sentence that needs neither its `detail` nor its place (home.md, Needs your
 * attention): said away from the document, of the publish as a whole, so it names nothing of the
 * author's text. The full words, at each place, are the Publishing panel's (`failureWords`).
 */
export const FAILURE_SUMMARIES: Readonly<Record<PublishFailureCode, string>> = {
  get occurrence_unreadable() {
    return words('publishing.it-places-a-component-you');
  },
  get occurrence_gone() {
    return words('publishing.it-places-a-component-that');
  },
  get override_stale() {
    return words('publishing.it-overrides-a-paragraph-that');
  },
  get variable_unresolved() {
    return words('publishing.a-variable-in-it-has');
  },
  get axis_unset() {
    return words('publishing.content-in-it-depends-on');
  },
  get condition_leaked() {
    return words('publishing.text-its-profile-leaves-out');
  },
  get generated_unaccepted() {
    return words('publishing.generated-content-in-it-waits');
  },
  get citation_unresolved() {
    return words('publishing.a-citation-in-it-names');
  },
  get entry_incomplete() {
    return words('publishing.a-bibliography-entry-it-cites');
  },
  get style_invalid() {
    return words('publishing.its-theme-names-no-citation');
  },
  get occurrence_untranslated() {
    return words('publishing.a-component-in-it-has');
  },
  get translation_out_of_date() {
    return words('publishing.a-translation-in-it-is');
  },
  get translation_machine_drafted() {
    return words('publishing.a-translation-in-it-was');
  },
  get occurrence_unresolved() {
    return words('publishing.a-reference-in-it-waits');
  },
  get asset_unreadable() {
    return words('publishing.a-figure-in-it-shows');
  },
  get component_metadata_invalid() {
    return words('publishing.a-component-in-it-has-2');
  },
  get title_not_publishable() {
    return words('publishing.a-title-in-it-holds');
  },
  get block_not_publishable() {
    return words('publishing.it-holds-a-block-that');
  },
  get inline_not_publishable() {
    return words('publishing.its-text-holds-an-item');
  },
  get style_missing() {
    return words('publishing.it-uses-a-style-the');
  },
  get language_not_publishable() {
    return words('publishing.it-names-a-language-a');
  },
  get glyph_missing() {
    return words('publishing.it-holds-a-character-that');
  },
  get character_disallowed() {
    return words('publishing.it-holds-an-invisible-character');
  },
  get nothing_to_publish() {
    return words('publishing.there-is-nothing-in-it');
  },
  get layout_glyph_missing() {
    return words('publishing.its-layout-uses-a-character');
  },
  get layout_language_not_publishable() {
    return words('publishing.its-layout-is-in-a');
  },
  get code_glyph_missing() {
    return words('publishing.its-code-holds-a-character');
  },
  get line_too_wide() {
    return words('publishing.a-line-of-its-preformatted');
  },
  get table_without_caption() {
    return words('publishing.a-table-in-it-has');
  },
  get table_header_spans_body() {
    return words('publishing.a-header-cell-of-a');
  },
  get figure_without_caption() {
    return words('publishing.a-figure-in-it-has');
  },
  get alternative_missing() {
    return words('publishing.an-image-or-an-equation');
  },
  get caption_too_long() {
    return words('publishing.a-figure-s-caption-is-2');
  },
  get image_too_wide() {
    return words('publishing.an-image-in-a-line-4');
  },
  get image_in_caption() {
    return words('publishing.a-caption-in-it-holds');
  },
  get footnote_not_publishable_here() {
    return words('publishing.a-footnote-in-it-stands');
  },
  get footnote_anchor_unresolved() {
    return words('publishing.a-footnote-in-it-is');
  },
  get footnote_empty() {
    return words('publishing.a-footnote-in-it-has');
  },
  get footnote_unnumbered() {
    return words('publishing.a-footnote-in-it-would');
  },
  get cross_reference_unresolved() {
    return words('publishing.a-cross-reference-in-it');
  },
  get cross_reference_excluded() {
    return words('publishing.a-cross-reference-in-it-2');
  },
  get cross_reference_form_unavailable() {
    return words('publishing.a-cross-reference-in-it-3');
  },
  get equation_unrenderable() {
    return words('publishing.an-equation-in-it-holds');
  },
  get equation_unnumbered() {
    return words('publishing.an-equation-in-it-would');
  },
  get math_glyph_missing() {
    return words('publishing.an-equation-in-it-holds-2');
  },
  get style_not_applicable() {
    return words('publishing.it-uses-a-style-where');
  },
  get typeface_not_embeddable() {
    return words('publishing.its-theme-uses-a-typeface');
  },
  get typeface_unavailable() {
    return words('publishing.its-theme-names-a-typeface');
  },
  get continuation_words_missing() {
    return words('publishing.its-layout-has-no-words');
  },
  get word_not_yet() {
    return words('publishing.it-holds-something-that-cannot');
  },
  get format_unsupported() {
    return words('publishing.its-layout-has-no-page');
  },
  get numbering_not_in_word() {
    return words('publishing.word-would-number-something-in');
  },
  get list_not_in_word() {
    return words('publishing.word-cannot-print-a-list');
  },
  get cross_reference_not_in_word() {
    return words('publishing.word-cannot-print-a-cross');
  },
  get preview_words_missing() {
    return words('publishing.its-layout-has-no-words-2');
  },
  get heading_too_deep() {
    return words('publishing.a-heading-in-it-is');
  },
  get binding_unresolved() {
    return words('publishing.a-value-in-it-has');
  },
  get value_none() {
    return words('publishing.a-value-s-result-in');
  },
  get value_many() {
    return words('publishing.a-value-s-result-in-2');
  },
  get row_missing() {
    return words('publishing.a-value-s-result-in-3');
  },
  get value_null() {
    return words('publishing.a-value-in-it-takes');
  },
  get value_empty() {
    return words('publishing.a-value-in-it-takes-2');
  },
  get take_invalid() {
    return words('publishing.a-value-in-it-names');
  },
  get result_unreadable() {
    return words('publishing.a-value-s-stored-result');
  },
  get image_description_missing() {
    return words('publishing.an-image-bound-in-it');
  },
  get image_not_placeable() {
    return words('publishing.an-image-in-it-stands');
  },
  get value_not_image() {
    return words('publishing.a-figure-s-value-in');
  },
  get column_missing() {
    return words('publishing.a-table-in-it-uses');
  },
  get column_image() {
    return words('publishing.a-table-in-it-shows');
  },
  get format_mismatch() {
    return words('publishing.a-table-in-it-has-2');
  },
  get table_too_long() {
    return words('publishing.a-table-in-it-has-3');
  },
  get table_words_missing() {
    return words('publishing.its-layout-has-no-words-3');
  },
  get key_required() {
    return words('publishing.a-table-in-it-needs');
  },
  get note_row_missing() {
    return words('publishing.a-note-on-a-table');
  },
  get revision_row_missing() {
    return words('publishing.a-value-revised-by-hand-3');
  },
  get revision_column_unavailable() {
    return words('publishing.a-value-revised-by-hand-4');
  },
  get subtotal_not_boolean() {
    return words('publishing.a-table-in-it-marks');
  },
  get subtotal_ambiguous() {
    return words('publishing.a-table-in-it-has-4');
  },
  get transpose_too_long() {
    return words('publishing.a-transposed-table-in-it');
  },
  get table_too_wide() {
    return words('publishing.a-table-in-it-is');
  },
  get engine_failed() {
    return words('publishing.the-publication-could-not-be-5');
  },
  get store_failed() {
    return words('publishing.the-publication-could-not-be-3');
  },
};

/** A failed publish's summary by its code; a code this does not know, as a failed publish. */
export function failureSummary(code: string): string {
  return Object.hasOwn(FAILURE_SUMMARIES, code)
    ? FAILURE_SUMMARIES[code as PublishFailureCode]
    : words('publishing.its-latest-publish-failed-publish');
}

/** What an author does about a value taken from a result that holds none (B3). */
const CHANGE_THE_VALUE = (): string => words('publishing.change-the-value-or-resolve');

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * A request's failures as the service answers them, a publish's or a preview's: the client's bodies are
 * `any`, so each failure is checked member by member, never trusted.
 */
export function failuresIn(value: unknown): Failure[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((each) =>
    isRecord(each) && typeof each.code === 'string'
      ? [
          {
            stage: String(each.stage),
            code: each.code,
            node: typeof each.node === 'string' ? each.node : null,
            block: typeof each.block === 'string' ? each.block : null,
            detail: typeof each.detail === 'string' ? each.detail : null,
          },
        ]
      : [],
  );
}
