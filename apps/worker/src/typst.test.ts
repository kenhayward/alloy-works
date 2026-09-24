import { createHash } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { FONT_DIRECTORY, FontsUnavailable, loadPinnedFonts, PINNED_FONT_FILES } from './fonts.js';
import { JobRefused } from './refusal.js';
import {
  createTypst,
  SAMPLE_TEMPLATE,
  TypstFailed,
  typstArguments,
  typstBinaryPath,
  typstOutcome,
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

  it('places each image it is handed in the compile root at its path, and no other file', async () => {
    // A template that reads one image, as a publication template reads a figure's.
    const directory = await mkdtemp(join(tmpdir(), 'aw-image-template-'));
    try {
      const template = join(directory, 'main.typ');
      const hash = 'ab'.repeat(32);
      await writeFile(
        template,
        [
          '#set document(title: "Images")',
          '#set text(lang: "en")',
          `#image("assets/${hash}.png", width: 10pt, alt: "A square")`,
        ].join('\n'),
      );
      const square = await sharp({
        create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 30, b: 30 } },
      })
        .png()
        .toBuffer();
      const pdf = await typst.compile(template, '{}', at, [
        { path: `assets/${hash}.png`, bytes: square },
      ]);
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      // Not handed it, the template cannot read it: the root holds nothing it was not given.
      await expect(typst.compile(template, '{}', at)).rejects.toBeInstanceOf(JobRefused);
      // And a path outside the images' own directory is refused before Typst starts.
      for (const path of ['main.typ', '../escape.png', `assets/${hash}.gif`, 'assets/x/y.png']) {
        await expect(
          typst.compile(template, '{}', at, [{ path, bytes: square }]),
          path,
        ).rejects.toThrow(/not an image's place in the root/);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('says plainly when the binary is not there', async () => {
    const missing = createTypst({ binary: 'typst-that-is-not-installed', fonts });
    await expect(missing.compile(SAMPLE_TEMPLATE, data, at)).rejects.toThrow(TypstFailed);
  });

  it('says only how the run ended when the binary will not tell its version', async () => {
    // A handler's `failed` is handed this error as it is `compile`'s, so its cause is stripped the
    // same way: Node's own error names the command line, which names the binary's path.
    const missing = createTypst({ binary: join(tmpdir(), 'aw-no-typst', 'typst'), fonts });
    const failure: unknown = await missing.version().catch((e) => e);
    expect(failure).toBeInstanceOf(TypstFailed);
    const cause = (failure as TypstFailed).cause;
    expect(Object.keys(cause as object).sort()).toEqual(['code', 'killed', 'signal']);
    expect(cause).toMatchObject({ code: 'ENOENT', killed: false });
    expect(JSON.stringify(pino.stdSerializers.err(failure as Error))).not.toContain('aw-no-typst');
  });

  it('refuses, once and for all, a document the engine will not set', async () => {
    // A private-use character no pinned face holds: PDF/UA-1 refuses it every time. (STIX Two Math
    // holds much of the private-use area from U+E000, which the engine would fall back to.)
    const refused = JSON.stringify({ environment: '\u{f8ff}', requestedAt: 'now' });
    const refusal = typst.compile(SAMPLE_TEMPLATE, refused, at);
    await expect(refusal).rejects.toMatchObject({ code: 'typst_refused' });
    await expect(refusal).rejects.toBeInstanceOf(JobRefused);
  });

  it('fails, to be tried again, a compile killed at its time limit', async () => {
    // A timeout might not happen twice, so it is never a refusal, whatever the run had done by then.
    const hurried = createTypst({ binary: typstBinaryPath(), fonts, timeoutMs: 1 });
    const failure = hurried.compile(SAMPLE_TEMPLATE, data, at);
    await expect(failure).rejects.toMatchObject({ code: 'typst_failed', cause: { killed: true } });
    await expect(failure).rejects.not.toBeInstanceOf(JobRefused);
  });

  it('carries no word of what Typst printed, or of the command, into a logged failure', async () => {
    // A handler's `failed` is handed this error, and pino's `err` serializer prints every cause's
    // message: Node's own is "Command failed: <the command>" and then Typst's stderr, which quotes
    // content.
    const hurried = createTypst({ binary: typstBinaryPath(), fonts, timeoutMs: 1 });
    const failure: unknown = await hurried.compile(SAMPLE_TEMPLATE, data, at).catch((e) => e);
    expect(failure).toBeInstanceOf(TypstFailed);
    const logged = JSON.stringify(pino.stdSerializers.err(failure as Error));
    for (const quoted of ['Command failed', 'aw-render-', 'main.typ', 'stderr', 'stdout']) {
      expect(logged).not.toContain(quoted);
    }
  });
});

