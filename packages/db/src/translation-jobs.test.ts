import { randomUUID } from 'node:crypto';
import { parseContentDocument } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDocument } from './documents.js';
import { claimLock, saveIteration } from './editing.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { cutVersion } from './promotion.js';
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
  closeTranslationJob,
  jobFileParts,
  makeTranslationJob,
  translationJobsOf,
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

  it('refuses a language that is no tag, and a job of another document', async () => {
    expect(await job([], 'not a tag')).toEqual({ answer: 'translation.language_invalid' });
    expect(
      await as((trx) =>
        closeTranslationJob(trx, { documentId: randomUUID(), job: randomUUID(), by: ada }),
      ),
    ).toEqual({ answer: 'job.missing' });
  });
});
