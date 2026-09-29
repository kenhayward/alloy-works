import type { Paint, PaintedText } from './pdf.js';

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
      // An underline is a rule drawn just beneath the baseline across the run: filled or stroked.
      const beneath = (box: readonly number[]) =>
        box[1]! < run.y && box[3]! > run.y - run.size * 0.3 && box[0]! <= x + 1 && box[2]! >= x + 1;
      const underline =
        paint.fills.some(
          (fill) => fill.page === run.page && beneath(fill.box) && fill.box[3]! - fill.box[1]! < 3,
        ) ||
        paint.strokes.some(
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
