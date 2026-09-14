import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { EOL, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  areaListing,
  describeWrite,
  readAreaArguments,
  readDraftInput,
  resolveOutputPath,
  writeListing,
} from './cli.js';
import type { TraceModel } from './model.js';

/**
 * `readDraftInput`'s flag form, exercised directly rather than through `main` - `main` reads the real
 * corpus via `compile(REPO_ROOT)` and shells out to `gh`, neither of which this file's fixes touch.
 * Importing `cli.ts` at all only works because of the `isMain` guard at the bottom of it: without
 * that guard, importing this module would run the real CLI against Vitest's own `process.argv`.
 */
describe('reading the flag form of draft input', () => {
  it('accepts an uppercase MUST, the same as the issue-form path now does', () => {
    const result = readDraftInput([
      '--area',
      'ZZZ',
      '--statement',
      'A footnote MUST carry a citation.',
    ]);

    expect('error' in result).toBe(false);
  });

  it('treats a trailing --tranche with no value as absent, not the literal empty string', () => {
    const result = readDraftInput([
      '--area',
      'ZZZ',
      '--statement',
      'A widget must glow.',
      '--tranche',
    ]);

    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.filed.tranche).toBeUndefined();
    }
  });

  it('refuses an area the schema rejects, with a legible message rather than a raw zod dump', () => {
    const result = readDraftInput(['--area', 'zz9', '--statement', 'A widget must glow.']);

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).not.toMatch(/ZodError|invalid_format|pattern \//);
      expect(result.error).toMatch(/area/i);
    }
  });

  it('refuses a statement with neither must nor should, the same as the issue-form path', () => {
    const result = readDraftInput(['--area', 'ZZZ', '--statement', 'A widget looks nice.']);

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/must say must or should/);
    }
  });
});

/**
 * The `area` command's decision, exercised directly for the same reason as `readDraftInput`: `main`
 * reads the real corpus. The index is passed as a function, because only `--all` needs it and a
 * single-area listing should not read a document it does not use.
 */
describe('the area command', () => {
  const model: TraceModel = {
    requirements: [
      {
        id: 'ZZZ-001',
        area: 'ZZZ',
        statement: 'A widget must carry a footnote',
        tranche: 'T1',
        status: 'Specified',
        document: 'ZZZ-invented-area.md',
        line: 7,
      },
    ],
    nonRequirements: [],
    questions: [],
    designs: [],
    citations: [],
  };
  const noIndex = (): never => {
    throw new Error('a single-area listing must not read the index');
  };

  it('lists one area by its code, in any case, without reading the index', () => {
    expect(areaListing('zzz', model, noIndex)).toEqual({
      output: 'ZZZ-001  Specified   A widget must carry a footnote',
      requirements: 1,
      areas: 1,
    });
  });

  it('lists every area with --all, under headings from the index', () => {
    const result = areaListing('--all', model, () => [
      { code: 'ZZZ', name: 'Invented area' },
      { code: 'ZZQ', name: 'Invented and empty' },
    ]);

    expect(result).toEqual({
      output:
        'ZZZ - Invented area - 1 requirement\nZZZ-001  Specified   A widget must carry a footnote\n\nZZQ - Invented and empty - no requirements yet',
      requirements: 1,
      areas: 2,
    });
  });

  it('refuses a missing argument, naming both forms', () => {
    const result = areaListing(undefined, model, noIndex);

    expect('error' in result && result.error).toMatch(/three-letter code.*--all/);
  });

  it('refuses an area the corpus does not hold', () => {
    expect(areaListing('ZZQ', model, noIndex)).toEqual({ error: 'No area ZZQ in the corpus.' });
  });
});

describe('reading the area command arguments', () => {
  it('reads an area code, or --all, with no file', () => {
    expect(readAreaArguments(['CNT'])).toEqual({ target: 'CNT' });
    expect(readAreaArguments(['--all'])).toEqual({ target: '--all' });
  });

  it('reads --file and its filename, before or after the area', () => {
    expect(readAreaArguments(['--all', '--file', 'areas.txt'])).toEqual({
      target: '--all',
      file: 'areas.txt',
    });
    expect(readAreaArguments(['--file', 'cnt.txt', 'CNT'])).toEqual({
      target: 'CNT',
      file: 'cnt.txt',
    });
  });

  it('leaves the target absent when none is given, so the listing refuses it by name', () => {
    expect(readAreaArguments([])).toEqual({});
  });

  it('refuses --file with no filename after it', () => {
    const result = readAreaArguments(['--all', '--file']);

    expect('error' in result && result.error).toMatch(/--file needs a filename/);
  });

  it('refuses a flag where the filename should be', () => {
    const result = readAreaArguments(['--file', '--all']);

    expect('error' in result && result.error).toMatch(/--file needs a filename/);
  });

  it('refuses two areas at once', () => {
    const result = readAreaArguments(['CNT', 'STR']);

    expect('error' in result && result.error).toMatch(/one area/);
  });
});

