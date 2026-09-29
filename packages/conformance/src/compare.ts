import {
  EDGES,
  type Measured,
  type MeasuredFill,
  type MeasuredImage,
  type MeasuredMarker,
  type MeasuredRules,
} from './measure.js';
import type { Token } from './styled.js';

/**
 * **The comparison** (the W13 plan's W13.4, step 6; ADR-0014's tolerance): every length within half a
 * point - where a token starts across the measure, the step from one baseline to the next, the size -
 * and the face, weight, posture, colour, underline and what stands behind the text exactly.
 */
export const TOLERANCE = 0.5;

/** A deviation STY-060 approves: a property, what it stands in, and why. */
export interface Deviation {
  readonly property: string;
  readonly what: string;
  readonly why: string;
}

/**
 * **STY-060's list of approved deviations between the editor and the PDF**: empty. A difference is on
 * it by its property and what the token shows; one that is not on it fails.
 */
export const EDITOR_DEVIATIONS: readonly Deviation[] = [];

/**
 * **STY-060's list between Word and the PDF** (the W15 plan's W15-H): one entry, the one STY-060 names -
 * STY-052's substitution, the maths face a theme declares Word may not embed set in the face it names
 * for Word, Cambria Math in the default theme.
 */
export const WORD_DEVIATIONS: readonly Deviation[] = [
  {
    property: 'maths face',
    what: "the equation's face",
    why: 'STY-052: a face Word may not embed is set in the face the theme names for Word, and reported',
  },
];

/** Whether a difference is one the list of approved deviations for its pair of outputs approves. */
export function approved(difference: Difference, list: readonly Deviation[]): boolean {
  return list.some(
    (each) => each.property === difference.property && each.what === difference.what,
  );
}

/** One property that did not agree, and by how much. */
export interface Difference {
  readonly token: string;
  readonly what: string;
  readonly property: string;
  readonly editor: string | number | boolean;
  readonly pdf: string | number | boolean;
}

/** Told each length compared and by how much the two differed, for the record of the largest. */
export type Largest = (theme: string, property: string, by: number) => void;

