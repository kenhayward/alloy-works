import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  defaultLimits,
  type ConnectionSettings,
  type ContentDocument,
  type OutlineDocument,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createConnection } from './connections.js';
import { createComponent } from './creation.js';
import { createDocument } from './documents.js';
import { migrate } from './migrate.js';
import { provisionTenant, type Tenant } from './provision.js';
import { createQueryDefinition } from './queryDefinitions.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  queryAs,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { createArtifact, recordVersion, substanceOf, type StoredVersion } from './versions.js';

/** An outline node's identifier, as the outline writes one. */
const NODE = 'abcdefghijklmnopqrstuvwxyz';

const settings: ConnectionSettings = {
  schemaVersion: 1,
  name: 'Gauges',
  description: '',
  type: 'postgres',
  source: {
    host: 'source-postgres',
    port: 5432,
    database: 'gauges',
    account: 'reader',
    tls: 'require',
  },
  identity: { kind: 'service' },
  retired: false,
};

describe('migration 0102, which indexes the references of every latest version', () => {
  let db: TestDatabase;
  let before: string;
  let service: TenantDatabase;
  let upgraded: Tenant;
  const made: Record<string, string> = {};

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    before = await mkdtemp(join(tmpdir(), 'aw-before-0102-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 102;
      },
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    upgraded = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    service = testTenantDatabase(db.serviceUrl);
    await service.withTenant(upgraded, async (trx: TenantTransaction) => {
      const ada = (
        await trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'ada',
            email: null,
            display_name: 'Ada',
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      const general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      const connection = await createConnection(trx, { author: ada, spaceId: general, settings });
      if (connection.answer !== 'created') throw new Error(connection.answer);
      const query = await createQueryDefinition(trx, {
        author: ada,
        spaceId: general,
        definition: {
          schemaVersion: 1,
          title: 'Gauges',
          description: '',
          connection: connection.connection.id,
          parameters: [],
          fetch: { kind: 'sql', text: 'select site from sample.site' },
          columns: [{ name: 'site', from: { column: 'site' }, type: { base: 'text' } }],
          key: ['site'],
          order: 'multiset',
          empty: 'valid',
          limits: { ...defaultLimits },
          retired: false,
        },
      });
      if (query.answer !== 'created') throw new Error(query.answer);
      const image = await createArtifact(trx, {
        spaceId: general,
        author: ada,
        substance: {
          kind: 'asset',
          content: {
            schemaVersion: 1,
            object: `${upgraded.role}/sha256/${'a'.repeat(64)}`,
            format: 'png',
            bytes: 3530,
            width: 800,
            height: 600,
            orientation: 1,
            colour: 'rgb',
            alpha: false,
            depth: 8,
            resolution: null,
            alternative: { text: 'A gauge', language: 'en-GB' },
          },
        } as never,
      });
      const component = await createComponent(trx, {
        spaceId: general,
        title: 'Gauge',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (component.answer !== 'created') throw new Error(component.answer);
      const substance = substanceOf(component.version) as Extract<
        ReturnType<typeof substanceOf>,
        { kind: 'component' }
      >;
      const blocks = [
        {
          type: 'figure',
          id: 'f1',
          asset: image.id,
          imageStyle: 'figure',
          caption: [{ type: 'text', value: 'A gauge', marks: [] }],
          alternative: { kind: 'inherited' },
        },
        {
          type: 'paragraph',
          id: 'p1',
          style: 'body',
          content: [
            {
              type: 'binding',
              id: 'k1',
              query: query.definition.id,
              parameters: {},
              mode: 'checked',
              take: { key: { site: 'North' }, column: 'site' },
            },
          ],
        },
      ] as ContentDocument['content'];
      const revised = await recordVersion(trx, {
        artifactId: component.version.artifactId,
        openedFrom: component.version.id,
        author: ada,
        substance: { ...substance, content: { ...substance.content, content: blocks } },
      });
      if (revised.answer !== 'recorded') throw new Error(revised.answer);
      const document = await createDocument(trx, {
        spaceId: general,
        title: 'Gauges report',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (document.answer !== 'created') throw new Error(document.answer);
      const outline = document.version.content as OutlineDocument;
      const placed = await recordVersion(trx, {
        artifactId: document.version.artifactId,
        openedFrom: document.version.id,
        author: ada,
        substance: {
          kind: 'document',
          content: {
            ...outline,
            nodes: [
              {
                type: 'reference',
                id: NODE,
                component: component.version.artifactId,
                mode: { kind: 'pinned', version: (revised.version as StoredVersion).id },
                numbered: true,
                matter: 'body',
                pageBreak: 'none',
                values: {},
                children: [],
              },
            ],
          } as OutlineDocument,
        },
      });
      if (placed.answer !== 'recorded') throw new Error(placed.answer);
      Object.assign(made, {
        connection: connection.connection.id,
        query: query.definition.id,
        image: image.artifactId,
        imageVersion: image.id,
        component: component.version.artifactId,
        componentVersion: revised.version.id,
        document: document.version.artifactId,
      });
    });
    await migrate(db.migratorUrl);
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
    await rm(before, { recursive: true, force: true });
  });

  it('backfills one row for each reference the latest versions hold', async () => {
    const { rows } = await queryAs(
      db.adminUrl,
      `select from_id, node, to_id, to_kind, mode, to_version from ${upgraded.schema}.reference
        order by from_id, id`,
    );
    const expected = [
      {
        from_id: made.component,
        node: 'f1',
        to_id: made.image,
        to_kind: 'asset',
        mode: 'pinned',
        to_version: made.imageVersion,
      },
      {
        from_id: made.component,
        node: 'k1',
        to_id: made.query,
        to_kind: 'queryDefinition',
        mode: 'latest',
        to_version: null,
      },
      {
        from_id: made.document,
        node: NODE,
        to_id: made.component,
        to_kind: 'component',
        mode: 'pinned',
        to_version: made.componentVersion,
      },
      {
        from_id: made.query,
        node: null,
        to_id: made.connection,
        to_kind: 'connection',
        mode: 'latest',
        to_version: null,
      },
    ];
    const sort = (all: readonly Record<string, unknown>[]) =>
      [...all].sort((a, b) => `${a.from_id}${a.node}`.localeCompare(`${b.from_id}${b.node}`));
    expect(sort(rows)).toEqual(sort(expected));
  });
});