/**
 * `pnpm trace` runs the CLI inside `packages/trace`, because the root script is a `--filter`, so the
 * process's own working directory is not where anybody expects a file to land. The base passed in is
 * `INIT_CWD`, the directory pnpm started from - for this repository, its root. Run from a
 * subdirectory, pnpm still reports the root; only `PWD` carries the subdirectory, and only in some
 * shells, so it is deliberately not used.
 */
describe('where --file writes', () => {
  const typedIn = resolve('/work', 'repository');
  const exists = (): boolean => true;

  it('takes a relative filename against the base pnpm reports, not the working directory', () => {
    expect(resolveOutputPath('areas.txt', typedIn, exists)).toEqual({
      path: join(typedIn, 'areas.txt'),
    });
  });

  it('uses an absolute filename as given', () => {
    const absolute = resolve('/elsewhere', 'areas.txt');

    expect(resolveOutputPath(absolute, typedIn, exists)).toEqual({ path: absolute });
  });

  it('refuses a folder that does not exist rather than creating it, naming the folder', () => {
    const result = resolveOutputPath(join('missing', 'areas.txt'), typedIn, () => false);

    expect(result).toEqual({
      error: `No folder ${join(typedIn, 'missing')} to write areas.txt into.`,
    });
  });
});

describe('writing a listing to a file', () => {
  // A statement outside ASCII - an accented letter, a CJK character and a mathematical symbol - is
  // the thing a wrong encoding corrupts, and the text mixes LF and CRLF so that normalising is tested
  // rather than assumed.
  const listing =
    'ZZZ-001  Specified   Café 文字 ≤ must survive\r\nZZZ-002  Specified   A second row\nZZZ-003  Specified   A third row';

  const written = (eol?: string): Buffer => {
    const directory = mkdtempSync(join(tmpdir(), 'trace-area-'));
    try {
      const path = join(directory, 'areas.txt');
      if (eol === undefined) writeListing(path, listing);
      else writeListing(path, listing, eol);
      return readFileSync(path);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };

  /** The text after the byte-order mark, failing if the mark is not there. */
  const text = (bytes: Buffer): string => {
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    return bytes.subarray(3).toString('utf8');
  };

  it('writes CRLF on a platform whose line ending is CRLF, so Windows viewers break the lines', () => {
    const written_ = text(written('\r\n'));

    expect(written_).toBe(
      'ZZZ-001  Specified   Café 文字 ≤ must survive\r\nZZZ-002  Specified   A second row\r\nZZZ-003  Specified   A third row\r\n',
    );
    // No LF that is not part of a CRLF - a bare LF is exactly what a Windows viewer does not break on.
    expect(written_.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('writes LF on a platform whose line ending is LF', () => {
    expect(text(written('\n'))).toBe(
      'ZZZ-001  Specified   Café 文字 ≤ must survive\nZZZ-002  Specified   A second row\nZZZ-003  Specified   A third row\n',
    );
  });

  it('uses the line ending of the platform it runs on when none is given', () => {
    const written_ = text(written());

    expect(written_.endsWith(`A third row${EOL}`)).toBe(true);
    expect(written_.split(EOL)).toHaveLength(4);
  });

  // Editors that decide a file's encoding from a byte-order mark, and otherwise assume the Windows
  // legacy code page, show a UTF-8 section sign as `Â§` without one (#93).
  it('starts with exactly one UTF-8 byte-order mark, so an editor need not guess the encoding', () => {
    const bytes = written('\r\n');

    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect([...bytes.subarray(3, 6)]).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(text(bytes)).toContain('Café 文字 ≤');
  });
});

describe('saying what was written', () => {
  it('names the counts and the full path', () => {
    expect(describeWrite({ output: '', requirements: 1360, areas: 22 }, 'D:/work/areas.txt')).toBe(
      'Wrote 1,360 requirements in 22 areas to D:/work/areas.txt',
    );
  });

  it('uses the singular for one of each', () => {
    expect(describeWrite({ output: '', requirements: 1, areas: 1 }, '/tmp/x.txt')).toBe(
      'Wrote 1 requirement in 1 area to /tmp/x.txt',
    );
  });
});
