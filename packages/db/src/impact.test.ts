import { randomBytes, randomUUID } from 'node:crypto';
import {
  blockIdentifierFrom,
  defaultLimits,
  type ConnectionSettings,
  type ContentDocument,
  type OutlineDocument,
  type OutlineNode,
  type QueryDefinition,
  type ReferenceNode,
  TEMPLATE_SCHEMA_VERSION,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createConnection } from './connections.js';
import { createComponent } from './creation.js';
import { createDocument } from './documents.js';
import { grant } from './grants.js';
import { impact, referencesFrom } from './impact.js';
import { DEFAULT_LAYOUT_ID } from './layouts.js';
import { createTemplate } from './templates.js';
import { DEFAULT_THEME_ID } from './themes.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createQueryDefinition } from './queryDefinitions.js';
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
import { createArtifact, recordVersion, substanceOf, type StoredVersion } from './versions.js';

const ISSUER = 'https://idp.example';
const nodeId = () => blockIdentifierFrom(randomBytes(16));
const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };
const reference = (component: string): ReferenceNode => ({
  type: 'reference',
  id: nodeId(),
  component,
  mode: { kind: 'latest' },
  ...base,
  children: [],
});

const settings: ConnectionSettings = {
  schemaVersion: 1,
  name: 'Readings',
  description: '',
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
};

