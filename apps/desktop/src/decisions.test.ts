import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The architecture decision records, and the index that lists them.
 *
 * An index nobody checks goes stale the first time somebody adds a record in a hurry, and a stale
 * index is worse than none - it says a decision does not exist. This repository already pins the
 * things that drift silently (the version mirrors next door, the icon paths, the IPC channel names)
 * with tests rather than with discipline, and the decision index is the same class of thing.
 *
 * It lives here for the same reason `version.test.ts` does: this is where the repository-wide
 * invariants are tested from, and this package already has `fs` and a node environment. When there
 * are three or four such checks they deserve a workspace of their own rather than a corner of the
 * desktop app.
 */
const repoRoot = join(process.cwd(), '..', '..');
const decisionsDir = join(repoRoot, 'docs', 'decisions');

const read = (...parts: string[]): string => readFileSync(join(decisionsDir, ...parts), 'utf8');

const recordFiles = readdirSync(decisionsDir)
  .filter((name) => /^\d{4}-.+\.md$/.test(name))
  .sort();

interface IndexRow {
  readonly number: string;
  readonly file: string;
  readonly title: string;
  readonly status: string;
}

const INDEX_ROW = /^\|\s*\[(\d{4})\]\(([^)]+)\)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/gm;

function indexRows(): IndexRow[] {
  const readme = read('README.md');
  return [...readme.matchAll(INDEX_ROW)].map((match) => ({
    number: match[1]!,
    file: match[2]!,
    title: match[3]!,
    status: match[4]!,
  }));
}

/**
 * The shape every record follows. It was a convention held only by imitation until this test - the
 * five existing records all use it, and nothing said so anywhere.
 */
const REQUIRED_SECTIONS = ['## Context', '## Decision', '## Consequences'] as const;

/**
 * The section that makes a record worth writing: a conclusion without it is an opinion with a date
 * on it. 0001 predates the convention and is exempt, because records are not edited once accepted -
 * adding the section now would mean inventing the reasoning retrospectively, which is the thing the
 * no-edit rule exists to prevent.
 */
const CHANGE_THE_ANSWER = '## What would change the answer';
const PREDATES_THE_CONVENTION = new Set(['0001']);

const KNOWN_STATUSES = /^(Accepted|Proposed|Superseded by \d{4})$/;

describe('the decision records', () => {
  it('has some, so the rest of this is testing something', () => {
    expect(recordFiles.length).toBeGreaterThan(0);
  });

  it('lists every record in the index', () => {
    const listed = indexRows()
      .map((row) => row.number)
      .sort();
    const present = recordFiles.map((name) => name.slice(0, 4)).sort();

    expect(listed).toEqual(present);
  });

  it('links each index row at a file that exists, under the number it claims', () => {
    for (const row of indexRows()) {
      expect(recordFiles, `index row ${row.number} links to ${row.file}`).toContain(row.file);
      expect(row.file.startsWith(row.number)).toBe(true);
    }
  });

  it('gives each record a status the index agrees with', () => {
    for (const row of indexRows()) {
      const status = /^- \*\*Status:\*\* (.+)$/m.exec(read(row.file))?.[1]?.trim();

      expect(status, `${row.file} declares a status`).toBeDefined();
      expect(status, `${row.file} status is one we recognise`).toMatch(KNOWN_STATUSES);
      expect(row.status, `index and ${row.file} agree on status`).toBe(status);
    }
  });

  it('dates each record', () => {
    for (const name of recordFiles) {
      expect(read(name), `${name} carries a date`).toMatch(/^- \*\*Date:\*\* \d{4}-\d{2}-\d{2}$/m);
    }
  });

  it('titles each record with its own number', () => {
    for (const name of recordFiles) {
      expect(read(name).split('\n')[0]).toMatch(new RegExp(`^# ${name.slice(0, 4)} - .+`));
    }
  });

  it('gives each record the sections a record is made of', () => {
    for (const name of recordFiles) {
      const body = read(name);
      for (const section of REQUIRED_SECTIONS) {
        expect(body, `${name} has a "${section}" section`).toContain(section);
      }
    }
  });

  it('makes every record since the convention say what would change the answer', () => {
    for (const name of recordFiles) {
      if (PREDATES_THE_CONVENTION.has(name.slice(0, 4))) continue;
      expect(read(name), `${name} says what would change the answer`).toContain(CHANGE_THE_ANSWER);
    }
  });

  it('numbers them without a gap or a repeat, so the next number is never in doubt', () => {
    const numbers = recordFiles.map((name) => Number.parseInt(name.slice(0, 4), 10));

    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
  });
});
