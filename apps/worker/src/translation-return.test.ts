import { createHash, randomUUID } from 'node:crypto';
import {
  claimLock,
  createComponent,
  createDocument,
  createJobQueue,
  createTenant,
  decideGate,
  findRole,
  grant,
  jobFileParts,
  makeTranslationJob,
  migrate,
  moveArtifact,
  prepareDatabase,
  readTranslationJob,
  receiveReturn,
  releaseLock,
  saveIteration,
  type JobQueue,
  type StoredVersion,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
  type TranslationJob,
} from '@alloy-works/db';
import { freshDatabase, type TestDatabase, testTenantDatabase } from '@alloy-works/db/testing';
import { parseContentDocument, writeXliff } from '@alloy-works/domain';
import { createObjectStores, type ObjectStores, type TenantStore } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { translationReturnJob } from './jobs/translation-return.js';
import { processNext, type JobHandler, type WorkerLog } from './worker.js';

describe('the translation_return job, which reads a returned file back into translations (the XL plan, XL-F)', () => {
  let db: TestDatabase;
  let objects: TestObjectStore;
  let service: TenantDatabase;
  let worker: TenantDatabase;
  let queue: JobQueue;
  let stores: ObjectStores;
  let tenant: Tenant;
  let store: TenantStore;
  let ada = '';
  let grace = '';
  let general = '';
  let handlers: Record<string, JobHandler>;
  const log: WorkerLog = { info: () => {}, warn: () => {}, error: () => {} };

  const work = () =>
    processNext({ queue, db: worker, handlers, workerId: 'worker-1', leaseMs: 60_000, log });
  const as = <T>(fn: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, fn, { actorKind: 'person', actor: ada });

  /** A component of Ada's with words, approved by Grace. */
  const approved = (title: string, words: string) =>
    as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: general,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const at = { artifactId: made.version.artifactId, principal: ada, session: randomUUID() };
      await claimLock(trx, { ...at, move: true });
      await saveIteration(trx, {
        ...at,
        sequence: 1,
        openedFrom: made.version.id,
        content: {
          ...parseContentDocument(made.version.content),
          content: [
            {
              type: 'paragraph',
              id: 'p1',
              style: 'body',
              content: [{ type: 'text', value: words, marks: [] }],
            },
          ],
        },
      });
      const released = await releaseLock(trx, { ...at, openedFrom: made.version.id });
      if (released.answer !== 'released' || !released.version) throw new Error(released.answer);
      const version: StoredVersion = released.version;
      await moveArtifact(trx, {
        artifactId: version.artifactId,
        kind: 'component',
        transition: 'submit',
        from: 'draft',
        by: ada,
        may: () => true,
      });
      await decideGate(trx, {
        artifactId: version.artifactId,
        kind: 'component',
        transition: 'approve',
        version: version.id,
        decision: 'approved',
        by: grace,
        may: () => true,
      });
      return version;
    });

  /** A job of these components to French, of a document of Ada's. */
  const sent = (components: readonly StoredVersion[]) =>
    as(async (trx) => {
      const document = await createDocument(trx, {
        spaceId: general,
        title: 'Pond survey',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (document.answer !== 'created') throw new Error(document.answer);
      const made = await makeTranslationJob(trx, {
        documentId: document.version.artifactId,
        documentVersion: document.version.id,
        language: 'fr-FR',
        by: ada,
        components: components.map((each) => ({ id: each.artifactId, editable: true })),
      });
      if (made.answer !== 'made') throw new Error(made.answer);
      return made.job;
    });

  /** The job's own file, each segment given a target: what a vendor sends back. */
  const translatedFile = (job: TranslationJob) =>
    as(async (trx) => {
      const parts = await jobFileParts(trx, job, new Set(job.items.map((item) => item.component)));
      return writeXliff({
        job: job.id,
        source: 'en-GB',
        target: 'fr-FR',
        files: parts.map((part) => ({
          component: part.component,
          title: part.title,
          type: part.type ?? '',
          content: parseContentDocument(part.content),
        })),
        terms: new Map(),
      }).replace(/<source>(.*?)<\/source>/g, '<source>$1</source><target>[$1]</target>');
    });

  /** These bytes returned to the job as the service returns them: stored, and the read queued. */
  const returned = async (job: TranslationJob, file: string | Uint8Array) => {
    const bytes = typeof file === 'string' ? new TextEncoder().encode(file) : file;
    const stored = await store.put(bytes, 'application/octet-stream');
    const received = await as((trx) =>
      receiveReturn(trx, {
        documentId: job.document,
        job: job.id,
        key: stored.key,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: stored.size,
        by: ada,
      }),
    );
    if (received.answer !== 'received') throw new Error(received.answer);
  };

  const again = (job: TranslationJob) =>
    as(async (trx) => (await readTranslationJob(trx, job.document, job.id))!);

  beforeAll(async () => {
    db = await freshDatabase();
    objects = await testObjectStore();
    await prepareDatabase(db.adminUrl);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    await objects.setUp(db.adminUrl, tenant);
    service = testTenantDatabase(db.serviceUrl);
    worker = testTenantDatabase(db.workerUrl);
    queue = createJobQueue(db.workerUrl);
    stores = createObjectStores(objects.settings, objects.sealingKey);
    handlers = { translation_return: translationReturnJob({ db: worker, stores }) };
    await service.withTenant(tenant, async (trx) => {
      const person = async (name: string) =>
        (
          await trx
            .insertInto('principal')
            .values({
              issuer: 'https://idp.example',
              subject: name,
              email: null,
              display_name: name,
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      ada = await person('Ada');
      grace = await person('Grace');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      for (const [who, role] of [
        [ada, 'Author'],
        [grace, 'Approver'],
      ] as const) {
        await grant(trx, {
          roleId: (await findRole(trx, role))!.id,
          subject: { principal: who },
          level: { kind: 'space', id: general },
          effect: 'allow',
          grantedBy: ada,
        });
      }
      store = await stores.forTenant(trx, tenant);
    });
  });

  afterAll(async () => {
    await queue?.close();
    await worker?.close();
    await service?.close();
    await objects?.drop();
    await db?.drop();
  });

  it('LOC-018 reads a returned file in its thread and makes each component its translation, for the uploader', async () => {
    const source = await approved('Ponds', 'Twelve ponds were sampled.');
    const job = await sent([source]);
    await returned(job, await translatedFile(job));
    expect(await work()).toBe('done');
    const after = await again(job);
    expect(after.returns[0]).toMatchObject({ state: 'read', returned: 1, by: ada });
    expect(after.items[0]).toMatchObject({ outcome: 'returned', decided: { by: ada } });
    const variant = await as((trx) =>
      trx
        .selectFrom('artifact_version')
        .select(['content', 'author_id'])
        .where('id', '=', after.items[0]!.version!)
        .executeTakeFirstOrThrow(),
    );
    expect(variant.author_id).toBe(ada);
    expect(JSON.stringify(variant.content)).toContain('[Twelve ponds were sampled.]');
  });

  it('fails a file it cannot read whole, saying why, and applies nothing', async () => {
    const source = await approved('Streams', 'Streams were walked.');
    const job = await sent([source]);
    await returned(job, '<!DOCTYPE x [<!ENTITY e "boom">]><xliff version="2.1">&e;</xliff>');
    expect(await work()).toBe('failed');
    const after = await again(job);
    expect(after.returns[0]).toMatchObject({ state: 'failed', failure: 'file_unsafe' });
    expect(after.items[0]!.outcome).toBeNull();
  });
});
