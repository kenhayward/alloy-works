import { describe, expect, it } from 'vitest';

import { problems } from './check.js';
import type { Requirement, TraceModel } from './model.js';

const requirement = (id: string, status = 'Specified'): Requirement => ({
  id,
  area: id.slice(0, 3),
  statement: 'A widget must exist',
  tranche: 'T1',
  status,
  document: `${id.slice(0, 3)}-invented-area.md`,
  line: 1,
});

const model = (over: Partial<TraceModel>): TraceModel => ({
  requirements: [requirement('ZZZ-001'), requirement('ZZZ-002')],
  nonRequirements: [],
  questions: [],
  designs: [],
  citations: [],
  ...over,
});

describe('the problems in a corpus', () => {
  it('finds none in a corpus that is sound', () => {
    expect(problems(model({}))).toEqual([]);
  });

  it('reports a requirement two designs both claim', () => {
    const found = problems(
      model({
        designs: [
          { document: 'one.md', owns: [{ id: 'ZZZ-001', howItIsMet: 'a' }] },
          { document: 'two.md', owns: [{ id: 'ZZZ-001', howItIsMet: 'b' }] },
        ],
      }),
    );

    expect(found.map((problem) => problem.kind)).toEqual(['claimed-twice']);
    expect(found[0]?.detail).toContain('one.md');
    expect(found[0]?.detail).toContain('two.md');
  });

  it('reports a design claiming a requirement that does not exist', () => {
    const found = problems(
      model({ designs: [{ document: 'one.md', owns: [{ id: 'ZZZ-404', howItIsMet: 'a' }] }] }),
    );

    expect(found.map((problem) => problem.kind)).toEqual(['claims-unknown']);
  });

  it('reports a hole in an area, which is how a deletion disguises itself as an edit', () => {
    const found = problems({
      ...model({}),
      requirements: [requirement('ZZZ-001'), requirement('ZZZ-003')],
    });

    expect(found.map((problem) => problem.kind)).toEqual(['not-contiguous']);
  });

  it('reports the same identifier issued twice', () => {
    const found = problems({
      ...model({}),
      requirements: [requirement('ZZZ-001'), requirement('ZZZ-001')],
    });

    expect(found.map((problem) => problem.kind)).toContain('issued-twice');
  });

  it('reports a requirement whose area disagrees with the document holding it', () => {
    const stray = { ...requirement('ZZZ-002'), document: 'AAA-invented-area.md' };

    expect(
      problems({ ...model({}), requirements: [requirement('ZZZ-001'), stray] }).map((p) => p.kind),
    ).toContain('wrong-document');
  });

  it('reports a superseding status pointing at nothing', () => {
    const found = problems({
      ...model({}),
      requirements: [requirement('ZZZ-001', 'Superseded by ZZZ-404'), requirement('ZZZ-002')],
    });

    expect(found.map((problem) => problem.kind)).toEqual(['supersedes-unknown']);
  });

  it('reports a citation naming a requirement that does not exist', () => {
    const found = problems(
      model({ citations: [{ id: 'ZZZ-404', file: 'a.test.ts', line: 1, kind: 'title' }] }),
    );

    expect(found.map((problem) => problem.kind)).toEqual(['cites-unknown']);
  });

  // This is IAM-018 in the real corpus: a test names a requirement no design answers. The tool must
  // report it rather than smooth it over, because it is the exact gap this work exists to expose.
  it('reports a requirement a test cites and no design claims', () => {
    const found = problems(
      model({ citations: [{ id: 'ZZZ-001', file: 'a.test.ts', line: 1, kind: 'title' }] }),
    );

    expect(found.map((problem) => problem.kind)).toEqual(['cited-undesigned']);
    expect(found[0]?.id).toBe('ZZZ-001');
  });
});
