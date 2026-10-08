import { randomBytes, randomUUID } from 'node:crypto';
import type { AuditContext, ImageHeader, PostgresSettings } from '@alloy-works/domain';
import { sealSecret } from '@alloy-works/sealing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAssetUpload, receiveAssetBytes, recordAsset, refuseAssetUpload } from './assets.js';
import { bootstrapCluster } from './bootstrap.js';
import {
  createConnection,
  recordConnectionTest,
  recordConnectionVersion,
  setConnectionCredential,
} from './connections.js';
import { createComponent } from './creation.js';
import { nameDataset } from './datasets.js';
import { claimLock, saveIteration } from './editing.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { requestPublication } from './publishing.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import {
  auditEvents,
  freshDatabase,
  newestEvent,
  queryAs,
  TEST_PASSWORDS,
  type ReadEvent,
  type TestDatabase,
} from './testing/database.js';
import { everyKind } from './testing/every-kind.js';
import { latestVersion, recordVersion } from './versions.js';

const ISSUER = 'https://idp.example';
/** A credential's value: neither it nor its sealed form may reach an event. */
const SECRET = 'an-invented-source-password';

const settings = (over: Partial<PostgresSettings> = {}): PostgresSettings => ({
  schemaVersion: 1,
  name: 'Readings',
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
  ...over,
});

const header: ImageHeader = {
  format: 'png',
  width: 800,
  height: 500,
  orientation: 1,
  colour: 'rgb',
  alpha: false,
  depth: 8,
  resolution: null,
  end: 3530,
};

/**
 * Content and data on the audit log (the AU1 plan, task 4; AU1-J to AU1-L): each act's event in the
 * act's own transaction, attributed by its context, with the version acted on and the labels it is
 * read by.
 */
