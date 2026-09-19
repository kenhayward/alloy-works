import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from './compile.js';
import {
  PINS,
  type Corpus,
  type Pin,
  agrees,
  comparePins,
  corpusIn,
  findPinnedValue,
  formatPins,
  readPinFile,
} from './pins.js';

const emptyCorpus: Corpus = {
  model: { requirements: [], nonRequirements: [], questions: [], designs: [], citations: [] },
  testFiles: [],
  areaDocuments: [],
};

const widgets = (n: number): Pin => ({
  what: 'widgets',
  file: 'fixture.test.ts',
  expectation: /expect\(widgets\)\.toHaveLength\((\d+)\)/,
  current: () => n,
});

describe('finding a pin’s value in a file', () => {
  it('reads the value and the 1-based line it is on', () => {
    const text = ['// a comment', 'expect(widgets).toHaveLength(3);', ''].join('\n');

    expect(findPinnedValue(widgets(3), text)).toEqual({ value: 3, line: 2 });
  });

  it('refuses loudly, naming the pin and the file, when the expectation is not found', () => {
    expect(() => findPinnedValue(widgets(3), 'nothing here')).toThrow(
      /widgets.*fixture\.test\.ts/s,
    );
  });

  it('refuses loudly when the expectation is found more than once', () => {
    const text = ['expect(widgets).toHaveLength(3);', 'expect(widgets).toHaveLength(3);'].join(
      '\n',
    );

    expect(() => findPinnedValue(widgets(3), text)).toThrow(/widgets.*fixture\.test\.ts/s);
  });
});

describe('comparing pins against a corpus', () => {
  const readFixture = (text: string) => (): string => text;

  it('agrees when the pinned value equals what the corpus gives now', () => {
    const pin = widgets(3);
    const [report] = comparePins(
      [pin],
      emptyCorpus,
      readFixture('expect(widgets).toHaveLength(3);'),
    );

    expect(report).toEqual({ pin, pinned: 3, corpus: 3, line: 1 });
    expect(agrees(report!)).toBe(true);
  });

  it('differs when the pinned value and the corpus disagree', () => {
    const pin = widgets(4);
    const [report] = comparePins(
      [pin],
      emptyCorpus,
      readFixture('expect(widgets).toHaveLength(3);'),
    );

    expect(report).toEqual({ pin, pinned: 3, corpus: 4, line: 1 });
    expect(agrees(report!)).toBe(false);
  });

  it('reads each pin from its own file', () => {
    const a = widgets(1);
    const b: Pin = { ...widgets(2), file: 'other.test.ts' };
    const files = new Map([
      [a.file, 'expect(widgets).toHaveLength(1);'],
      [b.file, 'expect(widgets).toHaveLength(2);'],
    ]);

    const reports = comparePins([a, b], emptyCorpus, (file) => files.get(file)!);

    expect(reports.map((report) => report.pin.file)).toEqual([a.file, b.file]);
  });
});

describe('formatting a pin report', () => {
  it('says every pin agrees when none differ', () => {
    const pin = widgets(3);
    const output = formatPins(
      comparePins([pin], emptyCorpus, () => 'expect(widgets).toHaveLength(3);'),
    );

    expect(output).toContain('Every pin agrees with the corpus.');
    expect(output).not.toContain('differs');
  });

  it('marks a pin that differs and counts it in the summary', () => {
    const pin = widgets(4);
    const output = formatPins(
      comparePins([pin], emptyCorpus, () => 'expect(widgets).toHaveLength(3);'),
    );

    expect(output).toContain('pinned 3');
    expect(output).toContain('corpus 4');
    expect(output).toContain('differs');
    expect(output).toContain('1 pin(s) to move.');
  });
});

describe('the ten pins CLAUDE.md names', () => {
  it('cover trace.test.ts and parse/requirements.test.ts, nothing else', () => {
    const files = new Set(PINS.map((pin) => pin.file));

    expect(PINS).toHaveLength(10);
    expect(files).toEqual(
      new Set([
        'packages/trace/src/trace.test.ts',
        'packages/trace/src/parse/requirements.test.ts',
      ]),
    );
  });

  it('agree with the corpus on this clean branch', () => {
    const corpus = corpusIn(REPO_ROOT);
    const reports = comparePins(PINS, corpus, (file) => readPinFile(REPO_ROOT, file));

    const moving = reports
      .filter((report) => !agrees(report))
      .map(
        (report) =>
          `${report.pin.what} (${report.pin.file}:${report.line}): pinned ${report.pinned}, corpus ${report.corpus}`,
      );

    expect(moving).toEqual([]);
  });
});
