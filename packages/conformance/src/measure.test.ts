import { readFileSync } from 'node:fs';

import { DEFAULT_CATALOGUES } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { compareFills } from './compare.js';
import {
  measurePdf,
  pdfCellRules,
  pdfFills,
  pdfImages,
  pdfImagesBeside,
  type MeasuredFill,
} from './measure.js';
import { readPaint, type Box, type Paint, type PaintedText } from './pdf.js';
import { COMPONENT_TITLE, HEADINGS, IMAGES, styledContent, type Token } from './styled.js';

/**
 * **What Word's measurement asks of a PDF that the editor's does not** (the W15 plan, W15-G): each image
 * found beside the words it stands by rather than by the order it is painted in, since a floated
 * figure is painted where its page puts it; the rules about a cell found in the PDF alone, with no
 * editor to say where to look; and a fill's edges against its text - its padding. Over the pinned
 * engine's own PDF of the measured fixture, and over paint written here as Word paints it.
 */
const MARGIN = 72;
const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const { tokens } = styledContent('00000000-0000-4000-8000-00000000f001');
const every: Token[] = [...HEADINGS, COMPONENT_TITLE, ...tokens];

/** A page of paint, 600 by 800, written as a PDF reader would read one. */
function page(
  texts: readonly Pick<PaintedText, 'text' | 'x' | 'y' | 'width'>[],
  fills: readonly { fill: string; box: Box }[] = [],
  strokes: readonly { stroke: string; box: Box; width: number }[] = [],
  images: readonly Box[] = [],
): Paint {
  return {
    pages: [{ width: 600, height: 800 }],
    texts: texts.map((each) => ({
      page: 1,
      face: 'LiberationSerif',
      size: 11,
      fill: '#000000',
      offsets: [...each.text].map((_, index) => index * 5),
      artifact: false,
      ...each,
    })),
    fills: fills.map((each) => ({ page: 1, ...each })),
    strokes: strokes.map((each) => ({ page: 1, ...each })),
    images: images.map((box) => ({ page: 1, box })),
  };
}

describe("the images, found beside their words (the W15 plan, W15-G's floated figure)", () => {
  it("finds each of the pinned engine's images where its order would, since it floats none", async () => {
    const paint = await readPaint(read('measured-typst.pdf'));
    const measured = measurePdf(
      paint,
      every.map((each) => each.text),
      MARGIN,
    );
    const side = (style: string) => {
      const found = DEFAULT_CATALOGUES.image.styles.find((each) => each.id === style)!;
      return found.placement === 'inline' ? 'below' : found.caption;
    };
    const beside = pdfImagesBeside(paint, measured, MARGIN, side);
    expect(beside).toHaveLength(IMAGES.length);
    expect(beside).toEqual(pdfImages(paint, MARGIN));
  });

  it("finds a figure painted before the text above it by its caption, and an image in a line by its line's words", () => {
    // The second figure floated to the head of the page, painted first, its caption below it; the
    // first figure below its caption; the images in a line beside Zi1 and Zi2.
    const paint = page(
      [
        { text: 'Zg2 figure', x: 72, y: 700, width: 40 },
        { text: 'Zg1 figure', x: 72, y: 500, width: 40 },
        { text: 'Zi1 ', x: 72, y: 300, width: 15 },
        { text: 'Zi2 ', x: 72, y: 250, width: 15 },
      ],
      [],
      [],
      [
        [72, 710, 172, 780],
        [72, 420, 272, 490],
        [90, 298, 102, 309],
        [90, 248, 104, 262],
      ],
    );
    const measured = measurePdf(paint, ['Zg1', 'Zg2', 'Zi1', 'Zi2'], MARGIN);
    const beside = pdfImagesBeside(paint, measured, MARGIN, (style) =>
      style === 'figure' ? 'above' : 'below',
    );
    expect(beside.map((each) => each && [each.x, each.width])).toEqual([
      [0, 200],
      [0, 100],
      [18, 12],
      [18, 14],
    ]);
  });
});

describe('the rules about a cell, read from the PDF alone', () => {
  it("finds the nearest rule beyond the cell's words on each side, and none where the next rule stands past the next line", () => {
    // Two rows of two cells: a rule above the first row, one between the columns, and one under the
    // table; nothing between the rows.
    const paint = page(
      [
        { text: 'Zc1', x: 80, y: 700, width: 15 },
        { text: 'Zc2', x: 280, y: 700, width: 15 },
        { text: 'Zc3', x: 80, y: 680, width: 15 },
        { text: 'Zc4', x: 280, y: 680, width: 15 },
      ],
      [],
      [
        { stroke: '#000000', box: [72, 712, 472, 712], width: 1 },
        { stroke: '#808080', box: [272, 670, 272, 712], width: 0.5 },
        { stroke: '#000000', box: [72, 670, 472, 670], width: 1 },
      ],
    );
    const measured = measurePdf(paint, ['Zc1', 'Zc2', 'Zc3', 'Zc4'], MARGIN);
    const rules = pdfCellRules(paint, ['Zc1', 'Zc3', 'Zc4'], measured, MARGIN);
    expect(rules.get('Zc1')).toEqual({
      top: { at: 12, width: 1, colour: '#000000' },
      bottom: { at: 0, width: 0, colour: 'none' },
      left: { at: 0, width: 0, colour: 'none' },
      right: { at: 200, width: 0.5, colour: '#808080' },
    });
    expect(rules.get('Zc3')!.top).toEqual({ at: 0, width: 0, colour: 'none' });
    expect(rules.get('Zc3')!.bottom).toEqual({ at: 10, width: 1, colour: '#000000' });
    expect(rules.get('Zc4')!.left).toEqual({ at: 200, width: 0.5, colour: '#808080' });
  });
});

