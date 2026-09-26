import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadPinnedFonts } from '../fonts.js';
import { createTypst, typstBinaryPath } from '../typst.js';
import { readPaint, readPdf, type Paint, type ReadPdf } from './pdf.js';

/**
 * A page whose every mark is known: a tinted paper, a word in red at 20pt, bold, underlined, then a
 * word in the default black at 10pt in the monospace face, a grey panel, a word ending in a space before
 * another in another colour, a justified paragraph, and a running head. Compiled by the pinned
 * engine as the worker compiles, so the reader is held to what that engine writes.
 */
const SOURCE = `
#set document(title: "Paint")
#set text(font: "Liberation Serif", lang: "en", fallback: false)
#set page(width: 200pt, height: 200pt, margin: 20pt, fill: rgb("#fdf6e3"), header: [Head])
#par[#text(size: 20pt, weight: "bold", fill: rgb("#8b0000"), underline[Red]) #text(size: 10pt, font: "Liberation Mono")[mono]]
#block(fill: rgb("#eeeeee"), width: 50pt, height: 10pt)
#line(length: 40pt, stroke: 3pt + rgb("#123456"))
#scale(50%, reflow: true, line(length: 40pt, stroke: 4pt + rgb("#654321")))
#par[#text(fill: rgb("#000080"))[Blue ]#text(fill: rgb("#006400"))[Green]]
#par(justify: true)[Justified words run on across the line and over onto the next one, and the next again.]
`;

describe("the paint of a PDF's pages: its text's faces, sizes and colours, and its fills", () => {
  let paint: Paint;
  let read: ReadPdf;
  let directory: string;

  beforeAll(async () => {
    const fonts = await loadPinnedFonts();
    directory = await mkdtemp(join(tmpdir(), 'aw-paint-'));
    await writeFile(join(directory, 'paint.typ'), SOURCE);
    const typst = createTypst({ binary: typstBinaryPath(), fonts });
    const pdf = await typst.compile(
      join(directory, 'paint.typ'),
      '{}',
      new Date('2026-09-24T00:00:00Z'),
    );
    paint = await readPaint(pdf);
    read = await readPdf(pdf);
  });
  afterAll(() => rm(directory, { recursive: true, force: true }));

  it('reads each run of text with its face, its size, its colour, where its baseline starts and how wide it is', () => {
    const red = paint.texts.find((each) => each.text === 'Red')!;
    expect(red).toMatchObject({ page: 1, face: 'LiberationSerif-Bold', size: 20, fill: '#8b0000' });
    // The first line starts at the margin; its baseline, and its width, are where and what pdf.js's
    // own text extraction says they are.
    const extracted = read.items.find((each) => each.text === 'Red')!;
    expect(red.x).toBeCloseTo(20, 2);
    expect(red.y).toBeCloseTo(extracted.y, 2);
    expect(red.y).toBeLessThan(180);
    expect(red.width).toBeCloseTo(extracted.width, 2);
    const mono = paint.texts.find((each) => each.text === 'mono')!;
    expect(mono).toMatchObject({ face: 'LiberationMono', size: 10, fill: '#000000' });
    expect(mono.width).toBeCloseTo(((4 * 1229) / 2048) * 10, 2);
    expect(mono.y).toBeCloseTo(red.y, 2);
  });

  it('reads the fills - the paper first - and the rules drawn, each in its colour', () => {
    expect(paint.fills[0]).toMatchObject({ page: 1, fill: '#fdf6e3' });
    expect(paint.fills[0]!.box).toEqual([0, 0, 200, 200]);
    const panel = paint.fills.find((each) => each.fill === '#eeeeee')!;
    expect(panel.box[2] - panel.box[0]).toBeCloseTo(50, 2);
    expect(panel.box[3] - panel.box[1]).toBeCloseTo(10, 2);
    // The underline: a rule under the red word, as wide as it, in its colour.
    const red = paint.texts.find((each) => each.text === 'Red')!;
    const [rule] = paint.strokes;
    expect(rule).toMatchObject({ page: 1, stroke: '#8b0000' });
    expect(rule!.box[0]).toBeCloseTo(red.x, 2);
    expect(rule!.box[2] - rule!.box[0]).toBeCloseTo(red.width, 1);
    expect(rule!.box[1]).toBeLessThan(red.y);
  });

  it('reads how thick each rule is drawn, in points on the page however it was scaled to get there', () => {
    // Themes 2: a table style's rules differ in thickness as well as in colour, so a test telling two
    // apart must read both. The underline is drawn as thick as the engine makes it for its face.
    const drawn = (colour: string) => paint.strokes.find((each) => each.stroke === colour)!;
    expect(drawn('#123456').width).toBeCloseTo(3, 3);
    expect(drawn('#123456').box[2] - drawn('#123456').box[0]).toBeCloseTo(40, 2);
    // Drawn 4pt thick inside something scaled to half its size: 2pt on the page.
    expect(drawn('#654321').width).toBeCloseTo(2, 3);
    expect(drawn('#8b0000').width).toBeGreaterThan(0);
  });

  it("reads a run's width as far as its ink goes, a space it ends with left out, and whether it is an artifact", () => {
    const blue = paint.texts.find((each) => each.text === 'Blue ')!;
    const green = paint.texts.find((each) => each.text === 'Green')!;
    // Liberation Serif's space is a quarter of an em: the blue word's ink ends that far before the
    // green word begins.
    expect(blue.width).toBeCloseTo(green.x - blue.x - 11 * 0.25, 2);
    // The running head is an artifact, which a screen reader skips; the page's text is not.
    expect(paint.texts.find((each) => each.text === 'Head')).toMatchObject({ artifact: true });
    expect(green).toMatchObject({ artifact: false });
  });

  it('reads a justified line to the margin, its spaces stretched as the engine stretched them', () => {
    const top = paint.texts.find((one) => one.text.startsWith('Justified'))!.y;
    const [first, second] = paint.texts.filter((each) => !each.artifact && each.y <= top);
    expect(first!.x).toBeCloseTo(20, 2);
    expect(first!.x + first!.width).toBeCloseTo(180, 2);
    expect(second!.x + second!.width).toBeCloseTo(180, 2);
  });

  it('names every face embedded in the file, and only those', () => {
    // The space between the two words is set in the paragraph's own face, the regular.
    expect(paint.embedded).toEqual(['LiberationMono', 'LiberationSerif', 'LiberationSerif-Bold']);
  });
});

