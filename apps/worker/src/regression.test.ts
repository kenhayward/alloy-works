import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { readPdf, type Bookmark } from './testing/pdf.js';
import { checkPdfUa1 } from './testing/verapdf.js';
import { createTypst, typstBinaryPath } from './typst.js';

const NINE_LEVELS = fileURLToPath(
  new URL('../regression/nine-heading-levels.typ', import.meta.url),
);
const at = new Date('2026-09-19T00:00:00Z');

const depthOf = (bookmarks: readonly Bookmark[]): number =>
  bookmarks.length === 0 ? 0 : 1 + Math.max(...bookmarks.map((each) => depthOf(each.items)));

describe('the publishing regression corpus', () => {
  it('passes veraPDF with nine heading levels, bookmarked nine deep, six of them tagged as headings', async () => {
    const pdf = await createTypst({ binary: typstBinaryPath(), template: NINE_LEVELS }).render(
      {},
      at,
    );

    expect(await checkPdfUa1(pdf)).toMatchObject({
      compliant: true,
      profile: 'PDF/UA-1 validation profile',
      failedRules: 0,
    });
    const read = await readPdf(pdf);
    expect(read).toMatchObject({
      marked: true,
      pdfuaPart: '1',
      title: 'Nine heading levels',
      language: 'en',
    });
    expect(depthOf(read.bookmarks)).toBe(9);
    // PDF/UA-1's standard heading types stop at H6. Typst 0.15.1 writes levels seven to nine as H7 to
    // H9 role-mapped to P, so assistive technology is told they are paragraphs (decision A). Pinned, so
    // an engine that changes it is noticed; PUB-090 stays unclaimed while it holds.
    expect(read.roles.filter((role) => /^H\d$/.test(role))).toEqual([
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
    ]);
  }, 120_000);

  it('the checker fails a PDF that is not PDF/UA-1, naming its rules', async () => {
    // Compiled without `--pdf-standard ua-1` and without a title, so it is untagged: a checker that
    // cannot say no would pass the corpus whatever the engine did.
    const directory = await mkdtemp(join(tmpdir(), 'aw-not-ua-'));
    try {
      await writeFile(join(directory, 'main.typ'), '#set text(lang: "en")\nA sentence.\n');
      await promisify(execFile)(
        typstBinaryPath(),
        ['compile', '--root', directory, '--ignore-system-fonts', 'main.typ', 'out.pdf'],
        { cwd: directory, env: {}, timeout: 30_000 },
      );
      const verdict = await checkPdfUa1(await readFile(join(directory, 'out.pdf')));

      expect(verdict).toMatchObject({ compliant: false, profile: 'PDF/UA-1 validation profile' });
      expect(verdict.failedRules).toBeGreaterThan(0);
      // 5-1 is PDF/UA-1's own identification, missing from any PDF not made to the standard.
      expect(verdict.failures).toContain('5-1');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
