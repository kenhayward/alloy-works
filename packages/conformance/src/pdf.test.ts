import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { measurePdf, pdfMathsFace } from './measure.js';
import { readPaint, type Paint } from './pdf.js';
import { COMPONENT_TITLE, HEADINGS, styledContent } from './styled.js';

/**
 * **The reader, over the PDF and over what Word's PDF is made of** (the W15 plan's W15.1, question 1).
 * `fixtures/measured-typst.pdf` is the measured fixture under the default theme and layout, compiled
 * through the current template by the pinned Typst, as `apps/worker/src/word-export.test.ts` leaves it.
 * Word's own export of the same document is not kept here: it embeds subsets of faces the repository
 * may not hold (ADR-0010), so it is made where Word is, at test time, and read there. What that export
 * showed the reader must follow - every face it embeds named `___WRD_EMBED_SUB_<n>`, a colour set
 * before a `q` and restored by its `Q`, a table's rules painted as filled rectangles, and a character
 * spacing on some runs - is written below into PDFs of the tests' own, in the Liberation faces the
 * product pins, so CI holds the reader to each.
 */
const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const { tokens } = styledContent('00000000-0000-4000-8000-00000000f001');
const every = [...HEADINGS, COMPONENT_TITLE, ...tokens].map((each) => each.text);
const MARGIN = 72;

describe("the reader, over the PDF's own of the measured fixture", () => {
  it('finds every token of the fixture, outside an artifact', async () => {
    const measured = measurePdf(await readPaint(read('measured-typst.pdf')), every, MARGIN);
    expect(every.filter((token) => !measured.has(token))).toEqual([]);
  });

  it('reads the underline mark as underlined, and nothing else', async () => {
    const measured = measurePdf(await readPaint(read('measured-typst.pdf')), every, MARGIN);
    expect(
      [...measured.values()].filter((each) => each.underline).map((each) => each.token),
    ).toEqual(['Zm3']);
  });

  it('reads its faces as the file names them', async () => {
    const paint = await readPaint(read('measured-typst.pdf'));
    const measured = measurePdf(paint, every, MARGIN);
    expect(measured.get('Zh01')).toMatchObject({ family: 'Liberation Serif', bold: true });
    expect(measured.get('Zm1')).toMatchObject({ family: 'Liberation Serif', italic: true });
    expect(measured.get('Zf1')).toMatchObject({ family: 'Liberation Mono' });
    // Split where its case changes, `STIXTwo Math`: the comparison takes the spaces out of both.
    expect(pdfMathsFace(paint, measured.get('Ze1')!, MARGIN)).toBe('STIXTwo Math');
  });
});

/** A pinned face's file, from `@alloy-works/fonts`. */
const pinned = (file: string) =>
  readFileSync(createRequire(import.meta.url).resolve(`@alloy-works/fonts/files/${file}`));

/** A font the page sets text in: Helvetica, the reader's own standard face, or a file embedded. */
type PageFont =
  | { readonly standard: 'Helvetica' }
  | {
      /** Its name in the file, as Word names one: `BCDEEE+___WRD_EMBED_SUB_45,Bold`. */
      readonly name: string;
      readonly program: Buffer;
      /** Whether the program is compressed, as Word's are; one that is not is left unread. */
      readonly compressed: boolean;
    };

/**
 * A PDF of one page, written here: `content` its content stream, `fonts` its fonts as `/F1`, `/F2` and
 * on, each a standard face or a TrueType program embedded as Word embeds one - a font, its descriptor
 * naming it, and its program as the descriptor's `FontFile2`.
 */
