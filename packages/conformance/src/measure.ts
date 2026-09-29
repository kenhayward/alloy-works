import type { Box, Paint, PaintedText } from './pdf.js';
import { FIGURES, IMAGES } from './styled.js';

/**
 * **What a token measures at**, in the editor and in the PDF alike (the W13 plan's W13.4, steps 4 and
 * 5; ADR-0014's method): where its first letter starts, across from the text's own start, and its
 * baseline, down from the top of what holds it, both in points; the size it is set at, in points; the
 * face, weight and posture it is drawn in; and its colour.
 */
export interface Measured {
  readonly token: string;
  /** Points across from where the measure starts. */
  readonly x: number;
  /** Points down to its baseline: from the canvas's top in the editor, from the page's in the PDF. */
  readonly baseline: number;
  /** The PDF's page, from 1; the editor has one, 1. */
  readonly page: number;
  readonly size: number;
  /** The family, as the font files name it: `Liberation Serif`. */
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
  /** `#rrggbb`. */
  readonly colour: string;
  /** Whether it is drawn underlined. */
  readonly underline: boolean;
  /** The colour behind it: a fill, or where there is none the paper, as `#rrggbb`. */
  readonly background: string;
  /** Where the line it stands in starts and ends, in points across from where the measure starts. */
  readonly line: readonly [number, number];
}

/** `LiberationSerif-BoldItalic` as its family, weight and posture. */
function faceOf(face: string): { family: string; bold: boolean; italic: boolean } {
  const [name = '', style = ''] = face.split('-');
  return {
    family: name.replace(/([a-z])([A-Z])/g, '$1 $2'),
    bold: /Bold/.test(style),
    italic: /Italic|Oblique/.test(style),
  };
}

/**
 * Each token as the PDF paints it (step 5): the last time it is painted outside an artifact - after the
 * contents and the lists, which repeat a heading's or a caption's words, and never a running head -
 * its start across from the page's left margin `margin`, its baseline down from the page's top, and
 * its size, face and fill.
 */
export function measurePdf(
  paint: Paint,
  tokens: readonly string[],
  margin: number,
): Map<string, Measured> {
  const measured = new Map<string, Measured>();
  const runs = paint.texts.filter((run: PaintedText) => !run.artifact);
  for (const token of tokens) {
    for (let index = runs.length - 1; index >= 0; index -= 1) {
      const run = runs[index]!;
      const match = [...run.text.matchAll(/\S+/g)].find((word) => word[0] === token);
      if (!match) continue;
      const height = paint.pages[run.page - 1]!.height;
      const x = run.x + (run.offsets[match.index] ?? 0);
      const onLine = runs.filter(
        (each) => each.page === run.page && Math.abs(each.y - run.y) < 0.25 && each.width > 0,
      );
      // An underline is a rule drawn just beneath the baseline across the run, stroked or a thin
      // filled rectangle, which the reader reads as a rule - but for a strip of a fill's own colour,
      // which Word paints about a cell's margins and is the fill's.
      const beneath = (box: readonly number[]) =>
        box[1]! < run.y && box[3]! > run.y - run.size * 0.3 && box[0]! <= x + 1 && box[2]! >= x + 1;
      const underline = paint.strokes.some(
        (stroke) =>
          stroke.page === run.page && beneath(stroke.box) && stroke.box[3]! - stroke.box[1]! < 3,
      );
      // The smallest fill behind the token's first letter, taller than a rule.
      const fills = paint.fills
        .filter(
          (fill) =>
            fill.page === run.page &&
            fill.box[0] <= x + 0.5 &&
            fill.box[2] >= x + 0.5 &&
            fill.box[1] <= run.y + 1 &&
            fill.box[3] >= run.y + 1 &&
            fill.box[3] - fill.box[1] > 3,
        )
        .sort(
          (a, b) =>
            (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]) -
            (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]),
        );
      measured.set(token, {
        token,
        x: x - margin,
        baseline: height - run.y,
        page: run.page,
        size: run.size,
        ...faceOf(run.face),
        colour: run.fill,
        underline,
        background: fills[0]?.fill ?? 'none',
        line: [
          Math.min(...onLine.map((each) => each.x)) - margin,
          Math.max(...onLine.map((each) => each.x + each.width)) - margin,
        ],
      });
      break;
    }
  }
  return measured;
}

