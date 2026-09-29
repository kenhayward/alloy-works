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

    // 1449, from 1392: the T1 audit against the code (2026-09-25) - 57 new rows splitting 28 by
    // tranche, the T1 half superseding each row and the rest rows of their own in T2 to T6. Fifteen
    // rows moved tranche whole and keep their identifiers, so they leave the count alone.
    // 1392, from 1388: STY-074 to STY-077, STY-048 and STY-012 each split by tranche for the themes
    // design (TH-H, TH-I) - the T1 half superseding the row, the rest a row of its own in T6 or T2.
    // 1388, from 1387: AST-051, each asset format declaring how it is made safe - scanned, or proved
    // by a strict parse and a full decode - superseding AST-003's scan of everything (issue #206).
    // 1387, from 1386: TAB-049, header rows associated in every output and header columns wherever
    // the format can express one, superseding TAB-031, which Word could never meet (issue #202).
    // 1386, from 1385: CNT-153, an ordered list's start number of 1 or more except in decimal,
    // superseding CNT-119, which permitted the roman zero the engine sets as `n.`, landed by the
    // lists plan. CNT-119 keeps its row as `Superseded by CNT-153`, so the count rises by one.
    // 1385, from 1384: CNT-152, a language tag the model takes and no output can carry named to the
    // author at the time, before the mark is applied (issue #155), landed by the marks plan.
    // 1384, from 1383: PUB-095, a layout's words in one declared language, and a document in another
    // refused naming both (issue #144), landed by the second publishing plan.
    // 1383, from 1382: STR-064, front matter only at the top level and before the rest of the outline
    // (issue #152), landed by the second publishing plan.
    // 1382, from 1381: PUB-094, publishing never containing what its publisher could not read (issue
    // #143), landed by the first publishing plan. IAM-074 is withdrawn for it and keeps its row, so it
    // still counts.
    // 1381, from 1380: PUB-093, a publication not made from a baseline saying it is not approved
    // (issue #142), landed by the first publishing plan.
    // 1380, from 1369: Ken's answer to the publishing design (2026-09-19) - eleven new rows, each
    // superseding one: PUB-085 (PUB-064's budget, p95 ten seconds), PUB-086 (PUB-001), PUB-087
    // (PUB-015, the regression corpus), PUB-088 and PUB-089 (PUB-010 split, the approval page to T3),
    // PUB-090 (PUB-030, PDF/UA-1 and veraPDF), PUB-091 (PUB-036), PUB-092 (PUB-018, "honoured"
    // defined), CNT-150 (CNT-095, PDF alone), CNT-151 (CNT-136, from the save) and IAM-074 (IAM-017,
    // the publisher's permission). TPL-030 is withdrawn and keeps its row, so it still counts.
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
    // 1477, from 1476 (2026-09-29): PUB-105 supersedes PUB-104, the Matterhorn review made before each release rather than on each change (issue #344).
    // 1476, from 1474 (2026-09-29): W13.3 - STR-072 supersedes STR-039 (issue #134) and CNT-179 supersedes CNT-076 (issue #339), the navigation budgets with numbers.
    // 1474, from 1472 (2026-09-28): W13.4 - STY-080 and STY-081 supersede STY-053, the editor and Word each measured against the PDF (issue #328).
    // 1472, from 1471 (2026-09-28): W14.4 - STR-071 supersedes STR-070, a figure or a table explicitly unnumbered (issue #129).
    // 1471, from 1470 (2026-09-28): W14.7's final review - CNT-178 supersedes CNT-148, because macOS chooses its spelling checker's languages itself.
    // 1470, from 1458 (2026-09-28): the T1 audit's last decisions and rewordings: CNT-176 and CNT-177, PUB-098 to PUB-104, IAM-080 and IAM-081 supersede the rows they split, and STY-079 is new (issue #306).
    // 1458, from 1449 (2026-09-26): the rewordings Ken agreed after the T1 audit (K7, and W1's three): CNT-171 to CNT-175, STR-070, MET-042, STY-078 and API-061 supersede the rows they reword.
    expect(model.requirements).toHaveLength(1477);
    expect(model.nonRequirements).toHaveLength(117);
    expect(model.questions).toHaveLength(135);
    // 504, from 503 (2026-09-29): publishing.md claims PUB-105, the Matterhorn review before each release, verified by attestation as CNT-177 is (issue #344).
    // 503, from 502 (2026-09-29): W13.3 - document-view.md claims CNT-179, measured green by the browser suite's budgets.test.ts on the reference machine; STR-072 is not claimed, since the document opened cold misses its number (structure.md names the gap).
    // 502, from 503 (2026-09-28): W13.4 after W13.2 - themes.md does not claim STY-080 (issues #331, #333 named beside its table).
    // 503, from 504 (2026-09-28): W13.2's final review - publishing.md drops PUB-104, which asks for the review on each change and the guide makes it before each release; the gap is named beside its table.
    // 504, from 500 (2026-09-28): W13.2 - component-editor.md claims CNT-176, CNT-177 and CNT-078, and publishing.md PUB-104, each verified by the browser suite or a person's attestation.
    // 500, from 498 (2026-09-28): W14.5 - themes.md claims STY-079 and STR-025, which structure.md left unclaimed.
    // 498, from 497 (2026-09-28): W14.6 - service-foundations.md claims IAM-075, store by store, once #314 sealed each environment's sign-in secret.
    // 497, from 496 (2026-09-28): W14.4 after W14.6 - publishing.md claims TAB-034; structure.md's STR-070 claim moved to STR-071.
    // 496, from 497 (2026-09-28): W14.3's final review - themes.md drops PUB-092 and names the gap: its
    // tests show the PDF's pagination and Word's keep properties, and nothing measures Word's pages.
    // 497, from 496 (2026-09-28): W14.6 - word-output.md claims PUB-100.
    // 496, from 494 (2026-09-28): W14.2 - publishing.md claims PUB-103, six heading levels, and PUB-102, the 300-page budget.
    // 494, from 493 (2026-09-28): document-view.md claims IAM-080, IAM-023's T1 half; publishing.md's PUB-003 claim moved to PUB-098.
    // 493, from 492 (2026-09-27): W10.0 - publishing.md claims CNT-150, the preview beside the text.
    // 492, from 483 (2026-09-27): W9.0 - document-view.md claims CNT-072, CNT-073, CNT-154, CNT-105,
    // CNT-156, CNT-158, CNT-162, STR-035 and STR-045; IAM-023 waits on CNT-155's review mode, T3.
    // 483, from 481 (2026-09-27): W8.0 - themes.md claims STY-070 and CNT-122.
    // 481, from 479 (2026-09-27): W7.0 - service-foundations.md claims SCH-022 and SCH-064.
    // 479, from 467 (2026-09-27): W6.0 - search.md claims SCH-054, 002, 011, 012, 016, 017, 039, 046,
    // 057, 059, 062 and 066.
    // 467, from 460 (2026-09-27): W5.0 - definitions.md claims MET-041, MET-031, MET-008, MET-040,
    // MET-037, MET-021 and MET-023.
    // 460, from 447 (2026-09-27): W4.0 - templates.md claims twelve TPL and STR-060.
    // 447, from 446 (2026-09-26): W2.3 - content-model.md claims CNT-167.
    // 446, from 444 (2026-09-26): W2.2 - service-foundations.md claims API-037 and API-047.
    // 444, from 443 (2026-09-26): W2.1b - component-editor.md claims CNT-175.
    // 443, from 441 (2026-09-26): W2.1 - component-editor.md claims CNT-075 and CNT-074.
    // 441, from 435 (2026-09-26): the rewordings claim CNT-171, CNT-172, CNT-173, STR-070, MET-042
    // and API-061; CNT-174 and STY-078 take CNT-089's and STY-019's claims.
    // 435, from 432 (2026-09-26): W1.3 - publishing.md claims PUB-031 and PUB-069, and structure.md
    // CNT-160, each measured and demonstrated before it was claimed. CNT-166 stays unclaimed: U+0000
    // is refused and text is kept in NFC, which "the full Unicode range" does not allow for.
    // 432, from 434 (2026-09-26): content-model.md stopped claiming CNT-061 and CNT-062, whose paste
    // keeps a heading as a paragraph where "must preserve structure" makes no exception (W1.2's final
    // review); named in prose beside the table until they are reworded as CNT-167 was.
    // 434, from 436 (2026-09-26): word-output.md stopped claiming PUB-023 and PUB-035, which Word 4's
    // final review found claimed for more than the design gives - PUB-023's first-class kept by
    // STY-053's suite, not built, and PUB-035's same terms asking for structures Word does not carry
    // here - each named in prose beside the table rather than repointed.
    // 436, from 434: the Word output design measured in Word claims CNT-045, one MathML drawn in the
    // editor and set by both writers from one maths tree, and CNT-128, a link in the PDF and in Word.
    // 434, from 429: the T1 audit's review. Designs that already answered a split row's T1 half in
    // their own words claim it: structure.md STR-068 and STR-065, component-editor.md CNT-164,
    // metadata.md MET-038 and publishing.md TAB-050.
    // 429, from 430: the T1 audit against the code. content-model.md stops claiming CNT-055 and
    // CNT-060, whose T1 halves, CNT-166 and CNT-167, it answers only in part (the editor's display and
    // the publish failing; Word's footnotes), and names both beside its table; publishing.md claims
    // PUB-096, PUB-022's cross-reference half, which it had left unclaimed only for citations. STR-012,
    // CNT-103, VER-011 and IAM-052's claims move to STR-067, CNT-169, VER-056 and IAM-078.
    // 430, from 429: themes 1's plan. themes.md's claims of STY-012 and STY-048 move to STY-076 and
    // STY-074, their T1 halves, and it claims STY-077, alignment by column type, which it designs;
    // STY-075 waits for LOC-038's list.
    // 429, from 425: themes.md claims STY-069, PUB-017, TAB-032 and PUB-092 once its Themes in the
    // PDF section designs the contrast check, table styles' page breaks and the keep rules against
    // the pinned engine.
    // 425, from 424: equations 3. component-editor.md claims CNT-046 once a section's title takes an
    // equation in the outline, so every context it names is made in the editor, and publishing.md's
    // equations 2 sets each in the PDF.
    // 424, from 422: figures 1. assets.md claims AST-051, and AST-035 once it speaks of an upload's
    // check rather than its scan. AST-037 is not claimed: it asks for the refusal to be audited, and
    // nothing audits one until LIF's log is designed.
    // 422, from 413: the figures design. assets.md claims eight - AST-001, AST-002, AST-038 and
    // AST-040 (what an upload may be, read from its bytes and proved by decoding it), AST-041, AST-005
    // and AST-006 (its hash and its recorded properties) and AST-026 (an asset in a space) - and
    // publishing.md claims AST-014. AST-003, AST-035 and AST-037 wait on decision F-A.
    // 413, from 412: publishing.md claims TAB-049 with tables 2 - header rows and columns tagged in
    // the PDF, measured, and Word's report naming each table whose header column it could not mark,
    // as word-output.md designs it. TAB-031, which it supersedes, was never claimed.
    // 412, from 409: publishing.md claims PUB-032, TAB-039 and TAB-040 in its Tables section, each
    // measured against the pinned Typst and veraPDF; TAB-031, TAB-032, TAB-034 and TAB-041 are named
    // there as unclaimed, each with why.
    // 409, from 408: component-editor.md claims CNT-152, met by the mark prompt naming the tag before
    // it applies anything.
    // 408, from 407: publishing.md claims PUB-095, met by the layout's language matched as a range.
    // 407, from 406: structure.md claims STR-064, front matter first, met by the outline parse.
    // 406, unchanged: publishing.md claims PUB-094 (#143) and no longer IAM-074, which Ken withdrew for it.
    // 406, from 405: publishing.md claims PUB-093, decision A as a requirement.
    // 405, from 406: publishing.md stopped claiming PUB-085 (1a's final review). A cold veraPDF takes
    // 11.2 s a page, so the ten-second p95 cannot hold alongside PUB-091's report on every
    // publication, and Ken deferred the choice - a warm checker or changing the requirement - to
    // slice 5. The gap is named in prose beside the table.
    // 406, from 403: Ken's answer to the publishing design. publishing.md stopped claiming PUB-030,
    // which it answers only once the first publishing plan has run veraPDF over headings at levels
    // seven to nine, and moved PUB-036 and PUB-064 to their replacements, PUB-091 and PUB-085, which
    // it answers in full. It claims four more it now answers in full: PUB-086 (PUB-001 reworded),
    // PUB-087 (the regression corpus, PUB-015's replacement), PUB-088 (PUB-010's T1 half) and
    // IAM-074 (IAM-017, the publisher's permission). PUB-090, PUB-089 and PUB-092 are named in prose.
    // 403, from 360: publishing.md claims 43 - the request, the order, the layout, the published
    // document, the record and preview: 32 of PUB's, the seven STR clauses structure.md left for the
    // publisher (STR-013, STR-024, STR-027, STR-029, STR-050, STR-052, STR-055) and four CNT clauses
    // content-model.md left for it (CNT-042, CNT-049, CNT-054, CNT-084). PUB-001, PUB-004, PUB-010,
    // PUB-015, PUB-018 and the rest it answers only in part are named in prose beside the table.
    // 360, from 361: structure.md stopped claiming STR-034, which the panel answers for the author's
    // own acts and not for another person's - named in prose beside the table (the navigation plan,
    // decision I).
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
    ).toBe(504);
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

    // IAM-018 was once cited by accident: apps/service/src/http.test.ts used it as the sample rule in
    // a fixture refusal, so the scan read a test about error envelopes as verification of a
    // permission requirement. The fixture names ZZZ-001 now, which the scan ignores. Since W4.1 it is
    // cited, by the test that decides a template by a grant made on it - and by nothing else.
    expect(
      model.citations
        .filter((citation) => citation.id === 'IAM-018')
        .map((citation) => citation.file),
    ).toEqual(['apps/service/src/template-routes.test.ts']);
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
  // 182, from 180: the first publishing plan (docs/plans/2026-09-19-publishing-01-a-document-to-pdf.md)
  // cites PUB-052 and PUB-086 in packages/domain/src/publishing/assemble.test.ts: every failure at
  // once, each naming its stage and its place.
  // 183, from 182: the same plan cites PUB-050 in packages/db/src/publishing.test.ts: the runtime role
  // inserts and reads a publication and can change none of it, and correcting one is another.
  // 190, from 183: the same plan cites PUB-021, PUB-053, PUB-061, PUB-062, PUB-063 and PUB-093 in
  // apps/worker/src/publish.test.ts, over one publish through the queue, the store and Typst, and
  // PUB-086 again there, for the engine and store stages assemble.test.ts cannot reach.
  // 191, from 190: the same plan cites PUB-094 in apps/worker/src/publish.test.ts: a publish holding a
  // component its publisher may not read fails naming the node alone, makes no publication, and leaves
  // the component's id, versions and title in no row and no log line.
  // 193, from 191: the same plan cites PUB-047 and PUB-048 in
  // apps/service/src/publication-routes.test.ts: a publication kept at its own address, read on its
  // own grants and never deleted, and listed with its document, newest first, with who and when.
  // 194, from 193: the second publishing plan cites STR-064 in
  // packages/domain/src/structure/outline.test.ts: the parse takes front matter first and refuses it
  // below the top level, after the body and after an appendix, naming the node.
  // 195, from 194: the same plan cites PUB-011 in packages/domain/src/publishing/layout.test.ts: the
  // layout carries the scheme sections, figures, tables and equations number by, and is refused
  // without one or with one that numbers no figures.
  // 197, from 195: the same plan cites PUB-014 and PUB-095 in packages/db/src/publishing.test.ts: a
  // format the layout does not make is refused naming it, and a document in another language than the
  // layout's words is refused naming both, while one its tag matches as a range is taken.
  // 199, from 197: the same plan cites STR-013 and PUB-079 in
  // packages/domain/src/publishing/assemble.test.ts: `assemble` numbers with the scheme its layout
  // declares, and an empty document publishes its cover or is refused `nothing_to_publish` where the
  // layout declares nothing with something to show.
  // 201, from 199: the same plan cites PUB-007 and PUB-009 in apps/worker/src/layout.test.ts: template
  // 2 sets the page size, orientation, margins and gutter the layout declares, and numbers each
  // matter's pages in its own format, restarting where the layout says.
  // 204, from 201: the same plan cites PUB-008, PUB-037 and PUB-088 in apps/worker/src/layout.test.ts:
  // template 2 sets running heads and feet from the layout's words and fields, a contents to the
  // layout's depth tagged as a table of contents, and the cover, contents and appendix pages the
  // layout declares, and none where it declares none.
  // 205, from 204: the same plan cites STR-036 in apps/web/src/structure/DocumentPage.test.tsx: the
  // outline panel and the generated lists number with the scheme of the layout the document would be
  // published under, and the test shows those are the numbers `assemble` prints under that layout.
  // 207, from 205: the editor's marks plan cites CNT-126 in packages/editor/src/schema.test.ts - the
  // schema holds a hyperlink as a mark carrying an absolute target and an optional title - and
  // CNT-147 in packages/editor/src/state.test.ts: the spelling checker is turned off over a run whose
  // language mark differs from the component's base language, and over no other run.
  // 210, from 207: the same plan cites CNT-031, CNT-003 and CNT-126 in
  // packages/editor/src/mapping.test.ts: the mapping carries all eight character marks there and
  // back unchanged, keeps two overlapping annotations whole across three runs under two identifiers,
  // and carries a hyperlink over a range with an absolute target and the title it has or has not.
  // 213, from 210: the same plan cites CNT-077, CNT-004 and CNT-127 in
  // packages/editor/src/marks.test.ts: one registry gives every mark command a label and a shortcut
  // no other command uses, an edit that splits a marked run leaves one annotation under one
  // identifier, and a link target whose scheme is not allowlisted is refused before it is applied.
  // 214, from 213: the same plan cites CNT-077 in apps/web/src/editor/EditorToolbar.test.tsx: the
  // formatting toolbar offers every command in that registry as a button, in one tab stop the arrow
  // keys, Home and End move around.
  // 216, from 214: the same plan cites CNT-098 and CNT-147 in
  // apps/web/src/editor/ComponentEditor.test.tsx, which is where a mark is applied through the link
  // and language dialogs and the surface is rendered under jsdom: the surface asks the delivery to
  // check spelling, and a run whose language mark differs from the component's base language is
  // rendered with the checker turned off while one carrying the base language is not.
  // 217, from 216: the same plan's last editor task lands CNT-152, the warning about a language tag
  // a publication cannot carry, and moves CNT-077 off the registry table in
  // packages/editor/src/marks.test.ts - whose body asserts strings and presses no key - onto the two
  // tests in apps/web/src/editor/ComponentEditor.test.tsx that move between the regions of the view
  // with F6 and Shift-F6. One file leaves and one file arrives for CNT-077, so the count rises only
  // by CNT-152's own.
  // 218, from 217: the lists plan's identity task cites CNT-002 in a new file,
  // packages/editor/src/identity.test.ts, where the plugin's walk descends: a block made at depth -
  // by splitting a list item, by sinking one, by Enter inside the item that sink made - is allocated
  // an identifier of its own, no two blocks in the component share one, and an identifier it already
  // carries is refused and drawn again. It is a new file, so unlike the case at 163 above this
  // citation does not hide behind one already in the same file.
  // 219, from 218: the same plan's adjacency task cites CNT-023 in packages/editor/src/state.test.ts,
  // where the editor's rule descends with the schema - the second of two adjacent empty paragraphs is
  // removed in every home the editor can make a pair in, the top level, a list item and a definition
  // item's body, which is what makes a spacer unrepresentable now that a block can stand at depth.
  // The file carried no CNT-023 citation before, so this one hides behind nothing either.
  // 221, from 219: the same plan's mapping task cites CNT-117 and CNT-118 once each in
  // packages/editor/src/mapping.test.ts, which carried neither before. One body makes all three
  // kinds of list and round-trips them through the editor and back; the other nests six levels
  // mixing all three kinds and round-trips that. Every other list test in that file keeps its words
  // and no identifier, because a definition list alone is a third of what CNT-117 states.
  // 222, from 221: the same plan's toolbar task cites CNT-077 once in packages/editor/src/marks.ts's
  // test file, which carried none before - the registry widened to fourteen rows and one loop now
  // binds all of them, so that body presses `Mod-Shift-8`, `Mod-]` and `Mod-[` through the real
  // keymap chain and makes, nests and lifts a list without a toolbar. The registry's own string
  // assertions beside it stay deliberately uncited: they press no key.
  // 223, from 222: the same plan's publishing task cites CNT-118 once in
  // packages/domain/src/publishing/assemble.test.ts, whose body assembles a list nested six levels
  // deep in a mixture of all three kinds and reads every level back off the published document.
  // The list tests beside it keep their words and no identifier: the start rule's requirement is
  // filed later in the same plan, and a second PUB-052 in that file would hide behind the one
  // already there, because a citation is kept once per identifier per kind per file.
  // 250, from 231: figures 1 cites the AST ingest rows where each test demonstrates them whole -
  // the header walk in packages/domain (AST-002, AST-005, AST-006, AST-038, AST-040), the stored shape
  // (AST-005, AST-041), the database (AST-005, AST-041), the routes (AST-001, AST-002, AST-026,
  // AST-035, AST-038, AST-040), the ingest job (AST-005, AST-006, AST-051) and the whole system
  // (AST-005) - and CNT-017 once more, in document.test.ts, for a figure naming an asset version.
  // AST-012 and AST-039 are left to figures 2, which makes a figure's own text; AST-037 is uncited
  // because nothing audits a refusal yet.
  // 231, from 229: tables 2 cites PUB-032 and TAB-040 once each in apps/worker/src/tables.test.ts,
  // whose body publishes a table with a header row, a header column and spans across a page, passes
  // it through veraPDF and counts its rows and header cells in the whole file. PUB-038 stays uncited:
  // the same file sets a list of tables, and lists of figures and equations cannot be published yet.
  // 229, from 228: tables 1 cites CNT-016 once in packages/editor/src/tables.test.ts, whose body
  // opens a stored table - caption, spans, header counts, key columns and note - and stores it back
  // exactly. The domain's own table tests cite CNT-016 in document.test.ts, which already did.
  // 228, from 226: editor 7 cites CNT-130 once in packages/readers/src/html.test.ts, whose body
  // runs hostile HTML through the reader and the pipeline and finds nothing that could run stored,
  // and CNT-063 once in apps/web/src/editor/ComponentEditor.test.tsx, whose body pastes and reads the
  // paste report beside the surface. CNT-060, CNT-061 and CNT-062 stay uncited: a paste keeps no
  // table or footnote, and reads no Markdown.
  // 255, from 250: figures 2 cites CNT-017, AST-013 and AST-015 in packages/editor's figures.test.ts,
  // storing each state and reading it back, and AST-039 and AST-015 in ComponentEditor.test.tsx, where
  // the dialog and the panel make and change a figure. AST-012 stays figures 1's shape, uncited.
  // 259, from 255: figures 3 cites PUB-033 and AST-014 in packages/domain's assemble.test.ts, where a
  // figure with no alternative text is refused by name, and AST-015 and AST-039 in apps/worker's
  // figures.test.ts, where the PDF tags a decorative image as nothing and German text as German.
  // 262, from 259: figures 4 cites CNT-086 and CNT-087 in packages/editor's images.test.ts, placing an
  // image in a table's cell and in a run of text and storing each, and CNT-087 in ComponentEditor.test.tsx,
  // where the Image button places one.
  // 264, from 262: figures 5 cites CNT-086 and CNT-087 in apps/worker's figures.test.ts, where an image
  // in a table's cell and one in a run of text are published and read back from the PDF.
  // 268, from 264: footnotes 1 cites CNT-036 and CNT-038 in packages/editor's footnotes.test.ts,
  // placing a footnote at the cursor and a note on a table and storing each, and both again in
  // ComponentEditor.test.tsx, where the Footnote button and the Table panel's Add note make them.
  // 272, from 268: footnotes 2 cites CNT-042 in packages/domain's assemble.test.ts, where an anchor
  // that does not resolve fails the publish naming the footnote, and PUB-016, CNT-036 and CNT-038 in
  // apps/worker's footnotes.test.ts, where footnotes and a table's note are read back from the PDF.
  // 279, from 272: cross-references 2 cites STR-028, STR-029, STR-031, STR-032, STR-056 and STR-062
  // in packages/domain's assemble.test.ts, where references are resolved and printed by the publish,
  // and STR-027 in apps/worker's references.test.ts, where each form is read back from the PDF.
  // 282, from 279: equations 1 cites CNT-044, CNT-048 and CNT-080 in apps/web's ComponentEditor.test.tsx,
  // where an equation is typed as LaTeX in the dialog and stored with it, its alternative generated in
  // the component's language and changed by the author, and it is drawn as MathML, reached and opened
  // by keyboard.
  // 285, from 282: equations 2 cites CNT-049 in packages/domain's assemble.test.ts, where every
  // refusal of the maths tree's converter fails the publish by name, and CNT-080 and PUB-038 in
  // apps/worker's equations.test.ts, where every equation is read back from the PDF as a Formula
  // carrying its alternative in the language a reader is told, and the lists of figures, tables and
  // equations are read back, each entry linking to its page.
  // 286, from 285: equations 3 cites CNT-046 in apps/web's DocumentPage.test.tsx, where an equation is
  // placed in running text, a table's cell, a caption and a footnote on a component's surface and in a
  // section's title through the outline's title field, and each is shown stored.
  // 299, from 286 (2026-09-24): themes 1 cites STY-001, STY-003, STY-006 and STY-041 in
  // packages/domain's theme/read.test.ts, where the reader resolves the default theme and refuses what
  // it must, and moves STY-027 and STY-038 there from the prototype's resolve.test.ts, which is gone;
  // STY-024 in packages/db's default-theme.test.ts, STY-005 and STY-069 in its themes.test.ts and
  // STY-002 in its publishing.test.ts, where the theme is stored, refused and recorded; and STY-008,
  // STY-009, STY-010, STY-074, STY-042 and PUB-019 in apps/worker's themes.test.ts, where two themes
  // are read back from the PDF and a face that may not be embedded is refused. STY-009's prototype
  // citation in theme/runs.test.ts is removed with its test.
  // 307, from 299 (2026-09-24): themes 2 cites STY-015 with STY-016, and STY-017, in packages/domain's
  // publishing/assemble.test.ts, where an image is sized from its style's fixed dimension and held to
  // its maximum with its proportion kept; and STY-076, STY-013 with PUB-017 and TAB-032, and STY-018 in
  // apps/worker's table-and-image-styles.test.ts, where four table styles over a table crossing pages
  // and every image placement and alignment are read back from the PDF.
  // 317, from 307 (2026-09-25): the T1 audit against the code cites CNT-125, CNT-025, CNT-028,
  // CNT-037, AST-012, IAM-007, IAM-041 and IAM-039 on tests that already demonstrated them, PUB-096 on
  // apps/worker's references.test.ts, where a reference in running text, a list's item, a quotation, a
  // table's body cell and a footnote's text is read back as a link, and STR-067 beside STR-003 in
  // packages/db's documents.test.ts.
  // 316, from 317 (2026-09-25): the T1 audit's review takes IAM-039 off apps/service's
  // session-routes.test.ts until its wording is ruled on.
  // 317, from 316 (2026-09-25): Word 1 cites PUB-027 in packages/domain's theme/ooxml.test.ts, where
  // every paragraph and character style of the default theme is read back as a Word style under its
  // catalogue identifier, every paragraph property stated.
  // 318, from 317 (2026-09-25): Word 1 cites PUB-012 in packages/domain's publishing/layout.test.ts,
  // where a layout whose Word page differs from its PDF page in size, orientation, margins, running
  // matter and page numbering is read back with each page as written.
  // 323, from 318 (2026-09-25): Word 1's writer cites PUB-024, CNT-128, PUB-034 with CNT-084, and
  // STY-052 in packages/domain's word/write.test.ts, where every heading is numbered by a numbering
  // definition and none by its text, a link is a w:hyperlink to an external relationship beside the
  // PDF's link in apps/worker's marks.test.ts, the document's and each passage's language are read back
  // beside the PDF's there too, and a face with a Word face is named by it and reported.
  // 324, from 323 (2026-09-25): Word 1's job cites PUB-074 in apps/worker's publish.test.ts, where a
  // Word-only request of a document citing a page is refused before anything is recorded, and one of a
  // document citing none is published with its Word document's record saying it carries no page-cited
  // output, which the same document beside a PDF does not say.
  // 325, from 324 (2026-09-25): Word 1's Word check cites PUB-029 in apps/worker's
  // word-check.test.ts, which opens the writer's fixtures in Word itself, updates their fields and
  // reads back what Word shows; it runs only on Windows with ALLOY_WORD_CHECK=1, so CI skips it.
  // 327, from 325 (2026-09-25): Word 2's tables cite TAB-039 and TAB-049 in apps/worker's
  // word.test.ts, where one publication's PDF and Word document are read together - each output's
  // caption associated with its table, its header rows marked, the header column a TH in the PDF and
  // named in the Word document's report - the whole of each "in every output" in one test.
  // 328, from 327 (2026-09-25): Word 2's figures cite PUB-035 in apps/worker's word.test.ts, where one
  // Word document holding everything Word 2 writes is read for each thing the design says makes it
  // accessible - every heading at its outline level, every image described or flagged decorative,
  // every table's header rows marked and its caption its title, and every run in its language.
  // 329, from 328 (2026-09-26): Word 3's footnotes cite PUB-025 in packages/domain's
  // word/write.test.ts, where every footnote is a w:footnoteReference where it stands, in text, a
  // table's cell and a header row, with no mark of its own, and each note opens with Word's own number,
  // w:footnoteRef; Word 16 numbered them as the PDF does, measured by hand for this slice.
  // 331, from 329 (2026-09-26): Word 3's cross-references cite PUB-026 in packages/domain's
  // word/write.test.ts, where every form of reference to every kind of target is a REF, NOTEREF or
  // PAGEREF field at a hidden bookmark, prefilled with what the PDF prints; and PUB-066 in apps/worker's
  // word.test.ts, where the contents, the lists of figures and of tables and every page reference are
  // fields updated as the document opens, and none holds a page. Word 16 updated every field to what
  // the PDF prints and every page to the page it laid the target on, measured by hand for this slice.
  // 332, from 331 (2026-09-26): Word 4's converter cites PUB-067 in packages/domain's
  // word/omml.test.ts, where an equation holding every kind of maths node, read by mathsTree from one
  // stored MathML, is written as OMML objects alone - no image, no second reading of the MathML -
  // inline and displayed; Word 16 opened it as two OMaths in Cambria Math, measured by hand.
  // 334, from 332 (2026-09-26): Word 4's writer cites PUB-067 in packages/domain's word/write.test.ts,
  // where every equation is the converter's OMML of the published tree, in a line an m:oMath and
  // displayed an m:oMathPara, never an image or the MathML; and CNT-045 in apps/worker's word.test.ts,
  // where one publication sets each stored MathML's one maths tree in the PDF, a Formula saying its
  // words, and in Word as that tree's OMML - the editor's own tests drawing it on screen. Word 16 set
  // every placement in Cambria Math, measured by hand for this task.
  // 337, from 334 (2026-09-26): Word 4's last citations. CNT-045 in apps/web's editor/equationView.test.ts,
  // where the editor draws the stored MathML whole, element for element, beside the worker's test of
  // the PDF and Word from its one tree; PUB-065 in apps/worker's publish.test.ts, where one job carries
  // a document's content, numbers and cross-references into Word as fields, breaks no page the layout
  // does not declare and records that a page cites the PDF; and PUB-023 in apps/worker's word.test.ts,
  // where one document holding every construct a T1 document can hold is written as Word's own
  // structures, flattened nowhere and dropped nowhere unsaid. The Word check measured them in Word.
  // 335, from 337 (2026-09-26): Word 4's final review dropped PUB-023's citation on apps/worker's
  // word.test.ts, whose test shows the structure of one document and not what PUB-078 makes
  // first-class, and PUB-035's, whose test shows what Word carries and not the PDF's terms; both tests
  // stay, retitled, as the record of what Word carries.
  // 551, from 550 (2026-09-29): W13.3 - CNT-179 in tests/browser's budgets.test.ts. STR-072's two
  // tests cite nothing while it is not claimed.
  // 550, from 548 (2026-09-29): issue #336 - STR-035 and STR-045 in tests/browser's
  // navigation.test.ts, a long document scrolled, jumped through and linked into: four titles in one
  // file, two citations. STR-035's new title in the document page's test adds none.
  // 548, from 547 (2026-09-28): W13.2 - CNT-176 in tests/browser's accessibility.test.ts, axe over
  // every state of the editor and the document view: three titles in one file, one citation.
  // 547, from 548 (2026-09-28): W13.4's final review - styles.test.ts no longer cites STY-080, whose
  // claim was dropped as partial; the test stays, retitled, measuring the editor against the PDF.
  // 548, from 547 (2026-09-28): W13.4 - STY-080 in tests/browser's styles.test.ts, the editor measured
  // against the PDF under five themes.
  // 547, from 546 (2026-09-28): W13.1 - STR-006 in tests/browser's outline.test.ts, the outline
  // edited by keyboard alone, by the browser's own drag and drop and through the API: three titles in
  // one file, one citation.
  // 546, from 539 (2026-09-28): W14.5 - STY-079 in packages/domain's theme/schema.test.ts and
  // word/write.test.ts, in apps/worker's table-and-image-styles.test.ts and word.test.ts, and in
  // apps/web's editor/ComponentEditor.test.tsx; STR-025 in packages/domain's
  // content/model/document.test.ts and apps/worker's table-and-image-styles.test.ts.
  // 539, from 537 (2026-09-28): IAM-075's final review (#321) - IAM-075 in packages/db's queue.test.ts
  // (three tests) and publishing.test.ts, where a key in another tenant's store is refused.
  // 537, from 529 (2026-09-28): W14.6 - IAM-075 in eight files: packages/db's tenant-database.test.ts
  // (three tests), seal.test.ts and idempotency.test.ts; packages/objects' store.test.ts (three) and
  // seal.test.ts; and apps/service's sign-in.test.ts (two), oidc.test.ts and tenants.test.ts.
  // 529, from 519 (2026-09-28): W14.4, merged over W14.1, W14.2 and W14.6 - STR-071 in packages/domain's
  // structure/lists.test.ts, structure/references.test.ts, publishing/assemble.test.ts and word/write.test.ts, in
  // packages/editor's referenceText.test.ts, in apps/web's editor/ComponentEditor.test.tsx and in
  // apps/worker's tables.test.ts, figures.test.ts and word.test.ts; TAB-034 in assemble.test.ts.
  // numbering.test.ts's five STR-070 tests cite STR-071 instead, which supersedes it.
  // 519, from 515 (2026-09-28): W14.3 - PUB-087 in apps/worker's regression.test.ts, on the spike's
  // nine cases and the fixed PDF defects' cases; STY-008 there on three of the keep rules' four, moved
  // from themes.test.ts, whose STY-008 describe keeps its citation (PUB-092 left uncited, its Word
  // pages unmeasured); and PUB-098 in packages/domain's publishing/order.test.ts, on each adjacent
  // pair of the order's stages, and in regression.test.ts, on a list printing a caption's reference.
  // 515, from 510 (2026-09-28): W14.6 - PUB-100 in three files, domain's word/write.test.ts, the
  // worker's word.test.ts and apps/web's PublicationPage.test.tsx; IAM-080 in apps/web's
  // DocumentPage.test.tsx, retitled; and SCH-008 in packages/db's tenant-database.test.ts.
  // 510, from 509 (2026-09-28): W14.2 after W14.1 - PUB-103 in apps/worker's check.test.ts too,
  // where a publication is recorded with its check queued and its PDF checked against PDF/UA-1.
  // 509, from 506 (2026-09-28): W14.2 - PUB-103 in packages/domain's assemble.test.ts, where a node
  // deeper than six levels is refused for the PDF by name, and in apps/worker's regression.test.ts,
  // where six levels pass veraPDF tagged H1 to H6 and nine are refused for the PDF and published to
  // Word; and PUB-102 in apps/worker's publishing-budget.test.ts, the 300-page reference document.
  // 506, from 505 (2026-09-28): W14.1 - PUB-091 in apps/worker's check.test.ts, seven tests in one
  // file: a publication's PDF checked and its verdict kept, veraPDF's whole report retained, a failing
  // PDF's rules named, a check left queued by a worker that died after recording taken by the next, a
  // check that gave up queued again by the sweep, one that gave up three times left, and the
  // publications recorded before checks were queued checked by the first sweep after.
  // 505, unchanged (2026-09-28): W14.7's final review - CNT-178 superseded CNT-148, and the two
  // tests that cited CNT-148 cite CNT-178 instead.
  // 505, from 502 (2026-09-28): W14.7 - CNT-148 in apps/desktop's shell.test.ts, where each
  // component language maps to a dictionary Electron has, and in apps/web's
  // editor/ComponentEditor.test.tsx, where the surface keeps the browser's checker and the desktop's
  // bridge is told the base language on opening and as it changes; and CNT-057 in the same file,
  // where the palette offers its three groups and inserts a symbol at the cursor, focus returning.
  // 502, from 500 (2026-09-28): W12.4 - IAM-029 in apps/web's access/AccessPanel.test.tsx, where an
  // administrator chooses a person and reads every permission with its answer on a document, a
  // template, a space and the environment; and IAM-030 in apps/service's access-routes.test.ts, where
  // the explanation names the group a deciding grant came through by its name. The panel's IAM-030
  // test is retitled to say the group is named, and stays one citation.
  // 500, from 499 (2026-09-28): W12.3's final review - IAM-049 in packages/db's groups.test.ts, where
  // the decision holds an external principal a provider group reaches to the tenant's cap.
  // 499, from 496 (2026-09-28): W12.3 - IAM-009 in packages/db's groups.test.ts, through
  // syncProviderGroups, and apps/service's group-routes.test.ts, through a real sign-in; IAM-044 in
  // oidc.test.ts, where groups arrive in the ID token under the basic scopes.
  // 496, from 489 (2026-09-28): W12.1 - IAM-034 in packages/domain's access/scopes.test.ts,
  // packages/db's api-token.test.ts and apps/service's token-routes.test.ts, in a title and as the
  // rule a refused expiry names; IAM-035 in token-routes.test.ts; IAM-062 in scopes.test.ts and
  // token-routes.test.ts, where a scope confers nothing its creator holds through no role.
  // 489, from 488 (2026-09-28): W11.3's second look - CNT-068 in apps/web's editor/Reload.test.tsx,
  // a reload whose last save was refused saying it is not saved.
  // 488, from 485 (2026-09-28): W11.3 - CNT-069, CNT-067 and CNT-169 in apps/web's
  // editor/Reload.test.tsx; CNT-169's two tests, a version cut elsewhere and one cut in the session, are
  // one citation, one file.
  // 485, from 480 (2026-09-28): W11.2 - CNT-174 and CNT-090 in packages/db's recovery.test.ts,
  // CNT-174 in apps/service's editing-routes.test.ts, and CNT-067 and CNT-090 in apps/web's
  // editor/Recovery.test.tsx.
  // 480, from 476 (2026-09-28): W11.1 - VER-003 in packages/db's retention.test.ts and apps/worker's
  // iteration-sweep.test.ts, and VER-004 in packages/db's retention.test.ts and apps/service's
  // settings-routes.test.ts.
  // 476, from 475 (2026-09-27): W10.3 - CNT-150 in the document page's test, where a preview asked
  // for from the page opens beside the text with an editor open in place kept.
  // 475, from 474 (2026-09-27): W10.2 - PUB-005 in tests/e2e's stack.test.ts, where a preview of a
  // document's latest version is asked for through the API and its PDF says so on every page.
  // 474, from 471 (2026-09-27): W10.1 - PUB-005 in packages/domain's assemble.test.ts and in
  // apps/worker's publish.test.ts, and PUB-006 in apps/worker's publish.test.ts.
  // 471, from 469 (2026-09-27): W9.4 - CNT-162 and CNT-158 in apps/web's DocumentPage.test.tsx;
  // CNT-158's two tests, the choice made and where it is offered, are one citation, one file.
  // 469, from 466 (2026-09-27): W9.3 - STR-035, STR-045 and STR-065 in apps/web's DocumentPage.test.tsx.
  // 466, from 463 (2026-09-27): W9.2 - CNT-154, CNT-105 and CNT-156 in apps/web's DocumentPage.test.tsx.
  // 463, from 461 (2026-09-27): W9.1 - CNT-072 and CNT-073 in apps/web's DocumentPage.test.tsx.
  // 461, from 459 (2026-09-27): W8.6 - STY-070 in packages/editor's resolution.test.ts and apps/web's
  // ComponentEditor.test.tsx.
  // 459, from 457 (2026-09-27): W8.4 - CNT-094 and CNT-121 in apps/web's ComponentEditor.test.tsx; CNT-121's
  // two tests, a figure's and an image's in a line, are one citation, one file.
  // 457, from 456 (2026-09-27): W8.3 - CNT-122 in apps/web's ComponentEditor.test.tsx.
  // 456, from 450 (2026-09-27): W8.2 - the domain's css.test.ts cites STY-058, STY-050 and CNT-082 (one
  // title), CNT-097, CNT-115 and STY-037, where the prototype's cited STY-050, STY-051 and STY-037 -
  // STY-051 dropped, since the test shows only the editor's placement of a line's space (final review);
  // and apps/web's ComponentEditor.test.tsx cites CNT-097, CNT-082 and CNT-115.
  // 450, from 448 (2026-09-27): W8.1 - STY-035 in apps/service's presentation-routes.test.ts and
  // STY-039 in apps/web's theme/presentation.test.tsx.
  // 448, from 446 (2026-09-27): W7.4 - API-008 in apps/service's idempotency-routes.test.ts, by a
  // title and by the `rule` a refusal names.
  // 446, from 445 (2026-09-27): W7.3 - SCH-064 in apps/web's listing/views.test.tsx.
  // 445, from 444 (2026-09-27): W7.2 - API-007 in apps/service's listing-routes.test.ts.
  // 444, from 443 (2026-09-27): W7.1 - SCH-022 in packages/db's listing.test.ts.
  // 443, from 442 (2026-09-27): W6.4 - SCH-057 in apps/web's editor/ComponentEditor.test.tsx.
  // 442, from 438 (2026-09-27): W6.3 - SCH-059, SCH-046, SCH-062 and SCH-034 in packages/db's
  // search-facets.test.ts.
  // 438, from 432 (2026-09-27): W6.2 - SCH-011, SCH-012, SCH-016, SCH-017 and SCH-010 in
  // packages/db's search-words.test.ts, SCH-010's second test a grant refusing a definition itself, and SCH-039 in apps/service's search-routes.test.ts.
  // 432, from 429 (2026-09-27): W6.1 - SCH-002 in packages/domain's search/entries.test.ts, and
  // SCH-054 and SCH-066 in packages/db's search.test.ts.
  // 429, from 428 (2026-09-27): W5.5 - MET-023 in the store's test of a component's values.
  // 428, from 427 (2026-09-27): W5.3 - MET-021 in the fields form's test.
  // 427, from 425 (2026-09-27): W5.2 - MET-033 and MET-038 in the store's test of a component's values.
  // 425, from 416 (2026-09-27): W5.1 - MET-041, MET-031, MET-008, MET-040 and MET-037 in the store's
  // test of definitions; MET-024 in the route test's title, and MET-031, MET-008 and MET-037 as the
  // rules it asserts.
  // 416, from 412 (2026-09-27): W4.4 - TPL-013 and TPL-055, each in the store's test of a document
  // made from a template and as the rule the route test asserts.
  // 412, from 410 (2026-09-27): W4.3 - TPL-015 and STR-060 in the outline operations' test.
  // 410, from 404 (2026-09-27): W4.2 - TPL-012 and TPL-062 in the materialising test; TPL-025,
  // TPL-027, TPL-004 and STY-025 in the store's test of a document made from a template.
  // 404, from 392 (2026-09-27): W4.1 - in titles TPL-059, TPL-012, TPL-013, TPL-015 and TPL-054 (the
  // definition), TPL-053 (resolution), TPL-001 and VER-056 (the store), TPL-006 and IAM-018 (the
  // routes); as rules the route tests assert, TPL-004 and API-037.
  // 392, from 391 (2026-09-26): W2.3 - CNT-167, in the HTML reader's test.
  // 391, from 373 (2026-09-26): W2.2 - in titles API-003 (http and app), API-006, API-012, API-037
  // and API-047 (http and stream); as refusals' rules asserted by the route tests, API-037 in three
  // files, API-039, COL-005, IAM-071, AST-001, AST-040, PUB-014, PUB-074 and PUB-095.
  // 373, from 372 (2026-09-26): W2.1b - CNT-175, in the rendered-content test.
  // 372, from 370 (2026-09-26): W2.1 - CNT-075 and CNT-074, each in the document page's test.
  // 370, from 357 (2026-09-26): the rewordings - CNT-173 in four files, MET-042 in two, and CNT-171,
  // CNT-172, STR-070, STY-078, API-061, IAM-039 and IAM-024 in one each.
  // 357, from 352 (2026-09-26): W1.3 - PUB-069 and PUB-031 in two files each, the PDF's and Word's;
  // CNT-160 in one. CNT-166's three tests stay uncited until it is reworded.
  // 352, from 335 (2026-09-26): W1.2, the test debt the T1 audit found - one file each for CNT-014,
  // CNT-019, CNT-026, CNT-081, CNT-164 (two tests, one file), CNT-169, STR-024, STR-068, TAB-050,
  // VER-009, IAM-053, IAM-078 and API-005; CNT-085 in three, the PDF's paint, Word's run and Word's
  // style; and CNT-124's second sentence on the creation test. CNT-061 and CNT-062 wait on a
  // rewording, and API-003 on issue #240.
  it('cites exactly as many times as the corpus currently does', () => {
    expect(model.citations).toHaveLength(551);
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
    // 10, from 8: publishing/Publishing.test.tsx and publishing/PublicationPage.test.tsx, which cite nothing.
    // 11, from 10: editor/EditorToolbar.test.tsx, which cites CNT-077.
    // 12, from 11: shell/Header.test.tsx, which cites nothing.
    // 13, from 12: states/states.test.tsx, which cites nothing.
    // 15, from 13: editor/ComponentList.test.tsx and layouts/ListLayout.test.tsx, which cite nothing.
    // 16, from 15: layouts/Modal.test.tsx, which cites nothing.
    // 17, from 16: editor/SpacePane.test.tsx, which cites nothing.
    // 18, from 17: structure/DocumentList.test.tsx, which cites nothing.
    // 20, from 18: layouts/PaneWidth.test.tsx and structure/DocumentText.test.tsx, which cite nothing.
    // 21, from 20: publishing/PublicationList.test.tsx, which cites nothing.
    // 22, from 21: home/Home.test.tsx, which cites nothing.
    // 23, from 22: admin/Administration.test.tsx, which cites nothing.
    // 24, from 23: shell/Status.test.tsx, which cites nothing.
    // 25, from 24: editor/EquationDialog.test.tsx, which cites nothing.
    // 26, from 25: metadata/FieldsForm.test.tsx, which cites MET-021.
    // 27, from 26: search/SearchPage.test.tsx, which cites nothing.
    // 28, from 27: listing/views.test.tsx, which cites SCH-064.
    // 29, from 28: theme/presentation.test.tsx, which cites STY-039.
    // 30, from 29: publishing/Preview.test.tsx, which cites nothing.
    // 31, from 30 (2026-09-28): editor/Recovery.test.tsx, which cites CNT-067 and CNT-090.
    // 32, from 31 (2026-09-28): editor/Reload.test.tsx, which cites CNT-069, CNT-067 and CNT-169.
    // 33, from 32 (2026-09-28): account/ApiTokens.test.tsx, which cites nothing.
    expect(files.filter((file) => file.endsWith('.tsx'))).toHaveLength(33);
  });
});
