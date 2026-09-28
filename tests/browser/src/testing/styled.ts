/**
 * **The measured fixture** (the W13 plan's W13.4, step 3): a component whose every block opens with a
 * token, one block for each paragraph style an author can choose and each place a paragraph can stand,
 * a run for each of the nine marks, the roles the editor sets - a caption, a table's note, an
 * attribution, preformatted text - and a table and a figure in each of their styles, with an image in a
 * line of text. Each token is a word no other text holds, so it is found once in the editor and, the
 * last time it is painted outside an artifact, in the PDF - after the contents and the lists, which
 * repeat a heading's or a caption's words.
 */

/** What a token stands in, which says what the comparison can ask of it. */
export type Where =
  /** Running text, in the flow the editor and the page both set top to bottom. */
  | 'flow'
  /** A section's or the component's heading. */
  | 'heading'
  /** In a list, whose indent is the engine's and the editor stylesheet's, not a style property. */
  | 'list'
  /** In a table's cell, whose columns each renderer sizes itself. */
  | 'cell'
  /** A footnote, set at the page's foot, and read beside its anchor in the document view. */
  | 'footnote'
  /**
   * The paragraph holding a footnote, whose line the document view lengthens with the footnote's words,
   * so where an aligned line starts is not compared.
   */
  | 'footnoted'
  /** A caption, which the PDF opens with its number and the editor does not. */
  | 'caption'
  /** A mark's run, part way along a line. */
  | 'mark'
  /** Preformatted text's label, which the editor draws from an attribute: only how it is set is read. */
  | 'label';

export interface Token {
  readonly text: string;
  readonly where: Where;
  /** What it shows, for a failure to name. */
  readonly what: string;
  /** For a mark's run lowered or raised, which. */
  readonly script?: 'subscript' | 'superscript';
  /**
   * Whether its line holds something taller than its own text - an image in it, which stands above it,
   * or the marker of the list it is in, set in the list's own style, which may stand above it and below
   * it - which the PDF grows the line for and the editor does not (issue #331; themes.md, "The
   * theme in the editor, measured"). The step to it, and for `around` the step from it, is not
   * compared.
   */
  readonly grows?: 'above' | 'around';
}

/** The marks, each with what it needs besides its type, in the order the component holds them. */
const MARKS = [
  { type: 'emphasis' },
  { type: 'strong' },
  { type: 'underline' },
  { type: 'subscript' },
  { type: 'superscript' },
  { type: 'inlineCode' },
  { type: 'quotedPhrase' },
  { type: 'hyperlink', href: 'https://example.com/measured' },
  { type: 'language', tag: 'fr-FR' },
] as const;

/** The paragraph styles an author can choose for running text, in every theme here. */
export const TEXT_STYLES = ['body', 'lead', 'centred', 'small-print'] as const;

let marks = 0;
const mark = (made: object) => ({ id: `measured-mark-${(marks += 1)}`, ...made });
const text = (value: string, marked: readonly object[] = []) => ({
  type: 'text',
  value,
  marks: marked.map(mark),
});
const paragraph = (id: string, style: string, content: readonly object[]) => ({
  type: 'paragraph',
  id,
  style,
  content,
});

/** The section titles, deepest last: headings one to five, and the component's own is the sixth. */
export const HEADINGS: readonly Token[] = [1, 2, 3, 4, 5].map((depth) => ({
  text: `Zh0${depth}`,
  where: 'heading',
  what: `a heading at depth ${depth}`,
}));

/** The images the component holds, in the order they stand: two figures and one in a line. */
export const IMAGES: readonly { readonly what: string; readonly line?: string }[] = [
  { what: 'a figure in figure' },
  { what: 'a figure in half-width' },
  { what: 'an image in a line', line: 'Zi1' },
];

/** The component's title, set as a heading at depth six. */
export const COMPONENT_TITLE: Token = {
  text: 'Zh06',
  where: 'heading',
  what: 'a heading at depth 6',
};

/**
 * The component's content and the tokens it holds, in the order they stand. `image` is the asset
 * version every figure and the image in a line show.
 */
