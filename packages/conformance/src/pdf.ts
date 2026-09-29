import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * **A publication as its reader's eye meets it**, read by pdf.js: a small copy of `readPaint` in
 * `apps/worker/src/testing/pdf.ts`, the reader the worker's own suite measures a theme's PDF with,
 * since this suite imports nothing from an app's source (the W13 plan's global constraints). It adds
 * what the worker's has no need of - where each image is painted - and leaves out what this suite has
 * no need of: the faces the file embeds.
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

/** A stroked shape - an underline, a table's rule - its colour, its box and how thick it is drawn. */
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

/** The two ways pdf.js names painting an image, both followed. */
const IMAGES = new Set(['paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject']);

/**
 * The paint of every page, from pdf.js's operator list, the transformation followed through `cm`, `q`
 * and `Q` and each run of text placed by its text matrix, as the worker's `readPaint` reads it: the
 * pinned engine writes every run of text in a text object of its own, placed by one text matrix, and a
 * text object moved any other way is thrown on rather than misread.
 */
export async function readPaint(bytes: Buffer): Promise<Paint> {
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
      let ctm = IDENTITY;
      let lineWidth = 1;
      const saved: { ctm: Matrix; lineWidth: number }[] = [];
      let matrix = IDENTITY;
      let face = '';
      let size = 0;
      let fill = '#000000';
      let stroke = '#000000';
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
          saved.push({ ctm, lineWidth });
        } else if (name === 'restore') {
          ({ ctm, lineWidth } = saved.pop() ?? { ctm: IDENTITY, lineWidth: 1 });
        } else if (name === 'setLineWidth') {
          lineWidth = args[0] as number;
        } else if (name === 'transform') {
          ctm = times(args as unknown as Matrix, ctm);
        } else if (name === 'beginText') {
          matrix = IDENTITY;
        } else if (name === 'setTextMatrix') {
          const m = args[0] as Record<number, number>;
          matrix = [m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!];
        } else if (name === 'setFont') {
          const loaded = page.commonObjs.get(args[0] as string) as { name?: string };
          face = (loaded.name ?? '').replace(/^[A-Z]{6}\+/, '');
          size = args[1] as number;
        } else if (name === 'setFillRGBColor') {
          fill = args[0] as string;
        } else if (name === 'setStrokeRGBColor') {
          stroke = args[0] as string;
        } else if (name === 'showText') {
          let advance = 0;
          let width = 0;
          let text = '';
          const offsets: number[] = [];
          for (const glyph of args[0] as ({ unicode: string; width: number } | number)[]) {
            if (typeof glyph === 'number') {
              advance -= (glyph * size) / 1000;
            } else {
              for (let each = 0; each < glyph.unicode.length; each += 1) offsets.push(advance);
              advance += (glyph.width * size) / 1000;
              text += glyph.unicode;
              if (glyph.unicode.trim() !== '') width = advance;
            }
          }
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
          const [painting, , extent] = args as [number, unknown, Record<number, number>];
          const [x1, y1] = apply(ctm, extent[0]!, extent[1]!);
          const [x2, y2] = apply(ctm, extent[2]!, extent[3]!);
          const box: Box = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
          const how = names[painting] ?? '';
          if (/^(eoFill|fill|fillStroke|eoFillStroke)$/.test(how)) {
            fills.push({ page: number, fill, box });
          }
          if (/^(stroke|closeStroke|fillStroke|eoFillStroke)$/.test(how)) {
            const scale = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]));
            strokes.push({ page: number, stroke, box, width: lineWidth * scale });
          }
        } else if (IMAGES.has(name)) {
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
