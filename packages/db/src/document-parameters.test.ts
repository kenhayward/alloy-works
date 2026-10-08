import { DEFINITION_SCHEMA_VERSION, TEMPLATE_SCHEMA_VERSION } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import {
  createDocument,
  editOutline,
  parameterHistory,
  recordDocumentParameters,
  recordDocumentValues,
} from './documents.js';
import { grant } from './grants.js';
import { DEFAULT_LAYOUT_ID } from './layouts.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import type { TenantTransaction } from './tables.js';
import { createTemplate, recordTemplateVersion } from './templates.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  queryAs,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { DEFAULT_THEME_ID } from './themes.js';
import {
  createArtifact,
  latestVersion,
  readVersion,
  recordVersion,
  type StoredVersion,
} from './versions.js';

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
    service = testTenantDatabase(db.serviceUrl);
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
        parameters: { site: 'York' },
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

  /** Makes a document from a template with these parameters, answering the store's answer. */
  const make = (templateId: string | undefined, parameters?: Record<string, unknown>) =>
    service.withTenant(production, (trx) =>
      createDocument(trx, {
        spaceId: general,
        title: 'The site report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
        ...(templateId === undefined ? {} : { template: templateId }),
        ...(parameters === undefined ? {} : { parameters }),
      }),
    );
  const made = async (templateId: string, parameters: Record<string, unknown>) => {
    const answer = await make(templateId, parameters);
    if (answer.answer !== 'created') throw new Error(answer.answer);
    return answer.version;
  };
  const documents = () =>
    service.withTenant(production, async (trx) =>
      Number(
        (
          await trx
            .selectFrom('artifact')
            .select((eb) => eb.fn.countAll().as('n'))
            .where('kind', '=', 'document')
            .executeTakeFirstOrThrow()
        ).n,
      ),
    );
  const change = (from: StoredVersion, parameters: Record<string, unknown>) =>
    service.withTenant(production, (trx) =>
      recordDocumentParameters(trx, {
        documentId: from.artifactId,
        openedFrom: from.id,
        author: ada,
        parameters,
      }),
    );

  describe('given when a document is made', () => {
    it('are recorded in its first version, and seed each field they feed over its default', async () => {
      const version = await made((await template()).id, { site: 'York', due: '2026-10-07' });
      expect(version.parameters).toEqual({ site: 'York', due: '2026-10-07' });
      expect(version.values).toEqual({ [SITE]: 'York', [DUE]: '2026-10-07' });
    });

    it('record an optional parameter given null as absent', async () => {
      const version = await made((await template()).id, { site: 'York', due: null });
      expect(version.parameters).toEqual({ site: 'York' });
      expect(await change(version, { site: 'York', due: null })).toMatchObject({
        answer: 'version.unchanged',
      });
    });

    it('refuse a name the template does not declare, and any given a blank document', async () => {
      const id = (await template()).id;
      expect(await make(id, { site: 'York', colour: 'red' })).toEqual({
        answer: 'parameter.unknown',
        parameters: ['colour'],
      });
      expect(await make(undefined, { site: 'York' })).toEqual({
        answer: 'parameter.unknown',
        parameters: ['site'],
      });
    });

    it('refuse a seeded value its field refuses, naming the parameter, the rule and the field, and write nothing', async () => {
      // Site holds at most 4 characters; the parameter permits a longer value.
      const id = (await template({ parameters: [{ ...site, permitted: undefined }, due] })).id;
      const before = await documents();
      expect(await make(id, { site: 'Bradford' })).toEqual({
        answer: 'parameter.invalid',
        problems: [{ parameter: 'site', rule: 'maxLength', value: 'Bradford', field: SITE }],
      });
      expect(await documents()).toBe(before);
    });

    it('refuse a template parameter whose field no longer takes it, and write nothing', async () => {
      const id = (await template()).id;
      // The Review schema now fixes Site, after the template was saved.
      await service.withTenant(production, async (trx) => {
        const current = await latestVersion(trx, REVIEW);
        const answer = await recordVersion(trx, {
          artifactId: REVIEW,
          openedFrom: current!.id,
          author: ada,
          substance: {
            kind: 'metadataSchema',
            content: {
              ...identity(REVIEW, 'Review'),
              entries: [
                { field: SITE, required: false, fixed: true, default: 'Leed' },
                { field: DUE, required: false, fixed: false },
              ],
            },
          },
        });
        if (answer.answer !== 'recorded') throw new Error(answer.answer);
      });
      try {
        const before = await documents();
        expect(await make(id, { site: 'York' })).toMatchObject({
          answer: 'parameter.field',
          problems: [{ parameter: 'site', field: SITE }],
        });
        expect(await documents()).toBe(before);
      } finally {
        await service.withTenant(production, async (trx) => {
          const current = await latestVersion(trx, REVIEW);
          await recordVersion(trx, {
            artifactId: REVIEW,
            openedFrom: current!.id,
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
        });
      }
    });
  });

  describe('changed', () => {
    it('cut a version with the outline and values unchanged, keeping a seeded field as the author left it', async () => {
      const first = await made((await template()).id, { site: 'York' });
      const next = recordedVersion(await change(first, { site: 'York', due: '2026-12-01' }));
      expect(next.parameters).toEqual({ site: 'York', due: '2026-12-01' });
      expect(next.content).toEqual(first.content);
      // Seeding happens once: Due was not given at creation, and is not written now.
      expect(next.values).toEqual(first.values);
    });

    it('refuse a fixed parameter given another value, and pass an unchanged one', async () => {
      const first = await made((await template()).id, { site: 'York' });
      expect(await change(first, { site: 'Leeds' })).toEqual({
        answer: 'parameter.fixed',
        parameters: ['site'],
      });
      expect(await change(first, { site: 'York', due: '2026-12-01' })).toMatchObject({
        answer: 'recorded',
      });
    });

    it('are judged by the template version the document was made from, not a later one', async () => {
      const template1 = await template();
      const first = await made(template1.id, { site: 'York' });
      // The template's next version makes the site changeable; the document keeps 0.1's.
      const next = await service.withTenant(production, (trx) =>
        recordTemplateVersion(trx, {
          templateId: template1.id,
          openedFrom: template1.version.id,
          definition: definition({ parameters: [{ ...site, changeable: true }, due] }),
          author: ada,
        }),
      );
      expect(next.answer).toBe('recorded');
      expect(await change(first, { site: 'Leeds' })).toMatchObject({ answer: 'parameter.fixed' });
    });

    it('leave values writable after a schema change that a parameter can no longer seed', async () => {
      const first = await made((await template()).id, { site: 'York' });
      await service.withTenant(production, async (trx) => {
        const current = await latestVersion(trx, REVIEW);
        const answer = await recordVersion(trx, {
          artifactId: REVIEW,
          openedFrom: current!.id,
          author: ada,
          // Site leaves the schema: the template's site parameter no longer has a field to seed.
          substance: {
            kind: 'metadataSchema',
            content: {
              ...identity(REVIEW, 'Review'),
              entries: [{ field: DUE, required: false, fixed: false }],
            },
          },
        });
        if (answer.answer !== 'recorded') throw new Error(answer.answer);
      });
      try {
        const written = await service.withTenant(production, (trx) =>
          recordDocumentValues(trx, {
            documentId: first.artifactId,
            openedFrom: first.id,
            author: ada,
            values: { [DUE]: '2026-12-01' },
          }),
        );
        expect(recordedVersion(written).parameters).toEqual({ site: 'York' });
      } finally {
        await service.withTenant(production, async (trx) => {
          const current = await latestVersion(trx, REVIEW);
          await recordVersion(trx, {
            artifactId: REVIEW,
            openedFrom: current!.id,
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
        });
      }
    });
  });

  describe('their history', () => {
    it('answers each change with its author and time, newest first, across an outline act between', async () => {
      const first = await made((await template()).id, { site: 'York' });
      const second = recordedVersion(await change(first, { site: 'York', due: '2026-12-01' }));
      const third = recordedVersion(
        await service.withTenant(production, (trx) =>
          editOutline(trx, {
            artifactId: first.artifactId,
            openedFrom: second.id,
            author: ada,
            operation: {
              operation: 'insert',
              parent: null,
              position: 0,
              node: { type: 'section', title: [{ type: 'text', value: 'Results', marks: [] }] },
            },
          }),
        ),
      );
      const fourth = recordedVersion(await change(third, { site: 'York' }));
      const history = await service.withTenant(production, (trx) =>
        parameterHistory(trx, first.artifactId, { limit: 50 }),
      );
      expect(history.next).toBeNull();
      expect(
        history.items.map((each) => ({
          version: each.version.id,
          author: each.author?.name,
          changed: each.changed,
          parameters: each.parameters,
        })),
      ).toEqual([
        { version: fourth.id, author: 'Ada', changed: ['due'], parameters: { site: 'York' } },
        {
          version: second.id,
          author: 'Ada',
          changed: ['due'],
          parameters: { site: 'York', due: '2026-12-01' },
        },
        { version: first.id, author: 'Ada', changed: ['site'], parameters: { site: 'York' } },
      ]);
      expect(history.items[0]!.createdAt).toBeInstanceOf(Date);
      // A page at a time, from where the last ended.
      const page = await service.withTenant(production, (trx) =>
        parameterHistory(trx, first.artifactId, { limit: 2 }),
      );
      expect(page.items.map((each) => each.version.id)).toEqual([fourth.id, second.id]);
      const rest = await service.withTenant(production, (trx) =>
        parameterHistory(trx, first.artifactId, { limit: 2, after: page.next! }),
      );
      expect(rest.items.map((each) => each.version.id)).toEqual([first.id]);
      expect(rest.next).toBeNull();
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