describe('content and data on the audit log', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let tenant: Tenant;
  let ada: string;
  let grace: string;
  let general: string;
  let acting: AuditContext;

  /** Runs `work` in `context`, answering it with the events it recorded. */
  async function recorded<T>(
    work: (trx: TenantTransaction) => Promise<T>,
    context: AuditContext = acting,
  ): Promise<{ answer: T; events: ReadEvent[] }> {
    const system = { actorKind: 'system' } as const;
    const before = await service.withTenant(tenant, newestEvent, system);
    const answer = await service.withTenant(tenant, work, context);
    const events = await service.withTenant(tenant, (trx) => auditEvents(trx, before), system);
    return { answer, events };
  }

  const ofKind = (events: readonly ReadEvent[], kind: string) =>
    events.filter((event) => event.kind === kind);

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const id = db.newTenantId();
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Production' },
      hostnames: [`${id}.alloy.test`],
    });
    // No default context: every event here is attributed by the context each act names.
    service = createTenantDatabase(db.serviceUrl);
    ({ ada, grace, general } = await service.withTenant(
      tenant,
      async (trx) => {
        const [first, second] = await trx
          .insertInto('principal')
          .values([
            { issuer: ISSUER, subject: 'ada', email: null, display_name: 'Ada' },
            { issuer: ISSUER, subject: 'grace', email: null, display_name: 'Grace' },
          ])
          .returning('id')
          .execute();
        const space = await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow();
        return { ada: first!.id, grace: second!.id, general: space.id };
      },
      { actorKind: 'system' },
    ));
    acting = { actorKind: 'person', actor: ada, actorLabel: 'Ada', traceId: 'req-ada' };
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('records nothing for the versions a migration seeded', async () => {
    const events = await service.withTenant(tenant, (trx) => auditEvents(trx), {
      actorKind: 'system',
    });
    expect(ofKind(events, 'content.version_cut')).toEqual([]);
  });

  it('LIF-027 records a version cut with who, what, when, its version and parent, and the title it had', async () => {
    const { answer, events } = await recorded(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: general,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const first = (await latestVersion(trx, made.version.artifactId))!;
      const substance = {
        kind: 'component' as const,
        content: { ...(first.content as Record<string, unknown>), title: 'Install the scanner' },
        definitions: first.definitions,
        values: first.values,
        notCarried: first.notCarried,
      };
      const next = await recordVersion(trx, {
        artifactId: first.artifactId,
        openedFrom: first.id,
        author: ada,
        substance: substance as never,
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      // The same again changes nothing, and records nothing.
      await recordVersion(trx, {
        artifactId: first.artifactId,
        openedFrom: next.version.id,
        author: ada,
        substance: substance as never,
      });
      return { first, second: next.version };
    });
    const cuts = ofKind(events, 'content.version_cut').filter(
      (event) => event.subject === answer.first.artifactId,
    );
    expect(cuts).toHaveLength(2);
    expect(cuts.map((event) => event.subjectVersion)).toEqual([answer.first.id, answer.second.id]);
    expect(cuts.map((event) => event.detail)).toEqual([
      { kind: 'component', parent: null },
      { kind: 'component', parent: answer.first.id },
    ]);
    for (const cut of cuts) {
      expect(cut).toMatchObject({
        actorKind: 'person',
        actor: ada,
        subjectKind: 'component',
        space: general,
        outcome: 'done',
        traceId: 'req-ada',
      });
      expect(cut.at).toBeInstanceOf(Date);
      expect(cut.labels.actor?.text).toBe('Ada');
      expect(cut.labels.space).toEqual({ text: 'General', refersTo: general, erased: false });
    }
    // Each by the title it had when it was cut.
    expect(cuts.map((event) => event.labels.subject?.text)).toEqual([
      'Install the printer',
      'Install the scanner',
    ]);
  });

  it('names the author of a version where it is not who acts', async () => {
    const { events } = await recorded(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: general,
        title: 'Grace wrote this',
        language: 'en-GB',
        direction: 'ltr',
        author: grace,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
    });
    const [cut] = ofKind(events, 'content.version_cut');
    expect(cut).toMatchObject({ actor: ada, detail: { kind: 'component', parent: null } });
    expect(cut!.detail.author).toBe(grace);
  });

  it('skips a version cut only on a schema with no log in a transaction naming nobody, and fails one naming somebody', async () => {
    // An environment as a migration's own test stands one before 0060: no log.
    const id = db.newTenantId();
    const before = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Before the log' },
      hostnames: [`${id}.alloy.test`],
    });
    await queryAs(
      db.adminUrl,
      `drop table ${before.schema}.audit_label, ${before.schema}.audit_event cascade`,
    );
    const make = (trx: TenantTransaction) =>
      trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow()
        .then(async (space) => {
          const author = await trx
            .insertInto('principal')
            .values({ issuer: ISSUER, subject: randomUUID(), email: null, display_name: 'Ada' })
            .returning('id')
            .executeTakeFirstOrThrow();
          const made = await createComponent(trx, {
            spaceId: space.id,
            title: 'Before',
            language: 'en-GB',
            direction: 'ltr',
            author: author.id,
          });
          if (made.answer !== 'created') throw new Error(made.answer);
        });
    await expect(service.withTenant(before, make)).resolves.toBeUndefined();
    await expect(service.withTenant(before, make, { actorKind: 'system' })).rejects.toThrow(
      /audit_event/,
    );
  });

  it('records nothing for an iteration', async () => {
    const { answer: component } = await recorded(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: general,
        title: 'Iterated',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });
    const session = randomUUID();
    const { answer, events } = await recorded(async (trx) => {
      await claimLock(trx, { artifactId: component.artifactId, principal: ada, session });
      return saveIteration(trx, {
        artifactId: component.artifactId,
        principal: ada,
        session,
        sequence: 1,
        openedFrom: component.id,
        content: {
          ...(component.content as Record<string, unknown>),
          content: [
            { type: 'paragraph', id: 'b1', style: 'body', content: [{ type: 'text', value: 'x' }] },
          ],
        } as never,
      });
    });
    expect(answer.answer).toBe('accepted');
    expect(events).toEqual([]);
  });

  it('DAT-007 LIF-027 records a connection made, changed, its credential set, tested and retired, by whom, when and at which version, and never the value', async () => {
    const SEALED = sealSecret(randomBytes(32), 'source-credential', tenant.id, SECRET);
    const { answer: made, events: making } = await recorded((trx) =>
      createConnection(trx, { author: ada, spaceId: general, settings: settings() }),
    );
    if (made.answer !== 'created') throw new Error(made.answer);
    const connection = made.connection;
    expect(making.map((event) => event.kind)).toEqual(['content.version_cut', 'connection.made']);
    expect(ofKind(making, 'connection.made')[0]).toMatchObject({
      actor: ada,
      subjectKind: 'connection',
      subject: connection.id,
      subjectVersion: connection.version.id,
      space: general,
      detail: {},
    });
    expect(ofKind(making, 'connection.made')[0]!.labels.subject?.text).toBe('Readings');

    // Exactly the settings that differ, by name, never by value.
    const { answer: changed, events: changing } = await recorded((trx) =>
      recordConnectionVersion(trx, {
        author: ada,
        id: connection.id,
        openedFrom: connection.version.id,
        settings: settings({
          name: 'Site readings',
          source: { ...settings().source, host: 'readings.example', port: 5433 },
        }),
      }),
    );
    if (changed.answer !== 'recorded') throw new Error(changed.answer);
    expect(changing.map((event) => event.kind)).toEqual([
      'content.version_cut',
      'connection.changed',
    ]);
    expect(ofKind(changing, 'connection.changed')[0]).toMatchObject({
      subject: connection.id,
      subjectVersion: changed.connection.version.id,
      detail: { settings: ['name', 'source.host', 'source.port'] },
    });
    expect(ofKind(changing, 'connection.changed')[0]!.labels.subject?.text).toBe('Site readings');
    expect(JSON.stringify(changing)).not.toContain('readings.example');

    const { answer: set, events: setting } = await recorded((trx) =>
      setConnectionCredential(trx, {
        id: connection.id,
        sealed: SEALED,
        by: ada,
        sealedFor: changed.connection.settings,
      }),
    );
    if (set.answer !== 'set') throw new Error(set.answer);
    expect(setting.map((event) => event.kind)).toEqual(['connection.credential_set']);
    expect(setting[0]).toMatchObject({
      actor: ada,
      subject: connection.id,
      subjectVersion: changed.connection.version.id,
      detail: {},
    });

    // Tested in a transaction of its own, after the credential's committed: each outcome by name.
    const { events: testing } = await recorded(async (trx) => {
      await recordConnectionTest(trx, {
        connectionId: connection.id,
        versionId: changed.connection.version.id,
        credentialId: set.credentialId,
        by: ada,
        outcome: 'ok',
        findings: ['account_not_read_only'],
        failure: null,
      });
      await recordConnectionTest(trx, {
        connectionId: connection.id,
        versionId: changed.connection.version.id,
        credentialId: set.credentialId,
        by: ada,
        outcome: 'failed',
        findings: [],
        failure: 'timeout',
      });
    });
    expect(testing.map((event) => [event.kind, event.detail])).toEqual([
      ['connection.tested', { outcome: 'ok', findings: ['account_not_read_only'] }],
      ['connection.tested', { outcome: 'failed', findings: [], failure: 'timeout' }],
    ]);
    expect(testing.every((event) => event.subjectVersion === changed.connection.version.id)).toBe(
      true,
    );

    const { answer: retired, events: retiring } = await recorded((trx) =>
      recordConnectionVersion(trx, {
        author: ada,
        id: connection.id,
        openedFrom: changed.connection.version.id,
        settings: { ...changed.connection.settings, retired: true },
      }),
    );
    if (retired.answer !== 'recorded') throw new Error(retired.answer);
    expect(retiring.map((event) => event.kind)).toEqual([
      'content.version_cut',
      'connection.retired',
    ]);
    expect(ofKind(retiring, 'connection.retired')[0]).toMatchObject({
      subjectVersion: retired.connection.version.id,
      detail: {},
    });

    // Each by whom, when, and against the version it was done to (LIF-027).
    const all = [...making, ...changing, ...setting, ...testing, ...retiring];
    for (const event of all) {
      expect(event, event.kind).toMatchObject({ actorKind: 'person', actor: ada });
      expect(event.at, event.kind).toBeInstanceOf(Date);
      expect(event.subjectVersion, event.kind).toMatch(/^[0-9a-f-]{36}$/);
    }
    // No value anywhere in any of it: not the secret, not its sealed form.
    const everything = JSON.stringify(all);
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain(SEALED);
  });

  it('records an asset ingested and an upload refused, the worker naming who asked', async () => {
    const key = (fill: string) => `${tenant.role}/sha256/${fill.repeat(64)}`;
    const { answer: uploads } = await recorded(async (trx) => {
      const kept = await createAssetUpload(trx, {
        spaceId: general,
        uploader: ada,
        alternative: null,
      });
      const refused = await createAssetUpload(trx, {
        spaceId: general,
        uploader: ada,
        alternative: null,
      });
      await receiveAssetBytes(trx, kept.id, { key: key('a'), format: 'png', bytes: 3530 });
      return { kept, refused };
    });
    // The worker's: the system, for the uploader.
    const worker: AuditContext = { actorKind: 'system', requestedBy: ada };
    const { answer: version, events: ingesting } = await recorded(
      (trx) => recordAsset(trx, uploads.kept.id, header),
      worker,
    );
    expect(ingesting.map((event) => event.kind)).toEqual(['content.version_cut', 'asset.ingested']);
    for (const event of ingesting) {
      expect(event).toMatchObject({
        actorKind: 'system',
        actor: null,
        subjectKind: 'asset',
        subject: version.artifactId,
        subjectVersion: version.id,
        space: general,
      });
      expect(event.detail.requestedBy).toBe(ada);
    }
    // The version's author is the uploader, who is not who acts.
    expect(ofKind(ingesting, 'content.version_cut')[0]!.detail.author).toBe(ada);

    const { events: refusing } = await recorded(
      (trx) => refuseAssetUpload(trx, uploads.refused.id, 'too_many_pixels', 'awaiting'),
      acting,
    );
    expect(refusing).toHaveLength(1);
    expect(refusing[0]).toMatchObject({
      kind: 'asset.refused',
      outcome: 'refused',
      actor: ada,
      subjectKind: 'asset_upload',
      subject: uploads.refused.id,
      space: general,
      detail: { reason: 'too_many_pixels' },
    });
    // Refused once: a second refusal of what is already refused changes nothing, and records nothing.
    const { events: again } = await recorded((trx) =>
      refuseAssetUpload(trx, uploads.refused.id, 'malformed', 'awaiting'),
    );
    expect(again).toEqual([]);
  });

  it('records a dataset named, and a publication requested but not a preview', async () => {
    const { answer: made, events } = await recorded((trx) =>
      everyKind(trx, { author: ada, spaceId: general, word: 'audited', role: tenant.role }),
    );
    const document = await service.withTenant(
      tenant,
      async (trx) => (await latestVersion(trx, made.document))!,
      { actorKind: 'system' },
    );
    const [requested] = ofKind(events, 'publication.requested');
    expect(requested).toMatchObject({
      actor: ada,
      subjectKind: 'document',
      subject: made.document,
      subjectVersion: document.id,
      space: general,
      detail: { formats: ['pdf'] },
    });
    expect(requested!.labels.subject?.text).toBe('audited document');

    const { events: previewing } = await recorded(async (trx) => {
      const asked = await requestPublication(trx, {
        documentId: made.document,
        version: document.id,
        formats: ['pdf'],
        requester: ada,
        kind: 'preview',
      });
      if (asked.answer !== 'requested') throw new Error(asked.answer);
    });
    expect(previewing).toEqual([]);

    const { events: naming } = await recorded((trx) =>
      nameDataset(trx, { dataset: made.dataset!, name: 'Site readings', by: ada }),
    );
    expect(naming).toHaveLength(1);
    expect(naming[0]).toMatchObject({
      kind: 'dataset.named',
      actor: ada,
      subjectKind: 'dataset',
      subject: made.dataset,
      space: general,
      detail: {},
    });
    expect(naming[0]!.subjectVersion).toMatch(/^[0-9a-f-]{36}$/);
    expect(naming[0]!.labels.subject?.text).toBe('Site readings');
  });
});
