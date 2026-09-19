// `pnpm trace pins` - the arithmetic behind the exact counts CLAUDE.md's "Requirements, designs and
// the trace" section pins in trace.test.ts and parse/requirements.test.ts. Those pins stay: they
// make a change to the corpus visible in a diff. This module only reports what each one currently
// says, what the corpus gives right now, and where to edit it - it never writes a file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { areaDocumentNames, compile, testFilesIn } from './compile.js';
import type { TraceModel } from './model.js';

/**
 * Everything a pin's current value might be computed from: the compiled model, the test files
 * `compile` scans to build its citations, and the area documents it reads. The count of areas is a
 * property of the documents on disk, not of anything `TraceModel` itself carries, so it travels
 * alongside the model rather than being derived from it.
 */
export interface Corpus {
  readonly model: TraceModel;
  readonly testFiles: readonly string[];
  readonly areaDocuments: readonly string[];
}

/**
 * What `pnpm --filter @alloy-works/trace generate` would compile from the working tree right now -
 * never the committed `trace.json`, which may already be stale by the time a pin is checked.
 */
export function corpusIn(repoRoot: string): Corpus {
  return {
    model: compile(repoRoot),
    testFiles: testFilesIn(repoRoot),
    areaDocuments: areaDocumentNames(repoRoot),
  };
}

export interface Pin {
  /** What the pin counts. Not unique on its own - the same count is pinned separately in two files
   * - but unique together with `file`. */
  readonly what: string;
  /** The pin's file, as a repository-relative POSIX path. */
  readonly file: string;
  /** Matches the `expect(...)` call that carries the pinned value, with the value itself as the one
   * capture group. Anchored on wording particular to that one call, so a rewrite that drops it or
   * duplicates it is refused rather than silently matched against something else. */
  readonly expectation: RegExp;
  /** The value the corpus gives today. */
  readonly current: (corpus: Corpus) => number;
}

const distinctDesignClaims = (model: TraceModel): number =>
  new Set(model.designs.flatMap((design) => design.owns.map((claim) => claim.id))).size;

const scannedTsxFiles = (corpus: Corpus): number =>
  corpus.testFiles.filter((file) => file.endsWith('.tsx')).length;

/**
 * The ten pins CLAUDE.md names: trace.test.ts's six, then parse/requirements.test.ts's four, in the
 * order it lists them. requirements/non-requirements/questions are pinned twice, once per file,
 * because the two tests check different things - one that the committed `trace.json` equals what
 * `compile` gives, the other that summing every area document's own parse gives the same totals -
 * so each is its own line to edit, even though today they agree.
 */
export const PINS: readonly Pin[] = [
  {
    what: 'requirements',
    file: 'packages/trace/src/trace.test.ts',
    expectation: /expect\(model\.requirements\)\.toHaveLength\((\d+)\)/,
    current: (corpus) => corpus.model.requirements.length,
  },
  {
    what: 'non-requirements',
    file: 'packages/trace/src/trace.test.ts',
    expectation: /expect\(model\.nonRequirements\)\.toHaveLength\((\d+)\)/,
    current: (corpus) => corpus.model.nonRequirements.length,
  },
  {
    what: 'questions',
    file: 'packages/trace/src/trace.test.ts',
    expectation: /expect\(model\.questions\)\.toHaveLength\((\d+)\)/,
    current: (corpus) => corpus.model.questions.length,
  },
  {
    what: 'design claims',
    file: 'packages/trace/src/trace.test.ts',
    expectation:
      /new Set\(model\.designs\.flatMap\(\(design\) => design\.owns\.map\(\(claim\) => claim\.id\)\)\)\.size,\s*\)\.toBe\((\d+)\)/,
    current: (corpus) => distinctDesignClaims(corpus.model),
  },
  {
    what: 'citations',
    file: 'packages/trace/src/trace.test.ts',
    expectation: /expect\(model\.citations\)\.toHaveLength\((\d+)\)/,
    current: (corpus) => corpus.model.citations.length,
  },
  {
    what: 'scanned .tsx test files',
    file: 'packages/trace/src/trace.test.ts',
    expectation:
      /expect\(files\.filter\(\(file\) => file\.endsWith\('\.tsx'\)\)\)\.toHaveLength\((\d+)\)/,
    current: scannedTsxFiles,
  },
  {
    what: 'areas',
    file: 'packages/trace/src/parse/requirements.test.ts',
    expectation: /expect\(areas\)\.toHaveLength\((\d+)\)/,
    current: (corpus) => corpus.areaDocuments.length,
  },
  {
    what: 'requirements',
    file: 'packages/trace/src/parse/requirements.test.ts',
    expectation: /expect\(total\(\(document\) => document\.requirements\)\)\.toBe\((\d+)\)/,
    current: (corpus) => corpus.model.requirements.length,
  },
  {
    what: 'non-requirements',
    file: 'packages/trace/src/parse/requirements.test.ts',
    expectation: /expect\(total\(\(document\) => document\.nonRequirements\)\)\.toBe\((\d+)\)/,
    current: (corpus) => corpus.model.nonRequirements.length,
  },
  {
    what: 'questions',
    file: 'packages/trace/src/parse/requirements.test.ts',
    expectation: /expect\(total\(\(document\) => document\.questions\)\)\.toBe\((\d+)\)/,
    current: (corpus) => corpus.model.questions.length,
  },
];

