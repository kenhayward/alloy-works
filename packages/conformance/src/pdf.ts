import { inflateSync } from 'node:zlib';

import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * **A publication as its reader's eye meets it**, read by pdf.js: a small copy of `readPaint` in
 * `apps/worker/src/testing/pdf.ts`, the reader the worker's own suite measures a theme's PDF with,
 * since the kit imports nothing from an app's source (the W13 plan's global constraints), moved here
 * from the browser suite so that the editor and Word are both measured against the PDF by one reader
 * (the W15 plan's W15-C). It adds what the worker's has no need of - where each image is painted.
 *
 * **And it reads Word's PDF** (the W15 plan's question 1, answered from Word 16's export of the measured
 * fixture, which is made and read where Word is by the worker's `word-export.test.ts`, and never kept,
 * since it embeds faces the repository may not hold): Word names every face it set from a document's own embedded file
 * `___WRD_EMBED_SUB_<n>`, so a run's face is its embedded program's own PostScript name wherever the
 * file keeps one; Word sets a colour and then paints inside `q` and `Q`, so the colours, the line's
 * width and the text state are graphics state, saved and restored; Word draws a table's rules as filled
 * rectangles, so a thin filled rectangle is a rule too; and Word sets a character spacing on some runs,
 * so each character is moved on by it. None of it moves what the pinned engine's PDF reads as.
 */

/** `[left, bottom, right, top]`, in points from the page's bottom left. */
export type Box = readonly [number, number, number, number];

/**
 * A run of text as it is painted: its page (from 1), its text, the face it is drawn in by the name the
 * file embeds it under with the subset's prefix taken off (`LiberationSerif-Bold`), its size in
 * points, its fill as `#rrggbb`, where its baseline starts, in points from the page's bottom left, and
 * whether it is an artifact - a running head, the notice - which assistive technology skips.
 */
export interface PaintedText {
  readonly page: number;
  readonly text: string;
  readonly face: string;
  readonly size: number;
  readonly fill: string;
  readonly x: number;
  readonly y: number;
  /** Its advance to the end of its last glyph that is not a space. */
  readonly width: number;
  /** How far along the run each character of `text` starts, in points: where a word in it begins. */
  readonly offsets: readonly number[];
  readonly artifact: boolean;
}

/** A filled shape: its page, its colour and its box. */
export interface PaintedFill {
  readonly page: number;
  readonly fill: string;
  readonly box: Box;
}

/**
 * A stroked shape - an underline, a table's rule - its colour, its box and how thick it is drawn; or a
 * rule painted as a filled rectangle no thicker than `THIN`, as Word paints one, its box the rectangle
 * and its width the rectangle's thickness.
 */
export interface PaintedStroke {
  readonly page: number;
  readonly stroke: string;
  readonly box: Box;
  readonly width: number;
}

/** An image painted: its page and the box its unit square is drawn into. */
export interface PaintedImage {
  readonly page: number;
  readonly box: Box;
}

export interface Paint {
  readonly pages: readonly { readonly width: number; readonly height: number }[];
  readonly texts: readonly PaintedText[];
  readonly fills: readonly PaintedFill[];
  readonly strokes: readonly PaintedStroke[];
  readonly images: readonly PaintedImage[];
}

type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const times = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];
const apply = (m: Matrix, x: number, y: number) =>
  [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]] as const;

/** The operators a text object can be moved by that are not followed here, by pdf.js's name. */
const UNFOLLOWED = new Set([
  'moveText',
  'setLeadingMoveText',
  'nextLine',
  'nextLineShowText',
  'nextLineSetSpacingShowText',
]);

/** The thickest a filled rectangle is that is read as a rule as well as a fill: a theme's widest rule. */
const THIN = 3;

/** The two ways pdf.js names painting an image, both followed. */
const IMAGES = new Set(['paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject']);

/** A TrueType program's PostScript name, from its `name` table, or nothing where it keeps none. */
function postScriptName(font: Buffer): string {
  const tables = font.readUInt16BE(4);
  for (let record = 12; record < 12 + tables * 16; record += 16) {
    if (font.toString('latin1', record, record + 4) !== 'name') continue;
    const table = font.readUInt32BE(record + 8);
    const count = font.readUInt16BE(table + 2);
    const strings = table + font.readUInt16BE(table + 4);
    for (let entry = table + 6; entry < table + 6 + count * 12; entry += 12) {
      if (font.readUInt16BE(entry + 6) !== 6) continue;
      const start = strings + font.readUInt16BE(entry + 10);
      const end = start + font.readUInt16BE(entry + 8);
      // A Macintosh name is a byte a character; a Unicode or a Windows one is UTF-16, big-endian.
      return font.readUInt16BE(entry) === 1
        ? font.toString('latin1', start, end)
        : Buffer.from(font.subarray(start, end)).swap16().toString('utf16le');
    }
  }
  return '';
}

