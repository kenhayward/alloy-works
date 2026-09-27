import {
  defaultNumberingScheme,
  DEFINITION_SCHEMA_VERSION,
  OUTLINE_SCHEMA_VERSION,
  SEARCH_CONFIGURATIONS,
  TEMPLATE_SCHEMA_VERSION,
  type ContentDocument,
} from '@alloy-works/domain';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { grant } from './grants.js';
import { DEFAULT_LAYOUT_ID } from './layouts.js';
import { migrate } from './migrate.js';
import { createTenant, provisionTenant, type Tenant } from './provision.js';
import { recordPublication, requestPublication } from './publishing.js';
import { findRole } from './roles.js';
import { reindexSearch } from './search.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { DEFAULT_THEME_ID } from './themes.js';
import { createArtifact, recordVersion, substanceOf, type StoredVersion } from './versions.js';

const ISSUER = 'https://idp.example';
const GECKO = '5ea00000-0000-4000-8000-000000000001';
const HERON = '5ea00000-0000-4000-8000-000000000002';
const IBIS = '5ea00000-0000-4000-8000-000000000003';
const SECTION = 'c'.repeat(26);

const text = (value: string) => [{ type: 'text', value, marks: [] }];

interface Found {
  readonly kind: string;
  readonly artifact_id: string;
  readonly node: string | null;
  readonly place: string;
}

/** Every place whose words match, as the query W6.2 makes will: each row in its own configuration. */
const found = (trx: TenantTransaction, words: string) =>
  sql<Found>`
    select e.kind, e.artifact_id, e.node, t.place
    from search_text t join search_entry e on e.id = t.entry_id
    where t.vector @@ websearch_to_tsquery(t.configuration, ${words})
    order by e.kind, t.place`
    .execute(trx)
    .then((result) => result.rows);

