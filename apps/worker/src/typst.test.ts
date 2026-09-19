import { createHash } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONT_DIRECTORY, FontsUnavailable, loadPinnedFonts, PINNED_FONT_FILES } from './fonts.js';
import {
  createTypst,
  SAMPLE_TEMPLATE,
  TypstFailed,
  typstArguments,
  typstBinaryPath,
  TYPST_RELEASE,
} from './typst.js';

const fonts = await loadPinnedFonts();
const typst = createTypst({ binary: typstBinaryPath(), fonts });
const data = JSON.stringify({
  environment: 'Development',
  requestedAt: '2026-09-11T00:00:00.000Z',
});
const at = new Date('2026-09-11T00:00:00.000Z');

/** The families a PDF embeds, as its font dictionaries name them, without the subset prefix. */
const families = (pdf: Buffer) =>
  [
    ...new Set(
      [...pdf.toString('latin1').matchAll(/\/BaseFont\s*\/(?:[A-Z]{6}\+)?([A-Za-z-]+)/g)].map(
        (match) => match[1],
      ),
    ),
  ].sort();

/** The pinned faces copied somewhere a test may break them. */
const copyOfTheFaces = async (prefix: string) => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  await cp(FONT_DIRECTORY, directory, { recursive: true });
  return directory;
};

/**
 * A face renamed "Interloper" wherever its `name` table says "Liberation" - the same length, in both
 * the Macintosh (one byte) and Unicode (two byte) records - so Typst reads it as another family.
 */
const renamed = (face: Buffer) => {
  const copy = Buffer.from(face);
  for (let table = 0; table < copy.readUInt16BE(4); table += 1) {
    const record = 12 + 16 * table;
    if (copy.toString('latin1', record, record + 4) !== 'name') continue;
    const start = copy.readUInt32BE(record + 8);
    const end = start + copy.readUInt32BE(record + 12);
    for (const [from, to] of [
      [Buffer.from('Liberation', 'latin1'), Buffer.from('Interloper', 'latin1')],
      [
        Buffer.from('Liberation', 'utf16le').swap16(),
        Buffer.from('Interloper', 'utf16le').swap16(),
      ],
    ] as const) {
      for (
        let at = copy.indexOf(from, start);
        at !== -1 && at < end;
        at = copy.indexOf(from, at + 1)
      ) {
        to.copy(copy, at);
      }
    }
  }
  return copy;
};