function onePage(
  content: string,
  fonts: readonly PageFont[] = [{ standard: 'Helvetica' }],
): Buffer {
  const objects: Buffer[] = [];
  const add = (made: Buffer | string) => {
    objects.push(typeof made === 'string' ? Buffer.from(made, 'latin1') : made);
    return objects.length;
  };
  const stream = (dictionary: string, bytes: Buffer) =>
    Buffer.concat([
      Buffer.from(`<< ${dictionary} /Length ${bytes.length} >>\nstream\n`, 'latin1'),
      bytes,
      Buffer.from('\nendstream', 'latin1'),
    ]);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  const page = add('');
  const contents = add(stream('', Buffer.from(content, 'latin1')));
  const named = fonts.map((font, index) => {
    if ('standard' in font) {
      return `/F${index + 1} ${add(`<< /Type /Font /Subtype /Type1 /BaseFont /${font.standard} >>`)} 0 R`;
    }
    const program = add(
      font.compressed
        ? stream(`/Filter /FlateDecode /Length1 ${font.program.length}`, deflateSync(font.program))
        : stream(`/Length1 ${font.program.length}`, font.program),
    );
    const descriptor = add(
      `<< /Type /FontDescriptor /FontName /${font.name} /Flags 32 /ItalicAngle 0 /Ascent 891 ` +
        `/Descent -216 /CapHeight 693 /StemV 54 /FontBBox [-544 -216 1344 693] /FontFile2 ${program} 0 R >>`,
    );
    const dictionary = add(
      `<< /Type /Font /Subtype /TrueType /BaseFont /${font.name} /Encoding /WinAnsiEncoding ` +
        `/FontDescriptor ${descriptor} 0 R >>`,
    );
    return `/F${index + 1} ${dictionary} 0 R`;
  });
  objects[page - 1] = Buffer.from(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << ${named.join(' ')} >> >> ` +
      `/Contents ${contents} 0 R >>`,
    'latin1',
  );
  const parts: Buffer[] = [Buffer.from('%PDF-1.7\n', 'latin1')];
  let length = parts[0]!.length;
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(length);
    const part = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, 'latin1'),
      object,
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    parts.push(part);
    length += part.length;
  });
  const trailer =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(Buffer.from(trailer, 'latin1'));
  return Buffer.concat(parts);
}

const run = (paint: Paint, text: string) => paint.texts.find((each) => each.text === text)!;

describe("the reader, over what Word's PDF is made of, in PDFs of its own", () => {
  it("names a face embedded as Word embeds one by its program's own PostScript name, never the name Word gives every subset", async () => {
    const paint = await readPaint(
      onePage(
        [
          'BT /F1 11 Tf 1 0 0 1 72 700 Tm (Zp01 body) Tj ET',
          'BT /F2 11 Tf 1 0 0 1 72 680 Tm (Zh01 heading) Tj ET',
        ].join('\n'),
        [
          {
            name: 'BCDEEE+___WRD_EMBED_SUB_45',
            program: pinned('LiberationSerif-Regular.ttf'),
            compressed: true,
          },
          {
            name: 'BCDFEE+___WRD_EMBED_SUB_45,Bold',
            program: pinned('LiberationSerif-Bold.ttf'),
            compressed: true,
          },
        ],
      ),
    );
    expect(paint.texts.map((each) => each.face)).toEqual([
      'LiberationSerif',
      'LiberationSerif-Bold',
    ]);
    const measured = measurePdf(paint, ['Zp01', 'Zh01'], MARGIN);
    expect(measured.get('Zp01')).toMatchObject({ family: 'Liberation Serif', bold: false });
    expect(measured.get('Zh01')).toMatchObject({ family: 'Liberation Serif', bold: true });
  });

  it('keeps the name the file gives a face whose program it cannot read', async () => {
    const paint = await readPaint(
      onePage('BT /F1 11 Tf 1 0 0 1 72 700 Tm (Zp01 body) Tj ET', [
        {
          name: 'BCDEEE+___WRD_EMBED_SUB_45',
          program: pinned('LiberationSerif-Regular.ttf'),
          compressed: false,
        },
      ]),
    );
    expect(run(paint, 'Zp01 body').face).toBe('___WRD_EMBED_SUB_45');
  });

  it('restores a fill colour with the graphics state, so what stands behind a word is the fill Word painted there', async () => {
    // As Word paints a table's header row: its fill's colour set, the cell filled, the text painted
    // black inside a `q` and a `Q`, and the next cell filled in the colour restored.
    const paint = await readPaint(
      onePage(
        [
          '0.851 0.851 0.851 rg',
          '72 690 200 30 re f',
          'q 0 0 0 rg BT /F1 11 Tf 1 0 0 1 80 700 Tm (Zt21) Tj ET Q',
          '272 690 200 30 re f',
          'q 0 0 0 rg BT /F1 11 Tf 1 0 0 1 280 700 Tm (Zt22) Tj ET Q',
        ].join('\n'),
      ),
    );
    expect(paint.fills.map((each) => each.fill)).toEqual(['#d9d9d9', '#d9d9d9']);
    const measured = measurePdf(paint, ['Zt21', 'Zt22'], MARGIN);
    expect([measured.get('Zt21')!.background, measured.get('Zt22')!.background]).toEqual([
      '#d9d9d9',
      '#d9d9d9',
    ]);
    expect(measured.get('Zt22')!.colour).toBe('#000000');
  });

  it('reads a rule Word paints as a filled rectangle as a rule, as thick as the rectangle is, and a fill as a fill', async () => {
    const paint = await readPaint(
      onePage(
        [
          // A 0.96pt rule across the page, black; a 0.48pt one down it, grey; and a cell's fill.
          '0 0 0 rg 72 700 400 0.96 re f',
          '0.502 0.502 0.502 rg 272 600 0.48 100 re f',
          '0.949 0.949 0.949 rg 72 600 200 20 re f',
        ].join('\n'),
      ),
    );
    expect(
      paint.strokes.map((each) => ({
        stroke: each.stroke,
        width: Math.round(each.width * 100) / 100,
      })),
    ).toEqual([
      { stroke: '#000000', width: 0.96 },
      { stroke: '#808080', width: 0.48 },
    ]);
    expect(paint.fills).toHaveLength(3);
  });

  it("reads a thin strip in a fill's own colour against that fill as part of it, not a rule, as Word paints a cell's fill about its margins and a panel's border in its fill", async () => {
    const paint = await readPaint(
      onePage(
        [
          // A banded cell's fill, a strip of its colour above it where its margin is, and a
          // border in its colour down its side, a point clear of it, as Word leaves a panel's; then
          // a grey rule under it, which is a rule.
          '0.949 0.949 0.949 rg 72 600 200 20 re f',
          '72 620 200 1.2 re f',
          '70.56 600 0.48 21.2 re f',
          '0.502 0.502 0.502 rg 72 599.52 200 0.48 re f',
        ].join('\n'),
      ),
    );
    expect(paint.strokes.map((each) => each.stroke)).toEqual(['#808080']);
    expect(paint.fills).toHaveLength(4);
  });

  it("reads a word underlined by a rule beneath it, never by the strip of a cell's fill Word paints beneath its words", async () => {
    const paint = await readPaint(
      onePage(
        [
          // A cell filled in two pieces, as Word fills one, the lower a strip just beneath the
          // baseline; its word is not underlined. A word beside it is, by a thin rule in its colour.
          '0.851 0.851 0.851 rg 72 702 200 14 re f',
          '72 699.5 200 2.5 re f',
          'q 0 0 0 rg BT /F1 11 Tf 1 0 0 1 80 702 Tm (Zt21) Tj ET Q',
          'q 0 0 0 rg BT /F1 11 Tf 1 0 0 1 300 702 Tm (Zm3) Tj ET 300 700.5 30 0.6 re f Q',
        ].join('\n'),
      ),
    );
    const measured = measurePdf(paint, ['Zt21', 'Zm3'], MARGIN);
    expect(measured.get('Zt21')!.underline).toBe(false);
    expect(measured.get('Zm3')!.underline).toBe(true);
  });

  it('reads a thin rectangle both filled and stroked as one rule, not two', async () => {
    const paint = await readPaint(
      onePage('0 0 0 rg 0 0 0 RG 0.5 w 72 700 400 0.96 re B\n72 650 400 0.96 re b*'),
    );
    expect(paint.strokes).toHaveLength(2);
    expect(paint.fills).toHaveLength(2);
  });

  it('moves each character on by the character spacing the run is set with, as a reader sees it', async () => {
    const plain = await readPaint(onePage('BT /F1 10 Tf 1 0 0 1 72 700 Tm (AB CD) Tj ET'));
    const spaced = await readPaint(onePage('BT /F1 10 Tf 2 Tc 1 0 0 1 72 700 Tm (AB CD) Tj ET'));
    // Five characters, each two points further on than the one before: the word after the space
    // starts six points further along, and the run ends eight further.
    expect(run(spaced, 'AB CD').offsets[3]! - run(plain, 'AB CD').offsets[3]!).toBeCloseTo(6, 5);
    expect(run(spaced, 'AB CD').width - run(plain, 'AB CD').width).toBeCloseTo(8, 5);
  });

  it('restores the character spacing and the colours with the graphics state', async () => {
    const paint = await readPaint(
      onePage(
        [
          '1 0 0 rg',
          'q 0 0 1 rg 3 Tc BT /F1 10 Tf 1 0 0 1 72 700 Tm (AB) Tj ET Q',
          'BT /F1 10 Tf 1 0 0 1 72 680 Tm (AB) Tj ET',
        ].join('\n'),
      ),
    );
    const [inside, after] = paint.texts;
    expect(inside!.fill).toBe('#0000ff');
    expect(after!.fill).toBe('#ff0000');
    expect(after!.width).toBeLessThan(inside!.width);
  });
});