describe("a fill's edges against its text, its padding", () => {
  it('reads the largest fill of the colour behind the words, with the strips of that colour against it, and nothing for the paper', () => {
    const paint = page(
      [
        { text: 'Zf1 kept', x: 80, y: 700, width: 30 },
        { text: 'Zp01 body', x: 72, y: 650, width: 30 },
      ],
      [
        { fill: '#ffffff', box: [0, 0, 600, 800] },
        // The block, a smaller fill of its colour inside it, and a border's strip above it.
        { fill: '#f0f0f0', box: [72, 694, 472, 712] },
        { fill: '#f0f0f0', box: [76, 696, 468, 710] },
        { fill: '#f0f0f0', box: [72, 712, 472, 712.48] },
      ],
    );
    const measured = measurePdf(paint, ['Zf1', 'Zp01'], MARGIN);
    const fills = pdfFills(paint, ['Zf1', 'Zp01'], measured, MARGIN);
    const fill = fills.get('Zf1')!;
    expect([fill.left, fill.right, fill.top, fill.bottom].map((each) => each.toFixed(2))).toEqual([
      '0.00',
      '400.00',
      '12.48',
      '6.00',
    ]);
    expect(fills.has('Zp01')).toBe(false);
  });

  it("takes no strip that runs past the fill's own edges, as the one along the next cell of a row does", () => {
    // Two header cells filled alike, as Word paints them: each cell's block and a strip along each
    // one's top margin, the first cell's strip meeting the second's block at the line between them.
    const paint = page(
      [{ text: 'Zt22', x: 300, y: 700, width: 20 }],
      [
        { fill: '#d9d9d9', box: [72.98, 690, 297.67, 711] },
        { fill: '#d9d9d9', box: [72.98, 709.32, 297.67, 711] },
        { fill: '#d9d9d9', box: [297.67, 690, 522.36, 711] },
        { fill: '#d9d9d9', box: [298.63, 709.32, 522.48, 711] },
      ],
    );
    const measured = measurePdf(paint, ['Zt22'], MARGIN);
    const fill = pdfFills(paint, ['Zt22'], measured, MARGIN).get('Zt22')!;
    expect([fill.left, fill.right].map((each) => each.toFixed(2))).toEqual(['225.67', '450.48']);
  });

  it('reads a fill as far as it shows: a rule painted along an edge of it covers it to the rule\'s inner side', () => {
    // A cell under a 1pt rule stroked along each edge, the PDF's way, centred on the cell's edges;
    // and one under rules Word paints as filled rectangles inside its edges.
    const pdf = page(
      [{ text: 'Zt21', x: 100, y: 700, width: 20 }],
      [{ fill: '#d9d9d9', box: [72, 690, 272, 711] }],
      [
        { stroke: '#000000', box: [72, 690, 72, 711], width: 1 },
        { stroke: '#000000', box: [72, 711, 272, 711], width: 1 },
      ],
    );
    const word = page(
      [{ text: 'Zt21', x: 100, y: 700, width: 20 }],
      [{ fill: '#d9d9d9', box: [72.98, 690, 272, 710.04] }],
      [
        { stroke: '#000000', box: [72.02, 690, 72.98, 711], width: 0.96 },
        { stroke: '#000000', box: [72.02, 710.04, 272, 711], width: 0.96 },
      ],
    );
    const edges = (paint: Paint) => {
      const fill = pdfFills(paint, ['Zt21'], measurePdf(paint, ['Zt21'], MARGIN), MARGIN).get(
        'Zt21',
      )!;
      return [fill.left, fill.top].map((each) => each.toFixed(2));
    };
    expect(edges(pdf)).toEqual(['0.50', '10.50']);
    expect(edges(word)).toEqual(['0.98', '10.04']);
  });

  it("compares each edge within half a point where both outputs fill behind the words, and a fill one has and the other not - but a footnote's or a caption's, which the PDF does not set (issue #330)", () => {
    const fill = (top: number): MeasuredFill => ({ left: 0, right: 400, top, bottom: 6 });
    const block = (text: string): Token => ({ text, where: 'flow', what: `a block, ${text}` });
    const recorded: string[] = [];
    const found = compareFills(
      [
        block('Za1'),
        block('Za2'),
        block('Za3'),
        { text: 'Zn2', where: 'footnote', what: 'a footnote' },
        { text: 'Zg1', where: 'caption', what: 'a caption' },
      ],
      new Map([
        ['Za1', fill(12.4)],
        ['Za2', fill(14)],
        ['Za3', fill(12)],
        ['Zn2', fill(12)],
        ['Zg1', fill(12)],
      ]),
      new Map([
        ['Za1', fill(12)],
        ['Za2', fill(12)],
      ]),
      (property) => recorded.push(property),
    );
    expect(found).toEqual([
      { token: 'Za2', what: 'a block, Za2', property: 'fill top', editor: 14, pdf: 12 },
      { token: 'Za3', what: 'a block, Za3', property: 'fill found', editor: true, pdf: false },
    ]);
    expect(recorded.filter((each) => each === 'fill top')).toHaveLength(2);
  });
});
