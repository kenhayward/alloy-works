import { randomBytes } from 'node:crypto';
import {
  DEFAULT_IMPORT_LEVELS,
  blockIdentifierFrom,
  proposeImport,
  type AuditContext,
  type ImportFlowItem,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import {
  abandonImport,
  acceptImport,
  changeImportLevels,
  createImport,
  failImport,
  importParts,
  provenanceOf,
  readImport,
  receiveImportFile,
  recordProposal,
  sweepImports,
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
import { readVersion, substanceOf } from './versions.js';

const ISSUER = 'https://idp.example';

const heading = (level: number, text: string): ImportFlowItem => ({
  kind: 'heading',
  level,
  style: `Heading ${level}`,
  text,
});
const para = (text: string): ImportFlowItem => ({
  kind: 'block',
  block: { type: 'paragraph', content: [{ type: 'text', value: text, marks: [] }] },
  source: text,
});

/** What the job would write for a short report by Ada. */
const proposal = () => ({
  ...proposeImport(
    [
      para('Opening words'),
      heading(1, 'Methods'),
      heading(2, 'Sampling'),
      para('How Ada sampled'),
      heading(2, 'Analysis'),
      para('How Grace analysed'),
    ],
    DEFAULT_IMPORT_LEVELS,
    { language: 'en', direction: 'ltr', newIdentifier: () => blockIdentifierFrom(randomBytes(16)) },
  ),
  report: [],
  title: 'A report by Ada',
  language: 'en-GB',
});

describe('an import', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let general: string;
  let acting: AuditContext;
  const removed: string[] = [];
  const remove = async (key: string) => {
    removed.push(key);
  };

  const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work, acting);

  /** An import filled with a file of this hash, and read into the proposal above. */
  const proposed = async (sha256 = randomBytes(32).toString('hex')) =>
    tenant(async (trx) => {
      const made = await createImport(trx, {
        spaceId: general,
        importer: ada,
        fileName: 'Report.docx',
        fileType: 'docx',
      });
      const key = `tenants/t/sha256/${sha256}`;
      await receiveImportFile(trx, made.id, { key, sha256, bytes: 2048 });
      return (await recordProposal(trx, made.id, proposal()))!;
    });

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
          .values({ issuer: ISSUER, subject: 'ada', email: null, display_name: 'Ada' })
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
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('IMP-001 IMP-004 is read into a proposal of sections and components, kept as read beside the one to edit', async () => {
    const made = await proposed();
    expect(made).toMatchObject({ state: 'proposed', title: 'A report by Ada', language: 'en-GB' });
    const parts = await tenant((trx) => importParts(trx, made.id));
    expect(parts.map((part) => [part.ord, part.kind, part.title])).toEqual([
      [0, 'component', 'Introduction'],
      [1, 'section', 'Methods'],
      [2, 'component', 'Sampling'],
      [3, 'component', 'Analysis'],
    ]);
    expect(parts[2]!.parent).toBe(parts[1]!.id);
    expect(parts[2]!.reason).toEqual({
      rule: 'heading',
      style: 'Heading 2',
      text: 'Sampling',
      level: 2,
    });
    const read = await tenant((trx) => importParts(trx, made.id, 'read'));
    expect(read.map((part) => part.title)).toEqual(parts.map((part) => part.title));
    // The proposal as read is never changed; the one to edit is.
    await expect(
      tenant((trx) =>
        sql`update import_part set title = 'Other' where id = ${read[0]!.id}`.execute(trx),
      ),
    ).rejects.toThrow(/never changed/);
    await tenant((trx) =>
      sql`update import_part set title = 'Opening' where id = ${parts[0]!.id}`.execute(trx),
    );
  });

  it('IMP-035 is accepted into a document, its sections and its components at 0.1, each recording what it came from', async () => {
    const made = await proposed();
    const answer = await tenant((trx) =>
      acceptImport(trx, made.id, {
        by: ada,
        title: 'A report by Ada',
        language: 'en-GB',
        direction: 'ltr',
      }),
    );
    if (answer.answer !== 'accepted') throw new Error(answer.answer);
    expect(answer.import).toMatchObject({
      state: 'accepted',
      documentId: answer.document.artifactId,
    });
    expect(answer.components.map((each) => [each.revision, each.version])).toEqual([
      [0, 1],
      [0, 1],
      [0, 1],
    ]);
    const outline = substanceOf(answer.document);
    if (outline.kind !== 'document') throw new Error('not a document');
    expect([answer.document.revision, answer.document.version]).toEqual([0, 1]);
    expect(
      outline.content.nodes.map((node) => [
        node.type,
        node.type === 'reference' ? node.component : node.children.length,
      ]),
    ).toEqual([
      ['reference', answer.components[0]!.artifactId],
      ['section', 2],
    ]);
    const sampling = await tenant((trx) => readVersion(trx, answer.components[1]!.id));
    const content = sampling && substanceOf(sampling);
    expect(content?.kind === 'component' && content.content.title).toBe('Sampling');
    expect(sampling?.author).toBe(ada);
    for (const version of [answer.document, ...answer.components]) {
      expect(await tenant((trx) => provenanceOf(trx, version.id))).toEqual({
        import: made.id,
        fileName: 'Report.docx',
        sha256: made.sha256,
        at: expect.any(Date),
        by: ada,
      });
    }
    const events = await tenant((trx) =>
      sql<{ kind: string; detail: unknown }>`select kind, detail from audit_event
        where kind = 'import.accepted' and subject = ${answer.document.artifactId}`.execute(trx),
    );
    expect(events.rows).toEqual([
      { kind: 'import.accepted', detail: { import: made.id, components: 3 } },
    ]);
    // Accepted, it is neither accepted again nor abandoned.
    expect(
      await tenant((trx) =>
        acceptImport(trx, made.id, { by: ada, title: 'Again', language: 'en', direction: 'ltr' }),
      ),
    ).toEqual({ answer: 'import.not_proposed' });
    expect(await tenant((trx) => abandonImport(trx, made.id, remove))).toBeUndefined();
  });

  it('IMP-042 accepting makes everything or nothing', async () => {
    const made = await proposed();
    const before = await tenant((trx) =>
      sql<{ count: string }>`select count(*) from artifact`.execute(trx),
    );
    await expect(
      tenant(async (trx) => {
        const answer = await acceptImport(trx, made.id, {
          by: ada,
          title: 'A report by Ada',
          language: 'en',
          direction: 'ltr',
          template: '00000000-0000-4000-8000-000000000009',
        });
        if (answer.answer !== 'accepted') throw new Error(answer.answer);
      }),
    ).rejects.toThrow('template.missing');
    const after = await tenant((trx) =>
      sql<{ count: string }>`select count(*) from artifact`.execute(trx),
    );
    expect(after.rows[0]!.count).toBe(before.rows[0]!.count);
    expect((await tenant((trx) => readImport(trx, made.id)))?.state).toBe('proposed');
  });

  it('IMP-008 is abandoned at any point before acceptance, leaving no parts and no file', async () => {
    const waiting = await tenant((trx) =>
      createImport(trx, {
        spaceId: general,
        importer: ada,
        fileName: 'Notes.md',
        fileType: 'markdown',
      }),
    );
    expect(await tenant((trx) => abandonImport(trx, waiting.id, remove))).toMatchObject({
      state: 'abandoned',
    });
    const made = await proposed();
    removed.length = 0;
    const abandoned = await tenant((trx) => abandonImport(trx, made.id, remove));
    expect(abandoned).toMatchObject({ state: 'abandoned', objectKey: null });
    expect(await tenant((trx) => importParts(trx, made.id))).toEqual([]);
    expect(await tenant((trx) => importParts(trx, made.id, 'read'))).toEqual([]);
    expect(removed).toEqual([made.objectKey]);
    const events = await tenant((trx) =>
      sql<{ detail: unknown }>`select detail from audit_event
        where kind = 'import.abandoned' and subject = ${made.id}`.execute(trx),
    );
    expect(events.rows).toEqual([{ detail: { swept: false } }]);
  });

  it('IMP-008 keeps a file another import of the same bytes still holds', async () => {
    const sha256 = randomBytes(32).toString('hex');
    const first = await proposed(sha256);
    const second = await proposed(sha256);
    removed.length = 0;
    await tenant((trx) => abandonImport(trx, first.id, remove));
    expect(removed).toEqual([]);
    await tenant((trx) => abandonImport(trx, second.id, remove));
    expect(removed).toEqual([second.objectKey]);
  });

  it('IMP-042 fails leaving nothing it read, and says why', async () => {
    const made = await tenant(async (trx) => {
      const waiting = await createImport(trx, {
        spaceId: general,
        importer: ada,
        fileName: 'Broken.docx',
        fileType: 'docx',
      });
      const sha256 = randomBytes(32).toString('hex');
      return (await receiveImportFile(trx, waiting.id, {
        key: `tenants/t/sha256/${sha256}`,
        sha256,
        bytes: 10,
      }))!;
    });
    removed.length = 0;
    const failed = await tenant((trx) => failImport(trx, made.id, 'file_unreadable', remove));
    expect(failed).toMatchObject({ state: 'failed', failure: 'file_unreadable', objectKey: null });
    expect(removed).toEqual([made.objectKey]);
    expect(await tenant((trx) => importParts(trx, made.id))).toEqual([]);
  });

  it('IMP-004 is read again at the levels its importer chooses', async () => {
    const made = await proposed();
    const changed = await tenant((trx) =>
      changeImportLevels(trx, made.id, { section: 2, component: 3 }),
    );
    expect(changed).toMatchObject({ state: 'reading', levels: { section: 2, component: 3 } });
    expect(await tenant((trx) => importParts(trx, made.id))).toEqual([]);
    // Not again while it is being read.
    expect(
      await tenant((trx) => changeImportLevels(trx, made.id, { section: 1, component: 2 })),
    ).toBeUndefined();
  });

  it('tells its importer seven days before a proposal left alone is swept, then sweeps it', async () => {
    const made = await proposed();
    const age = (days: number) =>
      tenant((trx) =>
        sql`update import set touched_at = now() - make_interval(days => ${days})
             where id = ${made.id}`.execute(trx),
      );
    await age(24);
    const system: AuditContext = { actorKind: 'system' };
    const sweep = () => service.withTenant(production, (trx) => sweepImports(trx, remove), system);
    expect(await sweep()).toMatchObject({ warned: 1, swept: 0 });
    expect(await sweep()).toMatchObject({ warned: 0, swept: 0 });
    const told = await tenant((trx) =>
      sql<{ counts: { import: string } }>`select counts from notification
        where recipient = ${ada} and kind = 'import'`.execute(trx),
    );
    expect(told.rows.map((row) => row.counts.import)).toEqual([made.id]);
    await age(31);
    expect((await sweep()).swept).toBeGreaterThanOrEqual(1);
    expect((await tenant((trx) => readImport(trx, made.id)))?.state).toBe('abandoned');
  });
});
