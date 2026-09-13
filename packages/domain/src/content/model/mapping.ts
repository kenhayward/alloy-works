/**
 * Every node and every mark, with what it becomes on the way out of the product.
 *
 * This is a COMPLETENESS CHECK rather than a mapping specification. The detailed mappings belong to
 * word-output.md and to the Typst template, so each has one owner - two documents stating one rule is
 * the condition that lets them drift apart while each looks correct.
 *
 * **Where each column was checked.** The OOXML column is grounded in what this repository already
 * emits and has tests over - `packages/domain/src/content/ooxml/export.ts` and
 * `packages/domain/src/theme/ooxml.ts` - and, for the constructs no writer emits yet, in
 * `docs/design/word-output.md`, whose claims were checked by opening the writer's output in Word
 * (PUB-029). The tagged-PDF column is the standard structure types of ISO 32000-1, which is the
 * edition PDF/UA-1 constrains and which ADR-0013 commits every publication to.
 *
 * **PDF/UA-1 is PDF 1.7, and that decides three rows.** `Em` and `Strong` arrived in PDF 2.0 and are
 * not available here, so emphasis and strong emphasis are a `Span` carrying the face the theme's
 * character style declares. Going the other way, `BlockQuote`, `Code`, `Note`, `Quote`, `Reference`
 * and `BibEntry` are PDF 1.7 types that PDF 2.0's own namespace dropped - so if the profile ever moves
 * to PDF/UA-2, this table is re-checked rather than inherited.
 *
 * **A cell that cannot be filled blocks the node from the vocabulary**, and a cell saying a construct
 * has no output form is filled rather than blank: a condition is resolved before anything is written,
 * and being resolved away is that mark's way out.
 */
export type OutputMapping = Record<string, { ooxml: string; tagged: string; note?: string }>;

