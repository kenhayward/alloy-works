import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The detailed requirements, and the identifiers work is tracked against.
 *
 * A requirement identifier is only worth citing from a commit or a test if it means exactly one
 * thing for ever. A duplicate, a renumbering, or a silent gap breaks every citation that already
 * exists, and breaks it quietly - the citation still reads fine, it just now points somewhere else.
 * So the properties that make an identifier trustworthy are pinned here rather than left to care.
 *
 * Second of the repository-wide checks living in this package alongside `version.test.ts` and
 * `decisions.test.ts`. At three or four they want a workspace of their own rather than a corner of
 * the desktop app.
 */
const repoRoot = join(process.cwd(), '..', '..');
const requirementsDir = join(repoRoot, 'docs', 'specification', 'requirements');

const read = (name: string): string => readFileSync(join(requirementsDir, name), 'utf8');

const areaDocuments = readdirSync(requirementsDir)
  .filter((name) => /^[A-Z]{3}-.+\.md$/.test(name))
  .sort();

/** `| **CNT-001** | statement | T1 | Specified |` - bold identifier is what marks a real row. */
const REQUIREMENT_ROW =
  /^\|\s*\*\*([A-Z]{3}-\d{3})\*\*\s*\|\s*(.+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/gm;

/** `| **CNT** | Content and authoring | 7.1 | [file](file) |` in the index. */
const INDEX_ROW =
  /^\|\s*\*\*([A-Z]{3})\*\*\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/gm;

/**
 * Non-requirements and open questions are numbered too, in their own sequences, so a reviewer can
 * cite one without quoting it. `CNT-N02` and `CNT-Q05` cannot be mistaken for `CNT-002`.
 */
const NON_REQUIREMENT_ROW = /^\|\s*\*\*([A-Z]{3}-N\d{2})\*\*\s*\|\s*(.+?)\s*\|\s*$/gm;
const OPEN_QUESTION_ROW = /^\|\s*\*\*([A-Z]{3}-Q\d{2})\*\*\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/gm;

interface Requirement {
  readonly id: string;
  readonly statement: string;
  readonly tranche: string;
  readonly status: string;
  readonly document: string;
}

function requirementsIn(name: string): Requirement[] {
  return [...read(name).matchAll(REQUIREMENT_ROW)].map((match) => ({
    id: match[1]!,
    statement: match[2]!,
    tranche: match[3]!,
    status: match[4]!,
    document: name,
  }));
}

const allRequirements = areaDocuments.flatMap(requirementsIn);

const KNOWN_TRANCHE = /^(T[1-6]|Constraint)$/;
const KNOWN_STATUS = /^(Specified|Withdrawn|Superseded by [A-Z]{3}-\d{3})$/;

describe('the requirement identifiers', () => {
  it('has requirements to check', () => {
    expect(areaDocuments.length).toBeGreaterThan(0);
    expect(allRequirements.length).toBeGreaterThan(0);
  });

  it('gives every requirement an identifier of the one permitted shape', () => {
    for (const requirement of allRequirements) {
      expect(requirement.id).toMatch(/^[A-Z]{3}-\d{3}$/);
    }
  });

  it('never issues the same identifier twice', () => {
    const seen = allRequirements.map((requirement) => requirement.id);

    expect(seen).toEqual([...new Set(seen)]);
  });

  it('keeps every requirement under the area code of the document holding it', () => {
    for (const name of areaDocuments) {
      const area = name.slice(0, 3);
      for (const requirement of requirementsIn(name)) {
        expect(requirement.id.slice(0, 3), `${requirement.id} sits in ${name}`).toBe(area);
      }
    }
  });

  /**
   * Contiguous from 001 as a SET, deliberately not in document order. A requirement added later
   * belongs beside the ones it relates to, and it keeps the next free number when it goes there -
   * so the numbers run out of order down the page. Requiring document order would mean renumbering
   * on every insert, which is exactly what the never-reuse rule forbids.
   *
   * The hole is what this catches: deleting a requirement instead of marking it withdrawn.
   */
  it('numbers each area from 001 with no gap and no repeat', () => {
    for (const name of areaDocuments) {
      const numbers = requirementsIn(name)
        .map((requirement) => Number.parseInt(requirement.id.slice(4), 10))
        .sort((left, right) => left - right);

      expect(numbers, `${name} numbers contiguously`).toEqual(numbers.map((_, index) => index + 1));
    }
  });

  it('gives every requirement a tranche we recognise', () => {
    for (const requirement of allRequirements) {
      expect(requirement.tranche, `${requirement.id} tranche`).toMatch(KNOWN_TRANCHE);
    }
  });

  it('gives every requirement a status we recognise', () => {
    for (const requirement of allRequirements) {
      expect(requirement.status, `${requirement.id} status`).toMatch(KNOWN_STATUS);
    }
  });

  it('points every superseding status at a requirement that exists', () => {
    const known = new Set(allRequirements.map((requirement) => requirement.id));
    for (const requirement of allRequirements) {
      const target = /^Superseded by ([A-Z]{3}-\d{3})$/.exec(requirement.status)?.[1];
      if (target === undefined) continue;
      expect(known, `${requirement.id} is superseded by something real`).toContain(target);
    }
  });

  it('states something binding in every requirement', () => {
    for (const requirement of allRequirements) {
      expect(requirement.statement, `${requirement.id} says must or should`).toMatch(
        /\b(must|should)\b/,
      );
    }
  });
});

describe('the requirements index', () => {
  const indexRows = [...read('README.md').matchAll(INDEX_ROW)].map((match) => ({
    area: match[1]!,
    document: match[4]!,
  }));

  it('reserves an area code for every area, uniquely', () => {
    const codes = indexRows.map((row) => row.area);

    expect(codes.length).toBeGreaterThan(0);
    expect(codes).toEqual([...new Set(codes)]);
  });

  it('links each written area at a file that exists', () => {
    for (const row of indexRows) {
      const target = /\(([^)]+)\)/.exec(row.document)?.[1];
      if (target === undefined) continue;
      expect(existsSync(join(requirementsDir, target)), `${row.area} links at ${target}`).toBe(
        true,
      );
    }
  });

  it('lists every area document that has been written', () => {
    const linked = indexRows
      .map((row) => /\(([^)]+)\)/.exec(row.document)?.[1])
      .filter((target): target is string => target !== undefined)
      .sort();

    expect(linked).toEqual(areaDocuments);
  });

  it('reserves a code for every area named in the scope', () => {
    // Eighteen capability areas in Project_Scope.md section 7. A code missing here is an area
    // nobody has claimed, which is how one quietly fails to be specified at all. The number is
    // asserted rather than counted from the scope so that adding an area is a deliberate act in
    // two places, not a silent one in either.
    expect(indexRows).toHaveLength(18);
  });
});