/**
 * Each TrueType program the file embeds, by the font name its descriptor gives it (with its subset's
 * tag), with the PostScript name the program keeps - the Word check's `fontPrograms`, which reads it so
 * for the same reason: Word names every face it set from a document's own embedded file
 * `___WRD_EMBED_SUB_<n>`, and the PostScript name is the one Word leaves. A descriptor or a program
 * this cannot reach - compressed into an object stream, or in another encoding - is left out, and its
 * run keeps the name the file gives it.
 */
function embeddedPrograms(bytes: Buffer): Map<string, string> {
  const text = bytes.toString('latin1');
  const objects = new Map<string, { at: number; body: string }>();
  for (const found of text.matchAll(/(\d+) 0 obj([^]*?)endobj/g)) {
    objects.set(found[1]!, { at: found.index, body: found[2]! });
  }
  const programs = new Map<string, string>();
  for (const { body } of objects.values()) {
    if (!body.includes('/FontDescriptor')) continue;
    const name = /\/FontName\s*\/([^\s/>]+)/.exec(body);
    const file = /\/FontFile2\s+(\d+)\s+0\s+R/.exec(body);
    const program = file && objects.get(file[1]!);
    if (!name || !program || !/\/FlateDecode/.test(program.body)) continue;
    const opens = text.indexOf('stream', program.at) + 'stream'.length;
    const from = opens + (text[opens] === '\r' ? 2 : 1);
    try {
      const own = postScriptName(
        inflateSync(bytes.subarray(from, text.indexOf('endstream', from))),
      );
      if (own !== '') programs.set(name[1]!, own);
    } catch {
      // Not a program this can read: its run keeps the name the file gives it.
    }
  }
  return programs;
}

/**
 * The paint of every page, from pdf.js's operator list, the transformation followed through `cm`, `q`
 * and `Q` and each run of text placed by its text matrix, as the worker's `readPaint` reads it: the
 * pinned engine writes every run of text in a text object of its own, placed by one text matrix, and a
 * text object moved any other way is thrown on rather than misread.
 */