export const outputMapping: {
  blocks: OutputMapping;
  inline: OutputMapping;
  marks: OutputMapping;
} = {
  blocks: {
    paragraph: {
      ooxml: 'w:p with w:pStyle naming the theme paragraph style',
      tagged: 'P',
    },
    list: {
      ooxml: 'w:p per item with w:numPr (w:ilvl, w:numId) against a numbering.xml definition',
      tagged: 'L holding one LI per item, each a Lbl and an LBody',
      note: 'The label is Word numbering rather than authored text - the mechanism PUB-024 requires for headings, which word-output.md extends to the lists that use it',
    },
    table: {
      ooxml: 'w:tbl with w:tr and w:tc; header rows carry w:tblHeader',
      tagged: 'Table with THead and TBody, TR, TH carrying /Scope, TD; the caption a Caption',
      note: 'TAB-031 and TAB-039 make scope and the caption association non-negotiable, which is why the spike overrode prosemirror-tables toDOM',
    },
    figure: {
      ooxml:
        'w:drawing, with the alternative in wp:docPr/@descr and the caption a w:p in the caption style',
      tagged: 'Figure carrying /Alt, with its Caption',
      note: 'A decorative figure is an Artifact rather than a Figure with empty /Alt',
    },
    preformatted: {
      ooxml: 'w:p in a fixed-pitch style, with xml:space="preserve" on its runs',
      tagged: 'P holding Code',
    },
    blockquote: {
      ooxml: 'w:p in the quote style, the attribution a w:p in the attribution style',
      tagged: 'BlockQuote',
    },
    equation: {
      ooxml: 'm:oMathPara, the number a SEQ field at a right tab stop so a REF to it updates',
      tagged: 'Formula carrying /Alt',
      note: 'word-output.md owns the maths tree to OMML mapping; PUB-067 builds both outputs from one tree',
    },
  },
  inline: {
    text: {
      ooxml: 'w:r with w:rPr, w:t carrying the characters',
      tagged: 'The text content of the enclosing structure element; no element of its own',
    },
    equation: {
      ooxml: 'm:oMath inside the paragraph',
      tagged: 'Formula carrying /Alt',
    },
    footnote: {
      ooxml:
        'w:footnoteReference at the anchor, the note a footnotes.xml entry opening with w:footnoteRef',
      tagged: 'Reference at the anchor, the note a Note',
      note: 'PUB-025. Word numbers both ends itself, so no number is written',
    },
    crossReference: {
      ooxml: 'A REF field to a bookmark on the target, its resolved value the field result',
      tagged: 'Reference, inside a Link where the reference is navigable',
      note: 'PUB-026, and settings.xml asks Word to update fields on opening (PUB-066)',
    },
    citation: {
      ooxml:
        'The runs the citation style produces, with a REF field to the bookmark on its bibliography entry',
      tagged: 'Reference, pointing at the BibEntry in the bibliography',
    },
    variable: {
      ooxml: 'The resolved value as runs; no field, because resolution happened before output',
      tagged: 'No element of its own; a Span only where the value carries its own language',
      note: 'CNT-029 stores no value, so what reaches a writer is already resolved',
    },
    binding: {
      ooxml: 'The resolved value as runs, in the w:tc or w:p it resolved into',
      tagged: 'No element of its own; the content of the enclosing TD or P',
    },
    image: {
      ooxml: 'An inline w:drawing, with the alternative in wp:docPr/@descr',
      tagged: 'Figure carrying /Alt, or an Artifact where the alternative is decorative',
    },
  },
  marks: {
    emphasis: {
      ooxml: 'w:rStyle naming the theme character style for emphasis, whose definition carries w:i',
      tagged: 'Span',
      note: 'PDF 1.7 has no Em; it arrived in PDF 2.0 and PDF/UA-1 cannot use it',
    },
    strong: {
      ooxml: 'w:rStyle naming the theme character style for strong, whose definition carries w:b',
      tagged: 'Span',
      note: 'PDF 1.7 has no Strong; same reason as emphasis',
    },
    underline: {
      ooxml:
        'w:rStyle naming the theme character style for underline, whose definition carries w:u',
      tagged: 'Span',
      note: 'CNT-085 admits this one is named for its appearance rather than its meaning',
    },
    subscript: {
      ooxml: 'w:rStyle whose definition carries w:vertAlign w:val="subscript"',
      tagged: 'Span',
    },
    superscript: {
      ooxml: 'w:rStyle whose definition carries w:vertAlign w:val="superscript"',
      tagged: 'Span',
    },
    inlineCode: {
      ooxml: 'w:rStyle naming the theme character style for code',
      tagged: 'Code',
    },
    definedTerm: {
      ooxml: 'w:rStyle for the term style, with a REF field to the bookmark on its glossary entry',
      tagged: 'Reference, pointing at the glossary entry',
      note: 'LIB-015 keeps the term text out of content, so both ends resolve from the term identity',
    },
    quotedPhrase: {
      ooxml: 'w:rStyle naming the theme character style for a quoted phrase',
      tagged: 'Quote',
    },
    condition: {
      ooxml: 'None: resolved before output, so the text is either written or it is not',
      tagged: 'None: resolved before output, for the same reason',
      note: 'Being resolved away is this mark's way out. Nothing in an output ever names an axis',
    },
    suggestion: {
      ooxml: 'w:ins or w:del carrying author and date',
      tagged:
        'None in a published copy, where suggestions are resolved or excluded; in a review copy the surviving text is tagged as the content it is',
      note: 'PUB-028. PDF has no tracked-change structure type, which is why a review PDF carries no equivalent',
    },
    comment: {
      ooxml:
        'w:commentRangeStart and w:commentRangeEnd around the span, w:commentReference, the thread in comments.xml',
      tagged: 'None in a published copy; in a review copy an Annot wrapping the text annotation',
      note: 'PUB-028, and the second open question in word-output.md is whether a client copy should carry these at all',
    },
    hyperlink: {
      ooxml: 'w:hyperlink with r:id to a relationship in document.xml.rels',
      tagged: 'Link, with a Link annotation and the /Link object reference the structure needs',
      note: 'CNT-127 has already refused any scheme outside the allowlist, so no writer re-checks it',
    },
    language: {
      ooxml: 'w:lang on the run, the document default in settings.xml and the styles',
      tagged: '/Lang on the enclosing structure element',
      note: 'PUB-035 and PUB-034. The engine spike failed a candidate on exactly this, so it is a checked column rather than an assumed one',
    },
  },
};
