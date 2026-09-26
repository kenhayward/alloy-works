import { DEFINITION_SCHEMA_VERSION, TEMPLATE_SCHEMA_VERSION } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { grant } from './grants.js';
import { DEFAULT_LAYOUT_ID } from './layouts.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import {
  createTemplate,
  listReadableTemplates,
  readTemplate,
  recordTemplateVersion,
} from './templates.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { DEFAULT_THEME_ID } from './themes.js';
import { createArtifact } from './versions.js';

const ISSUER = 'https://idp.example';
const REVIEW = '5c4e0000-0000-4000-8000-000000000001';
const OWNER = 'f1e1d000-0000-4000-8000-000000000001';
const MISSING = '00000000-0000-4000-8000-00000000dead';

const text = (value: string) => [{ type: 'text', value, marks: [] }];
const section = (key: string, words: string, required = false) => ({
  key,
  title: text(words),
  required,
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
  children: [],
});
const definition = (over: object = {}) => ({
  schemaVersion: TEMPLATE_SCHEMA_VERSION,
  name: 'Report',
  theme: DEFAULT_THEME_ID,
  layout: DEFAULT_LAYOUT_ID,
  schemas: [{ schema: REVIEW, level: 'document', requires: [OWNER] }],
  outline: {
    sections: [section('introduction', 'Introduction', true), section('method', 'Method')],
  },
  changes: { add: true, remove: false, reorder: true },
  ...over,
});

describe('a template in the version chain', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let general: string;
  let quality: string;

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    await service.withTenant(production, async (trx) => {
      ada = await person(trx, 'ada', 'Ada');
      grace = await person(trx, 'grace', 'Grace');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      // A field and the schema grouping it, which the template assigns at the document's level.
      const identity = (id: string) =>
        ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name: id }) as const;
      await createArtifact(trx, {
        author: ada,
        substance: {
          kind: 'field',
          content: { ...identity(OWNER), dataType: 'text', multiplicity: 'one', validation: {} },
        },
      });
      await createArtifact(trx, {
        author: ada,
        substance: {
          kind: 'metadataSchema',
          content: {
            ...identity(REVIEW),
            entries: [{ field: OWNER, required: false, fixed: false }],
          },
        },
      });
      // Ada reads General, where the templates are made; Grace reads Quality alone.
      const reader = await findRole(trx, 'Reader');
      for (const [principal, space] of [
        [ada, general],
        [grace, quality],
      ] as const) {
        await grant(trx, {
          roleId: reader!.id,
          subject: { principal },
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

  const made = (over: object = {}, spaceId = general) =>
    service.withTenant(production, (trx) =>
      createTemplate(trx, { spaceId, definition: definition(over), author: ada }),
    );

  it('TPL-001 is a named, versioned artifact in one space', async () => {
    const answer = await made();
    if (answer.answer !== 'created') throw new Error(answer.answer);
    expect(answer.template.definition.name).toBe('Report');
    expect(answer.template.space).toEqual({ id: general, name: 'General' });
    expect([answer.template.version.revision, answer.template.version.version]).toEqual([0, 1]);
    // Read back as it was made, the artifact a template's own kind, in the one space.
    const read = await service.withTenant(production, (trx) =>
      readTemplate(trx, answer.template.id),
    );
    expect(read).toEqual(answer.template);
    const row = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('artifact')
        .select(['kind', 'space_id'])
        .where('id', '=', answer.template.id)
        .executeTakeFirstOrThrow(),
    );
    expect(row).toEqual({ kind: 'template', space_id: general });
  });

  it('VER-056 versions a template by the rules content is versioned by', async () => {
    const first = await made();
    if (first.answer !== 'created') throw new Error(first.answer);
    const version = (openedFrom: string, over: object = {}) =>
      service.withTenant(production, (trx) =>
        recordTemplateVersion(trx, {
          templateId: first.template.id,
          openedFrom,
          definition: definition(over),
          author: ada,
        }),
      );
    // Nothing changed is no version, and not an error.
    expect((await version(first.template.version.id)).answer).toBe('version.unchanged');
    const second = await version(first.template.version.id, { name: 'Annual report' });
    if (second.answer !== 'recorded') throw new Error(second.answer);
    expect([second.template.version.revision, second.template.version.version]).toEqual([0, 2]);
    // A change made from a version that is no longer the latest is refused, naming the latest.
    const stale = await version(first.template.version.id, { name: 'Quarterly report' });
    expect(stale).toMatchObject({
      answer: 'version.precondition',
      current: { version: { id: second.template.version.id } },
    });
    // And a version, once cut, is never changed: the chain refuses an update to any artifact's.
    await expect(
      service.withTenant(production, (trx) =>
        sql`update artifact_version set note = 'changed' where id = ${first.template.version.id}`.execute(
          trx,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('refuses a template whose references do not resolve, naming each, and writes nothing', async () => {
    const before = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('artifact')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('kind', '=', 'template')
        .executeTakeFirstOrThrow(),
    );
    const answer = await made({
      theme: DEFAULT_LAYOUT_ID,
      schemas: [{ schema: MISSING, level: 'section', requires: [] }],
    });
    expect(answer).toEqual({
      answer: 'template.unresolved',
      unresolved: [
        { reference: 'theme', id: DEFAULT_LAYOUT_ID },
        { reference: 'schema', id: MISSING },
      ],
    });
    const after = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('artifact')
        .select(sql<number>`count(*)::int`.as('n'))
        .where('kind', '=', 'template')
        .executeTakeFirstOrThrow(),
    );
    expect(after.n).toBe(before.n);
  });

  it('lists the templates a principal may read, and none they may not', async () => {
    const inQuality = await made({ name: 'Inspection' }, quality);
    if (inQuality.answer !== 'created') throw new Error(inQuality.answer);
    const names = async (principal: string) =>
      (await service.withTenant(production, (trx) =>
        listReadableTemplates(trx, principal),
      ))!.items.map((each) => each.name);
    expect(await names(grace)).toEqual(['Inspection']);
    expect(await names(ada)).not.toContain('Inspection');
    expect(await names(ada)).toContain('Report');
  });
});