/** An image as it is drawn: where it starts across the measure, its foot and its size, in points. */
export interface MeasuredImage {
  readonly x: number;
  /** Down to its foot: from the canvas's top in the editor, from the page's in the PDF. */
  readonly foot: number;
  readonly page: number;
  readonly width: number;
  readonly height: number;
}

/** Every image the PDF paints, in the order it paints them, across from the left margin `margin`. */
export function pdfImages(paint: Paint, margin: number): MeasuredImage[] {
  return paint.images.map((image) => ({
    x: image.box[0] - margin,
    foot: paint.pages[image.page - 1]!.height - image.box[1],
    page: image.page,
    width: image.box[2] - image.box[0],
    height: image.box[3] - image.box[1],
  }));
}

/**
 * A rule on one edge of a cell: where the edge runs - for the top and the bottom, how far above or
 * below the cell's token's baseline; for the left and the right, how far across from where the measure
 * starts - how thick the rule is drawn, and its colour; `none` and nought thick where there is none.
 */
export interface MeasuredRule {
  readonly at: number;
  readonly width: number;
  readonly colour: string;
}

export type Edge = 'top' | 'bottom' | 'left' | 'right';
export const EDGES: readonly Edge[] = ['top', 'bottom', 'left', 'right'];
export type MeasuredRules = Readonly<Record<Edge, MeasuredRule>>;

/**
 * The rules the PDF strokes about each cell holding one of `tokens`: along each edge, the stroke
 * running past the token that lies within a point and a half of where the editor's edge is - the same
 * distance from the baseline, the same distance across the measure - measured as the editor's are.
 */
export function pdfRules(
  paint: Paint,
  tokens: readonly string[],
  measured: ReadonlyMap<string, Measured>,
  editor: ReadonlyMap<string, MeasuredRules>,
  margin: number,
): Map<string, MeasuredRules> {
  const rules = new Map<string, MeasuredRules>();
  for (const token of tokens) {
    const at = measured.get(token);
    const near = editor.get(token);
    if (!at || !near) continue;
    const y = paint.pages[at.page - 1]!.height - at.baseline;
    const x = at.x + margin;
    const strokes = paint.strokes.filter((each) => each.page === at.page);
    const along = (edge: Edge, want: number): MeasuredRule => {
      const across = edge === 'top' || edge === 'bottom';
      const found = strokes
        .filter((each) =>
          across
            ? each.box[2] - each.box[0] > each.box[3] - each.box[1] &&
              each.box[0] <= x + 1 &&
              each.box[2] >= x + 1
            : each.box[3] - each.box[1] > each.box[2] - each.box[0] &&
              each.box[1] <= y &&
              each.box[3] >= y,
        )
        .map((each) => ({
          each,
          centre: across ? (each.box[1] + each.box[3]) / 2 : (each.box[0] + each.box[2]) / 2,
        }))
        .filter(({ centre }) => Math.abs(centre - want) <= 1.5)
        .sort((a, b) => Math.abs(a.centre - want) - Math.abs(b.centre - want))[0];
      const distance = (centre: number) =>
        edge === 'top' ? centre - y : edge === 'bottom' ? y - centre : centre - margin;
      return found
        ? { at: distance(found.centre), width: found.each.width, colour: found.each.stroke }
        : { at: near[edge].at, width: 0, colour: 'none' };
    };
    rules.set(token, {
      top: along('top', y + near.top.at),
      bottom: along('bottom', y - near.bottom.at),
      left: along('left', margin + near.left.at),
      right: along('right', margin + near.right.at),
    });
  }
  return rules;
}

