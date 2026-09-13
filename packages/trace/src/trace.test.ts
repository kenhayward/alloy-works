import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, compile } from './compile.js';
import { TraceModel } from './model.js';

describe('the committed trace.json', () => {
  const committed: unknown = JSON.parse(
    readFileSync(new URL('../trace.json', import.meta.url), 'utf8'),
  );

  it('is exactly what the documents compile to - run `pnpm --filter @alloy-works/trace generate` if not', () => {
    expect(committed).toEqual(compile(REPO_ROOT));
  });

  it('is a model of the shape the schema describes', () => {
    expect(() => TraceModel.parse(committed)).not.toThrow();
  });

  it('holds the corpus this plan was written against', () => {
    const model = TraceModel.parse(committed);

    expect(model.requirements).toHaveLength(1303);
    expect(model.nonRequirements).toHaveLength(112);
    expect(model.questions).toHaveLength(131);
    expect(
      new Set(model.designs.flatMap((design) => design.owns.map((claim) => claim.id))).size,
    ).toBe(175);
  });
});