export async function readPaint(bytes: Buffer): Promise<Paint> {
  const programs = embeddedPrograms(Buffer.from(bytes));
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 });
  const pdf = await task.promise;
  try {
    const names: Record<number, string> = Object.fromEntries(
      Object.entries(OPS).map(([name, code]) => [code, name]),
    );
    const pages: { width: number; height: number }[] = [];
    const texts: PaintedText[] = [];
    const fills: PaintedFill[] = [];
    const strokes: PaintedStroke[] = [];
    const images: PaintedImage[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const [left, bottom, right, top] = page.view as [number, number, number, number];
      pages.push({ width: right - left, height: top - bottom });
      const list = await page.getOperatorList();
      // The graphics state `q` saves and `Q` restores: the transformation, the line's width, both
      // colours and the text state - the face, its size and the character and word spacing.
      const initial = {
        ctm: IDENTITY,
        lineWidth: 1,
        fill: '#000000',
        stroke: '#000000',
        face: '',
        size: 0,
        charSpacing: 0,
        wordSpacing: 0,
      };
      let state = initial;
      const saved: (typeof initial)[] = [];
      let matrix = IDENTITY;
      const marked: string[] = [];
      list.fnArray.forEach((code, index) => {
        const name = names[code] ?? '';
        const args = list.argsArray[index] as unknown[];
        if (UNFOLLOWED.has(name)) {
          throw new Error(`The content stream moves text by ${name}, which is not followed here`);
        } else if (name === 'beginMarkedContent' || name === 'beginMarkedContentProps') {
          const tag = args[0] as string | { name?: string };
          marked.push(typeof tag === 'string' ? tag : (tag.name ?? ''));
        } else if (name === 'endMarkedContent') {
          marked.pop();
        } else if (name === 'save') {
          saved.push(state);
        } else if (name === 'restore') {
          state = saved.pop() ?? initial;
        } else if (name === 'setLineWidth') {
          state = { ...state, lineWidth: args[0] as number };
        } else if (name === 'transform') {
          state = { ...state, ctm: times(args as unknown as Matrix, state.ctm) };
        } else if (name === 'setCharSpacing') {
          state = { ...state, charSpacing: args[0] as number };
        } else if (name === 'setWordSpacing') {
          state = { ...state, wordSpacing: args[0] as number };
        } else if (name === 'setHScale' && args[0] !== 100) {
          throw new Error(
            `The content stream scales text by ${String(args[0])}%, which is not followed here`,
          );
        } else if (name === 'beginText') {
          matrix = IDENTITY;
        } else if (name === 'setTextMatrix') {
          const m = args[0] as Record<number, number>;
          matrix = [m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!];
        } else if (name === 'setFont') {
          const loaded = page.commonObjs.get(args[0] as string) as { name?: string };
          // Its embedded program's own name where the file keeps one: Word's is `___WRD_EMBED_SUB_<n>`.
          const named = loaded.name ?? '';
          state = {
            ...state,
            face: programs.get(named) ?? named.replace(/^[A-Z]{6}\+/, ''),
            size: args[1] as number,
          };
        } else if (name === 'setFillRGBColor') {
          state = { ...state, fill: args[0] as string };
        } else if (name === 'setStrokeRGBColor') {
          state = { ...state, stroke: args[0] as string };
        } else if (name === 'showText') {
          const { size, charSpacing, wordSpacing } = state;
          let advance = 0;
          let width = 0;
          let text = '';
          const offsets: number[] = [];
          for (const glyph of args[0] as (
            { unicode: string; width: number; isSpace?: boolean } | number
          )[]) {
            if (typeof glyph === 'number') {
              advance -= (glyph * size) / 1000;
            } else {
              for (let each = 0; each < glyph.unicode.length; each += 1) offsets.push(advance);
              advance += (glyph.width * size) / 1000;
              text += glyph.unicode;
              if (glyph.unicode.trim() !== '') width = advance;
              // Each character is moved on by the character spacing, a space by the word spacing too.
              advance += charSpacing + (glyph.isSpace ? wordSpacing : 0);
            }
          }
          const { ctm, face, fill } = state;
          const placed = times(matrix, ctm);
          const [x, y] = apply(placed, 0, 0);
          // The size a run is painted at: the font's size scaled by the text matrix's and the
          // transformation's vertical scale, which the engine writes as one or the other.
          const scale = Math.sqrt(Math.abs(placed[0] * placed[3] - placed[1] * placed[2]));
          const artifact = marked.includes('Artifact');
          texts.push({
            page: number,
            text,
            face,
            size: size * scale,
            fill,
            x,
            y,
            width: width * scale,
            offsets: offsets.map((offset) => offset * scale),
            artifact,
          });
        } else if (name === 'constructPath') {
          const { ctm, fill, stroke, lineWidth } = state;
          const [painting, , extent] = args as [number, unknown, Record<number, number>];
          const [x1, y1] = apply(ctm, extent[0]!, extent[1]!);
          const [x2, y2] = apply(ctm, extent[2]!, extent[3]!);
          const box: Box = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
          const how = names[painting] ?? '';
          if (/^(eoFill|fill|fillStroke|eoFillStroke)$/.test(how)) {
            fills.push({ page: number, fill, box });
            // A rule painted as a filled rectangle, as Word paints a table's: as thick as it is thin.
            const thickness = Math.min(box[2] - box[0], box[3] - box[1]);
            if (thickness > 0 && thickness <= THIN) {
              strokes.push({ page: number, stroke: fill, box, width: thickness });
            }
          }
          if (/^(stroke|closeStroke|fillStroke|eoFillStroke)$/.test(how)) {
            const scale = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]));
            strokes.push({ page: number, stroke, box, width: lineWidth * scale });
          }
        } else if (IMAGES.has(name)) {
          const { ctm } = state;
          const [x1, y1] = apply(ctm, 0, 0);
          const [x2, y2] = apply(ctm, 1, 1);
          images.push({
            page: number,
            box: [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)],
          });
        }
      });
    }
    return { pages, texts, fills, strokes, images };
  } finally {
    // The loading task, not the document: in pdf.js 6 it is the task that owns the worker.
    await task.destroy();
  }
}