/** How a line stands in its measure, which is what places its first word where it is not the start. */
export type Alignment = 'start' | 'end' | 'centre' | 'justify';

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Every difference between the editor's measurement and the PDF's, token by token and from each token
 * to the next. What is compared follows what a token stands in (`Where`):
 *
 * - **Every token**: its size, face, weight, posture, colour and underline, and what stands behind it -
 *   but a footnote's, which the document view reads beside its anchor, in its paragraph's fill.
 * - **Where it starts**, across the measure: in running text, a heading - after its number, as the page
 *   sets it (issue #333) - a quotation, preformatted text and its label, a mark's run but a script's, a
 *   table's cell and a list's item. Not a script's, which the engine moves along its line by its
 *   italic face's own offset, from the face's tables as it moves it up or down (issue #332); not in a
 *   footnote, which the page sets at its foot, nor in the line holding its anchor, which the document
 *   view lengthens with the footnote's words. A
 *   caption's line is compared at the edge its alignment sets it by, since the PDF opens it with its
 *   number and the editor does not. The line holding an equation (`equated`) is compared where its
 *   paragraph is set from the start, where the equation's width moves nothing before it; where its
 *   paragraph is centred or set to the end, the line's length is the maths engine's and not compared.
 * - **The step from one baseline to the next**, in the order the page reads them, wherever both stand in
 *   the component's own flow and each output sets both on one page: running text, lists, quotations,
 *   preformatted text, a table's caption, cells and note, a figure's caption, and the sections' and
 *   the component's headings above them. A mark's run is its line's, so its step is nought; the step
 *   into a line held open by something taller or deeper than its text - an image, a run larger than
 *   its text, a list's marker - is compared as any other (issue #331); and a script, lowered or raised
 *   by the engine's own measure and the browser's rather than the theme's (themes.md, issue #332), is
 *   compared only for which way it moves. The caller may set lines `apart`, whose steps in and out
 *   are not compared: Word's measurement sets apart a floated figure's caption, whose place on the
 *   page is pagination's, and the line holding an equation, which Word sets in another face.
 */
export function compare(
  tokens: readonly Token[],
  editor: ReadonlyMap<string, Measured>,
  pdf: ReadonlyMap<string, Measured>,
  alignment: (token: Token) => Alignment,
  record: (property: string, by: number) => void = () => {},
  apart: ReadonlySet<string> = new Set(),
): Difference[] {
  const differences: Difference[] = [];
  const differ = (token: Token, property: string, e: Difference['editor'], p: Difference['pdf']) =>
    differences.push({ token: token.text, what: token.what, property, editor: e, pdf: p });
  const length = (token: Token, property: string, e: number, p: number) => {
    record(property, Math.abs(e - p));
    if (Math.abs(e - p) > TOLERANCE) differ(token, property, round(e), round(p));
  };
  const exactly = (token: Token, property: string, e: string | boolean, p: string | boolean) => {
    if (e !== p) differ(token, property, e, p);
  };

  for (const token of tokens) {
    const e = editor.get(token.text);
    const p = pdf.get(token.text);
    if (!e || !p) {
      differ(token, 'found', Boolean(e), Boolean(p));
      continue;
    }
    length(token, 'size', e.size, p.size);
    exactly(token, 'face', e.family, p.family);
    exactly(token, 'bold', e.bold, p.bold);
    exactly(token, 'italic', e.italic, p.italic);
    exactly(token, 'colour', e.colour, p.colour);
    exactly(token, 'underline', e.underline, p.underline);
    // A footnote is read beside its anchor in the document view, in its paragraph's fill.
    if (token.where !== 'footnote') exactly(token, 'background', e.background, p.background);

    const aligned = alignment(token);
    if (token.where === 'equated' && (aligned === 'start' || aligned === 'justify')) {
      length(token, 'start', e.x, p.x);
    } else if (
      token.where === 'heading' ||
      token.where === 'flow' ||
      (token.where === 'mark' && !token.script) ||
      token.where === 'cell' ||
      token.where === 'list' ||
      token.where === 'label'
    ) {
      length(token, 'start', e.x, p.x);
    } else if (token.where === 'caption') {
      const align = aligned;
      const edge = (m: Measured) =>
        align === 'centre' ? (m.line[0] + m.line[1]) / 2 : align === 'end' ? m.line[1] : m.line[0];
      length(
        token,
        `line ${align === 'centre' ? 'centre' : align === 'end' ? 'end' : 'start'}`,
        edge(e),
        edge(p),
      );
    }
  }

  // The steps, in the order the page reads them: a caption may stand above its block or below it.
  const inFlow = (each: Token) =>
    each.where !== 'footnote' && each.where !== 'footnoted' && each.where !== 'label';
  const chain = tokens
    .filter((each) => inFlow(each) && !each.script && editor.has(each.text) && pdf.has(each.text))
    .sort((a, b) => {
      const [p, q] = [pdf.get(a.text)!, pdf.get(b.text)!];
      return p.page - q.page || p.baseline - q.baseline || p.x - q.x;
    });
  chain.forEach((token, index) => {
    const previous = chain[index - 1];
    if (!previous) return;
    const [e, p] = [editor.get(token.text)!, pdf.get(token.text)!];
    const [pe, pp] = [editor.get(previous.text)!, pdf.get(previous.text)!];
    // Both on one page in each: a step over a page break is the page's, which the editor has none of
    // and Word breaks where it does (PUB-065).
    if (pp.page !== p.page || pe.page !== e.page) return;
    // A line the caller sets apart is stepped neither into nor out of.
    if (apart.has(token.text) || apart.has(previous.text)) return;
    length(token, `step from ${previous.text}`, e.baseline - pe.baseline, p.baseline - pp.baseline);
  });

  // A script is lowered or raised by the engine's own measure and the browser's, not the theme's
  // (themes.md): only which way is compared, from the run before it on its line.
  tokens.forEach((token, index) => {
    const before = tokens[index - 1];
    if (!token.script || !before) return;
    const [e, p, be, bp] = [
      editor.get(token.text),
      pdf.get(token.text),
      editor.get(before.text),
      pdf.get(before.text),
    ];
    if (!e || !p || !be || !bp) return;
    const way = (step: number) =>
      step > 0.01 ? 'lowered' : step < -0.01 ? 'raised' : 'on the line';
    exactly(token, token.script, way(e.baseline - be.baseline), way(p.baseline - bp.baseline));
  });
  return differences;
}

/**
 * Every image, the editor's and the PDF's in the order each draws them: its width, its height and where
 * it starts across the measure - the image style's size and its alignment - and, for an image in a
 * line, where its foot stands against its line's baseline, which is where the template seats it.
 */
export function compareImages(
  names: readonly { readonly what: string; readonly line?: string }[],
  editor: readonly MeasuredImage[],
  pdf: readonly MeasuredImage[],
  tokensEditor: ReadonlyMap<string, Measured>,
  tokensPdf: ReadonlyMap<string, Measured>,
  record: (property: string, by: number) => void = () => {},
): Difference[] {
  const differences: Difference[] = [];
  names.forEach((name, index) => {
    const [e, p] = [editor[index], pdf[index]];
    const differ = (property: string, a: number | boolean, b: number | boolean) =>
      differences.push({
        token: `image ${index + 1}`,
        what: name.what,
        property,
        editor: a,
        pdf: b,
      });
    if (!e || !p) return differ('found', Boolean(e), Boolean(p));
    const length = (property: string, a: number, b: number) => {
      record(`image ${property}`, Math.abs(a - b));
      if (Math.abs(a - b) > TOLERANCE) differ(property, round(a), round(b));
    };
    length('width', e.width, p.width);
    length('height', e.height, p.height);
    length('start', e.x, p.x);
    const [le, lp] = [
      name.line && tokensEditor.get(name.line),
      name.line && tokensPdf.get(name.line),
    ];
    if (le && lp)
      length(`foot from ${name.line}'s baseline`, e.foot - le.baseline, p.foot - lp.baseline);
  });
  return differences;
}

/**
 * Every rule on the edges of each cell: where its edge runs against the cell's text - the table style's
 * padding - how thick it is drawn and its colour, a rule none of either being nought thick. Where
 * either output breaks the table between a cell and the one above or below it, that edge is the
 * page's - the outer rule framing each page's part, the header repeated - and is not compared: the
 * editor has no page, and Word breaks its pages where it does (PUB-065).
 */
export function compareRules(
  tokens: readonly Token[],
  editor: ReadonlyMap<string, MeasuredRules>,
  pdf: ReadonlyMap<string, MeasuredRules>,
  shown: ReadonlyMap<string, Measured>,
  printed: ReadonlyMap<string, Measured>,
  record: (property: string, by: number) => void = () => {},
): Difference[] {
  const differences: Difference[] = [];
  const cells = tokens.filter((each) => each.where === 'cell');
  /** The cell nearest above or below in the column, and whether either output sets it apart. */
  const brokenFrom = (token: Token, way: -1 | 1): boolean => {
    const [here, page] = [shown.get(token.text), printed.get(token.text)?.page];
    if (!here) return false;
    // Down the column in reading order: a page's lines after the page before's.
    const down = (m: Measured) => m.page * 100_000 + m.baseline;
    const next = cells
      .map((each) => shown.get(each.text))
      .filter((each): each is Measured => each !== undefined && Math.abs(each.x - here.x) < 1)
      .filter((each) => (down(each) - down(here)) * way > 1)
      .sort((a, b) => Math.abs(down(a) - down(here)) - Math.abs(down(b) - down(here)))[0];
    return (
      next !== undefined &&
      (printed.get(next.token)?.page !== page || next.page !== here.page)
    );
  };
  for (const token of cells) {
    const [e, p] = [editor.get(token.text), pdf.get(token.text)];
    const differ = (property: string, a: number | string | boolean, b: number | string | boolean) =>
      differences.push({ token: token.text, what: token.what, property, editor: a, pdf: b });
    if (!e || !p) {
      differ('rules found', Boolean(e), Boolean(p));
      continue;
    }
    for (const edge of EDGES) {
      if (
        (edge === 'top' && brokenFrom(token, -1)) ||
        (edge === 'bottom' && brokenFrom(token, 1))
      ) {
        continue;
      }
      const [a, b] = [e[edge], p[edge]];
      if (a.colour !== b.colour) differ(`${edge} rule colour`, a.colour, b.colour);
      record('rule width', Math.abs(a.width - b.width));
      if (Math.abs(a.width - b.width) > TOLERANCE)
        differ(`${edge} rule width`, round(a.width), round(b.width));
      if (a.width > 0 && b.width > 0) {
        record('rule position', Math.abs(a.at - b.at));
        if (Math.abs(a.at - b.at) > TOLERANCE)
          differ(`${edge} rule position`, round(a.at), round(b.at));
      }
    }
  }
  return differences;
}

/** The face the equation beside `token` is drawn in, the editor's against the PDF's, exactly. */
export function compareMathsFace(
  token: string,
  editor: string | undefined,
  pdf: string | undefined,
): Difference[] {
  // The files name the family `STIX Two Math`; the PDF, `STIXTwoMath`.
  const bare = (family: string | undefined) => family?.replace(/\s+/g, '');
  return bare(editor) === bare(pdf) && editor !== undefined
    ? []
    : [
        {
          token,
          what: "the equation's face",
          property: 'maths face',
          editor: editor ?? 'none',
          pdf: pdf ?? 'none',
        },
      ];
}

/**
 * Each list item's marker: where it ends - a number is right-aligned in the list's column, a bullet
 * stands at its start - and its size within half a point, and its face, weight, posture and colour,
 * which the list's place's style sets, exactly.
 */
export function compareMarkers(
  tokens: readonly Token[],
  editor: ReadonlyMap<string, MeasuredMarker>,
  pdf: ReadonlyMap<string, MeasuredMarker>,
  record: (property: string, by: number) => void = () => {},
): Difference[] {
  const differences: Difference[] = [];
  for (const token of tokens.filter((each) => each.where === 'list')) {
    const [e, p] = [editor.get(token.text), pdf.get(token.text)];
    const differ = (property: string, a: number | string | boolean, b: number | string | boolean) =>
      differences.push({
        token: token.text,
        what: `${token.what}'s marker`,
        property,
        editor: a,
        pdf: b,
      });
    if (!e || !p) {
      differ('marker found', Boolean(e), Boolean(p));
      continue;
    }
    for (const [property, a, b] of [
      ['marker end', e.end, p.end],
      ['marker size', e.size, p.size],
    ] as const) {
      record(property, Math.abs(a - b));
      if (Math.abs(a - b) > TOLERANCE) differ(property, round(a), round(b));
    }
    for (const [property, a, b] of [
      ['marker face', e.family, p.family],
      ['marker bold', e.bold, p.bold],
      ['marker italic', e.italic, p.italic],
      ['marker colour', e.colour, p.colour],
    ] as const) {
      if (a !== b) differ(property, a, b);
    }
  }
  return differences;
}

/**
 * **Each fill's edges against its words** (the W15 plan, W15-G), what STY-080 leaves out only because
 * the editor paints a block's fill by its own means: its left and right across the measure and its top
 * and foot against the baseline, each within half a point, where both outputs fill behind a token; and
 * a fill one output paints behind a token and the other does not. Not a mark's run, whose fill is its
 * paragraph's; nor a footnote's or a caption's, which the PDF does not set (issue #330).
 */
export function compareFills(
  tokens: readonly Token[],
  editor: ReadonlyMap<string, MeasuredFill>,
  pdf: ReadonlyMap<string, MeasuredFill>,
  record: (property: string, by: number) => void = () => {},
): Difference[] {
  const differences: Difference[] = [];
  const outside = new Set(['mark', 'footnote', 'caption']);
  for (const token of tokens.filter((each) => !outside.has(each.where))) {
    const [e, p] = [editor.get(token.text), pdf.get(token.text)];
    const differ = (property: string, a: number | boolean, b: number | boolean) =>
      differences.push({ token: token.text, what: token.what, property, editor: a, pdf: b });
    if (!e && !p) continue;
    if (!e || !p) {
      differ('fill found', Boolean(e), Boolean(p));
      continue;
    }
    for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
      record(`fill ${edge}`, Math.abs(e[edge] - p[edge]));
      if (Math.abs(e[edge] - p[edge]) > TOLERANCE)
        differ(`fill ${edge}`, round(e[edge]), round(p[edge]));
    }
  }
  return differences;
}
