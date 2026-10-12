import { randomBytes, randomUUID } from 'node:crypto';
import {
  defaultNumberingScheme,
  type ContentDocument,
  type OutlineDocument,
  type PostgresSettings,
  type PublishFailureCode,
} from '@alloy-works/domain';
import { sealSecret } from '@alloy-works/sealing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ATTENTION_LIMIT, whatWaits } from './attention.js';
import { bootstrapCluster } from './bootstrap.js';
import {
  createConnection,
  recordConnectionTest,
  recordConnectionVersion,
  setConnectionCredential,
} from './connections.js';
import { createComponent } from './creation.js';
import { createDocument } from './documents.js';
import { claimLock, saveIteration } from './editing.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { cutVersion } from './promotion.js';
import { createTenant, type Tenant } from './provision.js';
import { failPublicationRequest, recordPublication, requestPublication } from './publishing.js';
import { discardUnsaved } from './recovery.js';
import { findRole } from './roles.js';
import { makeBaseline, requestBaselinePublication } from './baselines.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { recordVersion, type StoredVersion } from './versions.js';

const ISSUER = 'https://idp.example';

const settings = (name: string): PostgresSettings => ({
  schemaVersion: 1,
  name,
  description: 'The sites and their readings.',
  type: 'postgres',
  source: {
    host: 'source-postgres',
    port: 5432,
    database: 'readings',
    account: 'reader',
    tls: 'require',
  },
  identity: { kind: 'service' },
  retired: false,
});

