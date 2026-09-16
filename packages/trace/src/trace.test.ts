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

    // 1363, from 1362: MET-037 refuses a field version that would make a schema's default invalid,
    // found while planning the metadata rules. 1362, from 1360: CNT-147 and CNT-148 replaced CNT-099 and CNT-101, because native spellcheck
    // ignores an element's language. 1360, not 1306: specifying metadata and component types added the MET area's 36 rows and 18
    // more elsewhere, superseding 18 - TPL's schema rows among them, because a template now assigns
    // schemas it does not own. Before that, 1306 from 1303: CNT-142 to CNT-144 gave a component a
    // title of its own.
    expect(model.requirements).toHaveLength(1363);
    expect(model.nonRequirements).toHaveLength(117);
    expect(model.questions).toHaveLength(135);
    // 316, from 295: access.md claims 21 - spaces, roles, grants, deciding and explaining, and the
    // rules on external principals - and claims none it answers only in part.
    // 295, from 256: metadata.md claims 15 - the rules resolving, validating and carrying a
    // component's metadata - and component-editor.md claims 24, the editor, its session and the
    // metadata panel. Neither claims a requirement it answers only for a component.
    // 256, from 252: storage-and-versioning.md claims MET-015, MET-016, CNT-145 and VER-042 once a
    // version records its metadata values, its component type and a digest over all of it, which
    // ADR-0024 decided when a metadata-only change would otherwise have been refused as unchanged.
    // 252, from 253: docs/design/relationships.md stopped claiming REL-003 when REL-053 superseded
    // it, because the design stores a JSON Schema per type and REL-053 wants the tenant's shared
    // metadata schemas - a broader requirement, so the claim was dropped rather than repointed.
    // content-model.md swapped CNT-144 for CNT-146, which leaves its count unchanged.
    // 253, from 172: docs/design/content-model.md claims 81 - the first design document for
    // tranche T1. Twelve more of CNT's were left deliberately unclaimed because the model answers
    // one clause and the outline or the publisher answers the other; that document names them.
    // The 172 before it: three designs stopped claiming a requirement a later review superseded,
    // the replacement being broader than what the design answers, so the claim was dropped rather
    // than repointed. docs/design/ says so in prose beside each table.
    expect(
      new Set(model.designs.flatMap((design) => design.owns.map((claim) => claim.id))).size,
    ).toBe(316);
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
  // 103, from 61: the metadata rules (docs/plans/2026-09-15-metadata-01-the-rules.md) add 43
  // citations across the metadata test files, fewer than the plan's predicted 112 - implementation
  // dropped several titles' requirement identifiers under the controller's rule that a test cites a
  // requirement only when it demonstrates that requirement's own statement, not one nearby. The
  // final review's fix wave then drops one more: migrate.test.ts's only MET-006 citation, ruled a
  // mention of a nearby requirement rather than a demonstration of its own, taking 104 to 103.
  // 112, from 103: the version chain (docs/plans/2026-09-15-storage-01-the-version-chain.md) cites
  // six of the requirements storage-and-versioning.md owns - VER-007, VER-008, VER-010, VER-042,
  // CNT-145 and MET-016 - nine times across three database test files. The rest it builds in part
  // and leaves uncited, and the plan names each and what it waits for.
  // 121, from 112: the admission pipeline (docs/plans/2026-09-15-content-model-02-the-admission-pipeline.md)
  // cites nine of the requirements content-model.md claims for admission - CNT-056, CNT-064, CNT-065,
  // CNT-127, CNT-131, CNT-132, CNT-133, CNT-134 and CNT-135 - nine times across three domain test files.
  // CNT-130 and CNT-063 are built in part and left uncited, and the plan says what each waits for.
  // 134, from 121: roles, grants and the decision (docs/plans/2026-09-16-access-01-roles-grants-and-the-decision.md)
  // cite IAM-014, IAM-019, IAM-021, IAM-022, IAM-025, IAM-026, IAM-027, IAM-049, IAM-062, IAM-063,
  // IAM-071, MET-024 and API-053, once each, in two domain, four database and one service test file.
  it('cites exactly as many times as the corpus currently does', () => {
    expect(model.citations).toHaveLength(134);
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
