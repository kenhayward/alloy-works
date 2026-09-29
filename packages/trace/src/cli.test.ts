import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { EOL, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  areaListing,
  describeWrite,
  readAreaArguments,
  readDraftInput,
  recordRun,
  resolveOutputPath,
  runGate,
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

/**
 * `pnpm trace gate` as the CLI runs it, over a repository of its own: a baseline whose one requirement
 * is attested by a record under docs/audits/, and a report of a passing run. The CLI is what looks for
 * the record on disk, so a gate that stopped looking would pass here with the record missing.
 */
describe('the gate, run by the CLI', () => {
  const traced: TraceModel = {
    requirements: [
      {
        id: 'ZZZ-001',
        area: 'ZZZ',
        statement: 'A widget must exist',
        tranche: 'T1',
        status: 'Specified',
        document: 'ZZZ-invented-area.md',
        line: 1,
      },
    ],
    nonRequirements: [],
    questions: [],
    designs: [],
    citations: [],
  };

  function repository(): string {
    const root = mkdtempSync(join(tmpdir(), 'alloy-gate-'));
    mkdirSync(join(root, 'docs', 'specification', 'baselines'), { recursive: true });
    writeFileSync(
      join(root, 'docs', 'specification', 'baselines', '0.0.1.md'),
      [
        '# 0.0.1',
        '',
        '> **Declared:** 2026-09-28. Invented for the test.',
        '',
        '## Included',
        '',
        '| ID          | Why it is in force      |',
        '| ----------- | ----------------------- |',
        '| **ZZZ-001** | invented for the test   |',
        '',
        '## Verification',
        '',
        '| ID          | Kind        | By                                             |',
        '| ----------- | ----------- | ---------------------------------------------- |',
        '| **ZZZ-001** | attestation | Ada, 2026-09-28, docs/audits/0.0.1/wcag.md     |',
        '',
      ].join('\n'),
    );
    mkdirSync(join(root, '.trace-results'));
    writeFileSync(
      join(root, '.trace-results', 'invented.json'),
      JSON.stringify({ success: true, startTime: Date.now(), testResults: [] }),
    );
    return root;
  }

  it('fails a baseline whose attestation names a record in docs/audits that is not there', () => {
    const root = repository();
    try {
      expect(runGate(root, traced, undefined)).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('passes it once the record is there', () => {
    const root = repository();
    try {
      mkdirSync(join(root, 'docs', 'audits', '0.0.1'), { recursive: true });
      writeFileSync(join(root, 'docs', 'audits', '0.0.1', 'wcag.md'), '# A record\n');
      expect(runGate(root, traced, undefined)).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails it where what is named there is a folder, not a record', () => {
    const root = repository();
    try {
      mkdirSync(join(root, 'docs', 'audits', '0.0.1', 'wcag.md'), { recursive: true });
      expect(runGate(root, traced, undefined)).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/**
 * A local run over the CLI (the W15 plan's W15-D), in a repository of its own: `pnpm trace record-run`
 * reducing the worker's report to the record's report, and the gate reading both from the disk. Not the
 * reserved area, since a run's report is read through `parseResults`, which skips it.
 */
describe('a local run, recorded and gated by the CLI', () => {
  const ran: TraceModel = {
    requirements: [
      {
        id: 'QQQ-001',
        area: 'QQQ',
        statement: 'A widget must be measured where Word is',
        tranche: 'T1',
        status: 'Specified',
        document: 'QQQ-invented-area.md',
        line: 1,
      },
    ],
    nonRequirements: [],
    questions: [],
    designs: [{ document: 'one.md', owns: [{ id: 'QQQ-001', howItIsMet: 'a' }] }],
    citations: [{ id: 'QQQ-001', file: 'apps/worker/src/a.test.ts', line: 1, kind: 'title' }],
  };

  /** The worker's Vitest report as a whole run on a machine with Word writes it: two files. */
  const workerReport = (success = true, files = 2) => ({
    numTotalTests: 2,
    success,
    startTime: Date.now(),
    testResults: Array.from({ length: files }, (_, n) => ({
      name: `D:/Somewhere/apps/worker/src/${n === 0 ? 'a' : 'b'}.test.ts`,
      message: '',
      assertionResults: [
        n === 0
          ? { fullName: 'Word measured QQQ-001 holds', status: success ? 'passed' : 'failed' }
          : { fullName: 'something else', status: 'passed', failureMessages: [] },
      ],
    })),
  });

  function repository(): string {
    const root = mkdtempSync(join(tmpdir(), 'alloy-local-run-'));
    mkdirSync(join(root, 'docs', 'specification', 'baselines'), { recursive: true });
    writeFileSync(
      join(root, 'docs', 'specification', 'baselines', '0.0.2.md'),
      [
        '# 0.0.2',
        '',
        '> **Declared:** 2026-09-30. Invented for the test.',
        '',
        '## Included',
        '',
        '| ID          | Why it is in force    |',
        '| ----------- | --------------------- |',
        '| **QQQ-001** | invented for the test |',
        '',
        '## Verification',
        '',
        '| ID          | Kind      | By                                         |',
        '| ----------- | --------- | ------------------------------------------ |',
        '| **QQQ-001** | local-run | Ada, 2026-09-30, docs/audits/0.0.2/word.md |',
        '',
      ].join('\n'),
    );
    // The worker's two test files, which a whole run of its suite reports on.
    mkdirSync(join(root, 'apps', 'worker', 'src'), { recursive: true });
    writeFileSync(join(root, 'apps', 'worker', 'src', 'a.test.ts'), '');
    writeFileSync(join(root, 'apps', 'worker', 'src', 'b.test.ts'), '');
    mkdirSync(join(root, '.trace-results'));
    return root;
  }
  const writeReport = (root: string, name: string, report: unknown) =>
    writeFileSync(join(root, '.trace-results', `${name}.json`), JSON.stringify(report));
  const recorded = (root: string) => join(root, 'docs', 'audits', '0.0.2', 'word.json');

  it("reduces the worker's report to the record's report, with no path and no message", () => {
    const root = repository();
    try {
      writeReport(root, 'worker', workerReport());
      expect(recordRun(root, ['0.0.2', 'word'])).toBe(0);
      const written = readFileSync(recorded(root), 'utf8');
      expect(written).not.toContain('Somewhere');
      expect(written).not.toContain('message');
      expect(JSON.parse(written)).toMatchObject({
        success: true,
        counts: { total: 2, passed: 2, failed: 0, skipped: 0 },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a failed run, writing nothing', () => {
    const root = repository();
    try {
      writeReport(root, 'worker', workerReport(false));
      expect(recordRun(root, ['0.0.2', 'word'])).toBe(1);
      expect(existsSync(recorded(root))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a run of fewer of the worker's test files than it has, since the whole suite is the run", () => {
    const root = repository();
    try {
      writeReport(root, 'worker', workerReport(true, 1));
      expect(recordRun(root, ['0.0.2', 'word'])).toBe(1);
      expect(existsSync(recorded(root))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses where there is no report to reduce, or no release and name a record can have', () => {
    const root = repository();
    try {
      expect(recordRun(root, ['0.0.2', 'word'])).toBe(1);
      writeReport(root, 'worker', workerReport());
      expect(recordRun(root, ['0.0.2'])).toBe(1);
      expect(recordRun(root, ['../0.0.2', 'word'])).toBe(1);
      expect(recordRun(root, ['0.0.2', 'Word Run'])).toBe(1);
      expect(existsSync(join(root, 'docs', 'audits'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("gates the requirement on the record and the report on the disk, beside CI's own results", () => {
    const root = repository();
    try {
      writeReport(root, 'worker', workerReport());
      expect(recordRun(root, ['0.0.2', 'word'])).toBe(0);
      // CI's own run, where the Word test is skipped.
      writeReport(root, 'worker', {
        ...workerReport(),
        testResults: [
          { assertionResults: [{ fullName: 'Word measured QQQ-001 holds', status: 'skipped' }] },
        ],
      });
      // No record beside the report yet: the row names one.
      expect(runGate(root, ran, undefined)).toBe(1);
      writeFileSync(join(root, 'docs', 'audits', '0.0.2', 'word.md'), '# A run\n');
      expect(runGate(root, ran, undefined)).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
