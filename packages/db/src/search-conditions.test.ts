import { DEFINITION_SCHEMA_VERSION, OUTLINE_SCHEMA_VERSION } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDefinition } from './definitions.js';
import { deleteArtifact } from './deletion.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { changeRelationship, makeRelationship, removeRelationship } from './relationships.js';
import { findRole } from './roles.js';
import { searchWords, type SearchFilters } from './search-words.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { createArtifact, latestVersion, recordVersion, substanceOf } from './versions.js';

const text = (value: string) => ({ type: 'text', value, marks: [] });

describe('conditions and relationship fields in search (the R14 plan, R14-D, R14-E)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let general = '';
  let secret = '';
  let basis = '';
  let supersedes = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);
  const search = async (query: string, filters: SearchFilters = {}) => {
    const answer = await as((trx) => searchWords(trx, ada, query, { filters }));
    if (answer?.outcome !== 'results') throw new Error(String(answer?.outcome));
    return answer;
  };
  const titles = (answer: Awaited<ReturnType<typeof search>>) =>
    answer.items.map((each) => each.title).sort();
  const component = (title: string, spaceId = general, content: unknown[] = []) =>
    as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      if (content.length === 0) return made.version.artifactId;
      const latest = (await latestVersion(trx, made.version.artifactId))!;
      const substance = substanceOf(latest);
      await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: latest.id,
        author: ada,
        substance: {
          ...substance,
          content: { ...(substance.content as object), content },
        } as never,
      });
      return made.version.artifactId;
    });

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
      ada = (
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
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      secret = (await createSpace(trx, 'Secret')).id;
      const author = await findRole(trx, 'Author');
      await grant(trx, {
        roleId: author!.id,
        subject: { principal: ada },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
      // Definitions are read across the tenant; Secret is not.
      const reader = await findRole(trx, 'Reader');
      for (const [level, effect] of [
        [{ kind: 'tenant' }, 'allow'],
        [{ kind: 'space', id: secret }, 'deny'],
      ] as const) {
        await grant(trx, {
          roleId: reader!.id,
          subject: { principal: ada },
          level,
          effect,
          grantedBy: ada,
        });
      }
      const field = await createDefinition(trx, {
        kind: 'field',
        definition: {
          schemaVersion: DEFINITION_SCHEMA_VERSION,
          name: 'Basis',
          dataType: 'text',
          multiplicity: 'one',
          validation: {},
        },
        author: ada,
      });
      if (field.answer !== 'created') throw new Error(field.answer);
      basis = field.definition.id;
      const grounds = await createDefinition(trx, {
        kind: 'metadataSchema',
        definition: {
          schemaVersion: DEFINITION_SCHEMA_VERSION,
          name: 'Grounds',
          entries: [{ field: basis, required: true, fixed: false }],
        },
        author: ada,
      });
      if (grounds.answer !== 'created') throw new Error(grounds.answer);
      const type = await createDefinition(trx, {
        kind: 'relationshipType',
        definition: {
          schemaVersion: DEFINITION_SCHEMA_VERSION,
          name: 'Supersedes',
          inverseName: 'Superseded by',
          directed: true,
          from: { kinds: ['component'], cardinality: 'many', permission: 'read' },
          to: { kinds: ['component'], cardinality: 'many', permission: 'read' },
          selfReference: false,
          acyclic: false,
          informational: true,
          schemas: [{ schema: grounds.definition.id, requires: [] }],
        },
        author: ada,
      });
      if (type.answer !== 'created') throw new Error(type.answer);
      supersedes = type.definition.id;
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it("SCH-061 finds and facets by each condition a block's, a mark's or a node's content holds, axes together and values of one either", async () => {
    await component('Kudu table', general, [
      {
        type: 'table',
        id: 't1',
        style: 'table',
        caption: [text('Tolerances')],
        headerRows: 0,
        headerColumns: 0,
        conditions: [{ axis: 'market', values: ['eu'] }],
        rows: [
          {
            cells: [
              {
                content: [{ type: 'paragraph', id: 'c1', style: 'body', content: [text('Gauge')] }],
                colspan: 1,
                rowspan: 1,
              },
            ],
          },
        ],
      },
    ]);
    await component('Kudu note', general, [
      {
        type: 'paragraph',
        id: 'p1',
        style: 'body',
        content: [
          {
            type: 'text',
            value: 'For the inspector',
            marks: [{ type: 'condition', id: 'm1', axis: 'audience', values: ['inspector'] }],
          },
        ],
      },
    ]);
    await component('Kudu plain');
    await as((trx) =>
      createArtifact(trx, {
        author: ada,
        spaceId: general,
        substance: {
          kind: 'document',
          content: {
            schemaVersion: OUTLINE_SCHEMA_VERSION,
            title: 'Kudu manual',
            language: 'en-GB',
            direction: 'ltr',
            nodes: [
              {
                type: 'section',
                id: 'k'.repeat(26),
                title: [text('Kudu checks')],
                numbered: true,
                matter: 'body',
                pageBreak: 'none',
                values: {},
                conditions: [{ axis: 'market', values: ['us'] }],
                children: [],
              },
            ],
          },
        } as never,
      }),
    );

    expect(titles(await search('kudu', { conditions: ['market:eu'] }))).toEqual(['Kudu table']);
    expect(titles(await search('kudu', { conditions: ['market:eu', 'market:us'] }))).toEqual([
      'Kudu checks',
      'Kudu manual',
      'Kudu table',
    ]);
    expect(
      titles(await search('kudu', { conditions: ['market:eu', 'audience:inspector'] })),
    ).toEqual([]);
    const all = await search('kudu');
    expect(all.facets.conditions).toEqual([
      {
        axis: 'audience',
        values: [expect.objectContaining({ value: 'audience:inspector', count: 1 })],
      },
      {
        axis: 'market',
        values: [
          expect.objectContaining({ value: 'market:us', count: 2 }),
          expect.objectContaining({ value: 'market:eu', count: 1 }),
        ],
      },
    ]);
    // An axis's own filter leaves its other values offered.
    const eu = await search('kudu', { conditions: ['market:eu'] });
    expect(eu.facets.conditions.find((each) => each.axis === 'market')?.values).toHaveLength(2);
  });

  it("SCH-063 finds and facets an artifact by its relationships' fields at both ends, under the type, and leaves them once it is gone", async () => {
    const [older, newer, other] = [
      await component('Oryx older'),
      await component('Oryx newer'),
      await component('Oryx other'),
    ];
    const hidden = await component('Oryx hidden', secret);
    const made = await as((trx) =>
      makeRelationship(trx, {
        by: ada,
        type: supersedes,
        from: { artifact: newer },
        to: { artifact: older },
        values: { [basis]: 'Recall' },
      }),
    );
    if (made.answer !== 'made') throw new Error(made.answer);
    // One to an end the reader may not read says nothing of its value.
    await as((trx) =>
      makeRelationship(trx, {
        by: ada,
        type: supersedes,
        from: { artifact: other },
        to: { artifact: hidden },
        values: { [basis]: 'Secret basis' },
      }),
    );
    const recall = { type: supersedes, field: basis, value: 'Recall' };
    expect(titles(await search('oryx', { relations: [recall] }))).toEqual([
      'Oryx newer',
      'Oryx older',
    ]);
    expect(
      titles(await search('oryx', { relations: [{ ...recall, value: 'Secret basis' }] })),
    ).toEqual([]);
    expect((await search('oryx')).facets.relations).toEqual([
      {
        type: supersedes,
        typeName: 'Supersedes',
        field: basis,
        name: 'Basis',
        dataType: 'text',
        values: [expect.objectContaining({ value: 'Recall', count: 2 })],
      },
    ]);

    // Changed, both ends are found by the new value; removed, by none.
    await as((trx) =>
      changeRelationship(trx, { id: made.relationship.id, values: { [basis]: 'Revision' } }),
    );
    expect(titles(await search('oryx', { relations: [{ ...recall, value: 'Revision' }] }))).toEqual(
      ['Oryx newer', 'Oryx older'],
    );
    expect(titles(await search('oryx', { relations: [recall] }))).toEqual([]);
    await as((trx) => removeRelationship(trx, made.relationship.id));
    expect(titles(await search('oryx', { relations: [{ ...recall, value: 'Revision' }] }))).toEqual(
      [],
    );
  });

  it('SCH-063 says nothing of a relationship to an end since deleted, of a type the reader may not read, or in an earlier version', async () => {
    const [kept, gone] = [await component('Ibex kept'), await component('Ibex gone')];
    const relate = (type: string, value: string) =>
      as((trx) =>
        makeRelationship(trx, {
          by: ada,
          type,
          from: { artifact: kept },
          to: { artifact: gone },
          values: { [basis]: value },
        }),
      );
    await relate(supersedes, 'Withdrawn');
    const withdrawn = { type: supersedes, field: basis, value: 'Withdrawn' };
    expect(titles(await search('ibex', { relations: [withdrawn] }))).toEqual([
      'Ibex gone',
      'Ibex kept',
    ]);
    const deleted = await as((trx) => deleteArtifact(trx, gone, ada));
    expect(deleted?.answer).toBe('deleted');
    expect(titles(await search('ibex', { relations: [withdrawn] }))).toEqual([]);
    expect((await search('ibex')).facets.relations).toEqual([]);

    // A type the reader is denied: neither faceted nor a filter.
    const [left, right] = [await component('Lynx left'), await component('Lynx right')];
    const hiddenType = await as(async (trx) => {
      const made = await createDefinition(trx, {
        kind: 'relationshipType',
        definition: {
          schemaVersion: DEFINITION_SCHEMA_VERSION,
          name: 'Shadows',
          inverseName: 'Shadowed by',
          directed: true,
          from: { kinds: ['component'], cardinality: 'many', permission: 'read' },
          to: { kinds: ['component'], cardinality: 'many', permission: 'read' },
          selfReference: false,
          acyclic: false,
          informational: true,
          schemas: [
            {
              schema: (
                await trx
                  .selectFrom('artifact_version')
                  .select('artifact_id')
                  .where('kind', '=', 'metadataSchema')
                  .executeTakeFirstOrThrow()
              ).artifact_id,
              requires: [],
            },
          ],
        },
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: ada },
        level: { kind: 'artifact', id: made.definition.id },
        effect: 'deny',
        grantedBy: ada,
      });
      await makeRelationship(trx, {
        by: ada,
        type: made.definition.id,
        from: { artifact: left },
        to: { artifact: right },
        values: { [basis]: 'Shade' },
      });
      return made.definition.id;
    });
    expect(
      titles(
        await search('lynx', { relations: [{ type: hiddenType, field: basis, value: 'Shade' }] }),
      ),
    ).toEqual([]);
    expect((await search('lynx')).facets.relations).toEqual([]);

    // A version saved since: its earlier row keeps its conditions and none of the relationships.
    await as(async (trx) => {
      const latest = (await latestVersion(trx, left))!;
      await recordVersion(trx, {
        artifactId: left,
        openedFrom: latest.id,
        author: ada,
        substance: {
          ...substanceOf(latest),
          content: { ...(substanceOf(latest).content as object), title: 'Lynx left again' },
        } as never,
      });
    });
    const earlier = await as((trx) =>
      trx
        .selectFrom('search_earlier')
        .select('field_values')
        .where('artifact_id', '=', left)
        .execute(),
    );
    expect(earlier.length).toBeGreaterThan(0);
    expect(earlier.every((each) => !('~relations' in each.field_values))).toBe(true);
  });
});
