import { DEFINITION_SCHEMA_VERSION, TEMPLATE_SCHEMA_VERSION } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createDocument, editOutline, recordDocumentValues } from './documents.js';
import { grant } from './grants.js';
import { DEFAULT_LAYOUT_ID } from './layouts.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import type { TenantTransaction } from './tables.js';
import { createTemplate } from './templates.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { DEFAULT_THEME_ID } from './themes.js';
import { createArtifact, readVersion, recordVersion, type StoredVersion } from './versions.js';

const ISSUER = 'https://idp.example';
const REVIEW = '5c4e0000-0000-4000-8000-0000000000a1';
const SITE = 'f1e1d000-0000-4000-8000-0000000000a1';
const DUE = 'f1e1d000-0000-4000-8000-0000000000a2';

const identity = (id: string, name: string) =>
  ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name }) as const;

/** The template's parameters: a fixed site seeding Site, a changeable due date seeding Due. */
const site = {
  name: 'site',
  type: { base: 'text' },
  required: true,
  list: false,
  permitted: { values: ['Leeds', 'York'] },
  changeable: false,
  feeds: { field: SITE, arguments: true },
};
const due = {
  name: 'due',
  type: { base: 'date' },
  required: false,
  list: false,
  changeable: true,
  feeds: { field: DUE, arguments: false },
};

const definition = (over: object = {}) => ({
  schemaVersion: TEMPLATE_SCHEMA_VERSION,
  name: 'Site report',
  theme: DEFAULT_THEME_ID,
  layout: DEFAULT_LAYOUT_ID,
  schemas: [{ schema: REVIEW, level: 'document', requires: [] }],
  outline: { sections: [] },
  changes: { add: true, remove: true, reorder: true },
  parameters: [site, due],
  ...over,
});

describe("a document's parameters", () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let general: string;

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
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      await createArtifact(trx, {
        author: ada,
        substance: {
          kind: 'field',
          content: {
            ...identity(SITE, 'Site'),
            dataType: 'text',
            multiplicity: 'one',
            validation: { maxLength: 4 },
          },
        },
      });
      await createArtifact(trx, {
        author: ada,
        substance: {
          kind: 'field',
          content: {
            ...identity(DUE, 'Due'),
            dataType: 'date',
            multiplicity: 'one',
            validation: {},
          },
        },
      });
      await createArtifact(trx, {
        author: ada,
        substance: {
          kind: 'metadataSchema',
          content: {
            ...identity(REVIEW, 'Review'),
            entries: [
              { field: SITE, required: false, fixed: false },
              { field: DUE, required: false, fixed: false },
            ],
          },
        },
      });
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: reader!.id,
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

  const template = async (over: object = {}) => {
    const answer = await service.withTenant(production, (trx) =>
      createTemplate(trx, { spaceId: general, definition: definition(over), author: ada }),
    );
    if (answer.answer !== 'created') throw new Error(answer.answer);
    return answer.template;
  };

  /** A document made from the template, then given parameters through the chain itself. */
  const withParameters = async () => {
    const made = await service.withTenant(production, async (trx) =>
      createDocument(trx, {
        spaceId: general,
        title: 'Leeds',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
        template: (await template()).id,
      }),
    );
    if (made.answer !== 'created') throw new Error(made.answer);
    return service.withTenant(production, async (trx) => {
      const answer = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ada,
        substance: {
          kind: 'document',
          content: made.version.content as never,
          values: made.version.values,
          parameters: { site: 'York', due: '2026-10-07' },
        },
      });
      if (answer.answer !== 'recorded') throw new Error(answer.answer);
      return answer.version;
    });
  };

  const recordedVersion = (answer: { answer: string; version?: StoredVersion }) => {
    if (answer.answer !== 'recorded' || !answer.version) throw new Error(answer.answer);
    return answer.version;
  };

  describe('recorded in a version', () => {
    it('reads back, and a version with none reads as none', async () => {
      const version = await withParameters();
      const read = await service.withTenant(production, (trx) => readVersion(trx, version.id));
      expect(read?.parameters).toEqual({ site: 'York', due: '2026-10-07' });
      const blank = await service.withTenant(production, (trx) =>
        createDocument(trx, {
          spaceId: general,
          title: 'Blank',
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
        }),
      );
      if (blank.answer !== 'created') throw new Error(blank.answer);
      expect(blank.version.parameters).toEqual({});
      const { rows } = await queryAs(
        db.adminUrl,
        `select parameters from ${production.schema}.artifact_version where id = $1`,
        [blank.version.id],
      );
      expect(rows).toEqual([{ parameters: null }]);
    });

    it('are kept by an outline act', async () => {
      const version = await withParameters();
      const answer = await service.withTenant(production, (trx) =>
        editOutline(trx, {
          artifactId: version.artifactId,
          openedFrom: version.id,
          author: ada,
          operation: {
            operation: 'insert',
            parent: null,
            position: 0,
            node: { type: 'section', title: [{ type: 'text', value: 'Results', marks: [] }] },
          },
        }),
      );
      expect(recordedVersion(answer).parameters).toEqual({ site: 'York', due: '2026-10-07' });
    });

    it("are kept by a write of the document's values", async () => {
      const version = await withParameters();
      const answer = await service.withTenant(production, (trx) =>
        recordDocumentValues(trx, {
          documentId: version.artifactId,
          openedFrom: version.id,
          author: ada,
          values: { [SITE]: 'Hull' },
        }),
      );
      expect(recordedVersion(answer).parameters).toEqual({ site: 'York', due: '2026-10-07' });
    });
  });

  describe('migration 0057', () => {
    /** Inserts a copy of a version's row as the admin, with these parameters, answering the error. */
    const copied = async (version: StoredVersion, kind: string, parameters: string) => {
      try {
        await queryAs(
          db.adminUrl,
          `insert into ${production.schema}.artifact_version (
             artifact_id, kind, revision_no, version_no, author_id, schema_version, content,
             content_hash, metadata_values, not_carried, version_digest, parameters)
           select artifact_id, $2, revision_no, version_no + 100, author_id, schema_version, content,
             content_hash, '{}', not_carried, version_digest, $3::jsonb
           from ${production.schema}.artifact_version where id = $1`,
          [version.id, kind, parameters],
        );
        return undefined;
      } catch (error) {
        return (error as { constraint?: string }).constraint;
      }
    };

    it('refuses parameters on any version but a document, and anything but an object', async () => {
      const layout = await service.withTenant(production, (trx) =>
        trx
          .selectFrom('artifact_version')
          .select('id')
          .where('artifact_id', '=', DEFAULT_LAYOUT_ID)
          .orderBy('version_no', 'desc')
          .limit(1)
          .executeTakeFirstOrThrow(),
      );
      const stored = await service.withTenant(production, (trx) => readVersion(trx, layout.id));
      expect(await copied(stored!, 'layout', '{"site":"York"}')).toBe(
        'artifact_version_parameters_by_kind',
      );
      const document = await withParameters();
      expect(await copied(document, 'document', '["York"]')).toBe(
        'artifact_version_parameters_by_kind',
      );
    });
  });
});
