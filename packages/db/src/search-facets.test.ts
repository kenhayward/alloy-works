import { randomUUID } from 'node:crypto';
import {
  DEFINITION_SCHEMA_VERSION,
  OUTLINE_SCHEMA_VERSION,
  type ContentDocument,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import {
  searchWords,
  type FacetValue,
  type SearchAnswer,
  type SearchFilters,
} from './search-words.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { createArtifact, recordVersion, substanceOf } from './versions.js';

const ISSUER = 'https://idp.example';
const text = (value: string) => [{ type: 'text', value, marks: [] }];
const definition = (id: string, name: string) => ({
  schemaVersion: DEFINITION_SCHEMA_VERSION as typeof DEFINITION_SCHEMA_VERSION,
  id,
  name,
});

type Results = Extract<SearchAnswer, { outcome: 'results' }>;

function resultsOf(answer: SearchAnswer | undefined): Results {
  if (answer?.outcome !== 'results') throw new Error(`Expected results, not ${answer?.outcome}`);
  return answer;
}

/** A facet as value and count, the order it came in. */
const counted = (values: readonly FacetValue[]) =>
  values.map((each) => [each.label, each.count, each.capped]);

describe('narrowing a search, and counting what narrows it', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let ivy: string;
  let general: string;
  let quality: string;
  const procedure = randomUUID();
  const reviewer = randomUUID();
  const approved = randomUUID();
  const due = randomUUID();
  const signOff = randomUUID();
  const ids: Record<string, string> = {};

  const person = (trx: TenantTransaction, subject: string, name: string) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject, email: null, display_name: name })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  /** A component, by `author` in `space`, of the given type or the default, holding these values. */
  const component = async (
    name: string,
    input: {
      author: string;
      space: string;
      type?: string;
      values?: Record<string, unknown>;
    },
  ) =>
    service.withTenant(production, async (trx) => {
      const made = await createComponent(trx, {
        spaceId: input.space,
        title: name,
        language: 'en-GB',
        direction: 'ltr',
        author: input.author,
        ...(input.type === undefined ? {} : { componentTypeId: input.type }),
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      ids[name] = made.version.artifactId;
      if (input.values === undefined) return;
      const substance = substanceOf(made.version) as Extract<
        ReturnType<typeof substanceOf>,
        { kind: 'component' }
      >;
      const recorded = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: input.author,
        substance: {
          ...substance,
          content: substance.content as ContentDocument,
          values: input.values,
        },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
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
      ada = await person(trx, 'ada', 'Ada');
      grace = await person(trx, 'grace', 'Grace');
      ivy = await person(trx, 'ivy', 'Ivy');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      const author = await findRole(trx, 'Author');
      const reader = await findRole(trx, 'Reader');
      for (const principal of [ada, grace]) {
        for (const space of [general, quality]) {
          await grant(trx, {
            roleId: author!.id,
            subject: { principal },
            level: { kind: 'space', id: space },
            effect: 'allow',
            grantedBy: ada,
          });
        }
      }
      // Ada reads the tenant, and so its fields; Ivy reads General alone.
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: ada },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ada,
      });
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: ivy },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
      // Three fields - text, boolean, date - a schema grouping them, and a Procedure type assigning it.
      for (const [id, name, dataType] of [
        [reviewer, 'Reviewer', 'text'],
        [approved, 'Approved', 'boolean'],
        [due, 'Due date', 'date'],
      ] as const) {
        await createArtifact(trx, {
          author: ada,
          substance: {
            kind: 'field',
            content: { ...definition(id, name), dataType, multiplicity: 'one', validation: {} },
          },
        });
      }
      await createArtifact(trx, {
        author: ada,
        substance: {
          kind: 'metadataSchema',
          content: {
            ...definition(signOff, 'Sign-off'),
            entries: [reviewer, approved, due].map((field) => ({
              field,
              required: false,
              fixed: false,
            })),
          },
        },
      });
      await createArtifact(trx, {
        author: ada,
        substance: {
          kind: 'componentType',
          content: {
            ...definition(procedure, 'Procedure'),
            assignments: [{ schema: signOff, requires: [] }],
          },
        },
      });
    });

    // Six components whose titles say owl: across two spaces, two authors and two types.
    await component('Owl pellets', { author: ada, space: general });
    await component('Owl boxes', {
      author: ada,
      space: general,
      type: procedure,
      values: { [reviewer]: 'Grace Hopper', [approved]: true, [due]: '2026-10-01' },
    });
    await component('Owl ringing', {
      author: grace,
      space: general,
      type: procedure,
      values: { [reviewer]: 'Grace Hopper', [approved]: false, [due]: '2026-11-15' },
    });
    await component('Owl survey', {
      author: grace,
      space: quality,
      type: procedure,
      values: { [reviewer]: 'Ada Lovelace', [approved]: true, [due]: '2026-10-20' },
    });
    await component('Owl feeding', { author: grace, space: quality });
    await component('Owl nesting', { author: ada, space: quality });
    // And a document whose section holds the same Reviewer value, at a section's level (SCH-062).
    await service.withTenant(production, async (trx) => {
      const made = await createArtifact(trx, {
        author: ada,
        spaceId: general,
        substance: {
          kind: 'document',
          content: {
            schemaVersion: OUTLINE_SCHEMA_VERSION,
            title: 'Owl report',
            language: 'en-GB',
            direction: 'ltr',
            nodes: [
              {
                type: 'section',
                id: 's'.repeat(26),
                title: text('Owl findings'),
                numbered: true,
                matter: 'body',
                pageBreak: 'none',
                values: { [reviewer]: 'Grace Hopper' },
                children: [],
              },
            ],
          },
        } as never,
      });
      ids['Owl report'] = made.artifactId;
      // Two of them changed long ago: last year, and the year before (the projection's time, as a
      // version cut then would have written it).
      await sql`update search_entry set changed_at = date_trunc('year', now()) - interval '1 month'
                where artifact_id = ${ids['Owl pellets']!}`.execute(trx);
      await sql`update search_entry set changed_at = date_trunc('year', now()) - interval '13 months'
                where artifact_id = ${ids['Owl nesting']!}`.execute(trx);
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const search = (principal: string, filters: SearchFilters = {}, query = 'owl') =>
    service
      .withTenant(production, (trx) => searchWords(trx, principal, query, { filters }))
      .then(resultsOf);
  const titles = async (filters: SearchFilters) =>
    (await search(ada, filters)).items.map((each) => each.title).sort();

  it('SCH-059 narrows by type, space, metadata value, owner and date', async () => {
    // Type: over components, so nothing that is not one of that type.
    expect(await titles({ componentTypes: [procedure] })).toEqual([
      'Owl boxes',
      'Owl ringing',
      'Owl survey',
    ]);
    // Space.
    expect(await titles({ spaces: [quality] })).toEqual([
      'Owl feeding',
      'Owl nesting',
      'Owl survey',
    ]);
    // A metadata value, wherever it is held: a component's, and a section's.
    expect(await titles({ values: [{ field: reviewer, value: 'Grace Hopper' }] })).toEqual([
      'Owl boxes',
      'Owl findings',
      'Owl ringing',
    ]);
    // Owner.
    expect(await titles({ owners: [grace] })).toEqual(['Owl feeding', 'Owl ringing', 'Owl survey']);
    // Date: a named range, and from and to.
    expect(await titles({ changed: { within: 'earlier' } })).toEqual([
      'Owl nesting',
      'Owl pellets',
    ]);
    const lastYear = new Date().getUTCFullYear() - 1;
    expect(
      await titles({ changed: { from: `${lastYear}-01-01`, to: `${lastYear}-12-31` } }),
    ).toEqual(['Owl pellets']);
    // And several at once, each narrowing the others.
    expect(await titles({ spaces: [general], owners: [ada], componentTypes: [procedure] })).toEqual(
      ['Owl boxes'],
    );
  });

  it('SCH-046 declares its facet dimensions and recomputes each against the others', async () => {
    const { facets } = await search(ada, { spaces: [quality] });
    // Declared dimensions, each always present, and nothing else.
    expect(Object.keys(facets).sort()).toEqual(
      ['changed', 'componentTypes', 'fields', 'kinds', 'owners', 'spaces'].sort(),
    );
    // Space leaves out its own filter, so General is still offered, with what it would add.
    expect(counted(facets.spaces)).toEqual([
      ['General', 5, false],
      ['Quality', 3, false],
    ]);
    // Every other dimension counts only what Quality holds.
    expect(counted(facets.owners)).toEqual([
      ['Grace', 2, false],
      ['Ada', 1, false],
    ]);
    expect(counted(facets.kinds)).toEqual([['component', 3, false]]);
    // Dates bucket into declared ranges, each counting what changed within it.
    expect(facets.changed.map((each) => each.value)).toEqual([
      'today',
      'week',
      'month',
      'year',
      'earlier',
    ]);
    expect(facets.changed.find((each) => each.value === 'earlier')?.count).toBe(1);
    expect(facets.changed.find((each) => each.value === 'today')?.count).toBe(2);
    // And a filter on a field leaves that field's facet counting as if it were not there.
    const narrowed = await search(ada, { values: [{ field: approved, value: 'true' }] });
    const approval = narrowed.facets.fields.find((each) => each.field === approved);
    expect(counted(approval!.values).sort()).toEqual(
      [
        ['false', 1, false],
        ['true', 2, false],
      ].sort(),
    );
    expect(narrowed.items.map((each) => each.title).sort()).toEqual(['Owl boxes', 'Owl survey']);
  });

  it('SCH-062 facets by component type, and by a field across every artifact holding it', async () => {
    const { facets } = await search(ada);
    expect(counted(facets.componentTypes)).toEqual([
      ['Procedure', 3, false],
      ['Topic', 3, false],
    ]);
    const byField = Object.fromEntries(
      facets.fields.map((each) => [each.name, counted(each.values)]),
    );
    // Reviewer across two components and a section; a date by its month; a boolean by its value.
    expect(byField).toEqual({
      Reviewer: [
        ['Grace Hopper', 3, false],
        ['Ada Lovelace', 1, false],
      ],
      'Due date': [
        ['2026-10', 2, false],
        ['2026-11', 1, false],
      ],
      Approved: [
        ['true', 2, false],
        ['false', 1, false],
      ],
    });
  });

  it('offers a field as a facet and a filter only to a reader who may read the field', async () => {
    // Ivy reads General, whose components hold Reviewer values, and not the tenant, where fields are.
    const ivys = await search(ivy);
    expect(ivys.items.map((each) => each.title)).toContain('Owl boxes');
    expect(ivys.facets.fields).toEqual([]);
    // Nor does a value filter on the field reach what it holds for her.
    expect(
      (await search(ivy, { values: [{ field: reviewer, value: 'Grace Hopper' }] })).items,
    ).toEqual([]);
  });

  it('SCH-034 shows a capped count as a lower bound, capped over what the user may see', async () => {
    // Many entries at once, written to the projection directly: 900 in General, 1,200 in Quality.
    await service.withTenant(production, async (trx) => {
      const report = await trx
        .selectFrom('search_entry')
        .select(['artifact_id', 'version_id'])
        .where('artifact_id', '=', ids['Owl report']!)
        .where('node', 'is', null)
        .executeTakeFirstOrThrow();
      const quail = await createArtifact(trx, {
        author: ada,
        spaceId: quality,
        substance: {
          kind: 'document',
          content: {
            schemaVersion: OUTLINE_SCHEMA_VERSION,
            title: 'Quail report',
            language: 'en-GB',
            direction: 'ltr',
            nodes: [],
          },
        } as never,
      });
      for (const [artifact, version, space, many] of [
        [report.artifact_id, report.version_id, general, 900],
        [quail.artifactId, quail.id, quality, 1200],
      ] as const) {
        await sql`
          insert into search_entry
            (artifact_id, kind, node, version_id, space_id, title, owner, changed_at,
             configuration, body)
          select ${artifact}::uuid, 'section', 'yak' || n, ${version}::uuid, ${space}::uuid,
                 'Yak ' || n, ${ada}::uuid, now(), 'english', 'Yak herding'
          from generate_series(1, ${many}) n`.execute(trx);
      }
    });

    // Ivy may read General's 900, and her count is exact.
    const ivys = await search(ivy, {}, 'yak');
    expect([ivys.count, ivys.capped]).toEqual([900, false]);
    expect(counted(ivys.facets.kinds)).toEqual([['section', 900, false]]);
    // Ada may read all 2,100: she is told at least 1,000, and so is each facet past it.
    const adas = await search(ada, {}, 'yak');
    expect([adas.count, adas.capped]).toEqual([1000, true]);
    expect(counted(adas.facets.kinds)).toEqual([['section', 1000, true]]);
    expect(counted(adas.facets.spaces)).toEqual([
      ['Quality', 1000, true],
      ['General', 900, false],
    ]);
  });
});
