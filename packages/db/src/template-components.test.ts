import {
  DEFINITION_SCHEMA_VERSION,
  defaultLimits,
  resolveTemplate,
  TEMPLATE_SCHEMA_VERSION,
  type Binding,
  type ConnectionSettings,
  type ContentDocument,
  type OutlineDocument,
  type OutlineNode,
  type QueryDefinition,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { submitCohort } from './cohorts.js';
import { createConnection } from './connections.js';
import { createComponent } from './creation.js';
import { createDocument, editOutline, resolveForDocument } from './documents.js';
import { createDefinition } from './definitions.js';
import { unresolvedVariables } from './variable-check.js';
import { grant } from './grants.js';
import { DEFAULT_LAYOUT_ID } from './layouts.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { requestPublication } from './publishing.js';
import { createQueryDefinition } from './queryDefinitions.js';
import { findRole } from './roles.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTemplate } from './templates.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { DEFAULT_THEME_ID } from './themes.js';
import { recordVersion, substanceOf, type StoredVersion } from './versions.js';
import { waivedKeys } from './waivers.js';

const text = (value: string) => [{ type: 'text' as const, value, marks: [] }];
const section = (key: string, words: string) => ({
  key,
  title: text(words),
  required: false,
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
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

describe('a template requiring components (the R9 plan, R9-A to R9-D)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let general = '';
  let quality = '';
  /** A query definition in General, which Ada reads, and one in Quality, which she does not. */
  let depths = '';
  let secret = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  const component = (space: string, title: string, bindTo?: string) =>
    as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: grace,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      if (bindTo === undefined) return made.version;
      const binding = {
        type: 'binding',
        id: 'k1',
        query: bindTo,
        parameters: {},
        mode: 'checked',
        take: { key: { id: '1' }, column: 'depth' },
      } as Binding;
      const substance = substanceOf(made.version) as Extract<
        ReturnType<typeof substanceOf>,
        { kind: 'component' }
      >;
      const next = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: grace,
        substance: {
          ...substance,
          content: {
            ...substance.content,
            content: [
              { type: 'paragraph', id: 'p1', style: 'body', content: [binding] },
            ] as ContentDocument['content'],
          },
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
    });

  const template = (components: unknown[], by = grace) =>
    as((trx) =>
      createTemplate(trx, {
        spaceId: general,
        author: by,
        definition: {
          schemaVersion: TEMPLATE_SCHEMA_VERSION,
          name: 'Survey report',
          theme: DEFAULT_THEME_ID,
          layout: DEFAULT_LAYOUT_ID,
          schemas: [],
          outline: { sections: [section('method', 'Method')] },
          changes: { add: true, remove: true, reorder: true },
          components,
        },
      }),
    );

  const make = (templateId: string) =>
    as((trx) =>
      createDocument(trx, {
        spaceId: general,
        title: 'Site 4',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
        template: templateId,
      }),
    );

  const references = (outline: OutlineDocument) => {
    const found: Extract<OutlineNode, { type: 'reference' }>[] = [];
    const walk = (nodes: readonly OutlineNode[]) => {
      for (const node of nodes) {
        if (node.type === 'reference') found.push(node);
        walk(node.children);
      }
    };
    walk(outline.nodes);
    return found;
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
    await as(async (trx) => {
      const person = async (subject: string, name: string) =>
        (
          await trx
            .insertInto('principal')
            .values({ issuer: 'https://idp.example', subject, email: null, display_name: name })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      ada = await person('ada', 'Ada');
      grace = await person('grace', 'Grace');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      const author = await findRole(trx, 'Author');
      // Ada authors General; Grace authors General and Quality, which Ada may not read.
      for (const [principal, space] of [
        [ada, general],
        [grace, general],
        [grace, quality],
      ] as const) {
        await grant(trx, {
          roleId: author!.id,
          subject: { principal },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: grace,
        });
      }
      const define = async (space: string, title: string) => {
        const connection = await createConnection(trx, { author: grace, spaceId: space, settings });
        if (connection.answer !== 'created') throw new Error(connection.answer);
        const definition: QueryDefinition = {
          schemaVersion: 1,
          title,
          description: '',
          connection: connection.connection.id,
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
        const made = await createQueryDefinition(trx, {
          author: grace,
          spaceId: space,
          definition,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        return made.definition.id;
      };
      depths = await define(general, 'Depth by site');
      secret = await define(quality, 'Depth by restricted site');
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('TPL-014 TPL-070 places each required component with its key and mode, its query set computed from their bindings', async () => {
    const statement = await component(general, 'Method statement', depths);
    const notice = await component(general, 'Notice');
    const made = await template([
      {
        key: 'statement',
        component: statement.artifactId,
        mode: { kind: 'latest' },
        place: { section: 'method', at: 'start' },
      },
      {
        key: 'notice',
        component: notice.artifactId,
        mode: { kind: 'pinned', version: notice.id },
        place: { section: null, at: 'end' },
      },
    ]);
    if (made.answer !== 'created') throw new Error(made.answer);
    const document = await make(made.template.id);
    if (document.answer !== 'created') throw new Error(document.answer);
    expect(
      references(document.version.content as OutlineDocument).map((each) => ({
        origin: each.origin,
        component: each.component,
        mode: each.mode,
      })),
    ).toEqual([
      { origin: 'statement', component: statement.artifactId, mode: { kind: 'latest' } },
      {
        origin: 'notice',
        component: notice.artifactId,
        mode: { kind: 'pinned', version: notice.id },
      },
    ]);
    const resolution = await as((trx) => resolveForDocument(trx, ada, made.template.id));
    if (resolution.answer !== 'resolved') throw new Error(resolution.answer);
    const answer = resolveTemplate(resolution.resolution.definition, {
      kinds: new Map(resolution.resolution.references.kinds),
      schemas: [...resolution.resolution.references.schemas],
      fields: [...resolution.resolution.references.fields],
      components: new Map(resolution.resolution.references.components),
      definitions: new Set(resolution.resolution.references.definitions),
    });
    expect(answer.ok && answer.querySet).toEqual([depths]);
  });

  it('TPL-070 refuses a template whose required component, or a query its bindings name, the creator may not read, or that does not resolve', async () => {
    const hidden = await component(quality, 'Restricted statement');
    const leaking = await component(general, 'Leaking statement', secret);
    const other = await component(general, 'Other');
    const place = { section: 'method', at: 'start' };
    // Grace reads everything, so she saves these; Ada, making a document, does not.
    const unreadable = await template([
      { key: 'hidden', component: hidden.artifactId, mode: { kind: 'latest' }, place },
    ]);
    if (unreadable.answer !== 'created') throw new Error(unreadable.answer);
    expect(await make(unreadable.template.id)).toEqual({
      answer: 'template.unresolved',
      unresolved: [
        { reference: 'component', id: hidden.artifactId, key: 'hidden', why: 'missing' },
      ],
    });
    const querying = await template([
      { key: 'leaking', component: leaking.artifactId, mode: { kind: 'latest' }, place },
    ]);
    if (querying.answer !== 'created') throw new Error(querying.answer);
    expect(await make(querying.template.id)).toEqual({
      answer: 'template.unresolved',
      unresolved: [{ reference: 'query', id: secret, key: 'leaking' }],
    });
    // Following approved revisions, the default, with none approved yet; a pin to another's version.
    expect(await template([{ key: 'other', component: other.artifactId, place }])).toEqual({
      answer: 'template.unresolved',
      unresolved: [
        { reference: 'component', id: other.artifactId, key: 'other', why: 'unapproved' },
      ],
    });
    expect(
      await template([
        {
          key: 'other',
          component: other.artifactId,
          mode: { kind: 'pinned', version: hidden.id },
          place,
        },
      ]),
    ).toEqual({
      answer: 'template.unresolved',
      unresolved: [{ reference: 'component', id: other.artifactId, key: 'other', why: 'foreign' }],
    });
  });

  it('TPL-044 removes a required component only with a reason, recorded, and refuses to publish a document missing one with none', async () => {
    const notice = await component(general, 'Safety notice');
    const made = await template([
      {
        key: 'notice',
        component: notice.artifactId,
        mode: { kind: 'latest' },
        place: { section: null, at: 'end' },
      },
    ]);
    if (made.answer !== 'created') throw new Error(made.answer);
    const remove = async (version: StoredVersion, reason?: string) =>
      as(async (trx) => {
        const node = references(version.content as OutlineDocument)[0]!;
        return editOutline(trx, {
          artifactId: version.artifactId,
          openedFrom: version.id,
          author: ada,
          operation: { operation: 'remove', node: node.id, ...(reason ? { reason } : {}) },
        });
      });
    const publish = (version: StoredVersion) =>
      as((trx) =>
        requestPublication(trx, {
          documentId: version.artifactId,
          version: version.id,
          formats: ['pdf'],
          requester: ada,
        }),
      );

    const waived = await make(made.template.id);
    if (waived.answer !== 'created') throw new Error(waived.answer);
    expect(await remove(waived.version)).toEqual({
      answer: 'outline.invalid',
      reason: "A component this document's template requires is removed only with a reason",
    });
    const removed = await remove(waived.version, 'Issued with the notice bound separately.');
    if (removed.answer !== 'recorded') throw new Error(removed.answer);
    expect(await as((trx) => waivedKeys(trx, waived.version.artifactId))).toEqual(
      new Map([['notice', 'Issued with the notice bound separately.']]),
    );
    expect((await publish(removed.version)).answer).toBe('requested');

    // Taken out by a version written whole, with no reason: the publish names it.
    const dropped = await make(made.template.id);
    if (dropped.answer !== 'created') throw new Error(dropped.answer);
    const outline = dropped.version.content as OutlineDocument;
    const without = await as(async (trx) => {
      const answer = await recordVersion(trx, {
        artifactId: dropped.version.artifactId,
        openedFrom: dropped.version.id,
        author: ada,
        substance: {
          kind: 'document',
          content: { ...outline, nodes: outline.nodes.filter((node) => node.type !== 'reference') },
        },
      });
      if (answer.answer !== 'recorded') throw new Error(answer.answer);
      return answer.version;
    });
    expect(await publish(without)).toEqual({
      answer: 'component.required',
      components: [{ key: 'notice', component: notice.artifactId }],
    });
  });

  it('refuses a cohort of a template whose required components run queries, which bulk generation cannot run yet', async () => {
    const statement = await component(general, 'Bound statement', depths);
    const made = await template([
      {
        key: 'statement',
        component: statement.artifactId,
        mode: { kind: 'latest' },
        place: { section: 'method', at: 'start' },
      },
    ]);
    if (made.answer !== 'created') throw new Error(made.answer);
    expect(
      await as((trx) =>
        submitCohort(trx, {
          by: ada,
          spaceId: general,
          template: made.template.id,
          title: 'Site {site}',
          language: 'en-GB',
          direction: 'ltr',
          rows: [{}],
          source: { rows: 1 },
        }),
      ),
    ).toEqual({ answer: 'cohort.bound', queries: [depths] });
  });

  it('TPL-072 TPL-069 names each variable a required component holds that does not resolve yet, the template feeding one from its parameter', async () => {
    const declared = await as((trx) =>
      createDefinition(trx, {
        kind: 'variable',
        definition: {
          schemaVersion: DEFINITION_SCHEMA_VERSION,
          name: 'Site name',
          key: 'site_name',
          type: { base: 'text' },
          // Its own name for a parameter, which the template's mapping stands in front of.
          sources: { parameter: 'site' },
        },
        author: grace,
      }),
    );
    if (declared.answer !== 'created') throw new Error(declared.answer);
    const line = await as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: general,
        title: 'Site line',
        language: 'en-GB',
        direction: 'ltr',
        author: grace,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const substance = substanceOf(made.version) as Extract<
        ReturnType<typeof substanceOf>,
        { kind: 'component' }
      >;
      const next = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: grace,
        substance: {
          ...substance,
          content: {
            ...substance.content,
            content: [
              {
                type: 'paragraph',
                id: 'p1',
                style: 'body',
                content: [
                  { type: 'variable', name: 'site_name' },
                  { type: 'variable', name: 'undeclared' },
                ],
              },
            ] as ContentDocument['content'],
          },
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
    });
    const made = await as((trx) =>
      createTemplate(trx, {
        spaceId: general,
        author: grace,
        definition: {
          schemaVersion: TEMPLATE_SCHEMA_VERSION,
          name: 'Site line report',
          theme: DEFAULT_THEME_ID,
          layout: DEFAULT_LAYOUT_ID,
          schemas: [],
          outline: { sections: [] },
          changes: { add: true, remove: true, reorder: true },
          parameters: [
            {
              name: 'location',
              type: { base: 'text' },
              required: false,
              list: false,
              changeable: true,
              feeds: { arguments: false, variables: ['site_name'] },
            },
          ],
          components: [
            {
              key: 'line',
              component: line.artifactId,
              mode: { kind: 'latest' },
              place: { section: null, at: 'start' },
            },
          ],
        },
      }),
    );
    if (made.answer !== 'created') throw new Error(made.answer);
    const named = async (parameters: Record<string, unknown>) =>
      as(async (trx) => {
        const document = await createDocument(trx, {
          spaceId: general,
          title: 'Site 9',
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
          template: made.template.id,
          parameters,
        });
        if (document.answer !== 'created') throw new Error(document.answer);
        return (await unresolvedVariables(trx, document.version.artifactId, ada)).map(
          (each) => each.key,
        );
      });
    // The mapped parameter given, the variable resolves; the undeclared one never does.
    expect(await named({ location: 'North Quay' })).toEqual(['undeclared']);
    expect(await named({})).toEqual(['site_name', 'undeclared']);
  });
});