describe('the order a reader is given a PDF in', () => {
  let read: ReadPdf;
  let directory: string;

  beforeAll(async () => {
    const fonts = await loadPinnedFonts();
    directory = await mkdtemp(join(tmpdir(), 'aw-order-'));
    await writeFile(
      join(directory, 'order.typ'),
      [
        '#set document(title: "Order")',
        '#set text(font: "Liberation Serif", lang: "en", fallback: false)',
        '= First',
        'Before the table.',
        '#table(columns: 2, table.header[Name][Value], [one], [1], [two], [2])',
        'After the table.',
        '',
      ].join(String.fromCharCode(10)),
    );
    const typst = createTypst({ binary: typstBinaryPath(), fonts });
    const pdf = await typst.compile(
      join(directory, 'order.typ'),
      '{}',
      new Date('2026-09-26T00:00:00Z'),
    );
    read = await readPdf(pdf);
  });
  afterAll(() => rm(directory, { recursive: true, force: true }));

  it('reads every structure element in the order the tree gives it, each with the text it holds', () => {
    const shown = read.reading
      .filter((element) => ['H1', 'P', 'Table', 'TR'].includes(element.role))
      .map((element) => `${element.role}:${element.text}`);
    expect(shown).toEqual([
      'H1:First',
      'P:Before the table.',
      'Table:Name Valueone 1two 2',
      'TR:Name Value',
      'TR:one 1',
      'TR:two 2',
      'P:After the table.',
    ]);
  });
});