describe('the reference index and impact (relationships.md; the R2 plan, R2-A to R2-E)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let general = '';
  let quality = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  const component = (space: string, title: string) =>
    as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: grace,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });

  const revise = (version: StoredVersion, blocks: ContentDocument['content']) =>
    as(async (trx) => {
      const substance = substanceOf(version) as Extract<
        ReturnType<typeof substanceOf>,
        { kind: 'component' }
      >;
      const next = await recordVersion(trx, {
        artifactId: version.artifactId,
        openedFrom: version.id,
        author: grace,
        substance: { ...substance, content: { ...substance.content, content: blocks } },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
    });

  const document = (space: string, title: string, nodes: OutlineNode[]) =>
    as(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: grace,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return outlined(trx, made.version, nodes);
    });

  const outlined = async (trx: TenantTransaction, version: StoredVersion, nodes: OutlineNode[]) => {
    const outline: OutlineDocument = { ...(version.content as OutlineDocument), nodes };
    const recorded = await recordVersion(trx, {
      artifactId: version.artifactId,
      openedFrom: version.id,
      author: grace,
      substance: { kind: 'document', content: outline },
    });
    if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
    return recorded.version;
  };

  const image = (space: string) =>
    as((trx) =>
      createArtifact(trx, {
        spaceId: space,
        author: grace,
        substance: {
          kind: 'asset',
          content: {
            schemaVersion: 1,
            object: `${tenant.role}/sha256/${'e'.repeat(64)}`,
            format: 'png',
            bytes: 3530,
            width: 800,
            height: 600,
            orientation: 1,
            colour: 'rgb',
            alpha: false,
            depth: 8,
            resolution: null,
            alternative: { text: 'Two red squares', language: 'en-GB' },
          },
        } as never,
      }),
    );

  const figure = (asset: string) =>
    ({
      type: 'figure',
      id: 'f1',
      asset,
      imageStyle: 'figure',
      caption: [{ type: 'text', value: 'Shapes', marks: [] }],
      alternative: { kind: 'inherited' },
    }) as ContentDocument['content'][number];

  const rowsFrom = (id: string) =>
    as((trx) =>
      trx
        .selectFrom('reference')
        .select(['node', 'to_id', 'to_kind', 'mode', 'to_version'])
        .where('from_id', '=', id)
        .orderBy('id')
        .execute(),
    );

  const person = (trx: TenantTransaction, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject: randomUUID(), email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

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
    await as(async (trx) => {
      general = (await createSpace(trx, 'Shared')).id;
      quality = (await createSpace(trx, 'Restricted')).id;
      ada = await person(trx, 'Ada');
      grace = await person(trx, 'Grace');
      for (const [who, space] of [
        [ada, general],
        [grace, general],
        [grace, quality],
      ] as const) {
        await grant(trx, {
          roleId: (await findRole(trx, 'Author'))!.id,
          subject: { principal: who },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: who,
        });
      }
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it("indexes each reference of an artifact's latest version, and replaces them as a version is cut", async () => {
    const picture = await image(general);
    const holder = await revise(await component(general, 'Shapes'), [figure(picture.id)]);
    const placed = reference(holder.artifactId);
    const report = await document(general, 'Shapes report', [placed]);

    expect(await rowsFrom(holder.artifactId)).toEqual([
      {
        node: 'f1',
        to_id: picture.artifactId,
        to_kind: 'asset',
        mode: 'pinned',
        to_version: picture.id,
      },
    ]);
    expect(await rowsFrom(report.artifactId)).toEqual([
      {
        node: placed.id,
        to_id: holder.artifactId,
        to_kind: 'component',
        mode: 'latest',
        to_version: null,
      },
    ]);

    await as((trx) => outlined(trx, report, []));
    expect(await rowsFrom(report.artifactId)).toEqual([]);
  });

  it('AST-017 indexes an image following its asset as following the asset, not pinned to a version of it', async () => {
    const picture = await image(general);
    const holder = await revise(await component(general, 'Following'), [
      { ...figure(picture.id), follow: 'latest' } as ContentDocument['content'][number],
    ]);
    expect(await rowsFrom(holder.artifactId)).toEqual([
      { node: 'f1', to_id: picture.artifactId, to_kind: 'asset', mode: 'latest', to_version: null },
    ]);
  });

  it('SCH-024 indexes a binding by its query definition and a query definition by its connection, and says what a component uses', async () => {
    const { connection, definition } = await as(async (trx) => {
      const made = await createConnection(trx, { author: grace, spaceId: general, settings });
      if (made.answer !== 'created') throw new Error(made.answer);
      const query: QueryDefinition = {
        schemaVersion: 1,
        title: 'Depth by site',
        description: '',
        connection: made.connection.id,
        parameters: [],
        fetch: { kind: 'sql', text: 'select id, depth from sample.reading order by id' },
        columns: [
          { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
          { name: 'depth', from: { column: 'depth' }, type: { base: 'text' } },
        ],
        key: ['id'],
        order: [{ column: 'id', direction: 'ascending' }],
        empty: 'valid',
        limits: { ...defaultLimits },
        retired: false,
      };
      const defined = await createQueryDefinition(trx, {
        author: grace,
        spaceId: general,
        definition: query,
      });
      if (defined.answer !== 'created') throw new Error(defined.answer);
      return { connection: made.connection, definition: defined.definition };
    });
    const bound = await revise(await component(general, 'Depths'), [
      {
        type: 'paragraph',
        id: 'p1',
        style: 'body',
        content: [
          {
            type: 'binding',
            id: 'k1',
            query: definition.id,
            parameters: {},
            mode: 'checked',
            take: { key: { id: '1' }, column: 'depth' },
          },
        ],
      },
    ] as ContentDocument['content']);

    expect(await rowsFrom(bound.artifactId)).toEqual([
      {
        node: 'k1',
        to_id: definition.id,
        to_kind: 'queryDefinition',
        mode: 'latest',
        to_version: null,
      },
    ]);
    expect(await rowsFrom(definition.id)).toEqual([
      { node: null, to_id: connection.id, to_kind: 'connection', mode: 'latest', to_version: null },
    ]);
    // What the component uses, one hop forwards (SCH-024).
    expect(await as((trx) => referencesFrom(trx, ada, bound.artifactId))).toEqual({
      items: [{ id: definition.id, kind: 'queryDefinition', title: 'Depth by site' }],
      unreadable: false,
    });
    // And the whole chain from the connection, three hops (SCH-023).
    const report = await document(general, 'Depths report', [reference(bound.artifactId)]);
    const walked = await as((trx) => impact(trx, ada, connection.id, 3));
    expect(walked.reached.map((each) => [each.title, each.depth, each.via])).toEqual([
      ['Depth by site', 1, connection.id],
      ['Depths', 2, definition.id],
      ['Depths report', 3, bound.artifactId],
    ]);
    expect(walked.reached.at(-1)!.id).toBe(report.artifactId);
  });

  it('REU-055 indexes a document made from a template by the template version it was made from, and so says where a template is used', async () => {
    const template = await as(async (trx) => {
      const answer = await createTemplate(trx, {
        spaceId: general,
        author: grace,
        definition: {
          schemaVersion: TEMPLATE_SCHEMA_VERSION,
          name: 'Site report',
          theme: DEFAULT_THEME_ID,
          layout: DEFAULT_LAYOUT_ID,
          schemas: [],
          outline: { sections: [] },
          changes: { add: true, remove: true, reorder: true },
        },
      });
      if (answer.answer !== 'created') throw new Error(answer.answer);
      return answer.template;
    });
    const made = await as(async (trx) => {
      const answer = await createDocument(trx, {
        spaceId: general,
        title: 'North site',
        language: 'en-GB',
        direction: 'ltr',
        author: grace,
        template: template.id,
      });
      if (answer.answer !== 'created') throw new Error(answer.answer);
      return answer.version;
    });
    expect(await rowsFrom(made.artifactId)).toEqual([
      {
        node: null,
        to_id: template.id,
        to_kind: 'template',
        mode: 'pinned',
        to_version: template.version.id,
      },
    ]);
    const walked = await as((trx) => impact(trx, ada, template.id, 1));
    expect(walked.reached.map((each) => [each.kind, each.title])).toEqual([
      ['document', 'North site'],
    ]);
  });

  it('SCH-023 REL-017 answers what a change to an image reaches, to the depth asked and no further', async () => {
    const picture = await image(general);
    const holder = await revise(await component(general, 'Tiles'), [figure(picture.id)]);
    const report = await document(general, 'Tiles report', [reference(holder.artifactId)]);

    const one = await as((trx) => impact(trx, ada, picture.artifactId, 1));
    expect(one).toEqual({
      reached: [
        {
          id: holder.artifactId,
          kind: 'component',
          title: 'Tiles',
          depth: 1,
          via: picture.artifactId,
          hard: true,
        },
      ],
      depths: 1,
      stopped: false,
      cut: false,
      more: false,
    });
    const two = await as((trx) => impact(trx, ada, picture.artifactId, 2));
    expect(two.reached.map((each) => each.id)).toEqual([holder.artifactId, report.artifactId]);

    for (const depth of [0, 11, 1.5]) {
      await expect(as((trx) => impact(trx, ada, picture.artifactId, depth))).rejects.toThrow(
        /declares a depth from 1 to 10/,
      );
    }
  });

  it('REL-019 REL-020 neither returns nor walks past what the caller may not read, and says the walk was cut', async () => {
    const picture = await image(general);
    // Ada may not read Quality: its component, and the General document behind it, stay unseen.
    const hidden = await revise(await component(quality, 'Hidden tiles'), [figure(picture.id)]);
    const behind = await document(general, 'Behind it', [reference(hidden.artifactId)]);

    const asAda = await as((trx) => impact(trx, ada, picture.artifactId, 3));
    expect(asAda).toEqual({ reached: [], depths: 3, stopped: false, cut: true, more: false });
    const asGrace = await as((trx) => impact(trx, grace, picture.artifactId, 3));
    expect(asGrace.reached.map((each) => each.id)).toEqual([hidden.artifactId, behind.artifactId]);
    expect(asGrace.cut).toBe(false);
  });

  it('REL-018 ends on a cycle, taking each artifact once at the least depth it is reached', async () => {
    const one = await component(general, 'One');
    const two = await component(general, 'Two');
    // No content forms a cycle today; the index is general, so one is written directly.
    await as((trx) =>
      trx
        .insertInto('reference')
        .values([
          {
            from_id: one.artifactId,
            from_version: one.id,
            node: null,
            to_id: two.artifactId,
            to_kind: 'component',
            mode: 'latest',
            to_version: null,
          },
          {
            from_id: two.artifactId,
            from_version: two.id,
            node: null,
            to_id: one.artifactId,
            to_kind: 'component',
            mode: 'latest',
            to_version: null,
          },
        ])
        .execute(),
    );
    const walked = await as((trx) => impact(trx, ada, one.artifactId, 10));
    expect(walked.reached.map((each) => [each.id, each.depth])).toEqual([[two.artifactId, 1]]);
  });

  it('REL-030 stops at the nearest it may return, and says there were more', async () => {
    const picture = await image(general);
    const holder = await revise(await component(general, 'Popular'), [figure(picture.id)]);
    for (const title of ['A', 'B', 'C']) {
      await document(general, `Report ${title}`, [reference(holder.artifactId)]);
    }
    const walked = await as((trx) => impact(trx, ada, picture.artifactId, 2, 3));
    expect(walked.reached).toHaveLength(3);
    expect(walked.reached[0]!.id).toBe(holder.artifactId);
    expect(walked.more).toBe(true);
  });
});