describe('what waits on a person (home.md, Needs your attention)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  const key = randomBytes(32);

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  /**
   * A space of its own, so nothing another test made waits here, with Ada and Grace each an Author, a
   * Publisher and a Query builder on it, and Ivy a Reader.
   */
  const fresh = () =>
    as(async (trx) => {
      const space = (await createSpace(trx, `Space ${randomUUID()}`)).id;
      const person = async (name: string) =>
        (
          await trx
            .insertInto('principal')
            .values({ issuer: ISSUER, subject: randomUUID(), email: null, display_name: name })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      const ada = await person('Ada');
      const grace = await person('Grace');
      const ivy = await person('Ivy');
      for (const [principal, roles] of [
        [ada, ['Author', 'Publisher', 'Query builder']],
        [grace, ['Author', 'Publisher', 'Query builder']],
        [ivy, ['Reader']],
      ] as const) {
        for (const name of roles) {
          await grant(trx, {
            roleId: (await findRole(trx, name))!.id,
            subject: { principal },
            level: { kind: 'space', id: space },
            effect: 'allow',
            grantedBy: principal,
          });
        }
      }
      return { space, ada, grace, ivy };
    });

  /** Refuses a principal reading one artifact, by a Reader denial on it. */
  const hide = (artifact: string, principal: string) =>
    as(async (trx) => {
      await grant(trx, {
        roleId: (await findRole(trx, 'Reader'))!.id,
        subject: { principal },
        level: { kind: 'artifact', id: artifact },
        effect: 'deny',
        grantedBy: principal,
      });
    });

  const waiting = (principal: string) => as((trx) => whatWaits(trx, principal));

  const documentIn = (space: string, author: string, title: string) =>
    as(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });

  /** The document's next version, under a new title. */
  const retitled = (version: StoredVersion, author: string, title: string) =>
    as(async (trx) => {
      const recorded = await recordVersion(trx, {
        artifactId: version.artifactId,
        openedFrom: version.id,
        author,
        substance: {
          kind: 'document',
          content: { ...(version.content as OutlineDocument), title },
        },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version;
    });

  const requested = (version: StoredVersion, requester: string) =>
    as(async (trx) => {
      const answer = await requestPublication(trx, {
        documentId: version.artifactId,
        version: version.id,
        formats: ['pdf'],
        requester,
      });
      if (answer.answer !== 'requested') throw new Error(answer.answer);
      return answer.request.id;
    });

  const failed = (
    version: StoredVersion,
    requester: string,
    code: PublishFailureCode = 'engine_failed',
  ) =>
    requested(version, requester).then((id) =>
      as((trx) =>
        failPublicationRequest(trx, id, [
          { stage: 'engine', code, node: null, block: null, detail: null },
        ]),
      ),
    );

  /** A publication made of the document at this version, as a worker records one. */
  const published = (version: StoredVersion, requester: string) =>
    requested(version, requester).then((requestId) => recorded(requestId));

  const recorded = (requestId: string) =>
    as(async (trx) => {
      const id = await recordPublication(trx, {
        requestId,
        pipelineVersion: '2',
        fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
        dataSha256: 'b'.repeat(64),
        numbering: { scheme: defaultNumberingScheme.id, entries: [] },
        outputs: [
          {
            format: 'pdf',
            engineVersion: '0.15.1',
            templateVersion: 2,
            key: `${tenant.role}/sha256/${'c'.repeat(64)}`,
            sha256: 'c'.repeat(64),
            bytes: 1000,
          },
        ],
      });
      if (!id) throw new Error(`The request ${requestId} was already finished`);
      return id;
    });

  /** A component, and an editing session on it whose saves are iterations not in a version. */
  const componentIn = async (space: string, author: string, title: string) => {
    const made = await as(async (trx) => {
      const answer = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author,
      });
      if (answer.answer !== 'created') throw new Error(answer.answer);
      return answer.version;
    });
    const session = randomUUID();
    let sequence = 0;
    const editing = { artifactId: made.artifactId, principal: author, session };
    const claimed = await as((trx) => claimLock(trx, { ...editing, move: true }));
    if (claimed.answer !== 'claimed') throw new Error(claimed.answer);
    const save = async (text: string) => {
      sequence += 1;
      const content = made.content as ContentDocument;
      const answer = await as((trx) =>
        saveIteration(trx, {
          ...editing,
          sequence,
          openedFrom: made.id,
          content: {
            ...content,
            content: [
              {
                type: 'paragraph',
                id: 'b1',
                style: 'body',
                content: [{ type: 'text', value: text, marks: [] }],
              },
            ],
          },
        }),
      );
      if (answer.answer !== 'accepted') throw new Error(answer.answer);
    };
    const cut = async () => {
      const answer = await as((trx) => cutVersion(trx, { ...editing, openedFrom: made.id }));
      if (answer.answer !== 'recorded') throw new Error(answer.answer);
    };
    return { id: made.artifactId, save, cut };
  };

  /** A connection whose credential is set, by `by`, and never tested with it. */
  const connectionIn = async (space: string, by: string, name: string) => {
    const connection = await as(async (trx) => {
      const answer = await createConnection(trx, {
        author: by,
        spaceId: space,
        settings: settings(name),
      });
      if (answer.answer !== 'created') throw new Error(answer.answer);
      return answer.connection;
    });
    const set = await as((trx) =>
      setConnectionCredential(trx, {
        id: connection.id,
        sealed: sealSecret(key, 'source-credential', tenant.id, 'an-invented-password'),
        by,
        sealedFor: connection.settings,
      }),
    );
    if (set.answer !== 'set') throw new Error(set.answer);
    const test = () =>
      as((trx) =>
        recordConnectionTest(trx, {
          connectionId: connection.id,
          versionId: connection.version.id,
          credentialId: set.credentialId,
          outcome: 'failed',
          findings: [],
          failure: 'connection_failed',
          by,
        }),
      );
    const retire = () =>
      as(async (trx) => {
        const answer = await recordConnectionVersion(trx, {
          author: by,
          id: connection.id,
          openedFrom: connection.version.id,
          settings: { ...connection.settings, retired: true },
        });
        if (answer.answer !== 'recorded') throw new Error(answer.answer);
      });
    return { id: connection.id, test, retire };
  };

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
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('SCH-070 lists each kind waiting on the person, the most pressing first and newest first within it, with the reason and the title they read', async () => {
    const { space, ada } = await fresh();
    const connection = await connectionIn(space, ada, 'Readings');
    const earlier = await documentIn(space, ada, 'The audit');
    await published(earlier, ada);
    await retitled(earlier, ada, 'The audit, revised');
    const component = await componentIn(space, ada, 'Install the printer');
    await component.save('Unbox the printer.');
    const older = await documentIn(space, ada, 'The older report');
    await failed(older, ada, 'value_none');
    const newer = await documentIn(space, ada, 'The dosing report');
    await failed(newer, ada);

    expect(await waiting(ada)).toEqual({
      items: [
        {
          kind: 'publish_failed',
          artifact: { id: newer.artifactId, kind: 'document', title: 'The dosing report' },
          reason: 'engine_failed',
        },
        {
          kind: 'publish_failed',
          artifact: { id: older.artifactId, kind: 'document', title: 'The older report' },
          reason: 'value_none',
        },
        {
          kind: 'changes_not_in_version',
          artifact: { id: component.id, kind: 'component', title: 'Install the printer' },
        },
        {
          kind: 'published_earlier',
          artifact: { id: earlier.artifactId, kind: 'document', title: 'The audit, revised' },
        },
        {
          kind: 'connection_untested',
          artifact: { id: connection.id, kind: 'connection', title: 'Readings' },
        },
      ],
      total: 5,
    });
  });

  it('SCH-070 lists a document once, as failed, when it was also published from an earlier version', async () => {
    const { space, ada } = await fresh();
    const version = await documentIn(space, ada, 'The dosing report');
    await published(version, ada);
    const next = await retitled(version, ada, 'The dosing report, revised');
    await failed(next, ada);
    const answer = await waiting(ada);
    expect(answer.total).toBe(1);
    expect(answer.items.map((item) => [item.kind, item.artifact.id])).toEqual([
      ['publish_failed', version.artifactId],
    ]);
  });

  it('SCH-070 neither lists nor clears a document as published from an earlier version by a publication of a baseline', async () => {
    const { space, ada } = await fresh();
    /** A baseline of this version, the document's latest, by Ada. */
    const baselineOf = (version: StoredVersion, name: string) =>
      as(async (trx) => {
        const made = await makeBaseline(trx, {
          documentId: version.artifactId,
          version: version.id,
          name,
          maker: ada,
        });
        if (made.answer !== 'made') throw new Error(made.answer);
        return made.baseline;
      });
    /** A publication of the baseline, as a worker records one. */
    const ofBaseline = (baseline: string) =>
      as(async (trx) => {
        const asked = await requestBaselinePublication(trx, {
          baseline,
          formats: ['pdf'],
          requester: ada,
        });
        if (asked.answer !== 'requested') throw new Error(asked.answer);
        return asked.request.id;
      }).then((requestId) => recorded(requestId));

    // A baseline of the first version, published once the second exists, lists nothing.
    const pinned = await documentIn(space, ada, 'The audit');
    const issued = await baselineOf(pinned, 'Issued');
    await retitled(pinned, ada, 'The audit, revised');
    await ofBaseline(issued);
    // Published from its latest version, then from a baseline of its first: still nothing waits.
    const current = await documentIn(space, ada, 'The dosing report');
    const first = await baselineOf(current, 'First issue');
    await published(await retitled(current, ada, 'The dosing report, revised'), ada);
    await ofBaseline(first);
    expect(await waiting(ada)).toEqual({ items: [], total: 0 });

    // Published from an earlier version, a baseline of the latest clears nothing.
    const behind = await documentIn(space, ada, 'The summary');
    await published(behind, ada);
    await ofBaseline(
      await baselineOf(await retitled(behind, ada, 'The summary, revised'), 'Second issue'),
    );
    expect((await waiting(ada)).items.map((item) => [item.kind, item.artifact.id])).toEqual([
      ['published_earlier', behind.artifactId],
    ]);
  });

  it('SCH-070 clears each item once the person does what it asks: a publication made, a version cut or the changes discarded, a test run', async () => {
    const { space, ada } = await fresh();
    const failing = await documentIn(space, ada, 'The dosing report');
    await failed(failing, ada);
    const behind = await documentIn(space, ada, 'The audit');
    await published(behind, ada);
    const latest = await retitled(behind, ada, 'The audit, revised');
    const cut = await componentIn(space, ada, 'Install the printer');
    await cut.save('Unbox the printer.');
    const discarded = await componentIn(space, ada, 'Clean the printer');
    await discarded.save('Wipe it down.');
    const connection = await connectionIn(space, ada, 'Readings');
    const retired = await connectionIn(space, ada, 'Old readings');
    expect((await waiting(ada)).total).toBe(6);

    await published(failing, ada);
    await published(latest, ada);
    await cut.cut();
    await as((trx) =>
      discardUnsaved(trx, { artifactId: discarded.id, principalId: ada }, new Date()),
    );
    // A test answered either way is a test of the credential set.
    await connection.test();
    await retired.retire();
    expect(await waiting(ada)).toEqual({ items: [], total: 0 });
  });

  it('SCH-070 clears a failure with a later publication the person may read, or made though they may not read it, and not with one they may neither read nor made', async () => {
    const { space, ada, grace } = await fresh();
    const theirs = await documentIn(space, ada, 'The dosing report');
    await failed(theirs, ada);
    await hide(await published(theirs, ada), ada);
    const readable = await documentIn(space, ada, 'The audit');
    await failed(readable, ada);
    await published(readable, grace);
    const unreadable = await documentIn(space, ada, 'The summary');
    await failed(unreadable, ada);
    await hide(await published(unreadable, grace), ada);

    const answer = await waiting(ada);
    expect(answer.items.map((item) => [item.kind, item.artifact.id])).toEqual([
      ['publish_failed', unreadable.artifactId],
    ]);
  });

  it('SCH-032 lists and counts nothing the person may not read, nor anything they may not resolve', async () => {
    const { space, ada, ivy } = await fresh();
    const document = await documentIn(space, ada, 'The dosing report');
    await failed(document, ada);
    const behind = await documentIn(space, ada, 'The audit');
    await published(behind, ada);
    await retitled(behind, ada, 'The audit, revised');
    const component = await componentIn(space, ada, 'Install the printer');
    await component.save('Unbox the printer.');
    const connection = await connectionIn(space, ada, 'Readings');
    expect((await waiting(ada)).total).toBe(4);

    // Ivy reads every one, and may resolve none: her own failed attempt and unversioned work alike.
    await failed(document, ivy);
    const hers = await componentIn(space, ivy, 'Clean the printer');
    await hers.save('Wipe it down.');
    expect(await waiting(ivy)).toEqual({ items: [], total: 0 });

    for (const id of [document.artifactId, behind.artifactId, component.id, connection.id]) {
      await hide(id, ada);
    }
    expect(await waiting(ada)).toEqual({ items: [], total: 0 });
  });

  it(`lists at most ${ATTENTION_LIMIT}, and answers how many wait`, async () => {
    const { space, ada } = await fresh();
    for (let each = 0; each < ATTENTION_LIMIT + 2; each += 1) {
      await connectionIn(space, ada, `Readings ${each}`);
    }
    const answer = await waiting(ada);
    expect(answer.items).toHaveLength(ATTENTION_LIMIT);
    expect(answer.total).toBe(ATTENTION_LIMIT + 2);
  });
});
