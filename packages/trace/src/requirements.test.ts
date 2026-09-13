import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, compile } from './compile.js';
import { SUPERSEDED_BY } from './model.js';

/**
 * The detailed requirements, and the identifiers work is tracked against.
 *
 * A requirement identifier is only worth citing from a commit or a test if it means exactly one
 * thing for ever. A duplicate, a renumbering, or a silent gap breaks every citation that already
 * exists, and breaks it quietly - the citation still reads fine, it just now points somewhere else.
 * So the properties that make an identifier trustworthy are pinned here rather than left to care.
 *
 * One of the two checks over the requirement corpus, which now has the workspace those comments in
 * `apps/desktop` kept asking for. `version.test.ts`, `decisions.test.ts` and `icons.test.ts` stay
 * there: they do not parse requirements.
 *
 * The shapes and vocabularies these used to assert are now refused by the parser itself, at the
 * document and line that holds the offending row, which is a better failure than a test naming a
 * value. What is left here is everything the parser cannot see from one row: uniqueness across the
 * corpus, contiguity within an area, and the index agreeing with the documents.
 */
const requirementsDir = join(REPO_ROOT, 'docs', 'specification', 'requirements');
const read = (name: string): string => readFileSync(join(requirementsDir, name), 'utf8');

const model = compile(REPO_ROOT);
const allRequirements = model.requirements;
const areaDocuments = [
  ...new Set(allRequirements.map((requirement) => requirement.document)),
].sort();

describe('the requirement identifiers', () => {
  it('has requirements to check', () => {
    expect(areaDocuments.length).toBeGreaterThan(0);
    expect(allRequirements.length).toBeGreaterThan(0);
  });

  it('never issues the same identifier twice', () => {
    const seen = allRequirements.map((requirement) => requirement.id);

    expect(seen).toEqual([...new Set(seen)]);
  });

  it('keeps every requirement under the area code of the document holding it', () => {
    for (const name of areaDocuments) {
      const area = name.slice(0, 3);
      for (const requirement of allRequirements.filter(
        (requirement) => requirement.document === name,
      )) {
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
      const numbers = allRequirements
        .filter((requirement) => requirement.document === name)
        .map((requirement) => Number.parseInt(requirement.id.slice(4), 10))
        .sort((left, right) => left - right);

      expect(numbers, `${name} numbers contiguously`).toEqual(numbers.map((_, index) => index + 1));
    }
  });

  it('points every superseding status at a requirement that exists', () => {
    const known = new Set(allRequirements.map((requirement) => requirement.id));
    for (const requirement of allRequirements) {
      const target = SUPERSEDED_BY.exec(requirement.status)?.[1];
      if (target === undefined) continue;
      expect(known, `${requirement.id} is superseded by something real`).toContain(target);
    }
  });

  it('refuses a malformed row at the document and line holding it', async () => {
    const { parseAreaDocument } = await import('./parse/requirements.js');

    expect(() =>
      parseAreaDocument('ZZZ-invented.md', '| **ZZZ-001** | No verb here | T1 | Specified |'),
    ).toThrow(/ZZZ-invented\.md:1/);
  });
});

/** `| **CNT** | Content and authoring | 7.1 | [file](file) |` in the index. Not something the
 * parser produces - it belongs to the README, not to an area document. */
const INDEX_ROW =
  /^\|\s*\*\*([A-Z]{3})\*\*\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/gm;

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
    // Twenty-one capability areas in Project_Scope.md section 7. A code missing here is an area
    // nobody has claimed, which is how one quietly fails to be specified at all. The number is
    // asserted rather than counted from the scope so that adding an area is a deliberate act in
    // two places, not a silent one in either.
    expect(indexRows).toHaveLength(21);
  });
});

describe('the numbered non-requirements and open questions', () => {
  for (const [label, rows, offset] of [
    ['non-requirement', model.nonRequirements, 5],
    ['open question', model.questions, 5],
  ] as const) {
    describe(`${label}s`, () => {
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
            .map((row) => Number.parseInt(row.id.slice(offset), 10))
            .sort((left, right) => left - right);
          if (numbers.length === 0) continue;

          expect(numbers, `${name} ${label} numbering`).toEqual(
            numbers.map((_, index) => index + 1),
          );
        }
      });
    });
  }
});

/**
 * Every artifact the scope defines has to appear in the ownership map, even if what it says is that
 * nobody owns it yet.
 *
 * Two of the nineteen areas - STY and TPL - exist because somebody asked "is this covered
 * elsewhere?" and the answer turned out to be no. Both were found by luck. A concept can be listed
 * as unowned here, deliberately and visibly; what it cannot be is absent, which is how the first two
 * went unnoticed.
 */
describe('the ownership map', () => {
  const scope = readFileSync(join(REPO_ROOT, 'docs', 'specification', 'Project_Scope.md'), 'utf8');

  const between = (text: string, from: string, to: string): string => {
    const start = text.indexOf(from);
    const end = text.indexOf(to, start + 1);
    expect(start, `found "${from}"`).toBeGreaterThan(-1);
    expect(end, `found "${to}"`).toBeGreaterThan(start);
    return text.slice(start, end);
  };

  /**
   * A definition names a thing and then describes it: `- **Tenant** - a customer` in a list, or
   * `| **Metadata schema** | ...` in a table. What that deliberately excludes is a bolded sentence
   * making a point - section 6 has one, about numbering belonging to the outline - which is a rule
   * rather than an artifact and has nothing to own it.
   */
  const definedNames = (text: string): string[] => [
    ...new Set([
      ...[...text.matchAll(/^- \*\*([^*]+)\*\* - /gm)].map((match) => match[1]!.trim()),
      ...[...text.matchAll(/^\| \*\*([^*]+)\*\* +\|/gm)].map((match) => match[1]!.trim()),
    ]),
  ];

  const scopeConcepts = definedNames(
    between(scope, '## 6. Core concepts', '## 7. Capability scope'),
  );
  const mapped = new Set(
    definedNames(
      between(read('README.md'), '## Who owns what', '## The shape of an area document'),
    ),
  );

  it('found the concepts to check', () => {
    expect(scopeConcepts.length).toBeGreaterThan(20);
  });

  it('accounts for every concept the scope defines', () => {
    const missing = scopeConcepts.filter((concept) => !mapped.has(concept));

    expect(missing, 'concepts defined in the scope but absent from the ownership map').toEqual([]);
  });
});