describe('the numbered non-requirements and open questions', () => {
  const collect = (pattern: RegExp): { id: string; document: string }[] =>
    areaDocuments.flatMap((name) =>
      [...read(name).matchAll(pattern)].map((match) => ({ id: match[1]!, document: name })),
    );

  for (const [label, pattern, prefix] of [
    ['non-requirement', NON_REQUIREMENT_ROW, 'N'],
    ['open question', OPEN_QUESTION_ROW, 'Q'],
  ] as const) {
    describe(`${label}s`, () => {
      const rows = collect(pattern);

      it('exist to be checked', () => {
        expect(rows.length).toBeGreaterThan(0);
      });

      it('never reuse an identifier', () => {
        const seen = rows.map((row) => row.id);

        expect(seen).toEqual([...new Set(seen)]);
      });

      it('sit under the area code of the document holding them', () => {
        for (const row of rows) {
          expect(row.id.slice(0, 3), `${row.id} sits in ${row.document}`).toBe(
            row.document.slice(0, 3),
          );
        }
      });

      it('number from 01 with no gap and no repeat', () => {
        for (const name of areaDocuments) {
          const numbers = rows
            .filter((row) => row.document === name)
            .map((row) => Number.parseInt(row.id.slice(5), 10))
            .sort((left, right) => left - right);
          if (numbers.length === 0) continue;

          expect(numbers, `${name} ${label} numbering`).toEqual(
            numbers.map((_, index) => index + 1),
          );
        }
      });

      // Literals rather than a constructed pattern: `\d` inside a template literal collapses to a
      // bare `d`, which would leave this asserting almost nothing while still passing.
      const SHAPE = prefix === 'N' ? /^[A-Z]{3}-N\d{2}$/ : /^[A-Z]{3}-Q\d{2}$/;

      it('cannot be mistaken for a requirement identifier', () => {
        for (const row of rows) {
          expect(row.id).toMatch(SHAPE);
        }
      });
    });
  }
});