/**
 * The face an equation is drawn in, as the family the font files name: the first run on the line of
 * `token` after it that is in another face than the token's - the equation beside it.
 */
export function pdfMathsFace(paint: Paint, token: Measured, margin: number): string | undefined {
  const height = paint.pages[token.page - 1]!.height;
  const y = height - token.baseline;
  const run = paint.texts
    .filter(
      (each) =>
        !each.artifact &&
        each.page === token.page &&
        Math.abs(each.y - y) < 3 &&
        each.x > token.x + margin + 1 &&
        faceOf(each.face).family !== token.family,
    )
    .sort((a, b) => a.x - b.x)[0];
  return run && faceOf(run.face).family;
}

/**
 * A list item's marker - its bullet or number - as it is drawn: where it ends, across from where the
 * measure starts, and its face, weight, posture, size and colour, which the list's place's style sets.
 */
export interface MeasuredMarker {
  readonly end: number;
  readonly size: number;
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly colour: string;
}

/** Each list token's marker in the PDF: the run on its line nearest before it, which ends before it. */
export function pdfMarkers(
  paint: Paint,
  tokens: readonly string[],
  measured: ReadonlyMap<string, Measured>,
  margin: number,
): Map<string, MeasuredMarker> {
  const markers = new Map<string, MeasuredMarker>();
  for (const token of tokens) {
    const at = measured.get(token);
    if (!at) continue;
    const y = paint.pages[at.page - 1]!.height - at.baseline;
    const run = paint.texts
      .filter(
        (each) =>
          !each.artifact &&
          each.page === at.page &&
          Math.abs(each.y - y) < 0.5 &&
          each.x + each.width <= at.x + margin + 0.01 &&
          each.text.trim() !== '',
      )
      .sort((a, b) => b.x - a.x)[0];
    if (!run) continue;
    markers.set(token, {
      end: run.x + run.width - margin,
      size: run.size,
      ...faceOf(run.face),
      colour: run.fill,
    });
  }
  return markers;
}

/** How near a strip in a fill's own colour lies to that fill to be part of it, as the reader reads. */
const NEAR = 1.5;

/**
 * **Each image of the fixture, found beside its words** (the W15 plan, W15-G) rather than by the order
 * it is painted in, which a floated figure changes: an image in a line on its token's line, after it,
 * its foot within the token's size of the baseline; a figure the image on its caption's page nearest
 * its caption on the side its image style, `side`, sets the caption. In `IMAGES`' order, `undefined`
 * where one is not found.
 */
export function pdfImagesBeside(
  paint: Paint,
  measured: ReadonlyMap<string, Measured>,
  margin: number,
  side: (style: string) => 'above' | 'below',
): (MeasuredImage | undefined)[] {
  const all = paint.images.map((image, index) => {
    const height = paint.pages[image.page - 1]!.height;
    return {
      index,
      image: {
        x: image.box[0] - margin,
        foot: height - image.box[1],
        page: image.page,
        width: image.box[2] - image.box[0],
        height: image.box[3] - image.box[1],
      },
      top: height - image.box[3],
    };
  });
  const taken = new Set<number>();
  const take = (found: (typeof all)[number] | undefined) => {
    if (found) taken.add(found.index);
    return found?.image;
  };
  const inLine = IMAGES.map((name) => {
    const at = name.line === undefined ? undefined : measured.get(name.line);
    if (!at) return undefined;
    return take(
      all
        .filter(
          (each) =>
            !taken.has(each.index) &&
            each.image.page === at.page &&
            each.image.x > at.x &&
            Math.abs(each.image.foot - at.baseline) < at.size,
        )
        .sort((a, b) => a.image.x - b.image.x)[0],
    );
  });
  return IMAGES.map((name, index) => {
    if (name.line !== undefined) return inLine[index];
    const figure = FIGURES[name.what];
    const at = figure === undefined ? undefined : measured.get(figure.caption);
    if (!figure || !at) return undefined;
    // A caption below its image stands below the image's foot; one above it, above the image's top.
    const below = side(figure.style) === 'below';
    const apart = (each: (typeof all)[number]) =>
      below ? at.baseline - each.image.foot : each.top - at.baseline;
    return take(
      all
        .filter((each) => !taken.has(each.index) && each.image.page === at.page && apart(each) > 0)
        .sort((a, b) => apart(a) - apart(b))[0],
    );
  });
}

