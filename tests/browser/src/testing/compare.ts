import { EDGES, type Measured, type MeasuredImage, type MeasuredRules } from './measure.js';
import type { Token } from './styled.js';

/**
 * **The comparison** (the W13 plan's W13.4, step 6; ADR-0014's tolerance): every length within half a
 * point - where a token starts across the measure, the step from one baseline to the next, the size -
 * and the face, weight, posture, colour, underline and what stands behind the text exactly.
 */
export const TOLERANCE = 0.5;

/**
 * **STY-060's list of approved deviations**, as it stands between the editor and the PDF: empty. The one
 * deviation approved today, a face Word may not embed set in the face its theme names for Word
 * (STY-052), is Word's, and STY-081's to carry. A difference is on it by its property and what the
 * token shows; one that is not on it fails.
 */
export const APPROVED_DEVIATIONS: readonly {
  readonly property: string;
  readonly what: string;
  readonly why: string;
}[] = [];

/** Whether a difference is one STY-060's list approves. */
export function approved(difference: Difference): boolean {
  return APPROVED_DEVIATIONS.some(
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

/** How a caption's line stands in its measure, which is what places its first word. */
export type Alignment = 'start' | 'end' | 'centre' | 'justify';

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Every difference between the editor's measurement and the PDF's, token by token and from each token
 * to the next. What is compared follows what a token stands in (`Where`):
 *
 * - **Every token**: its size, face, weight, posture, colour and underline, and what stands behind it -
 *   but a footnote's, which the document view reads beside its anchor, in its paragraph's fill.
 * - **Where it starts**, across the measure: in running text, a quotation, preformatted text, a mark's
 *   run and a table's cell. Not in a list, whose indent is the engine's and the editor stylesheet's
 *   rather than a style property (themes.md, "Not every value is the theme's"); not in a heading,
 *   which the document view sets after its number its own way (issue #333); not in a footnote, which
 *   the page sets at its foot, nor in the line holding its anchor, which the document view lengthens
 *   with the footnote's words. A caption's line is compared at the edge its alignment sets it by,
 *   since the PDF opens it with its number and the editor does not.
 * - **The step from one baseline to the next**, in the order the page reads them, wherever both stand in
 *   the component's own flow and the PDF sets both on one page: running text, lists, quotations,
 *   preformatted text, a table's caption, cells and note, a figure's caption. A mark's run is its
 *   line's, so its step is nought; the step into a line something taller than its text holds open is
 *   not compared (`Token.grows`, issue #331); and a script, lowered or raised by the engine's own
 *   measure and the browser's rather than the theme's (themes.md, issue #332), is compared only for
 *   which way it moves.
 */
export function compare(
  tokens: readonly Token[],
  editor: ReadonlyMap<string, Measured>,
  pdf: ReadonlyMap<string, Measured>,
  alignment: (token: Token) => Alignment,
  record: (property: string, by: number) => void = () => {},
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

    if (token.where === 'flow' || token.where === 'mark' || token.where === 'cell') {
      length(token, 'start', e.x, p.x);
    } else if (token.where === 'caption') {
      const align = alignment(token);
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
    each.where !== 'heading' &&
    each.where !== 'footnote' &&
    each.where !== 'footnoted' &&
    each.where !== 'label';
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
    if (pp.page !== p.page || token.grows || previous.grows === 'around') return;
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
 * padding - how thick it is drawn and its colour, a rule none of either being nought thick. Where the
 * PDF breaks the table between a cell and the one above or below it, that edge is the page's - the
 * outer rule framing each page's part, the header repeated - and is not compared, since the editor has
 * no page.
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
  /** The cell nearest above or below, in the editor's column, and whether the PDF sets it apart. */
  const brokenFrom = (token: Token, way: -1 | 1): boolean => {
    const [here, page] = [shown.get(token.text), printed.get(token.text)?.page];
    if (!here) return false;
    const next = cells
      .map((each) => shown.get(each.text))
      .filter((each): each is Measured => each !== undefined && Math.abs(each.x - here.x) < 1)
      .filter((each) => (each.baseline - here.baseline) * way > 1)
      .sort(
        (a, b) => Math.abs(a.baseline - here.baseline) - Math.abs(b.baseline - here.baseline),
      )[0];
    return next !== undefined && printed.get(next.token)?.page !== page;
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