describe('the pinned Typst', () => {
  it('is the version this worker was built against', async () => {
    expect(await typst.version()).toBe(TYPST_RELEASE.version);
  });

  it('renders the sample as a PDF', async () => {
    const pdf = await typst.compile(SAMPLE_TEMPLATE, data, at);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(1000);
    expect(pdf.toString('latin1')).toContain('Development');
  });

  it('treats the data as data, whatever it looks like (ADR-0013)', async () => {
    // As Typst source this would stop the render; as data it is a name with odd punctuation.
    const odd = JSON.stringify({ environment: '#panic("injected") *bold*', requestedAt: 'now' });
    const pdf = await typst.compile(SAMPLE_TEMPLATE, odd, at);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('renders the same bytes for the same input', async () => {
    const once = await typst.compile(SAMPLE_TEMPLATE, data, at);
    const again = await typst.compile(SAMPLE_TEMPLATE, data, at);
    expect(once.equals(again)).toBe(true);
  });

  it('says plainly when the binary is not there', async () => {
    const missing = createTypst({ binary: 'typst-that-is-not-installed', fonts });
    await expect(missing.compile(SAMPLE_TEMPLATE, data, at)).rejects.toThrow(TypstFailed);
  });
});

describe('the pinned fonts (issue #145)', () => {
  it('ships the faces as pinned, with their licence beside them', async () => {
    // Hashed here rather than through `loadPinnedFonts`, so a checkout that rewrote a face's bytes
    // (a line-ending filter, say) fails a test and not only a worker's start.
    for (const pinned of PINNED_FONT_FILES) {
      const bytes = await readFile(join(FONT_DIRECTORY, pinned.file));
      expect(createHash('sha256').update(bytes).digest('hex'), pinned.file).toBe(pinned.sha256);
    }
    const licence = await readFile(join(FONT_DIRECTORY, 'LICENSE-Liberation.txt'), 'latin1');
    expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });

  it('sets every PDF in the pinned faces and in nothing Typst carries itself', async () => {
    const pdf = await typst.compile(SAMPLE_TEMPLATE, data, at);
    expect(families(pdf)).toEqual(['LiberationSerif', 'LiberationSerif-Bold']);
  });

  it('names one font directory, with its own and the system fonts ignored', () => {
    // `compile` passes a directory inside the compile root; the next test shows what it holds.
    const flags = typstArguments('/root', join('/root', 'fonts'), at);
    expect(flags).toContain('--ignore-system-fonts');
    expect(flags).toContain('--ignore-embedded-fonts');
    const path = flags.indexOf('--font-path');
    expect(flags.slice(path, path + 2)).toEqual(['--font-path', join('/root', 'fonts')]);
  });

  it('hands Typst the pinned faces alone, whatever else lies beside them', async () => {
    // Typst loads every face in the directory it is given. A fifth face beside the pinned four - a
    // copy of the Regular renamed "Interloper Serif", and asked for by name - must not reach the PDF.
    const directory = await copyOfTheFaces('aw-planted-fonts-');
    try {
      const loaded = await loadPinnedFonts(directory);
      await writeFile(
        join(directory, 'Interloper.ttf'),
        renamed(await readFile(join(directory, 'LiberationSerif-Regular.ttf'))),
      );
      await writeFile(
        join(directory, 'asks.typ'),
        [
          '#set document(title: "Planted")',
          '#set text(font: "Interloper Serif", lang: "en")',
          'A sentence.',
        ].join('\n'),
      );
      const pdf = await createTypst({ binary: typstBinaryPath(), fonts: loaded }).compile(
        join(directory, 'asks.typ'),
        '{}',
        at,
      );
      expect(families(pdf)).toEqual(['LiberationSerif']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('refuses to start with no fonts, where Typst would print blank pages and exit 0', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'aw-no-fonts-'));
    try {
      await expect(loadPinnedFonts(empty)).rejects.toThrow(FontsUnavailable);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('refuses a face that is not the file pinned', async () => {
    const altered = await copyOfTheFaces('aw-altered-fonts-');
    try {
      const [face] = (await readdir(altered)).filter((name) => name.endsWith('.ttf'));
      await writeFile(join(altered, face!), 'not a font');
      await expect(loadPinnedFonts(altered)).rejects.toThrow(FontsUnavailable);
    } finally {
      await rm(altered, { recursive: true, force: true });
    }
  });

  it('refuses to compile once a face has changed or gone, and returns no PDF', async () => {
    const directory = await copyOfTheFaces('aw-changed-fonts-');
    try {
      const loaded = await loadPinnedFonts(directory);
      const later = createTypst({ binary: typstBinaryPath(), fonts: loaded });
      // Checked before Typst starts: a compile that ran would have answered with a PDF or TypstFailed.
      await writeFile(join(directory, 'LiberationSerif-Bold.ttf'), 'not a font');
      await expect(later.compile(SAMPLE_TEMPLATE, data, at)).rejects.toBeInstanceOf(
        FontsUnavailable,
      );
      await rm(join(directory, 'LiberationSerif-Bold.ttf'));
      await expect(later.compile(SAMPLE_TEMPLATE, data, at)).rejects.toBeInstanceOf(
        FontsUnavailable,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('knows which characters every face can set', () => {
    expect(fonts.covers('A'.codePointAt(0)!)).toBe(true);
    expect(fonts.covers(0x05d0)).toBe(true); // Hebrew alef
    expect(fonts.covers(0x0627)).toBe(false); // Arabic alef
  });
});
