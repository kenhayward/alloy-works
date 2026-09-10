import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The design documents, and the requirements each of them claims.
 *
 * Requirements say what the product must do; design documents say how. The link between them is
 * the only thing that turns 869 identifiers into a tracker rather than a list, and it is exactly
 * the kind of cross-reference that rots - a requirement gets renumbered, a design doc gets renamed,
 * and the citation still reads fine while pointing at nothing.
 *
 * So the mapping is asserted rather than trusted, in the same spirit as `decisions.test.ts` next
 * door. The direction matters: a design document names the requirements it owns, and this test
 * builds the reverse index. Nothing is hand-maintained inside the requirements themselves, because
 * a coverage column edited by a person is a coverage column that drifts.
 *
 * Third of the repository-wide checks in this package. At four they want a workspace of their own.
 */
const repoRoot = join(process.cwd(), '..', '..');
const designDir = join(repoRoot, 'docs', 'design');
const requirementsDir = join(repoRoot, 'docs', 'specification', 'requirements');

const read = (...parts: string[]): string => readFileSync(join(designDir, ...parts), 'utf8');

const designDocuments = existsSync(designDir)
  ? readdirSync(designDir)
      .filter((name) => name.endsWith('.md') && name !== 'README.md')
      .sort()
  : [];

/** Every identifier that exists to be claimed, gathered from the requirements documents. */
const REQUIREMENT_ROW = /^\|\s*\*\*([A-Z]{3}-\d{3})\*\*\s*\|/gm;

const knownRequirements = new Set(
  readdirSync(requirementsDir)
    .filter((name) => /^[A-Z]{3}-.+\.md$/.test(name))
    .flatMap((name) => [
      ...readFileSync(join(requirementsDir, name), 'utf8').matchAll(REQUIREMENT_ROW),
    ])
    .map((match) => match[1]!),
);

/**
 * `| **VER-001** | how it is met |` inside the Requirements owned section. Only that section
 * counts: a design document mentions plenty of identifiers in prose, and mentioning one is not
 * claiming it.
 */
const OWNED_ROW = /^\|\s*\*\*([A-Z]{3}-\d{3})\*\*\s*\|/gm;

function between(text: string, startHeading: string, endPattern: RegExp): string {
  const start = text.indexOf(startHeading);
  if (start === -1) return '';
  const rest = text.slice(start + startHeading.length);
  const end = rest.search(endPattern);
  return end === -1 ? rest : rest.slice(0, end);
}

function ownedBy(document: string): string[] {
  const section = between(read(document), '## Requirements owned', /^## /m);
  return [...section.matchAll(OWNED_ROW)].map((match) => match[1]!);
}

const ownership = new Map<string, string[]>();
for (const document of designDocuments) {
  for (const id of ownedBy(document)) {
    ownership.set(id, [...(ownership.get(id) ?? []), document]);
  }
}

describe('design documents', () => {
  it('has a design folder with at least one document in it', () => {
    expect(existsSync(designDir), `${designDir} should exist`).toBe(true);
    expect(designDocuments.length).toBeGreaterThan(0);
  });

  it('gives every design document a title and a requirements section', () => {
    for (const document of designDocuments) {
      const text = read(document);
      expect(text, `${document} starts with a level-one heading`).toMatch(/^# .+/);
      expect(text, `${document} declares what it owns`).toContain('## Requirements owned');
    }
  });

  it('claims only requirements that exist', () => {
    for (const [id, documents] of ownership) {
      expect(knownRequirements.has(id), `${documents.join(', ')} claims unknown ${id}`).toBe(true);
    }
  });

  it('gives every requirement at most one owning design', () => {
    for (const [id, documents] of ownership) {
      expect(documents, `${id} is owned by more than one design`).toHaveLength(1);
    }
  });

  it('claims something in every design document', () => {
    for (const document of designDocuments) {
      expect(ownedBy(document).length, `${document} owns no requirement`).toBeGreaterThan(0);
    }
  });

  it('indexes every design document in the folder README', () => {
    const readme = read('README.md');
    for (const document of designDocuments) {
      expect(readme, `${document} is missing from docs/design/README.md`).toContain(
        `(${document})`,
      );
    }
  });

  it('links only to design documents that exist', () => {
    const readme = read('README.md');
    const linked = [...readme.matchAll(/\]\(([a-z0-9-]+\.md)\)/g)].map((match) => match[1]!);
    for (const target of linked) {
      expect(existsSync(join(designDir, target)), `README links missing ${target}`).toBe(true);
    }
  });
});
