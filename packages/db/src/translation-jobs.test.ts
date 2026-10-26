import { randomUUID } from 'node:crypto';
import { parseContentDocument, xliffUnits, type XliffPart } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDocument } from './documents.js';
import { claimLock, saveIteration } from './editing.js';

import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { cutVersion, releaseLock } from './promotion.js';
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
import { beginTranslation, translationsOf } from './translation.js';
import {
  applyReturn,
  closeTranslationJob,
  decideHeld,
  jobFileParts,
  makeTranslationJob,
  readHeld,
  readTranslationJob,
  receiveReturn,
  translationJobsOf,
  type TranslationJob,
} from './translation-jobs.js';
import type { StoredVersion } from './versions.js';
import { moveArtifact } from './workflow.js';
import { decideGate } from './workflow-gates.js';

describe('translation jobs (the XL plan, XL-D, XL-E)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let space = '';
  let document = { id: '', version: '' };

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, { actorKind: 'person', actor: ada });

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

  const approve = (version: StoredVersion) =>
    as(async (trx) => {
      const moved = await moveArtifact(trx, {
        artifactId: version.artifactId,
        kind: 'component',
        transition: 'submit',
        from: 'draft',
        by: ada,
        may: () => true,
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
      });
      if (passed.answer !== 'passed') throw new Error(passed.answer);
      return version;
    });

  const approved = async (title: string) => approve(await component(title));

  /** A translation into `language`, begun and cut against its approved source. */
  const translated = (source: StoredVersion, language: string) =>
    as(async (trx) => {
      const begun = await beginTranslation(trx, {
        artifactId: source.artifactId,
        language,
        by: ada,
      });
      if (begun.answer !== 'begun') throw new Error(begun.answer);
      const at = {
        artifactId: source.artifactId,
        principal: ada,
        session: randomUUID(),
        line: begun.line.id,
      };
      const claimed = await claimLock(trx, { ...at, move: true });
      if (claimed.answer !== 'claimed') throw new Error(claimed.answer);
      const content = { ...parseContentDocument(source.content), language };
      await saveIteration(trx, { ...at, sequence: 1, openedFrom: source.id, content });
      const made = await cutVersion(trx, { ...at, openedFrom: source.id, translates: source.id });
      if (made.answer !== 'recorded') throw new Error(made.answer);
    });

  /** One editing session on the main line, claimed, saved, cut and let go. */
  const revise = (version: StoredVersion, words: string) =>
    as(async (trx) => {
      const at = { artifactId: version.artifactId, principal: ada, session: randomUUID() };
      const claimed = await claimLock(trx, { ...at, move: true });
      if (claimed.answer !== 'claimed') throw new Error(claimed.answer);
      const content = {
        ...parseContentDocument(version.content),
        content: [
          {
            type: 'paragraph' as const,
            id: 'p1',
            style: 'body',
            content: [{ type: 'text' as const, value: words, marks: [] }],
          },
        ],
      };
      await saveIteration(trx, { ...at, sequence: 1, openedFrom: version.id, content });
      const made = await releaseLock(trx, { ...at, openedFrom: version.id });
      if (made.answer !== 'released' || made.version === null) throw new Error(made.answer);
      return made.version;
    });

  /** A component with words, approved: what a job sends. */
  const worded = async (title: string, words: string) =>
    approve(await revise(await component(title), words));

  /** Each unit of a version's content, its words put in brackets: a vendor's translation. */
  const translatedUnits = (version: StoredVersion) =>
    new Map(
      xliffUnits(parseContentDocument(version.content)).map((unit) => [
        unit.id,
        unit.parts.map((part): XliffPart =>
          part.kind === 'text' ? { kind: 'text', text: `[${part.text}]` } : part,
        ),
      ]),
    );

  /** A file returned to `sent` and read, `files` by each component sent. */
  const returned = async (
    sent: TranslationJob,
    files: Map<string, Map<string, XliffPart[] | null>>,
    target: string | null = 'fr-FR',
    mayEdit: (component: string) => Promise<boolean> = async () => true,
  ) => {
    const received = await as((trx) =>
      receiveReturn(trx, {
        documentId: document.id,
        job: sent.id,
        key: `returns/${randomUUID()}`,
        sha256: 'a'.repeat(64),
        bytes: 10,
        by: ada,
      }),
    );
    if (received.answer !== 'received') throw new Error(received.answer);
    const id = received.job.returns[0]!.id;
    await as((trx) =>
      applyReturn(trx, {
        id,
        target,
        files: new Map([...files].map(([component, units]) => [`f.${component}`, units])),
        mayEdit,
      }),
    );
    return (await as((trx) => readTranslationJob(trx, document.id, sent.id)))!;
  };

  const job = (components: { id: string; editable: boolean }[], language = 'fr-FR') =>
    as((trx) =>
      makeTranslationJob(trx, {
        documentId: document.id,
        documentVersion: document.version,
        language,
        vendor: 'Babel Ltd',
        by: ada,
        components,
      }),
    );

  const statusOf = async (artifactId: string, language = 'fr-FR') =>
    (await as((trx) => translationsOf(trx, [artifactId])))
      .get(artifactId)
      ?.find((each) => each.language === language)?.status;

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
    document = await as(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: space,
        title: 'Pond survey',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return { id: made.version.artifactId, version: made.version.id };
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('sends each component needing the language from the source version a translator is shown, and lists one it cannot send', async () => {
    const fresh = await approved('Sampling');
    const draft = await component('Equipment');
    const theirs = await approved('Safety');
    const done = await approved('Scope');
    await translated(done, 'fr-FR');

    const made = await job([
      { id: fresh.artifactId, editable: true },
      { id: draft.artifactId, editable: true },
      { id: theirs.artifactId, editable: false },
      { id: done.artifactId, editable: true },
    ]);
    if (made.answer !== 'made') throw new Error(made.answer);
    expect(made.job).toMatchObject({ language: 'fr-FR', vendor: 'Babel Ltd', closed: null });
    const byComponent = new Map(made.job.items.map((item) => [item.component, item]));
    expect(byComponent.get(fresh.artifactId)).toMatchObject({
      sourceVersion: fresh.id,
      lineHead: null,
      notSent: null,
      outcome: null,
    });
    expect(byComponent.get(fresh.artifactId)!.line).toEqual(expect.any(String));
    expect(byComponent.get(draft.artifactId)).toMatchObject({
      line: null,
      notSent: 'needs_revision',
    });
    expect(byComponent.get(theirs.artifactId)).toMatchObject({ notSent: 'not_editable' });
    // Translated and current: not listed.
    expect(byComponent.has(done.artifactId)).toBe(false);

    const sent = await as((trx) =>
      trx
        .selectFrom('audit_event')
        .select('detail')
        .where('kind', '=', 'translation.job_sent')
        .where('subject', '=', document.id)
        .executeTakeFirstOrThrow(),
    );
    expect(sent.detail).toEqual({ job: made.job.id, language: 'fr-FR', sent: 1, notSent: 2 });

    // The file is written from the version sent, of what the reader may read now.
    const parts = await as((trx) =>
      jobFileParts(trx, made.job, new Set([fresh.artifactId, theirs.artifactId])),
    );
    expect(parts).toEqual([
      { component: fresh.artifactId, title: 'Sampling', type: 'Topic', content: fresh.content },
    ]);
    expect(await as((trx) => jobFileParts(trx, made.job, new Set()))).toEqual([]);
  });

  it('holds a sent translation in translation until its job is closed, and sends it to no second job', async () => {
    const source = await approved('Sites');
    const made = await job([{ id: source.artifactId, editable: true }]);
    if (made.answer !== 'made') throw new Error(made.answer);
    expect(await statusOf(source.artifactId)).toEqual({ status: 'inTranslation' });
    expect(await job([{ id: source.artifactId, editable: true }])).toEqual({
      answer: 'translation.nothing_to_send',
    });

    const closed = await as((trx) =>
      closeTranslationJob(trx, { documentId: document.id, job: made.job.id, by: ada }),
    );
    expect(closed).toMatchObject({ answer: 'closed', job: { closed: { by: ada } } });
    expect(await statusOf(source.artifactId)).toEqual({ status: 'untranslated' });
    expect(
      await as((trx) =>
        closeTranslationJob(trx, { documentId: document.id, job: made.job.id, by: ada }),
      ),
    ).toEqual({ answer: 'translation.job_closed' });
    const event = await as((trx) =>
      trx
        .selectFrom('audit_event')
        .select('detail')
        .where('kind', '=', 'translation.job_closed')
        .executeTakeFirstOrThrow(),
    );
    expect(event.detail).toEqual({ job: made.job.id, outstanding: 1 });
    expect((await as((trx) => translationJobsOf(trx, document.id)))[0]!.id).toBe(made.job.id);
  });

  it('LOC-018 LOC-033 makes each component a returned file translates a version of its line, translating the source version sent, and records what came back', async () => {
    const source = await worded('Ponds', 'Twelve ponds were sampled.');
    const made = await job([{ id: source.artifactId, editable: true }]);
    if (made.answer !== 'made') throw new Error(made.answer);

    const after = await returned(made.job, new Map([[source.artifactId, translatedUnits(source)]]));
    const item = after.items[0]!;
    expect(item).toMatchObject({ outcome: 'returned', decided: { by: ada } });
    expect(after.returns[0]).toMatchObject({ state: 'read', returned: 1, held: 0, refused: 0 });
    expect(await statusOf(source.artifactId)).toEqual({ status: 'translated' });
    const variant = await as((trx) =>
      trx
        .selectFrom('artifact_version')
        .select(['content', 'line_id'])
        .where('id', '=', item.version!)
        .executeTakeFirstOrThrow(),
    );
    expect(variant.line_id).toBe(item.line);
    expect(parseContentDocument(variant.content)).toMatchObject({
      language: 'fr-FR',
      content: [{ id: 'p1', content: [{ value: '[Twelve ponds were sampled.]' }] }],
    });
    const event = await as((trx) =>
      trx
        .selectFrom('audit_event')
        .select('detail')
        .where('kind', '=', 'translation.job_returned')
        .executeTakeFirstOrThrow(),
    );
    expect(event.detail).toEqual({
      job: made.job.id,
      return: after.returns[0]!.id,
      returned: 1,
      held: 0,
      refused: 0,
      failure: null,
    });
  });

  it('LOC-035 never applies a return whose source moved since it was sent: it is held for a person, who accepts it as a translation of the version sent, out of date, or rejects it', async () => {
    const first = await worded('Streams', 'Streams were walked.');
    const second = await worded('Wells', 'Wells were dipped.');
    const made = await job([
      { id: first.artifactId, editable: true },
      { id: second.artifactId, editable: true },
    ]);
    if (made.answer !== 'made') throw new Error(made.answer);
    // Both sources approved again since.
    await approve(await revise(first, 'Streams were walked twice.'));
    await approve(await revise(second, 'Wells were dipped twice.'));

    const after = await returned(
      made.job,
      new Map([
        [first.artifactId, translatedUnits(first)],
        [second.artifactId, translatedUnits(second)],
      ]),
    );
    expect(after.items.map((item) => item.outcome)).toEqual(['held', 'held']);
    expect(after.returns[0]).toMatchObject({ returned: 0, held: 2 });
    // Held, and so still out.
    expect(await statusOf(first.artifactId)).toEqual({ status: 'inTranslation' });
    const held = await as((trx) =>
      readHeld(trx, { documentId: document.id, job: made.job.id, component: first.artifactId }),
    );
    expect(held?.content.content).toMatchObject([
      { content: [{ value: '[Streams were walked.]' }] },
    ]);

    const decide = (component: string, decision: 'accept' | 'reject') =>
      as((trx) =>
        decideHeld(trx, {
          documentId: document.id,
          job: made.job.id,
          component,
          decision,
          by: grace,
        }),
      );
    const accepted = await decide(first.artifactId, 'accept');
    expect(accepted).toMatchObject({ answer: 'decided' });
    expect(await statusOf(first.artifactId)).toEqual({ status: 'outOfDate', retranslate: true });
    const translates = await as((trx) =>
      trx
        .selectFrom('translation_state')
        .select('translates')
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirstOrThrow(),
    );
    expect(translates.translates).toBe(first.id);

    expect(await decide(second.artifactId, 'reject')).toMatchObject({ answer: 'decided' });
    const decided = (await as((trx) => readTranslationJob(trx, document.id, made.job.id)))!;
    expect(decided.items.map((item) => [item.outcome, item.decided?.by])).toEqual([
      ['returned', grace],
      ['refused', grace],
    ]);
    expect(await statusOf(second.artifactId)).toEqual({ status: 'untranslated' });
    expect(await decide(second.artifactId, 'accept')).toEqual({ answer: 'item.missing' });
    const events = await as((trx) =>
      trx
        .selectFrom('audit_event')
        .select('detail')
        .where('kind', '=', 'translation.job_decided')
        .execute(),
    );
    expect(events.map((each) => each.detail)).toEqual([
      {
        job: made.job.id,
        component: first.artifactId,
        decision: 'accept',
        version: decided.items[0]!.version,
      },
      { job: made.job.id, component: second.artifactId, decision: 'reject', version: null },
    ]);
  });

  it('holds a return for a line somebody is editing, rather than cut over their session', async () => {
    const source = await worded('Lakes', 'Lakes were rowed.');
    const made = await job([{ id: source.artifactId, editable: true }]);
    if (made.answer !== 'made') throw new Error(made.answer);
    const claimed = await as((trx) =>
      claimLock(trx, {
        artifactId: source.artifactId,
        principal: grace,
        session: randomUUID(),
        line: made.job.items[0]!.line!,
        move: true,
      }),
    );
    expect(claimed.answer).toBe('claimed');
    const after = await returned(made.job, new Map([[source.artifactId, translatedUnits(source)]]));
    expect(after.items[0]!.outcome).toBe('held');
  });

  it('refuses a component that does not read back, or that the uploader may no longer edit, and leaves one the file leaves out', async () => {
    const broken = await worded('Rivers', 'Rivers were forded.');
    const theirs = await worded('Canals', 'Canals were dredged.');
    const later = await worded('Ditches', 'Ditches were cleared.');
    const made = await job(
      [broken, theirs, later].map((each) => ({ id: each.artifactId, editable: true })),
    );
    if (made.answer !== 'made') throw new Error(made.answer);
    const after = await returned(
      made.job,
      new Map<string, Map<string, XliffPart[] | null>>([
        [broken.artifactId, new Map([['b.p1', null]])],
        [theirs.artifactId, translatedUnits(theirs)],
      ]),
      'fr-FR',
      async (component) => component !== theirs.artifactId,
    );
    expect(after.items.map((item) => item.outcome)).toEqual(['refused', 'refused', null]);
    expect(after.returns[0]).toMatchObject({ returned: 0, held: 0, refused: 2 });
    // A refused item takes a later return.
    const again = await returned(after, new Map([[broken.artifactId, translatedUnits(broken)]]));
    expect(again.items[0]!.outcome).toBe('returned');
  });

  it('holds a return whose translation moved since it was sent, applies a file once, records which file, and sends nothing of a deleted component (the XL final review)', async () => {
    const moved = await worded('Fens', 'Fens were crossed.');
    const twice = await worded('Bogs', 'Bogs were sounded.');
    const gone = await worded('Marsh', 'Marsh was mapped.');
    const made = await job(
      [moved, twice, gone].map((each) => ({ id: each.artifactId, editable: true })),
    );
    if (made.answer !== 'made') throw new Error(made.answer);
    // A translator's own version on the line since it was sent.
    await as(async (trx) => {
      const line = made.job.items[0]!.line!;
      const at = { artifactId: moved.artifactId, principal: ada, session: randomUUID(), line };
      await claimLock(trx, { ...at, move: true });
      const content = { ...parseContentDocument(moved.content), language: 'fr-FR' };
      await saveIteration(trx, { ...at, sequence: 1, openedFrom: moved.id, content });
      const cut = await releaseLock(trx, { ...at, openedFrom: moved.id, translates: moved.id });
      if (cut.answer !== 'released') throw new Error(cut.answer);
    });
    await as((trx) =>
      trx
        .insertInto('artifact_deletion')
        .values({ artifact_id: gone.artifactId, kind: 'component', act: 'deleted', by: ada })
        .execute(),
    );
    const files = new Map([
      [moved.artifactId, translatedUnits(moved)],
      [twice.artifactId, translatedUnits(twice)],
      [gone.artifactId, translatedUnits(gone)],
    ]);
    const after = await returned(made.job, files);
    expect(after.items.map((item) => item.outcome)).toEqual(['held', 'returned', 'refused']);
    const recorded = await as((trx) =>
      trx
        .selectFrom('translation_job_item')
        .select('return_id')
        .where('job_id', '=', made.job.id)
        .execute(),
    );
    expect(new Set(recorded.map((row) => row.return_id))).toEqual(new Set([after.returns[0]!.id]));
    // The same file again applies nothing it applied already.
    const again = await returned(after, files);
    expect(again.returns[0]).toMatchObject({ returned: 0, held: 0 });
    expect(again.items[1]!.version).toBe(after.items[1]!.version);
    // And a deleted component placed in a document is sent in no job.
    expect(await job([{ id: gone.artifactId, editable: true }], 'de-DE')).toEqual({
      answer: 'translation.nothing_to_send',
    });
  });

  it('sends one source language in a job, listing a component in another as not sent', async () => {
    const english = await worded('Moors', 'Moors were walked.');
    const french = await as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title: 'Landes',
        language: 'fr-FR',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });
    await approve(await revise(french, 'Les landes.'));
    const made = await job(
      [english, french].map((each) => ({ id: each.artifactId, editable: true })),
      'de-DE',
    );
    if (made.answer !== 'made') throw new Error(made.answer);
    expect(made.job.items.map((item) => item.notSent)).toEqual([null, 'other_source']);
  });

  it('refuses a file whole in another language, or naming a component the job did not send', async () => {
    const source = await worded('Moors', 'Moors were crossed.');
    const made = await job([{ id: source.artifactId, editable: true }]);
    if (made.answer !== 'made') throw new Error(made.answer);
    const units = new Map([[source.artifactId, translatedUnits(source)]]);
    const other = await returned(made.job, units, 'de-DE');
    expect(other.returns[0]).toMatchObject({ state: 'failed', failure: 'language_mismatch' });
    const stranger = await returned(
      made.job,
      new Map([...units, ['00000000-0000-4000-8000-0000000000aa', new Map()]]),
    );
    expect(stranger.returns[0]).toMatchObject({ state: 'failed', failure: 'unknown_file' });
    expect(stranger.items[0]!.outcome).toBeNull();
  });

  it('refuses a language that is no tag, and a job of another document', async () => {
    expect(await job([], 'not a tag')).toEqual({ answer: 'translation.language_invalid' });
    expect(
      await as((trx) =>
        closeTranslationJob(trx, { documentId: randomUUID(), job: randomUUID(), by: ada }),
      ),
    ).toEqual({ answer: 'job.missing' });
  });
});