describe("search's projection, written with every version", () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let general: string;

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
      const author = await findRole(trx, 'Author');
      await grant(trx, {
        roleId: author!.id,
        subject: { principal: ada },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const component = async (title: string): Promise<StoredVersion> => {
    const made = await service.withTenant(production, (trx) =>
      createComponent(trx, {
        spaceId: general,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      }),
    );
    if (made.answer !== 'created') throw new Error(made.answer);
    return made.version;
  };

  it('knows every text search configuration it maps a language to', async () => {
    const known = await service.withTenant(production, (trx) =>
      sql<{ cfgname: string }>`select cfgname from pg_ts_config`.execute(trx),
    );
    const names = known.rows.map((row) => row.cfgname);
    expect(SEARCH_CONFIGURATIONS.filter((each) => !names.includes(each))).toEqual([]);
  });

  it('SCH-054 makes every kind searchable', async () => {
    await component('Aardvark handling');
    const document = await service.withTenant(production, async (trx) => {
      const made = await createArtifact(trx, {
        author: ada,
        spaceId: general,
        substance: {
          kind: 'document',
          content: {
            schemaVersion: OUTLINE_SCHEMA_VERSION,
            title: 'Badger survey',
            language: 'en-GB',
            direction: 'ltr',
            nodes: [
              {
                type: 'section',
                id: SECTION,
                title: text('Cheetah sightings'),
                numbered: true,
                matter: 'body',
                pageBreak: 'none',
                values: {},
                children: [],
              },
            ],
          },
        } as never,
      });
      await createArtifact(trx, {
        author: ada,
        spaceId: general,
        substance: {
          kind: 'template',
          content: {
            schemaVersion: TEMPLATE_SCHEMA_VERSION,
            name: 'Emu report',
            theme: DEFAULT_THEME_ID,
            layout: DEFAULT_LAYOUT_ID,
            schemas: [],
            outline: { sections: [] },
            changes: { add: true, remove: true, reorder: true },
          },
        } as never,
      });
      await createArtifact(trx, {
        author: ada,
        spaceId: general,
        substance: {
          kind: 'asset',
          content: {
            schemaVersion: 1,
            object: `${production.role}/sha256/${'d'.repeat(64)}`,
            format: 'png',
            bytes: 10,
            width: 1,
            height: 1,
            orientation: 1,
            colour: 'rgb',
            alpha: false,
            depth: 8,
            resolution: null,
            alternative: { text: 'A ferret asleep', language: 'en' },
          },
        },
      });
      const identity = (id: string, name: string) => ({
        schemaVersion: DEFINITION_SCHEMA_VERSION as typeof DEFINITION_SCHEMA_VERSION,
        id,
        name,
      });
      await createArtifact(trx, {
        author: ada,
        substance: {
          kind: 'field',
          content: {
            ...identity(GECKO, 'Gecko count'),
            dataType: 'number',
            multiplicity: 'one',
            validation: {},
          },
        },
      });
      await createArtifact(trx, {
        author: ada,
        substance: {
          kind: 'metadataSchema',
          content: { ...identity(HERON, 'Heron watch'), entries: [] },
        },
      });
      await createArtifact(trx, {
        author: ada,
        substance: {
          kind: 'componentType',
          content: { ...identity(IBIS, 'Ibis note'), assignments: [] },
        },
      });
      return made;
    });
    await service.withTenant(production, async (trx) => {
      const asked = await requestPublication(trx, {
        documentId: document.artifactId,
        version: document.id,
        formats: ['pdf'],
        requester: ada,
      });
      if (asked.answer !== 'requested') throw new Error(asked.answer);
      await recordPublication(trx, {
        requestId: asked.request.id,
        pipelineVersion: '5',
        fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
        dataSha256: 'b'.repeat(64),
        numbering: { scheme: defaultNumberingScheme.id, entries: [] },
        outputs: [
          {
            format: 'pdf' as const,
            engineVersion: '0.15.1',
            templateVersion: 5,
            key: `${production.role}/sha256/${'c'.repeat(64)}`,
            sha256: 'c'.repeat(64),
            bytes: 1000,
          },
        ],
      });
    });

    const kinds = await service.withTenant(production, async (trx) =>
      Object.fromEntries(
        await Promise.all(
          [
            ['component', 'aardvark'],
            ['document', 'badger'],
            ['section', 'cheetah'],
            ['publication', 'badger'],
            ['template', 'emu'],
            ['asset', 'ferret'],
            ['field', 'gecko'],
            ['metadataSchema', 'heron'],
            ['componentType', 'ibis'],
          ].map(async ([kind, word]) => [
            kind,
            (await found(trx, word!)).some((each) => each.kind === kind),
          ]),
        ),
      ),
    );
    expect(kinds).toEqual({
      component: true,
      document: true,
      section: true,
      publication: true,
      template: true,
      asset: true,
      field: true,
      metadataSchema: true,
      componentType: true,
    });
  });

  it('SCH-066 makes a new version findable by its words in the next transaction', async () => {
    const first = await component('Narwhal migration');
    const substance = substanceOf(first) as Extract<
      ReturnType<typeof substanceOf>,
      { kind: 'component' }
    >;
    const content = substance.content as ContentDocument;
    const recorded = await service.withTenant(production, (trx) =>
      recordVersion(trx, {
        artifactId: first.artifactId,
        openedFrom: first.id,
        author: ada,
        substance: {
          ...substance,
          content: {
            ...content,
            title: 'Ocelot migration',
            content: [
              { type: 'paragraph', id: 'b1', style: 'body', content: text('Quokkas nearby') },
            ],
          } as ContentDocument,
        },
      }),
    );
    expect(recorded.answer).toBe('recorded');

    // The next transaction, with nothing between: the interval is none.
    const [title, block, before] = await service.withTenant(production, (trx) =>
      Promise.all([found(trx, 'ocelot'), found(trx, 'quokka'), found(trx, 'narwhal')]),
    );
    expect(title.map((each) => [each.artifact_id, each.place])).toEqual([
      [first.artifactId, 'title'],
    ]);
    expect(block.map((each) => [each.artifact_id, each.place])).toEqual([
      [first.artifactId, 'block:b1'],
    ]);
    // Its old words are gone with the version they were in.
    expect(before).toEqual([]);
  });

  it("rebuilds a tenant's projection whole from the chain", async () => {
    const snapshot = (trx: TenantTransaction) =>
      sql<{ kind: string; artifact_id: string; node: string | null; place: string; body: string }>`
        select e.kind, e.artifact_id, e.node, t.place, t.body
        from search_entry e left join search_text t on t.entry_id = e.id
        order by e.artifact_id, e.node nulls first, t.place`
        .execute(trx)
        .then((result) => result.rows);
    const before = await service.withTenant(production, snapshot);
    expect(before.length).toBeGreaterThan(0);

    const after = await service.withTenant(production, async (trx) => {
      await trx.deleteFrom('search_entry').execute();
      await reindexSearch(trx);
      return snapshot(trx);
    });
    expect(after).toEqual(before);
  });
});

describe('migration 0031, which makes search a projection of the chain', () => {
  let db: TestDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration up to 0030 and none after, where every environment stood before search.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0031-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 31;
      },
    });
  });

  afterAll(async () => {
    await rm(before, { recursive: true, force: true });
    await db.drop();
  });

  it('indexes, in the run that applies it, everything an environment already held', async () => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const tenant = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Demonstration' },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const service = createTenantDatabase(db.serviceUrl);
    try {
      const component = await service.withTenant(tenant, async (trx) => {
        const ada = await trx
          .insertInto('principal')
          .values({ issuer: ISSUER, subject: 'ada', email: null, display_name: 'Ada' })
          .returning('id')
          .executeTakeFirstOrThrow();
        const space = await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow();
        const made = await createComponent(trx, {
          spaceId: space.id,
          title: 'Wombat burrows',
          language: 'en-GB',
          direction: 'ltr',
          author: ada.id,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        return made.version;
      });

      const report = await migrate(db.migratorUrl);
      expect(report.tenants[id]).toEqual(['0031_search']);
      const [wombat, topic] = await service.withTenant(tenant, (trx) =>
        Promise.all([found(trx, 'wombat'), found(trx, 'topic')]),
      );
      expect(wombat.map((each) => [each.artifact_id, each.place])).toEqual([
        [component.artifactId, 'title'],
      ]);
      // And what the migrations themselves seeded: the starter component type.
      expect(topic.map((each) => each.kind)).toContain('componentType');
    } finally {
      await service.close();
    }
  });
});
