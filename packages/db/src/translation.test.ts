import { randomUUID } from 'node:crypto';
import { parseContentDocument, type ContentDocument } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { grant } from './grants.js';
import { claimLock, readLock, saveIteration } from './editing.js';
import { bringLineBack, compareLines, openLinesOf } from './lines.js';
import { cutVersion } from './promotion.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import {
  beginTranslation,
  declareSourceChange,
  markCurrent,
  sourceChanges,
  translationsOf,
} from './translation.js';
import { latestVersion, type StoredVersion } from './versions.js';
import { latestRevisionsOf, moveArtifact } from './workflow.js';
import { decideGate } from './workflow-gates.js';

const para = (id: string, value: string) => ({
  type: 'paragraph' as const,
  id,
  style: 'body',
  content: [{ type: 'text' as const, value, marks: [] }],
});

describe('translation as a line per language (the TR plan, TR-A to TR-H)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let space = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>, who = ada) =>
    service.withTenant(tenant, work, { actorKind: 'person', actor: who });

  const component = (title: string) =>
    as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });

  const approve = (version: StoredVersion, line?: string) =>
    as(async (trx) => {
      const moved = await moveArtifact(trx, {
        artifactId: version.artifactId,
        kind: 'component',
        transition: 'submit',
        from: 'draft',
        by: ada,
        may: () => true,
        ...(line === undefined ? {} : { line }),
      });
      if (moved.answer !== 'moved') throw new Error(moved.answer);
      const passed = await decideGate(trx, {
        artifactId: version.artifactId,
        kind: 'component',
        transition: 'approve',
        version: version.id,
        decision: 'approved',
        by: grace,
        may: () => true,
        ...(line === undefined ? {} : { line }),
      });
      if (passed.answer !== 'passed') throw new Error(passed.answer);
    });

  /** One editing session, claimed, saved and cut: the path an author or a translator takes. */
  const cut = (
    artifactId: string,
    from: string,
    content: ContentDocument,
    extra: { line?: string; translates?: string; retranslate?: boolean } = {},
    who = ada,
  ) =>
    as(async (trx) => {
      const session = randomUUID();
      const at = {
        artifactId,
        principal: who,
        session,
        ...(extra.line ? { line: extra.line } : {}),
      };
      const claimed = await claimLock(trx, { ...at, move: true });
      if (claimed.answer !== 'claimed') throw new Error(claimed.answer);
      const saved = await saveIteration(trx, { ...at, sequence: 1, openedFrom: from, content });
      if (saved.answer !== 'accepted') throw new Error(saved.answer);
      return cutVersion(trx, {
        ...at,
        openedFrom: from,
        ...(extra.translates === undefined ? {} : { translates: extra.translates }),
        ...(extra.retranslate === undefined ? {} : { retranslate: extra.retranslate }),
      });
    }, who);

  const contentOf = (
    version: StoredVersion,
    language: string,
    ...blocks: ReturnType<typeof para>[]
  ) =>
    parseContentDocument({ ...parseContentDocument(version.content), language, content: blocks });

  const status = async (artifactId: string) =>
    (await as((trx) => translationsOf(trx, [artifactId]))).get(artifactId) ?? [];

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    await service.withTenant(tenant, async (trx) => {
      space = (await createSpace(trx, `Space ${randomUUID()}`)).id;
      const person = async (name: string) =>
        (
          await trx
            .insertInto('principal')
            .values({
              issuer: 'https://idp.example',
              subject: randomUUID(),
              email: null,
              display_name: name,
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      ada = await person('Ada');
      grace = await person('Grace');
      for (const [who, role] of [
        [ada, 'Author'],
        [grace, 'Approver'],
      ] as const) {
        await grant(trx, {
          roleId: (await findRole(trx, role))!.id,
          subject: { principal: who },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        });
      }
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('LOC-007 begins a variant as a language line of the one component, from a designated revision, untranslated until its first cut', async () => {
    const first = await component('Sampling');
    const begin = (language: string) =>
      as((trx) => beginTranslation(trx, { artifactId: first.artifactId, language, by: ada }));

    expect(await begin('fr-FR')).toEqual({ answer: 'translation.needs_revision' });
    await approve(first);
    expect(await begin('not a tag')).toEqual({ answer: 'translation.language_invalid' });
    expect(await begin('en-GB')).toEqual({ answer: 'translation.same_language' });
    const begun = await begin('fr-FR');
    if (begun.answer !== 'begun') throw new Error(begun.answer);
    expect([begun.line.language, begun.line.name, begun.line.divergedFrom.revision]).toEqual([
      'fr-FR',
      'fr-FR',
      1,
    ]);
    expect(await begin('fr-FR')).toEqual({ answer: 'translation.exists' });

    expect(await status(first.artifactId)).toEqual([
      {
        line: begun.line.id,
        language: 'fr-FR',
        head: null,
        translates: null,
        status: { status: 'untranslated' },
      },
    ]);
    // A translation is not a divergence: never marked Diverged, compared or brought back.
    expect((await as((trx) => openLinesOf(trx, [first.artifactId]))).get(first.artifactId)).toBe(
      undefined,
    );
    expect(await as((trx) => compareLines(trx, first.artifactId, begun.line.id))).toBe(
      'line.is_translation',
    );
    expect(
      await as((trx) =>
        bringLineBack(trx, {
          artifactId: first.artifactId,
          line: begun.line.id,
          openedFrom: first.id,
          lineHead: first.id,
          carry: [],
          by: ada,
        }),
      ),
    ).toEqual({ answer: 'line.is_translation' });
  });

  it('LOC-013 records the source version each cut translates, refusing one that is no version of its source', async () => {
    const first = await component('Findings');
    await approve(first);
    const begun = await as((trx) =>
      beginTranslation(trx, { artifactId: first.artifactId, language: 'de-DE', by: ada }),
    );
    if (begun.answer !== 'begun') throw new Error(begun.answer);
    const german = contentOf(first, 'de-DE', para('b1', 'Teiche wurden beprobt.'));

    expect(await cut(first.artifactId, first.id, german, { line: begun.line.id })).toEqual({
      answer: 'translation.source_required',
    });
    const source2 = await cut(
      first.artifactId,
      first.id,
      contentOf(first, 'en-GB', para('b1', 'Ponds.')),
    );
    if (source2.answer !== 'recorded') throw new Error(source2.answer);
    // No version of its source's main line is refused; any of them may be named (the TR final review).
    const elsewhere = await cut(first.artifactId, first.id, german, {
      line: begun.line.id,
      translates: '00000000-0000-4000-8000-000000000009',
    });
    expect(elsewhere.answer).toBe('translation.source_invalid');

    const translated = await cut(first.artifactId, first.id, german, {
      line: begun.line.id,
      translates: source2.version.id,
    });
    if (translated.answer !== 'recorded') throw new Error(translated.answer);
    expect(await status(first.artifactId)).toEqual([
      {
        line: begun.line.id,
        language: 'de-DE',
        head: translated.version.id,
        translates: source2.version.id,
        status: { status: 'translated' },
      },
    ]);
  });

  it('LOC-014 goes out of date at the source cut, and LOC-031 takes the author declaring it needs no retranslation, revisable afterwards', async () => {
    const first = await component('Methods');
    await approve(first);
    const begun = await as((trx) =>
      beginTranslation(trx, { artifactId: first.artifactId, language: 'fr-FR', by: ada }),
    );
    if (begun.answer !== 'begun') throw new Error(begun.answer);
    const french = await cut(
      first.artifactId,
      first.id,
      contentOf(first, 'fr-FR', para('b1', 'Méthodes.')),
      {
        line: begun.line.id,
        translates: first.id,
      },
    );
    if (french.answer !== 'recorded') throw new Error(french.answer);

    const typo = await cut(
      first.artifactId,
      first.id,
      contentOf(first, 'en-GB', para('b1', 'Methods, spelt right.')),
      { retranslate: false },
    );
    if (typo.answer !== 'recorded') throw new Error(typo.answer);
    expect((await status(first.artifactId))[0]?.status).toEqual({
      status: 'outOfDate',
      retranslate: false,
    });

    expect(
      await as((trx) =>
        declareSourceChange(trx, {
          artifactId: first.artifactId,
          version: typo.version.id,
          retranslate: true,
          by: grace,
        }),
      ),
    ).toEqual({ answer: 'declared' });
    expect((await status(first.artifactId))[0]?.status).toEqual({
      status: 'outOfDate',
      retranslate: true,
    });
    // A line's version is no source change to declare.
    expect(
      await as((trx) =>
        declareSourceChange(trx, {
          artifactId: first.artifactId,
          version: french.version.id,
          retranslate: false,
          by: ada,
        }),
      ),
    ).toEqual({ answer: 'version.missing' });
  });

  it('LOC-040 offers the previous translation as the start, beside each source block changed since, and Mark current brings it up to date with no cut', async () => {
    const first = await component('Results');
    await approve(first);
    const begun = await as((trx) =>
      beginTranslation(trx, { artifactId: first.artifactId, language: 'fr-FR', by: ada }),
    );
    if (begun.answer !== 'begun') throw new Error(begun.answer);
    const english = contentOf(first, 'en-GB', para('b1', 'Ponds.'), para('b2', 'In May.'));
    const source2 = await cut(first.artifactId, first.id, english);
    if (source2.answer !== 'recorded') throw new Error(source2.answer);
    const french = await cut(
      first.artifactId,
      first.id,
      contentOf(first, 'fr-FR', para('b1', 'Étangs.'), para('b2', 'En mai.')),
      { line: begun.line.id, translates: source2.version.id },
    );
    if (french.answer !== 'recorded') throw new Error(french.answer);
    const source3 = await cut(
      first.artifactId,
      source2.version.id,
      contentOf(first, 'en-GB', para('b1', 'Twelve ponds.'), para('b2', 'In May.')),
    );
    if (source3.answer !== 'recorded') throw new Error(source3.answer);

    expect(await as((trx) => sourceChanges(trx, first.artifactId, begun.line.id))).toEqual({
      translates: source2.version.id,
      current: source3.version.id,
      changes: [{ block: 'b1', change: 'changed', words: 'Twelve ponds.' }],
    });
    // The line's head is the start: the next session opens from the earlier translation.
    expect(
      await as((trx) =>
        markCurrent(trx, {
          artifactId: first.artifactId,
          line: begun.line.id,
          translates: begun.line.id,
          by: ada,
        }),
      ),
    ).toEqual({ answer: 'translation.source_invalid' });
    expect(
      await as((trx) =>
        markCurrent(trx, {
          artifactId: first.artifactId,
          line: begun.line.id,
          translates: source3.version.id,
          by: ada,
        }),
      ),
    ).toEqual({ answer: 'marked' });
    expect(await status(first.artifactId)).toEqual([
      expect.objectContaining({
        head: french.version.id,
        translates: source3.version.id,
        status: { status: 'translated' },
      }),
    ]);
  });

  it('LOC-012 versions a variant as any content, cut and designated on its own line, its approval a workflow state of the variant: its revision never becomes the source’s, or another language’s, approved revision', async () => {
    const first = await component('Discussion');
    await approve(first);
    const begun = await as((trx) =>
      beginTranslation(trx, { artifactId: first.artifactId, language: 'fr-FR', by: ada }),
    );
    if (begun.answer !== 'begun') throw new Error(begun.answer);
    const french = await cut(
      first.artifactId,
      first.id,
      contentOf(first, 'fr-FR', para('b1', 'Discussion.')),
      {
        line: begun.line.id,
        translates: first.id,
      },
    );
    if (french.answer !== 'recorded') throw new Error(french.answer);
    await approve(french.version, begun.line.id);

    const approved = (await as((trx) => latestRevisionsOf(trx, [first.artifactId]))).get(
      first.artifactId,
    );
    expect(approved?.versionId).toBe(first.id);
  });

  it('keeps a lock per line, so a translator and the author edit at once', async () => {
    const first = await component('Abstract');
    await approve(first);
    const begun = await as((trx) =>
      beginTranslation(trx, { artifactId: first.artifactId, language: 'fr-FR', by: ada }),
    );
    if (begun.answer !== 'begun') throw new Error(begun.answer);

    const author = await as((trx) =>
      claimLock(trx, { artifactId: first.artifactId, principal: ada, session: randomUUID() }),
    );
    expect(author.answer).toBe('claimed');
    const translator = await as(
      (trx) =>
        claimLock(trx, {
          artifactId: first.artifactId,
          principal: grace,
          session: randomUUID(),
          line: begun.line.id,
        }),
      grace,
    );
    expect(translator.answer).toBe('claimed');
    expect((await as((trx) => readLock(trx, first.artifactId)))?.holder).toBe(ada);
    expect((await as((trx) => readLock(trx, first.artifactId, begun.line.id)))?.holder).toBe(grace);
    expect((await as((trx) => latestVersion(trx, first.artifactId)))?.id).toBe(first.id);
  });

  it('keeps one session’s words on each line apart: a cut on either takes its own line’s alone', async () => {
    const first = await component('Conclusion');
    await approve(first);
    const begun = await as((trx) =>
      beginTranslation(trx, { artifactId: first.artifactId, language: 'fr-FR', by: ada }),
    );
    if (begun.answer !== 'begun') throw new Error(begun.answer);
    // One tab, one session id, on both lines, each opened from the same version.
    const session = randomUUID();
    const on = (line?: string) => ({
      artifactId: first.artifactId,
      principal: ada,
      session,
      ...(line === undefined ? {} : { line }),
    });
    const words = (language: string, value: string) =>
      contentOf(first, language, para('b1', value));
    await as(async (trx) => {
      await claimLock(trx, { ...on(), move: true });
      await claimLock(trx, { ...on(begun.line.id), move: true });
      const english = await saveIteration(trx, {
        ...on(),
        sequence: 1,
        openedFrom: first.id,
        content: words('en-GB', 'English words.'),
      });
      const french = await saveIteration(trx, {
        ...on(begun.line.id),
        // A session's sequence is one count across its lines.
        sequence: 2,
        openedFrom: first.id,
        content: words('fr-FR', 'Des mots français.'),
      });
      expect([english.answer, french.answer]).toEqual(['accepted', 'accepted']);
    });
    const text = (version: StoredVersion) =>
      JSON.stringify(parseContentDocument(version.content).content);
    const onLine = await as((trx) =>
      cutVersion(trx, { ...on(begun.line.id), openedFrom: first.id, translates: first.id }),
    );
    if (onLine.answer !== 'recorded') throw new Error(onLine.answer);
    expect(text(onLine.version)).toContain('Des mots français.');
    const onMain = await as((trx) => cutVersion(trx, { ...on(), openedFrom: first.id }));
    if (onMain.answer !== 'recorded') throw new Error(onMain.answer);
    expect(text(onMain.version)).toContain('English words.');
  });

  it('refuses a lock on a line that is not the component’s, or a version recording another’s source', async () => {
    const one = await component('Appendix');
    const other = await component('Glossary');
    await approve(other);
    const begun = await as((trx) =>
      beginTranslation(trx, { artifactId: other.artifactId, language: 'fr-FR', by: ada }),
    );
    if (begun.answer !== 'begun') throw new Error(begun.answer);
    expect(
      await as((trx) =>
        claimLock(trx, {
          artifactId: one.artifactId,
          principal: ada,
          session: randomUUID(),
          line: begun.line.id,
        }),
      ),
    ).toEqual({ answer: 'artifact.missing' });
    // The store holds a recorded source to the line's own component's main line, whatever its caller.
    await expect(
      as((trx) =>
        trx
          .insertInto('translation_state')
          .values({ line_id: begun.line.id, version_id: other.id, translates: one.id, by: ada })
          .execute(),
      ),
    ).rejects.toThrow(/translation_state/);
  });
});
