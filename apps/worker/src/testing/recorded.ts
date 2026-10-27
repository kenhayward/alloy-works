import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Typst } from '../typst.js';

/**
 * **The corpus's recorded outputs** (PUB-075; the AU2 plan, AU-J and AU-K): the SHA-256 of every PDF,
 * DOCX and HTML file (the HT plan, HT-P) the publishing regression corpus makes, by its case and its place among that case's
 * outputs. A change to the pipeline, the engine, a face or a library that changes a byte fails the
 * corpus, naming the case and keeping what it made for a person to compare. `record` adds
 * what has no pin and rewrites none; `accept` takes a difference, in a pull request that says why.
 */
export type RecordingMode = 'check' | 'record' | 'accept';

export interface RecordedOutputs {
  /** Holds these bytes, the next output of this case in this format, to its pin. */
  check(caseName: string, format: 'pdf' | 'docx' | 'html', bytes: Uint8Array): void;
  /** Counts every case from one again: a test about to run, or to run again. */
  reset(): void;
  /** Writes the pins taken, where recording or accepting. */
  write(): Promise<void>;
}

/** A case's own title, after its describe's, as a file's name: what `keepingEach` names it by too. */
export const slugOf = (caseName: string): string =>
  (caseName.split(' > ').pop() ?? '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)
    .toLowerCase();

/** The mode `ALLOY_RECORD` asks for: `new` records, `accept` accepts, anything else checks. */
export const modeOf = (value: string | undefined): RecordingMode =>
  value === 'new' ? 'record' : value === 'accept' ? 'accept' : 'check';

export async function recordedOutputs(options: {
  readonly pins: string;
  readonly mode: RecordingMode;
  /** Where a differing output is kept for a person to compare; by default in the system's temporary directory. */
  readonly keep?: string;
}): Promise<RecordedOutputs> {
  const { pins, mode } = options;
  const recorded = JSON.parse(await readFile(pins, 'utf8')) as Record<string, string>;
  const taken = new Map<string, string>();
  const counts = new Map<string, number>();
  const keep = options.keep ?? join(tmpdir(), 'alloy-corpus-differences');
  return {
    check(caseName, format, bytes) {
      const slug = slugOf(caseName);
      const count = (counts.get(`${slug}.${format}`) ?? 0) + 1;
      counts.set(`${slug}.${format}`, count);
      const name = `${slug}-${count}.${format}`;
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const pinned = recorded[name];
      if (pinned === sha256) return;
      if (mode === 'accept' || (mode === 'record' && pinned === undefined)) {
        taken.set(name, sha256);
        return;
      }
      if (pinned === undefined) {
        throw new Error(
          `${name} has no recorded output: record it with \`pnpm --filter @alloy-works/worker record\``,
        );
      }
      mkdirSync(keep, { recursive: true });
      writeFileSync(join(keep, name), bytes);
      throw new Error(
        `${name} differs from its recorded output (PUB-075): made ${sha256}, kept in ${keep}. A change meant to ` +
          'alter it is accepted with `pnpm --filter @alloy-works/worker record --accept`, saying why',
      );
    },
    reset: () => counts.clear(),
    async write() {
      if (mode === 'check' || taken.size === 0) return;
      // Re-read, so two files of the corpus recording at once lose neither's pins.
      const now = JSON.parse(await readFile(pins, 'utf8')) as Record<string, string>;
      const merged = { ...now, ...Object.fromEntries(taken) };
      const sorted = Object.fromEntries(
        Object.keys(merged)
          .sort()
          .map((key) => [key, merged[key]!]),
      );
      await writeFile(pins, `${JSON.stringify(sorted, null, 2)}\n`);
    },
  };
}

/** Typst whose every PDF is held to its pin, under the name of the case compiling it. */
export const pinningEach = (typst: Typst, outputs: RecordedOutputs, name: () => string): Typst => ({
  version: () => typst.version(),
  query: (template, data, label, createdAt, images) =>
    typst.query(template, data, label, createdAt, images),
  async compile(template, data, createdAt, images) {
    const pdf = await typst.compile(template, data, createdAt, images);
    outputs.check(name(), 'pdf', pdf);
    return pdf;
  },
});