export function styledContent(image: string): { content: object[]; tokens: Token[] } {
  marks = 0;
  const tokens: Token[] = [];
  const token = (
    value: string,
    where: Where,
    what: string,
    also: Pick<Token, 'script' | 'grows'> = {},
  ) => {
    tokens.push({ text: value, where, what, ...also });
    return value;
  };
  const content: object[] = [];

  TEXT_STYLES.forEach((style, index) => {
    const id = `measured-${style}`;
    content.push(
      paragraph(id, style, [
        text(`${token(`Zp0${index + 1}`, 'flow', `a ${style} paragraph`)} ${style}`),
      ]),
    );
  });

  MARKS.forEach(({ type, ...rest }, index) => {
    const at = token(`Zr${index + 1}`, 'flow', `the paragraph holding ${type}`);
    const run = token(
      `Zm${index + 1}`,
      'mark',
      `${type}'s run`,
      type === 'subscript' || type === 'superscript' ? { script: type } : {},
    );
    content.push(
      paragraph(`measured-mark-${type}`, 'body', [
        text(`${at} `),
        text(`${run} ${type}`, [{ type, ...rest }]),
      ]),
    );
  });

  content.push({
    type: 'list',
    id: 'measured-list',
    kind: 'unordered',
    items: [
      {
        content: [
          paragraph('measured-item', 'body', [text(`${token('Zl1', 'list', 'a list item')} item`)]),
        ],
      },
      {
        content: [
          paragraph('measured-item-centred', 'centred', [
            text(`${token('Zl2', 'list', 'a centred list item', { grows: 'around' })} item`),
          ]),
        ],
      },
    ],
  });

  content.push({
    type: 'blockquote',
    id: 'measured-quotation',
    content: [
      paragraph('measured-quoted', 'body', [text(`${token('Zq1', 'flow', 'a quotation')} quoted`)]),
      paragraph('measured-quoted-2', 'body', [
        text(`${token('Zq2', 'flow', "a quotation's second paragraph")} quoted`),
      ]),
    ],
    attribution: [text(`${token('Zq3', 'flow', 'an attribution')} said`)],
  });

  content.push({
    type: 'preformatted',
    id: 'measured-preformatted',
    text: `${token('Zf1', 'flow', 'preformatted text')} kept`,
  });
  // And labelled: the label is its language, a word the label's role sets above its lines.
  content.push({
    type: 'preformatted',
    id: 'measured-preformatted-labelled',
    language: token('Zf2', 'label', "preformatted text's label"),
    text: `${token('Zf3', 'flow', 'labelled preformatted text')} kept`,
  });

  for (const style of ['table', 'banded'] as const) {
    const n = style === 'table' ? 1 : 2;
    const cell = (value: string, what: string) => ({
      content: [
        paragraph(`measured-${style}-${value}`, 'body', [text(`${token(value, 'cell', what)}`)]),
      ],
      colspan: 1,
      rowspan: 1,
    });
    // Made in the order they stand - the caption above the cells in every style here, the note last -
    // so the tokens are listed in it.
    const caption = [text(`${token(`Zt${n}0`, 'caption', `a caption of ${style}`)} caption`)];
    const rows = [
      { cells: [cell(`Zt${n}1`, `${style}'s corner`), cell(`Zt${n}2`, `${style}'s header row`)] },
      { cells: [cell(`Zt${n}3`, `${style}'s header column`), cell(`Zt${n}4`, `${style}'s body`)] },
      { cells: [cell(`Zt${n}5`, `${style}'s header column`), cell(`Zt${n}6`, `${style}'s band`)] },
      { cells: [cell(`Zt${n}7`, `${style}'s header column`), cell(`Zt${n}8`, `${style}'s body`)] },
    ];
    const note = [text(`${token(`Zt${n}9`, 'flow', `a note of ${style}`)} note`)];
    content.push({
      type: 'table',
      id: `measured-table-${style}`,
      style,
      caption,
      headerRows: 1,
      headerColumns: 1,
      note,
      rows,
    });
  }

  for (const style of ['figure', 'half-width'] as const) {
    content.push({
      type: 'figure',
      id: `measured-figure-${style}`,
      asset: image,
      imageStyle: style,
      caption: [
        text(
          `${token(`Zg${style === 'figure' ? 1 : 2}`, 'caption', `a caption of ${style}`)} figure`,
        ),
      ],
      alternative: { kind: 'inherited' },
    });
  }

  content.push(
    paragraph('measured-inline-image', 'body', [
      text(`${token('Zi1', 'flow', 'the paragraph holding an image', { grows: 'above' })} `),
      { type: 'image', asset: image, imageStyle: 'inline', alternative: { kind: 'inherited' } },
      text(' image'),
    ]),
  );

  content.push(
    paragraph('measured-footnoted', 'body', [
      text(`${token('Zn1', 'footnoted', 'the paragraph holding a footnote')} noted`),
      {
        type: 'footnote',
        id: 'measured-footnote',
        anchor: { kind: 'span' },
        content: [
          paragraph('measured-footnote-text', 'body', [
            text(`${token('Zn2', 'footnote', 'a footnote')} note`),
          ]),
        ],
      },
    ]),
  );

  return { content, tokens };
}
