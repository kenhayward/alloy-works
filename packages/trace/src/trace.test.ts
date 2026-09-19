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

    // 1369, from 1368: STR-063, the service's share of STR-039's budget (issue #119), narrowed.
    // 1368, from 1367: IAM-073, a number an outline produces revealing nothing about a component the
    // reader may not read (issue #130), landed by the numbering plan and narrowed from the issue's "a
    // number, count or order", which asked more than structure.md answers.
    // 1367, from 1366: STR-062, a cross-reference to a block resolving against exactly one occurrence
    // (issue #73), landed by the third content-model plan.
    // 1366, from 1365: STR-061, what a document is - a named, versioned artifact in exactly one space
    // with its own title and identity (issue #120), filed while planning the first structure plan.
    // 1365, from 1364: CNT-149, creating a component in a space the author may create in (issue #115).
    // 1364, from 1363: IAM-072, inviting anybody by address and granting before their first sign-in,
    // filed as issue #113 while planning invitations, when IAM-059 asked it only of the first administrator.
    // 1363, from 1362: MET-037 refuses a field version that would make a schema's default invalid,
    // found while planning the metadata rules. 1362, from 1360: CNT-147 and CNT-148 replaced CNT-099 and CNT-101, because native spellcheck
    // ignores an element's language. 1360, not 1306: specifying metadata and component types added the MET area's 36 rows and 18
    // more elsewhere, superseding 18 - TPL's schema rows among them, because a template now assigns
    // schemas it does not own. Before that, 1306 from 1303: CNT-142 to CNT-144 gave a component a
    // title of its own.
    expect(model.requirements).toHaveLength(1369);
    expect(model.nonRequirements).toHaveLength(117);
    expect(model.questions).toHaveLength(135);
    // 361, from 360: structure.md claims STR-063, which the navigation plan measures in the service
    // suite.
    // 360, from 361: structure.md stopped claiming STR-023 when the build gave a caption met in
    // appendix matter before any numbered appendix no number - an exception STR-017 does not cover,
    // so the row answered it only in part. The gap is named in prose beside the table, and issue #129
    // reopens STR-023 with a superseding row.
    // 361, from 360: structure.md claims IAM-073 ("Who is shown what"): a reader is numbered only from
    // what they may read, and every number an unreadable component could have moved is null.
    // 360, from 361: structure.md stopped claiming STR-026, which the built target union answers only
    // in part - it has no bibliography entry arm, and a component cannot reference a section - so the
    // claim was dropped and the gap named in prose (the third content-model plan's final fix wave).
    // 361, from 359: structure.md claims STR-062, and STR-056, which it had always answered ("A `block`
    // target has no occurrence") and neither claimed nor listed as unclaimed.
    // 359, from 358: structure.md claims STR-061, the document as an artifact of its own kind, which
    // it answers by construction.
    // 358, from 319: structure.md claims 39 - the document artifact, its outline, numbering, captions,
    // cross-references, the contents panel, deep links and page breaks, plus CNT-041 and CNT-047, the
    // two numbering clauses content-model.md left for STR. Sixteen more of STR's are deliberately
    // unclaimed, most of them because PUB's layout declares what this design applies, or because the
    // named failure is produced here and the publish that fails on it is PUB's; that document names
    // each one.
    // 319, from 318: component-editor.md claims CNT-149 once creating a component is an act somebody
    // performs rather than a shape somebody is given.
    // 318, from 317: access.md claims IAM-072 once any administrator of the environment invites an
    // address and grants it before the first sign-in (docs/plans/2026-09-17-access-03-invitations.md).
    // 317, from 316: access.md claims IAM-059 once the first administrator arrives by an invitation to
    // a named address (docs/plans/2026-09-17-access-03-invitations.md); IAM-060, its audit, stays LIF's.
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
    ).toBe(361);
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
  // cite thirteen of the requirements access.md owns - IAM-014, IAM-019, IAM-021, IAM-022, IAM-025,
  // IAM-026, IAM-027, IAM-049, IAM-062, IAM-063, IAM-071, MET-024 and API-053 - once each, across two
  // domain, four database and one service test file. Inheritance through templates and documents
  // (IAM-024, IAM-018), the Access view (IAM-029 to IAM-031) and provider groups (IAM-009) wait, and
  // the plan names each and what it waits for.
  // 135, from 134: opening, editing and saving a component (docs/plans/2026-09-16-editor-01-open-edit-and-save.md)
  // cites VER-001, which storage-and-versioning.md owns, in the database tests of the lock and iterations.
  // 137, from 135: the same plan cites VER-006 and COL-010 in the database tests of cutting and releasing.
  // 139, from 137: and API-039 and CNT-071, which component-editor.md owns, in the service's session tests.
  // 141, from 139: and CNT-066 and CNT-070 in the renderer's session tests.
  // 142, from 141: and CNT-068 in the save indicator's, eight citations in all, once each. The lock's
  // tenant setting (COL-008), recovery (CNT-067, CNT-090), undo across a reload (CNT-069, CNT-103) and
  // paste (CNT-063) wait, and the plan names each and what it waits for.
  // 144, from 142: managing grants (docs/plans/2026-09-17-access-02-managing-grants.md) cites IAM-030
  // and IAM-031, which access.md owns, in the Access page's tests: each answer names its level and
  // grants, and a refusal its denials or the levels that granted nothing. IAM-029 waits for an Access
  // page on every kind of artifact, and the plan names it and the rest.
  // 145, from 144: invitations (docs/plans/2026-09-17-access-03-invitations.md) cite IAM-059, which
  // access.md now owns, once, in the service's first administrator test: invited to a named address,
  // and Administrator from the first sign-in through a permitted route that verifies it. IAM-060, the
  // bootstrap's audit, waits for LIF's log.
  // 146, from 145: and IAM-072, which access.md owns, once, in the service's invitation routes test: an
  // administrator invites an address and grants it before anybody signs in with it, an account presenting
  // it unverified gets nothing, and the first verified sign-in through a permitted route has the access.
  // 147, from 146: and MET-011, which component-editor.md owns, once, in the service's component
  // creation test: a create naming no type takes the environment's default, one naming one takes that
  // one, one naming a type this environment does not hold is refused, and the version row records
  // exactly one component type either way.
  // 148, from 147: and CNT-143, which content-model.md owns, once, in the same file: a title and a
  // base language changed in an iteration and cut are what the new version carries, while the version
  // before still carries the old.
  // 149, from 148: and CNT-149, which component-editor.md owns, once, in the renderer's create form
  // (apps/web/src/editor/NewComponent.test.tsx): the spaces offered are only those the service says
  // the caller may create in, a title, a language tag and a direction are given and sent exactly as
  // typed, and the page opens what came back. MET-011 appears only in a comment there, a mention
  // rather than a demonstration of its own statement, so it does not move this count.
  // 154, from 149: the document and its outline (docs/plans/2026-09-18-structure-01-the-document-and-its-outline.md)
  // cites STR-001, STR-002, STR-048, STR-049 and STR-058 in the outline's schema.
  // 157, from 154: the same plan cites STR-003, STR-007 and STR-010 in the operations
  // (packages/domain/src/structure/operations.test.ts): every node gets a stable identifier that a
  // remove never hands back out, the tree nests to nine levels with no maximum the schema declares,
  // and one component referenced twice is two nodes with their own identity and their own switches.
  // 160, from 157: the same plan cites STR-054, STR-059 and STR-061 in the service's document routes
  // (apps/service/src/document-routes.test.ts): a document created, opened and listed with no nodes;
  // two acts from one version, one recorded and one refused against the current outline, the chain
  // holding only the winner's version; and a document made a named, versioned artifact in exactly one
  // space, its title inside its versioned content. The plan's 161 also counted STR-004, cited nowhere
  // because the test shows a construction rather than its statement. Task 5 cites STR-059 again,
  // where its conflict detection in the interface is built.
  // 162, from 160: the same plan cites STR-008 and STR-059 in the renderer's documents page
  // (apps/web/src/structure/DocumentPage.test.tsx): one move from the keymap sends one operation
  // naming the node and not its subtree, the subtree travels, and one Ctrl+Z sends the one inverse
  // that puts it all back; and a conflicting act answered 409 renders the outline the refusal carried,
  // says somebody else changed the document, and leaves nothing on the undo stack to overwrite it.
  // 163, from 162: the structure plan's final fix wave cites STR-003 a second time, in the store
  // (packages/db/src/documents.test.ts), where the identifier comes from node:crypto rather than a
  // test's counter: allocated at the insert, carried unchanged into the next version, and never handed
  // to the node inserted after it was removed.
  // 163 still: the third content-model plan's CNT-002 test sits in a file that already cites CNT-002,
  // and a file cites an identifier once.
  // 173, from 163: the numbering plan (docs/plans/2026-09-18-structure-02-numbering.md) cites ten
  // requirements structure.md claims, all in packages/domain/src/structure/numbering.test.ts: STR-014,
  // STR-015, STR-016, STR-017, STR-018, STR-021, STR-022, STR-023, CNT-041 and CNT-047.
  // 174, from 173: the same plan cites IAM-073, landed by it, in the numbering route's tests
  // (apps/service/src/numbering-routes.test.ts): a reader who may not read a component is shown no
  // number it could have moved, across a restart, and their answer does not move by a byte when the
  // component's content changes.
  // 173, from 174: STR-023's identifier left the title of its test in numbering.test.ts when
  // structure.md stopped claiming it; the test stays, citing nothing.
  // 175, from 173: the navigation plan (docs/plans/2026-09-18-structure-03-navigation.md) cites
  // STR-040 and STR-041 in packages/domain/src/structure/lists.test.ts: a contents generated to a
  // declared depth, and a list of figures, of tables and of equations.
  // 176, from 175: the same plan cites STR-063, landed by it, in
  // apps/service/src/navigation-budget.test.ts, which measures the service's routes over a document
  // of five hundred nodes.
  // 178, from 176: the same plan cites STR-044 and STR-046 in
  // apps/web/src/structure/DocumentPage.test.tsx: every node's address names its document and itself
  // and opens the document there, and the same address finds the same node after a reorder.
  // 180, from 178: the same plan cites IAM-073 a second time, in
  // apps/web/src/structure/DocumentPage.test.tsx, where the page now numbers captions itself and shows a
  // reader none a component they may not read could have moved; and STR-037, reordering from the
  // contents by key and by pointer.
  it('cites exactly as many times as the corpus currently does', () => {
    expect(model.citations).toHaveLength(180);
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
    // 7, from 6: NewComponent.test.tsx, which cites CNT-149.
    // 8, from 7: structure/DocumentPage.test.tsx, which cites STR-008 and STR-059.
    expect(files.filter((file) => file.endsWith('.tsx'))).toHaveLength(8);
  });
});
