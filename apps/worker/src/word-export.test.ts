import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  COMPONENT_TITLE,
  HEADINGS,
  measurePdf,
  pdfMathsFace,
  readPaint,
  styledContent,
  type Token,
} from '@alloy-works/conformance';
import {
  assemble,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  parseContentDocument,
  parseOutlineDocument,
  publishedImagePath,
  writeDocx,
  type PublishingAsset,
} from '@alloy-works/domain';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';

import { FONT_DIRECTORY, loadPinnedFonts, pinnedFacesByHash } from './fonts.js';
import { PUBLICATION_TEMPLATE, TEMPLATE_READING } from './template.js';
import { defaultTheme } from './testing/theme.js';
import { inWordsTurn } from './testing/word-turn.js';
import { createTypst, typstBinaryPath } from './typst.js';

/**
 * **The Word check's export-only mode** (the W15 plan's W15.1, step 3): `scripts/word-check.ps1
 * -ExportOnly` opens each document in a hidden Word, updates its contents and every field, repaginates,
 * exports Word's own PDF and reports Word's version and build - none of the check's reads, which are
 * slow and assert nothing a measurement needs. Held here over the kit's measured fixture
 * (`@alloy-works/conformance`) under the default theme and layout, written by `writeDocx` from one
 * `assemble` and compiled beside it through the current template, as W15.2's measurement will make
 * both; and the kit's reader reads Word's PDF - every token of the fixture found in it, each face by
 * its embedded program's name, each fill and rule as Word painted it (the W15 plan's question 1).
 *
 * Gated as the Word check is: Windows with Word, `ALLOY_WORD_CHECK=1`, and never in CI. Word's PDF is
 * made here at each run and never kept in the repository: it embeds subsets of Microsoft's faces, which
 * ADR-0010 keeps out. The kit's own tests hold the reader to what it showed in PDFs written to that
 * shape. Both PDFs are left in `alloy-works-word-export` under the system's temporary folder;
 * `measured-typst.pdf` is the one `packages/conformance/src/fixtures/` keeps.
 */
const WORD_CHECK = process.platform === 'win32' && process.env.ALLOY_WORD_CHECK === '1';

const FOLDER = join(tmpdir(), 'alloy-works-word-export');
const SCRIPT = fileURLToPath(new URL('../scripts/word-check.ps1', import.meta.url));
const run = promisify(execFile);

/** The image every figure and image in a line of the fixture shows, as the browser suite uploads it. */
const IMAGE = '00000000-0000-4000-8000-00000000f001';
const COMPONENT = '00000000-0000-4000-8000-00000000f002';
/** An outline node's identifier, base32 letters alone. */
const nodeId = (name: string) => name.padEnd(26, 'f');

/** What `-ExportOnly` reports of each document, and nothing more. */
interface Exported {
  readonly name: string;
  readonly opened: boolean;
  readonly error: string | null;
  readonly version: string;
  readonly build: string;
  readonly pdf: string;
}

/**
 * The fixture's document as the browser suite places it: each heading a section inside the one before,
 * the component in the deepest.
 */
function measuredOutline() {
  const positional = { numbered: true, matter: 'body', pageBreak: 'none', values: {} };
  const reference = {
    type: 'reference',
    id: nodeId('measuredcomponent'),
    component: COMPONENT,
    mode: { kind: 'latest' },
    ...positional,
    children: [],
  };
  const nested = HEADINGS.reduceRight<object>(
    (inner, heading, depth) => ({
      type: 'section',
      id: nodeId(`measuredheading${'abcde'[depth]}`),
      title: [{ type: 'text', value: heading.text, marks: [] }],
      ...positional,
      children: [inner],
    }),
    reference,
  );
  return parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'Measured style, exported',
    language: 'en-GB',
    direction: 'ltr',
    nodes: [nested],
  });
}

