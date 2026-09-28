/**
 * A component's content holding every block and every mark the editor makes (the W13 plan's W13.2,
 * step 1): the nine marks, an inline image, a footnote, a cross-reference and an inline equation in
 * one paragraph; bulleted, numbered and definition lists nested; a table with a caption, a header row
 * and column, a merged cell and a note; a figure; preformatted text; a quotation with its attribution;
 * and a numbered block equation. Written as the content model stores it, and saved through the API.
 *
 * The MathML is Temml's for the LaTeX beside it, as `admitTemmlMathml` keeps it: taken from the pinned
 * Temml once, since the suite imports nothing from the renderer. Each carries its alternative as its
 * `alttext`, as the Equation dialog writes one, so a document placing the component publishes.
 */

const MATHML = 'http://www.w3.org/1998/Math/MathML';

/** `x^{2}`, in a line of text. */
export const INLINE_EQUATION = {
  type: 'equation',
  mathml: `<math xmlns="${MATHML}" alttext="x squared"><msup><mi>x</mi><mn>2</mn></msup></math>`,
  latex: 'x^{2}',
} as const;

/** `\frac{a}{b}`, as a block. The backslash is built, so no tool on the way can read it as an escape. */
const BLOCK_LATEX = `${String.fromCharCode(92)}frac{a}{b}`;

function text(value: string, marks: readonly object[] = []) {
  return { type: 'text', value, marks };
}

function paragraph(id: string, value: string, style = 'body') {
  return { type: 'paragraph', id, style, content: [text(value)] };
}

function cell(id: string, value: string, colspan = 1) {
  return { content: [paragraph(id, value)], colspan, rowspan: 1 };
}

/** The paragraph a test puts the cursor in to reach each inline thing, by its words. */
export const WORDS = {
  marks: 'Strong',
  link: 'a link',
  language: 'in another language',
  reference: 'The table',
  footnote: 'A note on the span.',
  bulleted: 'A bulleted item',
  numbered: 'A numbered item',
  definition: 'A definition.',
  quotation: 'A quoted passage.',
  preformatted: 'select 1',
  header: 'Measure',
  merged: 'Merged across two',
} as const;

/** Every block and mark, placing `figure` as a figure and `image` in a line of text. */
export function everyBlock(figure: string, image: string): readonly unknown[] {
  return [
    {
      type: 'paragraph',
      id: 'b1',
      style: 'body',
      content: [
        text('Strong', [{ type: 'strong', id: 'm1' }]),
        text(', '),
        text('emphasis', [{ type: 'emphasis', id: 'm2' }]),
        text(', '),
        text('underline', [{ type: 'underline', id: 'm3' }]),
        text(', H'),
        text('2', [{ type: 'subscript', id: 'm4' }]),
        text('O, x'),
        text('2', [{ type: 'superscript', id: 'm5' }]),
        text(', '),
        text('inline code', [{ type: 'inlineCode', id: 'm6' }]),
        text(', '),
        text('a quoted phrase', [{ type: 'quotedPhrase', id: 'm7' }]),
        text(', '),
        text('a link', [{ type: 'hyperlink', id: 'm8', href: 'https://example.test/reference' }]),
        text(' and a passage '),
        text('in another language', [{ type: 'language', id: 'm9', tag: 'pt-BR' }]),
        text('. An image '),
        { type: 'image', asset: image, imageStyle: 'inline', alternative: { kind: 'inherited' } },
        text(', a note'),
        {
          type: 'footnote',
          id: 'f1',
          anchor: { kind: 'span' },
          content: [paragraph('fb1', 'A note on the span.', 'footnote')],
        },
        text(', a reference to '),
        {
          type: 'crossReference',
          id: 'x1',
          target: { kind: 'block', block: 'b4' },
          display: 'numberAndTitle',
        },
        text(' and an equation '),
        INLINE_EQUATION,
        text('.'),
      ],
    },
    {
      type: 'list',
      id: 'b2',
      kind: 'ordered',
      start: 1,
      format: 'decimal',
      items: [
        {
          content: [
            paragraph('b2a', 'A numbered item'),
            {
              type: 'list',
              id: 'b3',
              kind: 'unordered',
              items: [
                {
                  content: [
                    paragraph('b3a', 'A bulleted item'),
                    {
                      type: 'list',
                      id: 'b3b',
                      kind: 'definition',
                      items: [
                        {
                          term: [text('A term')],
                          content: [paragraph('b3c', 'A definition.')],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'table',
      id: 'b4',
      style: 'table',
      caption: [text('The table')],
      headerRows: 1,
      headerColumns: 1,
      note: [text('A note on the table.')],
      rows: [
        {
          cells: [cell('b5', 'Measure'), cell('b6', 'First'), cell('b7', 'Second')],
        },
        {
          cells: [cell('b8', 'Throughput'), cell('b9', 'Measured'), cell('b10', 'Estimated')],
        },
        {
          cells: [cell('b11', 'Latency'), cell('b12', 'Merged across two', 2)],
        },
      ],
    },
    {
      type: 'figure',
      id: 'b13',
      asset: figure,
      imageStyle: 'figure',
      caption: [text('The figure')],
      alternative: { kind: 'own', text: 'A blue rectangle' },
    },
    { type: 'preformatted', id: 'b14', text: 'select 1\n\tfrom nothing', language: 'sql' },
    {
      type: 'blockquote',
      id: 'b15',
      content: [paragraph('b16', 'A quoted passage.')],
      attribution: [text('Grace')],
    },
    {
      type: 'equation',
      id: 'b17',
      mathml: `<math xmlns="${MATHML}" alttext="a over b" display="block"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>`,
      latex: BLOCK_LATEX,
      numbered: true,
    },
    paragraph('b18', 'The last paragraph.'),
  ];
}
