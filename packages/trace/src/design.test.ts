import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { problems } from './check.js';
import { REPO_ROOT, compile } from './compile.js';

/**
 * The design documents, and the requirements each of them claims.
 *
 * Requirements say what the product must do; design documents say how. The link between them is
 * the only thing that turns 1,303 identifiers into a tracker rather than a list, and it is exactly
 * the kind of cross-reference that rots - a requirement gets renumbered, a design doc gets renamed,
 * and the citation still reads fine while pointing at nothing.
 *
 * So the mapping is asserted rather than trusted, in the same spirit as `decisions.test.ts` next
 * door. The direction matters: a design document names the requirements it owns, and this test
 * builds the reverse index. Nothing is hand-maintained inside the requirements themselves, because
 * a coverage column edited by a person is a coverage column that drifts.
 *
 * One of the two checks over the requirement corpus, which now has the workspace those comments in
 * `apps/desktop` kept asking for. `version.test.ts`, `decisions.test.ts` and `icons.test.ts` stay
 * there: they do not parse requirements.
 */
const designDir = join(REPO_ROOT, 'docs', 'design');

const read = (...parts: string[]): string => readFileSync(join(designDir, ...parts), 'utf8');

const model = compile(REPO_ROOT);
const designDocuments = model.designs.map((design) => design.document);
const ownedBy = (document: string): string[] =>
  model.designs.find((design) => design.document === document)?.owns.map((claim) => claim.id) ?? [];

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
    expect(problems(model).filter((problem) => problem.kind === 'claims-unknown')).toEqual([]);
  });

  it('gives every requirement at most one owning design', () => {
    expect(problems(model).filter((problem) => problem.kind === 'claimed-twice')).toEqual([]);
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
