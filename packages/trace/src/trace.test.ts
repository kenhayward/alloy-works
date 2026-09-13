import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT, compile, testFilesIn } from './compile.js';
import { RESERVED_AREA, TraceModel } from './model.js';

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

    // 1306, not 1303: designing the content model found the specification calling a component
    // "titled" in scope section 6 while no area gave one a title. CNT-142 to CNT-144 add the
    // title, carry it in versioned content, and close the set of attributes every component has.
    expect(model.requirements).toHaveLength(1306);
    expect(model.nonRequirements).toHaveLength(112);
    expect(model.questions).toHaveLength(131);
    // 253, from 172: docs/design/content-model.md claims 81 - the first design document for
    // tranche T1. Twelve more of CNT's were left deliberately unclaimed because the model answers
    // one clause and the outline or the publisher answers the other; that document names them.
    // The 172 before it: three designs stopped claiming a requirement a later review superseded,
    // the replacement being broader than what the design answers, so the claim was dropped rather
    // than repointed. docs/design/ says so in prose beside each table.
    expect(
      new Set(model.designs.flatMap((design) => design.owns.map((claim) => claim.id))).size,
    ).toBe(253);
  });
});

describe('the citations in the committed model', () => {
  const model = TraceModel.parse(
    JSON.parse(readFileSync(new URL('../trace.json', import.meta.url), 'utf8')),
  );

  it('found the identifiers this repository already cites in its test titles', () => {
    const cited = new Set(model.citations.map((citation) => citation.id));

    // Twelve requirement identifiers appear anywhere in a test file; these are the ones that
    // appear in a title or a rule, which is the only kind that counts as coverage.
    expect(cited.has('IAM-043')).toBe(true);
    expect(cited.has('IAM-054')).toBe(true);
    expect(cited.has('STY-050')).toBe(true);

    // IAM-018 is deliberately absent. apps/service/src/http.test.ts used it as the sample rule in a
    // fixture refusal, so the scan read a test about error envelopes as verification of a permission
    // requirement. The fixture names ZZZ-001 now, which the scan ignores.
    expect(cited.has('IAM-018')).toBe(false);
    expect(cited.size).toBeGreaterThan(5);
  });

  // A hard number, not a lower bound: `cited.size` above only counts distinct identifiers, so a
  // citation added to a requirement already cited elsewhere - as STY-050 and STY-051 gained a second
  // and third one in the Word and Typst projection tests - would move this count without moving
  // that one. Pinned so a citation quietly lost (a test renamed, a title's identifier dropped) fails
  // here rather than nowhere.
  it('cites exactly as many times as the corpus currently does', () => {
    expect(model.citations).toHaveLength(18);
  });

  it('cites no identifier the corpus does not hold', () => {
    const known = new Set(model.requirements.map((requirement) => requirement.id));
    const unknown = model.citations.map((citation) => citation.id).filter((id) => !known.has(id));

    expect(unknown).toEqual([]);
  });

  it('never cites the reserved fixture area', () => {
    const reserved = model.citations.filter(
      (citation) => citation.id.slice(0, 3) === RESERVED_AREA,
    );

    expect(reserved).toEqual([]);
  });

  it('records a path a person can open, relative to the repository root', () => {
    for (const citation of model.citations) {
      expect(citation.file, `${citation.id} path`).toMatch(/^(apps|packages|tests)\//);
      expect(citation.file).not.toContain('\\');
    }
  });
});

describe('scanning the repository for test files', () => {
  it('does not scan its own tests, whose fixtures name identifiers on purpose', () => {
    expect(testFilesIn(REPO_ROOT).filter((file) => file.startsWith('packages/trace/'))).toEqual([]);
  });

  it('does scan the other workspaces, so the exclusion is narrow', () => {
    const files = testFilesIn(REPO_ROOT);

    expect(files.some((file) => file.startsWith('apps/service/'))).toBe(true);
    expect(files.some((file) => file.startsWith('packages/domain/'))).toBe(true);
  });

  it('scans React test files too, since the renderer will cite requirements as it grows', () => {
    const files = testFilesIn(REPO_ROOT);

    expect(files).toContain('apps/web/src/App.test.tsx');
    expect(files.filter((file) => file.endsWith('.tsx'))).toHaveLength(2);
  });
});
