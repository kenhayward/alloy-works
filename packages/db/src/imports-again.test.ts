import { randomBytes } from 'node:crypto';
import {
  DEFAULT_IMPORT_LEVELS,
  blockIdentifierFrom,
  proposeImport,
  type AuditContext,
  type ContentDocument,
  type ImportFlowItem,
  type OutlineDocument,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import {
  acceptImport,
  chooseImportKind,
  createImport,
  earlierImport,
  editImport,
  importParts,
  readImport,
  receiveImportFile,
  recordProposal,
  type StoredImport,
} from './imports.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { grant } from './grants.js';
import { findRole } from './roles.js';
import { latestVersion, recordVersion } from './versions.js';
import { actOn } from './archival.js';

const ISSUER = 'https://idp.example';

const heading = (text: string): ImportFlowItem => ({
  kind: 'heading',
  level: 2,
  style: 'Heading 2',
  text,
});
const para = (text: string): ImportFlowItem => ({
  kind: 'block',
  block: { type: 'paragraph', content: [{ type: 'text', value: text, marks: [] }] },
  source: text,
});
const proposalOf = (items: ImportFlowItem[]) => ({
  ...proposeImport(items, DEFAULT_IMPORT_LEVELS, {
    language: 'en',
    direction: 'ltr',
    newIdentifier: () => blockIdentifierFrom(randomBytes(16)),
  }),
  report: [],
  title: 'Pond survey',
  language: 'en',
});

/** Ada's pond survey as she first imported it: Sampling, Analysis and Results. */
const FIRST = [
  heading('Sampling'),
  para('We saw three newts.'),
  heading('Analysis'),
  para('Counted twice.'),
  heading('Results'),
  para('Three in all.'),
];
/** The same file revised: Sampling changed, Discussion new, Analysis as it was, Results gone. */
const SECOND = [
  heading('Sampling'),
  para('We saw four newts.'),
  heading('Discussion'),
  para('Newts like ponds.'),
  heading('Analysis'),
  para('Counted twice.'),
];

const textOf = (content: unknown) =>
  (content as ContentDocument).content.map((block) =>
    (block as unknown as { content: { value: string }[] }).content.map((run) => run.value).join(''),
  );

describe('importing again (IMd)', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let general: string;
  let acting: AuditContext;

  const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work, acting);

  /** An import of `items` read and proposed, under `name` and the hash given. */
  const proposed = (items: ImportFlowItem[], name: string, sha256: string) =>
    tenant(async (trx) => {
      const made = await createImport(trx, {
        spaceId: general,
        importer: ada,
        fileName: name,
        fileType: 'docx',
      });
      await receiveImportFile(trx, made.id, {
        key: `tenants/t/sha256/${sha256}`,
        sha256,
        bytes: 9,
      });
      return (await recordProposal(trx, made.id, proposalOf(items)))!;
    });

  const accept = (id: string, may?: (component: string, permission: string) => boolean) =>
    tenant((trx) =>
      acceptImport(trx, id, {
        by: ada,
        title: 'Pond survey',
        language: 'en',
        direction: 'ltr',
        ...(may === undefined
          ? {}
          : { may: async (component, permission) => may(component, permission) }),
      }),
    );

  /** The first import accepted, and Analysis edited in the space since by Ada. */
  const firstAccepted = async () => {
    const hash = randomBytes(32).toString('hex');
    const first = await proposed(FIRST, 'Pond survey.docx', hash);
    const accepted = await accept(first.id);
    if (accepted.answer !== 'accepted') throw new Error(accepted.answer);
    const [sampling, analysis, results] = accepted.components;
    const edited = await tenant(async (trx) => {
      const recorded = await recordVersion(trx, {
        artifactId: analysis!.artifactId,
        openedFrom: analysis!.id,
        author: ada,
        substance: {
          kind: 'component',
          content: {
            ...(analysis!.content as ContentDocument),
            content: [
              {
                ...(analysis!.content as ContentDocument).content[0]!,
                content: [{ type: 'text', value: 'Counted twice, by Grace.', marks: [] }],
              } as ContentDocument['content'][number],
            ],
          },
          values: analysis!.values,
          notCarried: [],
          definitions: analysis!.definitions,
        },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version;
    });
    return {
      first,
      hash,
      accepted,
      sampling: sampling!,
      analysis: analysis!,
      results: results!,
      edited,
    };
  };

  /** The revised file imported again, as an update of the first. */
  const again = async (first: StoredImport) => {
    const second = await proposed(SECOND, 'Pond survey.docx', randomBytes(32).toString('hex'));
    const chosen = await tenant((trx) =>
      chooseImportKind(trx, second.id, { kind: 'again', earlier: first.id }),
    );
    if (typeof chosen !== 'object') throw new Error(String(chosen));
    return chosen;
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    await service.withTenant(production, async (trx) => {
      ada = (
        await trx
          .insertInto('principal')
          .values({ issuer: ISSUER, subject: 'ada', email: 'ada@example.com', display_name: 'Ada' })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
    });
    acting = { actorKind: 'person', actor: ada, actorLabel: 'Ada' };
    // Ada authors in General: what placing a component in its document is decided by.
    await tenant(async (trx) => {
      await grant(trx, {
        roleId: (await findRole(trx, 'Author'))!.id,
        subject: { principal: ada },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('IMP-036 recognises an accepted import in the space by the same hash, else by the same name', async () => {
    const { first, hash, accepted } = await firstAccepted();
    const byName = await proposed(SECOND, 'Pond survey.docx', randomBytes(32).toString('hex'));
    const byHash = await proposed(FIRST, 'Renamed.docx', hash);
    const neither = await proposed(FIRST, 'Other.docx', randomBytes(32).toString('hex'));
    const found = await tenant(async (trx) => ({
      byName: await earlierImport(trx, byName.id),
      byHash: await earlierImport(trx, byHash.id),
      neither: await earlierImport(trx, neither.id),
      itself: await earlierImport(trx, first.id),
    }));
    expect(found.byName).toMatchObject({
      id: first.id,
      match: 'name',
      fileName: 'Pond survey.docx',
      importer: ada,
      documentId: accepted.answer === 'accepted' ? accepted.document.artifactId : null,
    });
    expect(found.byName?.finishedAt).toBeInstanceOf(Date);
    expect(found.byHash).toMatchObject({ id: first.id, match: 'hash' });
    expect(found.neither).toBeUndefined();
    expect(found.itself).toBeUndefined();
  });

  it('IMP-036 matches each part of an import again to what the earlier import made, the rest gone', async () => {
    const { first, sampling, analysis, results } = await firstAccepted();
    const second = await again(first);
    expect(second).toMatchObject({ kind: 'again', earlier: first.id });
    const parts = await tenant((trx) => importParts(trx, second.id));
    expect(parts.map(({ title, matched, matchedBy }) => ({ title, matched, matchedBy }))).toEqual([
      { title: 'Sampling', matched: sampling.artifactId, matchedBy: 'provenance' },
      { title: 'Discussion', matched: null, matchedBy: null },
      { title: 'Analysis', matched: analysis.artifactId, matchedBy: 'provenance' },
    ]);
    // Results matches no part: gone.
    expect(parts.some((part) => part.matched === results.artifactId)).toBe(false);
    // Importing as new again clears every match.
    const asNew = await tenant((trx) => chooseImportKind(trx, second.id, { kind: 'first' }));
    expect(asNew).toMatchObject({ kind: 'first', earlier: null });
    expect(
      (await tenant((trx) => importParts(trx, second.id))).every((part) => part.matched === null),
    ).toBe(true);
  });

  it('IMP-037 lets its importer match a part to another component the earlier import made, or mark it new', async () => {
    const { first, results } = await firstAccepted();
    const second = await again(first);
    const discussion = (await tenant((trx) => importParts(trx, second.id)))[1]!;
    const edit = (revision: number, component: string | null, part = discussion.id) =>
      tenant((trx) =>
        editImport(trx, second.id, { revision, by: ada, edit: { edit: 'match', part, component } }),
      );
    const matched = await edit(second.revision, results.artifactId);
    expect(matched.answer).toBe('edited');
    expect((await tenant((trx) => importParts(trx, second.id)))[1]).toMatchObject({
      matched: results.artifactId,
      matchedBy: 'importer',
    });
    const revision = matched.answer === 'edited' ? matched.import.revision : 0;
    // A component the earlier import did not make, or one another part holds, is refused.
    expect(await edit(revision, randomUUIDv4())).toEqual({
      answer: 'refused',
      refusal: 'match_invalid',
    });
    const sampling = (await tenant((trx) => importParts(trx, second.id)))[0]!;
    expect(await edit(revision, sampling.matched)).toEqual({
      answer: 'refused',
      refusal: 'match_invalid',
    });
    expect((await edit(revision, null)).answer).toBe('edited');
    expect((await tenant((trx) => importParts(trx, second.id)))[1]).toMatchObject({
      matched: null,
      matchedBy: null,
    });
  });

  it('IMP-037 accepts an import again as suggestions against each component as it is now, never versions', async () => {
    const { first, accepted, sampling, analysis, results, edited } = await firstAccepted();
    const documentId = accepted.answer === 'accepted' ? accepted.document.artifactId : '';
    const second = await again(first);
    const answer = await accept(second.id);
    if (answer.answer !== 'accepted') throw new Error(answer.answer);
    expect(answer.document.artifactId).toBe(documentId);

    await tenant(async (trx) => {
      // No version is cut of a component it changes: Sampling is still 0.1, Analysis Ada's edit.
      expect((await latestVersion(trx, sampling.artifactId))?.id).toBe(sampling.id);
      expect((await latestVersion(trx, analysis.artifactId))?.id).toBe(edited.id);
      const { rows: suggestions } = await sql<{
        component_id: string;
        made_against: string;
        made_by: string;
        proposed: unknown;
        import_id: string;
      }>`select s.component_id, s.made_against, s.made_by, s.proposed, m.import_id
           from suggestion s join import_made m on m.suggestion_id = s.id
          where m.import_id = ${second.id} order by s.made_at`.execute(trx);
      expect(
        suggestions.map((each) => ({
          component: each.component_id,
          against: each.made_against,
          by: each.made_by,
          text: textOf(each.proposed),
        })),
      ).toEqual([
        {
          component: sampling.artifactId,
          against: sampling.id,
          by: ada,
          text: ['We saw four newts.'],
        },
        // Against Ada's edit, which the file never held: shown as a difference, never overwritten.
        { component: analysis.artifactId, against: edited.id, by: ada, text: ['Counted twice.'] },
      ]);

      // Discussion is a new component, placed in the same document after Sampling.
      const document = await latestVersion(trx, documentId);
      const references = (document!.content as OutlineDocument).nodes.flatMap((node) =>
        node.type === 'reference' ? [node.component] : [],
      );
      const made = answer.components.map((each) => each.artifactId);
      expect(made).toHaveLength(1);
      expect(references).toEqual([
        sampling.artifactId,
        made[0],
        analysis.artifactId,
        results.artifactId,
      ]);
      const { rows: provenance } = await sql`select 1 from import_made
        where import_id = ${second.id} and version_id = ${answer.components[0]!.id}`.execute(trx);
      expect(provenance).toHaveLength(1);

      // No new document; Results is gone, kept, and flagged on it.
      const { rows: documents } = await sql`select 1 from import_made m join artifact a
        on a.id = m.artifact_id where m.import_id = ${second.id} and a.kind = 'document'`.execute(
        trx,
      );
      expect(documents).toHaveLength(0);
      expect(await latestVersion(trx, results.artifactId)).toBeDefined();
      const { rows: flags } = await sql`select anchor from thread
        where on_id = ${documentId}`.execute(trx);
      expect(flags).toHaveLength(1);
    });
    expect(answer.import.outcome).toMatchObject({
      suggested: [{ component: sampling.artifactId }, { component: analysis.artifactId }],
      made: [{ component: answer.components[0]!.artifactId, placed: true }],
      gone: [{ component: results.artifactId, flagged: true }],
      skipped: [],
    });
  });

  it('IMP-037 keeps the identity of each block an import again leaves as it was, so a reference to another component points at its block as it is', async () => {
    // Sampling refers to Analysis's paragraph, by the reader's identifier the file gave it.
    const referring = (text: string, read: string): ImportFlowItem => ({
      kind: 'block',
      block: {
        type: 'paragraph',
        content: [
          { type: 'text', value: text, marks: [] },
          {
            type: 'crossReference',
            id: 'wr-1',
            target: { kind: 'block', block: read },
            display: 'number',
          },
        ],
      },
      source: text,
    });
    const counted = (read: string): ImportFlowItem => ({
      kind: 'block',
      block: {
        type: 'paragraph',
        id: read,
        content: [{ type: 'text', value: 'Counted twice.', marks: [] }],
      },
      source: 'Counted twice.',
    });
    const items = (count: string, read: string) => [
      heading('Sampling'),
      para(`We saw ${count} newts.`),
      referring('See ', read),
      heading('Analysis'),
      counted(read),
    ];
    const hash = randomBytes(32).toString('hex');
    const first = await proposed(items('three', 'wb-1'), 'Referring.docx', hash);
    const accepted = await accept(first.id);
    if (accepted.answer !== 'accepted') throw new Error(accepted.answer);
    const [sampling, analysis] = accepted.components;
    const blocks = (version: { content: unknown }) =>
      (version.content as ContentDocument).content as unknown as {
        id: string;
        content: { target?: object }[];
      }[];
    const there = blocks(analysis!)[0]!.id;
    expect(blocks(sampling!)[1]!.content[1]!.target).toEqual({
      kind: 'component',
      component: analysis!.artifactId,
      block: there,
    });

    const second = await proposed(
      items('four', 'wb-2'),
      'Referring.docx',
      randomBytes(32).toString('hex'),
    );
    await tenant((trx) => chooseImportKind(trx, second.id, { kind: 'again', earlier: first.id }));
    const answer = await accept(second.id);
    if (answer.answer !== 'accepted') throw new Error(answer.answer);
    expect(answer.import.outcome).toMatchObject({
      suggested: [{ component: sampling!.artifactId }],
      unchanged: 1,
    });
    const { rows } = await tenant((trx) =>
      sql<{ proposed: { content: unknown } }>`select proposed from suggestion
        where id = ${answer.import.outcome!.suggested[0]!.suggestion}`.execute(trx),
    );
    const suggested = blocks({ content: rows[0]!.proposed });
    // The changed paragraph is new; the one left as it was keeps its identity and its reference.
    expect(suggested[0]!.id).not.toBe(blocks(sampling!)[0]!.id);
    expect(suggested[1]!.id).toBe(blocks(sampling!)[1]!.id);
    expect(suggested[1]!.content[1]!.target).toEqual({
      kind: 'component',
      component: analysis!.artifactId,
      block: there,
    });
  });

  it('IMP-037 skips and says a component archived since it was matched, and records it as made by nothing', async () => {
    const { first, sampling, analysis } = await firstAccepted();
    const second = await again(first);
    await tenant(async (trx) => {
      expect(await actOn(trx, sampling.artifactId, ada, 'archived')).toBe('changed');
    });
    const answer = await accept(second.id);
    if (answer.answer !== 'accepted') throw new Error(answer.answer);
    expect(answer.import.outcome).toMatchObject({
      suggested: [{ component: analysis.artifactId }],
      skipped: [{ component: sampling.artifactId, reason: 'gone' }],
    });
    const made = (await tenant((trx) => importParts(trx, second.id))).map((part) => part.made);
    expect([made[0], made[2]]).toEqual([null, analysis.artifactId]);
  });

  it('IMP-037 skips a component its importer may not suggest on, and refuses only where none may be', async () => {
    const { first, sampling, analysis } = await firstAccepted();
    const second = await again(first);
    const answer = await accept(
      second.id,
      (component, permission) => !(permission === 'suggest' && component === sampling.artifactId),
    );
    if (answer.answer !== 'accepted') throw new Error(answer.answer);
    expect(answer.import.outcome).toMatchObject({
      suggested: [{ component: analysis.artifactId }],
      skipped: [{ component: sampling.artifactId, reason: 'suggest' }],
    });

    const { first: other } = await firstAccepted();
    const third = await again(other);
    expect(await accept(third.id, (_, permission) => permission !== 'suggest')).toEqual({
      answer: 'import.not_permitted',
    });
    expect((await tenant((trx) => readImport(trx, third.id)))?.state).toBe('proposed');
  });
});

function randomUUIDv4() {
  const hex = randomBytes(16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}