describe.runIf(WORD_CHECK)("the Word check's export-only mode, where Word is (W15.1)", () => {
  let exported: Exported[] = [];
  let tokens: Token[] = [];

  beforeAll(async () => {
    await rm(FOLDER, { recursive: true, force: true });
    await mkdir(FOLDER, { recursive: true });
    const fonts = await loadPinnedFonts();
    const faces = await pinnedFacesByHash(FONT_DIRECTORY);
    const typst = createTypst({ binary: typstBinaryPath(), fonts });

    // The browser suite's image: sixty by forty, red.
    const bytes = new Uint8Array(
      await sharp({
        create: { width: 60, height: 40, channels: 3, background: { r: 200, g: 30, b: 30 } },
      })
        .png()
        .toBuffer(),
    );
    const asset: PublishingAsset = {
      object: `t_acme/sha256/${createHash('sha256').update(bytes).digest('hex')}`,
      format: 'png',
      width: 60,
      height: 40,
      alternative: { text: 'A red block', language: 'en-GB' },
    };
    const images = new Map([[publishedImagePath(asset), bytes]]);

    const made = styledContent(IMAGE);
    tokens = [...HEADINGS, COMPONENT_TITLE, ...made.tokens];
    const assembled = assemble({
      formats: ['pdf', 'docx'],
      outline: measuredOutline(),
      refused: [],
      layout: defaultLayout,
      theme: defaultTheme,
      revision: '0.1',
      covers: fonts.covers,
      assets: new Map([[IMAGE, asset]]),
      occurrences: new Map([
        [
          nodeId('measuredcomponent'),
          parseContentDocument({
            schemaVersion: 1,
            title: COMPONENT_TITLE.text,
            language: 'en-GB',
            direction: 'ltr',
            content: made.content,
          }),
        ],
      ]),
    });
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    const docx = writeDocx({
      document: assembled.document,
      numbering: assembled.numbering,
      word: assembled.word!,
      formats: ['pdf', 'docx'],
      faces,
      images,
    });
    await writeFile(join(FOLDER, 'measured.docx'), docx.bytes);
    const pdf = await typst.compile(
      PUBLICATION_TEMPLATE[TEMPLATE_READING[assembled.document.schema]].file,
      JSON.stringify(assembled.document),
      new Date('2026-09-29T00:00:00Z'),
      [...images].map(([path, each]) => ({ path, bytes: each })),
    );
    await writeFile(join(FOLDER, 'measured-typst.pdf'), pdf);

    // In the suite's turn at Word: the Word check and the other Word file start Words of their own.
    await inWordsTurn(() =>
      run(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          SCRIPT,
          '-Folder',
          FOLDER,
          '-ExportOnly',
        ],
        { timeout: 300_000, windowsHide: true },
      ),
    );
    exported = JSON.parse(await readFile(join(FOLDER, 'word.json'), 'utf8')) as Exported[];
    const word = exported.find((each) => each.name === 'measured');
    if (word?.opened) await copyFile(word.pdf, join(FOLDER, 'measured-word.pdf'));
  }, 600_000);

  it("reports each document opened, Word's version and build, and Word's own PDF of it, with none of the check's reads", () => {
    expect(exported).toHaveLength(1);
    const [word] = exported;
    expect(Object.keys(word!).sort()).toEqual(
      ['build', 'error', 'name', 'opened', 'pdf', 'version'].sort(),
    );
    expect(word).toMatchObject({ name: 'measured', opened: true, error: null });
    expect(word!.version).toMatch(/^\d+\.\d+$/);
    expect(word!.build).toMatch(/^\d+(\.\d+)+$/);
    expect(word!.pdf.endsWith('measured.pdf')).toBe(true);
  });

  it("reads Word's PDF of the measured fixture with the kit's reader: every token found, in a face the file names", async () => {
    const paint = await readPaint(await readFile(join(FOLDER, 'measured-word.pdf')));
    const measured = measurePdf(
      paint,
      tokens.map((each) => each.text),
      defaultLayout.formats.docx!.margins.inside,
    );
    const missing = tokens.filter((each) => !measured.has(each.text)).map((each) => each.text);
    expect(missing).toEqual([]);
    const families = new Set([...measured.values()].map((each) => each.family));
    expect([...families].filter((family) => /WRD_EMBED/.test(family))).toEqual([]);
    expect(families).toContain('Liberation Serif');
  });

  it("names the face Word drew each run in by its embedded program's PostScript name, the maths in Cambria Math", async () => {
    const margin = defaultLayout.formats.docx!.margins.inside;
    const paint = await readPaint(await readFile(join(FOLDER, 'measured-word.pdf')));
    expect(paint.texts.filter((each) => /WRD_EMBED/.test(each.face))).toEqual([]);
    const measured = measurePdf(
      paint,
      tokens.map((each) => each.text),
      margin,
    );
    const face = (token: string) => {
      const at = measured.get(token)!;
      return { family: at.family, bold: at.bold, italic: at.italic };
    };
    expect(face('Zh01')).toEqual({ family: 'Liberation Serif', bold: true, italic: false });
    expect(face('Zp01')).toEqual({ family: 'Liberation Serif', bold: false, italic: false });
    expect(face('Zm1')).toEqual({ family: 'Liberation Serif', bold: false, italic: true });
    expect(face('Zf1')).toEqual({ family: 'Liberation Mono', bold: false, italic: false });
    expect(pdfMathsFace(paint, measured.get('Ze1')!, margin)).toBe('Cambria Math');
  });

  it("reads what stands behind each cell's and each panel's words, and each table's rules, as Word painted them", async () => {
    const margin = defaultLayout.formats.docx!.margins.inside;
    const paint = await readPaint(await readFile(join(FOLDER, 'measured-word.pdf')));
    const measured = measurePdf(
      paint,
      tokens.map((each) => each.text),
      margin,
    );
    const behind = (token: string) => measured.get(token)!.background;
    // The banded table's header row and its banded rows, and preformatted text's panel, as the
    // default theme fills them: in every cell and line of each.
    expect([behind('Zt21'), behind('Zt22')]).toEqual(['#d9d9d9', '#d9d9d9']);
    expect([behind('Zt23'), behind('Zt24'), behind('Zt27'), behind('Zt28')]).toEqual([
      '#f2f2f2',
      '#f2f2f2',
      '#f2f2f2',
      '#f2f2f2',
    ]);
    expect([behind('Zf1'), behind('Zf3')]).toEqual(['#f0f0f0', '#f0f0f0']);
    /** The rules on a token's page running down its line to its left, or across its column above. */
    const rules = (token: string, way: 'down' | 'across') => {
      const at = measured.get(token)!;
      const y = paint.pages[at.page - 1]!.height - at.baseline;
      const x = at.x + margin;
      return paint.strokes
        .filter((each) => each.page === at.page)
        .filter((each) =>
          way === 'down'
            ? each.box[3] - each.box[1] > each.box[2] - each.box[0] &&
              each.box[1] <= y &&
              each.box[3] >= y &&
              each.box[2] < x
            : each.box[2] - each.box[0] > each.box[3] - each.box[1] &&
              each.box[0] <= x &&
              each.box[2] >= x &&
              each.box[1] > y,
        )
        .map((each) => ({ colour: each.stroke, width: Math.round(each.width * 2) / 2 }));
    };
    // The first table style rules every edge 1pt black, between its columns too; the banded one its
    // rows 0.5pt grey and nothing between its columns. Word draws each a little thinner, as 0.96 and
    // 0.48, which rounds to the half point here.
    expect(rules('Zt14', 'down')).toEqual([
      { colour: '#000000', width: 1 },
      { colour: '#000000', width: 1 },
    ]);
    expect(rules('Zt26', 'across')).toContainEqual({ colour: '#808080', width: 0.5 });
    expect(rules('Zt24', 'down')).toEqual([{ colour: '#000000', width: 1 }]);
  });
});