describe('how a Typst run ended', () => {
  it('is a refusal when Typst exits 1 of its own accord', () => {
    expect(typstOutcome({ code: 1, killed: false, signal: null })).toBe('refused');
  });

  it('is a failure when Typst panics, which exits 101', () => {
    expect(typstOutcome({ code: 101, killed: false, signal: null })).toBe('failed');
  });

  it('is a failure when Typst crashes on Windows, exiting with a status code', () => {
    expect(typstOutcome({ code: 3221225477, killed: false, signal: null })).toBe('failed');
  });

  it('is a failure when Typst is stopped by a signal', () => {
    expect(typstOutcome({ code: null, killed: false, signal: 'SIGSEGV' })).toBe('failed');
  });

  it('is a failure when Typst is killed at its time limit', () => {
    expect(typstOutcome({ code: null, killed: true, signal: 'SIGTERM' })).toBe('failed');
    // Killed as it exited 1 of its own accord: still the time limit's doing.
    expect(typstOutcome({ code: 1, killed: true, signal: 'SIGTERM' })).toBe('failed');
  });

  it('is a failure when Typst could not be started at all', () => {
    expect(typstOutcome({ code: 'ENOENT' })).toBe('failed');
    expect(typstOutcome(new Error('no code'))).toBe('failed');
    expect(typstOutcome(undefined)).toBe('failed');
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
    // STIX Two Math's own licence, from the tag its face was taken from (equations 2, ruling R1).
    const stix = await readFile(join(FONT_DIRECTORY, 'LICENSE-STIX.txt'), 'latin1');
    expect(stix).toContain('The STIX Fonts Project Authors');
    expect(stix).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });

  it('pins STIX Two Math 2.13 b171 as the one maths face', () => {
    // The hash the equations spike measured, of the file at the tag `v2.13b171` in stipub/stixfonts.
    expect(PINNED_FONT_FILES.filter((each) => each.face === 'math')).toEqual([
      {
        file: 'STIXTwoMath-Regular.otf',
        face: 'math',
        sha256: '3a5f3f26f40d5698b3c62dd085d48d6663696a3f80825aab8b553d5097518e8c',
      },
    ]);
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

  it('runs the engine with its accessibility features, which a header column is tagged through', () => {
    // Decision T-E: `pdf.header-cell` exists only behind this flag, and without it template 6 refuses
    // every table with a header column. `tables.test.ts` is the regression case that says what the
    // flag does to the PDF; this says the worker passes it.
    const flags = typstArguments('/root', join('/root', 'fonts'), at);
    const features = flags.indexOf('--features');
    expect(flags.slice(features, features + 2)).toEqual(['--features', 'a11y-extras']);
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
      // Which pinned face Typst falls back to is its own choice (Liberation Mono, since editor 5
      // pinned it); what matters is that the planted one is never it.
      const set = families(pdf);
      expect(set.length).toBeGreaterThan(0);
      for (const family of set) expect(family).toMatch(/^Liberation(Serif|Mono)(-|$)/);
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
      const changed = later.compile(SAMPLE_TEMPLATE, data, at);
      await expect(changed).rejects.toBeInstanceOf(FontsUnavailable);
      // The worker's fault, not the document's: tried again, never finished as a refusal (#146).
      await expect(changed).rejects.not.toBeInstanceOf(JobRefused);
      await rm(join(directory, 'LiberationSerif-Bold.ttf'));
      await expect(later.compile(SAMPLE_TEMPLATE, data, at)).rejects.toBeInstanceOf(
        FontsUnavailable,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('knows which characters every face can set', () => {
    expect(fonts.covers('A'.codePointAt(0)!, 'body')).toBe(true);
    expect(fonts.covers(0x05d0, 'body')).toBe(true); // Hebrew alef
    expect(fonts.covers(0x0627, 'body')).toBe(false); // Arabic alef
  });

  it('knows which characters the monospace faces can set, apart from the body faces', async () => {
    // Liberation Mono is a strict subset of Liberation Serif: sixteen code points fewer, among them
    // U+2016, which a paragraph can carry and preformatted text cannot.
    expect(fonts.covers(0x2016, 'body')).toBe(true);
    expect(fonts.covers(0x2016, 'code')).toBe(false);
    expect(fonts.covers('A'.codePointAt(0)!, 'code')).toBe(true);
    const counted = (face: 'body' | 'code') =>
      Array.from({ length: 0x10000 }, (_, codePoint) => codePoint).filter((codePoint) =>
        fonts.covers(codePoint, face),
      ).length;
    expect(counted('body')).toBe(2321);
    expect(counted('code')).toBe(2305);
  });

  it('knows which characters the maths face can set, apart from the body faces', () => {
    // An identifier's italic is a character of its own, beyond U+FFFF, that the body face has not got;
    // the n-ary sum and the maths angle brackets are the maths face's too. Neither face sets Chinese.
    expect(fonts.covers(0x1d465, 'math')).toBe(true); // mathematical italic x
    expect(fonts.covers(0x1d465, 'body')).toBe(false);
    expect(fonts.covers(0x2211, 'math')).toBe(true);
    expect(fonts.covers(0x27e8, 'math')).toBe(true);
    expect(fonts.covers(0x4e2d, 'math')).toBe(false);
    // What the template draws itself, which no author supplies and so no check asks: the radical,
    // the braces over and under, the primes, and the brace and parentheses of cases and binomials.
    for (const drawn of [0x221a, 0x23de, 0x23df, 0x23b4, 0x23b5, 0x23dc, 0x23dd, 0x2032, 0x2033])
      expect(fonts.covers(drawn, 'math'), drawn.toString(16)).toBe(true);
    for (const drawn of [0x2034, 0x2057, 0x7b, 0x7d, 0x28, 0x29])
      expect(fonts.covers(drawn, 'math'), drawn.toString(16)).toBe(true);
    const counted = Array.from({ length: 0x110000 }, (_, codePoint) => codePoint).filter(
      (codePoint) => fonts.covers(codePoint, 'math'),
    ).length;
    expect(counted).toBe(4605);
  });

  it('refuses to start when the maths face is missing, as it does for a serif one', async () => {
    const directory = await copyOfTheFaces('aw-missing-math-');
    try {
      await rm(join(directory, 'STIXTwoMath-Regular.otf'));
      await expect(loadPinnedFonts(directory)).rejects.toBeInstanceOf(FontsUnavailable);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('refuses to start when a monospace face is missing, as it does for a serif one', async () => {
    const directory = await copyOfTheFaces('aw-missing-mono-');
    try {
      await rm(join(directory, 'LiberationMono-Italic.ttf'));
      await expect(loadPinnedFonts(directory)).rejects.toBeInstanceOf(FontsUnavailable);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