export interface PinnedValue {
  readonly value: number;
  readonly line: number;
}

/**
 * The value a pin's `expectation` carries in `text`, and the 1-based line it starts on. Refuses
 * loudly - naming the pin and its file - when the expectation is not found in `text` exactly once,
 * so a later rewrite of the test that drops the wording, or duplicates it, cannot make this command
 * silently report nothing or the wrong occurrence.
 */
export function findPinnedValue(pin: Pin, text: string): PinnedValue {
  const flags = pin.expectation.flags.includes('g')
    ? pin.expectation.flags
    : `${pin.expectation.flags}g`;
  const matches = [...text.matchAll(new RegExp(pin.expectation.source, flags))];
  if (matches.length !== 1) {
    throw new Error(
      `${pin.what} (${pin.file}): expected exactly one match for ${pin.expectation.source}, ` +
        `found ${matches.length}.`,
    );
  }
  const match = matches[0]!;
  const value = Number.parseInt(match[1]!, 10);
  const line = text.slice(0, match.index ?? 0).split('\n').length;
  return { value, line };
}

export interface PinReport {
  readonly pin: Pin;
  readonly pinned: number;
  readonly corpus: number;
  readonly line: number;
}

export const agrees = (report: PinReport): boolean => report.pinned === report.corpus;

/**
 * Every pin, compared against `corpus`. `readFile` takes a pin's `file` and returns its text, so
 * the comparison is testable over fixtures with no disk involved at all - `readPinFile` is the one
 * implementation that actually reads one.
 */
export function comparePins(
  pins: readonly Pin[],
  corpus: Corpus,
  readFile: (file: string) => string,
): PinReport[] {
  return pins.map((pin) => {
    const { value, line } = findPinnedValue(pin, readFile(pin.file));
    return { pin, pinned: value, corpus: pin.current(corpus), line };
  });
}

/** Reads a pin's file from disk, under `repoRoot`. The one impure edge `comparePins` needs. */
export function readPinFile(repoRoot: string, file: string): string {
  return readFileSync(join(repoRoot, ...file.split('/')), 'utf8');
}

/**
 * The report `pnpm trace pins` prints: one line per pin naming what it counts, its pinned value,
 * what the corpus gives now, and the file and line to edit - marked when the two differ - ending
 * with one line saying whether anything needs to move. It only reports; nothing here writes a file.
 */
export function formatPins(reports: readonly PinReport[]): string {
  const width = Math.max(...reports.map((report) => report.pin.what.length));
  const rows = reports.map((report) => {
    const mark = agrees(report) ? '' : '  <- differs';
    return (
      `${report.pin.what.padEnd(width)}  pinned ${report.pinned}  corpus ${report.corpus}  ` +
      `${report.pin.file}:${report.line}${mark}`
    );
  });
  const moving = reports.filter((report) => !agrees(report));
  const summary =
    moving.length === 0 ? 'Every pin agrees with the corpus.' : `${moving.length} pin(s) to move.`;
  return [...rows, '', summary].join('\n');
}