/**
 * **The rules about each cell holding one of `tokens`, read from the PDF alone** (the W15 plan, W15-G),
 * where no editor says where its edges are: along each edge the rule nearest the cell's words beyond
 * them - above the baseline, below it, before the token's start, after its end - and nearer than the
 * next line of text above or below it, or the next words along its line; none where there is none.
 * Measured as `pdfRules` measures: the top and the bottom from the baseline, the sides across the
 * measure.
 */
export function pdfCellRules(
  paint: Paint,
  tokens: readonly string[],
  measured: ReadonlyMap<string, Measured>,
  margin: number,
): Map<string, MeasuredRules> {
  const rules = new Map<string, MeasuredRules>();
  const texts = paint.texts.filter((each) => !each.artifact && each.text.trim() !== '');
  for (const token of tokens) {
    const at = measured.get(token);
    if (!at) continue;
    const size = paint.pages[at.page - 1]!;
    const y = size.height - at.baseline;
    const x = at.x + margin;
    const onPage = texts.filter((each) => each.page === at.page);
    const own = onPage.find((each) => Math.abs(each.y - y) < 0.25 && Math.abs(each.x - x) < 0.5);
    const end = own ? own.x + own.width : x;
    const onLine = onPage.filter((each) => Math.abs(each.y - y) < 1);
    const above = Math.min(
      size.height,
      ...onPage.filter((each) => each.y > y + 1).map((each) => each.y),
    );
    const below = Math.max(0, ...onPage.filter((each) => each.y < y - 1).map((each) => each.y));
    const before = Math.max(
      0,
      ...onLine.filter((each) => each.x + each.width < x - 0.5).map((each) => each.x + each.width),
    );
    const after = Math.min(
      size.width,
      ...onLine.filter((each) => each.x > end + 0.5).map((each) => each.x),
    );
    const strokes = paint.strokes.filter((each) => each.page === at.page);
    const along = (edge: Edge): MeasuredRule => {
      const across = edge === 'top' || edge === 'bottom';
      // Nearest first: up from the baseline, down from it, back from the start, on from the end.
      const [from, to, way] =
        edge === 'top'
          ? [y, above, 1]
          : edge === 'bottom'
            ? [y - 0.5, below, -1]
            : edge === 'left'
              ? [x, before, -1]
              : [end, after, 1];
      const found = strokes
        .filter((each) =>
          across
            ? each.box[2] - each.box[0] > each.box[3] - each.box[1] &&
              each.box[0] <= x + 1 &&
              each.box[2] >= x + 1
            : each.box[3] - each.box[1] > each.box[2] - each.box[0] &&
              each.box[1] <= y &&
              each.box[3] >= y,
        )
        .map((each) => ({
          each,
          centre: across ? (each.box[1] + each.box[3]) / 2 : (each.box[0] + each.box[2]) / 2,
        }))
        .filter(({ centre }) => (centre - from) * way > 0 && (to - centre) * way > 0)
        .sort((a, b) => (a.centre - b.centre) * way)[0];
      if (!found) return { at: 0, width: 0, colour: 'none' };
      const distance =
        edge === 'top'
          ? found.centre - y
          : edge === 'bottom'
            ? y - found.centre
            : found.centre - margin;
      return { at: distance, width: found.each.width, colour: found.each.stroke };
    };
    rules.set(token, {
      top: along('top'),
      bottom: along('bottom'),
      left: along('left'),
      right: along('right'),
    });
  }
  return rules;
}

/**
 * **A fill's edges against the words it stands behind** (the W15 plan, W15-G): its left and right
 * across from where the measure starts, and how far its top stands above the baseline and its foot
 * below it, in points - so a block's padding, and where its fill starts and ends.
 */
export interface MeasuredFill {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * The fill behind each token, where one stands there other than the paper: the largest fill of the
 * colour `measurePdf` read behind it that holds its first letter, with every strip of that colour no
 * thicker than a rule lying along its edges - Word paints a cell's fill in pieces about its margins, and
 * a panel's border in its fill's colour - but never a fill covering the page, which is the paper; and
 * as far as it shows, where a rule painted along an edge covers it.
 */
export function pdfFills(
  paint: Paint,
  tokens: readonly string[],
  measured: ReadonlyMap<string, Measured>,
  margin: number,
): Map<string, MeasuredFill> {
  const fills = new Map<string, MeasuredFill>();
  const touches = (a: Box, b: Box) =>
    a[0] <= b[2] + NEAR && b[0] <= a[2] + NEAR && a[1] <= b[3] + NEAR && b[1] <= a[3] + NEAR;
  const area = (box: Box) => (box[2] - box[0]) * (box[3] - box[1]);
  for (const token of tokens) {
    const at = measured.get(token);
    if (!at) continue;
    const size = paint.pages[at.page - 1]!;
    const y = size.height - at.baseline;
    const x = at.x + margin;
    const ofColour = paint.fills.filter(
      (fill) =>
        fill.page === at.page &&
        fill.fill === at.background &&
        !(
          fill.box[2] - fill.box[0] >= size.width - 1 &&
          fill.box[3] - fill.box[1] >= size.height - 1
        ),
    );
    const block = ofColour
      .filter(
        (fill) =>
          fill.box[0] <= x + 0.5 &&
          fill.box[2] >= x + 0.5 &&
          fill.box[1] <= y + 1 &&
          fill.box[3] >= y + 1 &&
          fill.box[3] - fill.box[1] > 3,
      )
      .sort((a, b) => area(b.box) - area(a.box))[0];
    if (!block) continue;
    // A strip along the block's own edge, not one running on past it along the next cell of a row.
    const [x0, y0, x1, y1] = block.box;
    const strips = ofColour.filter((fill) => {
      const [a, b, c, d] = fill.box;
      if (Math.min(c - a, d - b) > 3 || !touches(fill.box, block.box)) return false;
      return c - a > d - b ? a >= x0 - 3 && c <= x1 + 3 : b >= y0 - 3 && d <= y1 + 3;
    });
    const boxes = [block.box, ...strips.map((each) => each.box)];
    let [left, bottom, right, top] = [
      Math.min(...boxes.map((box) => box[0])),
      Math.min(...boxes.map((box) => box[1])),
      Math.max(...boxes.map((box) => box[2])),
      Math.max(...boxes.map((box) => box[3])),
    ];
    // As far as it shows: a rule painted along an edge covers the fill to the rule's inner side - a
    // stroked line half its width either side of its path, a rule Word paints as a filled rectangle
    // the rectangle.
    for (const rule of paint.strokes.filter((each) => each.page === at.page)) {
      const [a, b, c, d] = rule.box;
      const down = d - b > c - a;
      // Across its run, a stroked line's path is thinner than the line it paints.
      const half = Math.min(c - a, d - b) >= rule.width - 0.01 ? 0 : rule.width / 2;
      const [ra, rb, rc, rd] = down ? [a - half, b, c + half, d] : [a, b - half, c, d + half];
      const alongY = rb < top - 1 && rd > bottom + 1;
      const alongX = ra < right - 1 && rc > left + 1;
      if (down && alongY && ra <= left && rc > left && rc < right) left = rc;
      if (down && alongY && rc >= right && ra < right && ra > left) right = ra;
      if (!down && alongX && rd >= top && rb < top && rb > bottom) top = rb;
      if (!down && alongX && rb <= bottom && rd > bottom && rd < top) bottom = rd;
    }
    fills.set(token, {
      left: left - margin,
      right: right - margin,
      top: top - y,
      bottom: y - bottom,
    });
  }
  return fills;
}
