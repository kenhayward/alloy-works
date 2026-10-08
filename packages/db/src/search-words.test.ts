import { randomUUID } from 'node:crypto';
import {
  DEFINITION_SCHEMA_VERSION,
  OUTLINE_SCHEMA_VERSION,
  searchKinds,
  type ContentDocument,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { searchWords, type SearchAnswer } from './search-words.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import { everyKind } from './testing/every-kind.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { createArtifact, recordVersion, substanceOf } from './versions.js';

const ISSUER = 'https://idp.example';
const text = (value: string) => [{ type: 'text', value, marks: [] }];
const para = (id: string, value: string) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: text(value),
});

/** A results answer's items, or a failure naming the outcome it was instead. */
function itemsOf(answer: SearchAnswer | undefined) {
  if (answer?.outcome !== 'results') throw new Error(`Expected results, not ${answer?.outcome}`);
  return answer.items;
}

describe('searching words', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let ivy: string;
  let general: string;
  let quality: string;
  let reviewer: string;

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
      // Ivy has signed in and been granted nothing.
      ivy = await person(trx, 'ivy', 'Ivy');
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      // Ada authors in General and reads the whole tenant, so she finds every kind.
      const author = await findRole(trx, 'Author');
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: author!.id,
        subject: { principal: ada },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: ada },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ada,
      });
      reviewer = (
        await createArtifact(trx, {
          author: ada,
          substance: {
            kind: 'field',
            content: {
              schemaVersion: DEFINITION_SCHEMA_VERSION as typeof DEFINITION_SCHEMA_VERSION,
              id: randomUUID(),
              name: 'Reviewer',
              dataType: 'text',
              multiplicity: 'one',
              validation: {},
            },
          },
        })
      ).artifactId;
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const search = (principal: string, query: string) =>
    service.withTenant(production, (trx) => searchWords(trx, principal, query));

  /** A component in General holding these paragraphs under this title. */
  const component = (title: string, ...paragraphs: (readonly [string, string])[]) =>
    service.withTenant(production, async (trx) => {
      const made = await createComponent(trx, {
        spaceId: general,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      if (paragraphs.length === 0) return made.version.artifactId;
      const substance = substanceOf(made.version) as Extract<
        ReturnType<typeof substanceOf>,
        { kind: 'component' }
      >;
      const recorded = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ada,
        substance: {
          ...substance,
          content: {
            ...(substance.content as ContentDocument),
            content: paragraphs.map(([id, words]) => para(id, words)),
          } as ContentDocument,
        },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return made.version.artifactId;
    });

  it('SCH-011 supports phrases, exclusion and field-scoped terms', async () => {
    const guide = await component('Lever arm guide', ['b1', 'Adjust the brake first']);
    const notes = await component('Arm and lever notes', ['b1', 'Nothing about stopping']);
    const node = 'r'.repeat(26);
    const report = await service.withTenant(production, (trx) =>
      createArtifact(trx, {
        author: ada,
        spaceId: general,
        substance: {
          kind: 'document',
          content: {
            schemaVersion: OUTLINE_SCHEMA_VERSION,
            title: 'Lever inspection',
            language: 'en-GB',
            direction: 'ltr',
            nodes: [
              {
                type: 'section',
                id: node,
                title: text('Findings'),
                numbered: true,
                matter: 'body',
                pageBreak: 'none',
                values: { [reviewer]: 'Grace Hopper' },
                children: [],
              },
            ],
          },
        } as never,
      }),
    );
    const found = async (query: string) =>
      itemsOf(await search(ada, query)).map((each) => each.node ?? each.artifactId);

    // A phrase: the words together and in order.
    expect(await found('"lever arm"')).toEqual([guide]);
    // Exclusion: every lever, but not one that says brake.
    expect((await found('lever arm -brake')).sort()).toEqual([notes].sort());
    // A field-scoped term, by the field's name, finding the section that holds it; and in no other
    // place - the section's title does not say Grace.
    expect(await found('Reviewer:grace')).toEqual([node]);
    expect(await found('reviewer:"grace hopper"')).toEqual([node]);
    // And the title, as a scope of its own: the document says lever in its title, the section not.
    expect(await found('title:inspection')).toEqual([report.artifactId]);
    expect(await found('title:brake')).toEqual([]);
  });

  it('SCH-012 matches two strings a reader cannot tell apart', async () => {
    const decomposed = await component('Café opening hours');
    const composed = await component('Crème delivery');
    expect(itemsOf(await search(ada, 'Café')).map((each) => each.artifactId)).toEqual([decomposed]);
    expect(itemsOf(await search(ada, 'Crème')).map((each) => each.artifactId)).toEqual([composed]);
  });

  it('SCH-016 shows each result with a passage from where it matched', async () => {
    const long = [
      'The calibration begins once the scanner has warmed for ten minutes on a level bench.',
      'Hold the reference card flat, align its corners with the guides, and press the start key.',
      'When the lamp settles, the scanner reads the card twice and compares the two readings.',
      'A difference beyond the tolerance means the platen needs cleaning before another attempt.',
    ].join(' ');
    await component('Scanner calibration', ['b1', long]);
    const [result] = itemsOf(await search(ada, 'platen'));
    const passage = result!.passage;
    // The matched word marked, and the passage cut to what shows it rather than the whole place.
    expect(passage.filter((each) => each.matched).map((each) => each.text)).toEqual(['platen']);
    const shown = passage.map((each) => each.text).join('');
    expect(shown).toContain('platen needs cleaning');
    expect(shown.trim().split(/\s+/u).length).toBeLessThanOrEqual(30);
    expect(shown.length).toBeLessThan(long.length);
  });

  it('SCH-017 names the place a result matched', async () => {
    const artifact = await component(
      'Pump maintenance',
      ['b1', 'Drain the reservoir'],
      ['b2', 'Replace the impeller'],
    );
    const everything = await service.withTenant(production, (trx) =>
      everyKind(trx, { author: ada, spaceId: general, word: 'Walrus', role: production.role }),
    );
    expect(
      itemsOf(await search(ada, 'impeller')).map((each) => [each.artifactId, each.place]),
    ).toEqual([[artifact, 'block:b2']]);
    // A section by its document and its node, the place in it its title.
    const section = itemsOf(await search(ada, '"walrus section"')).find(
      (each) => each.kind === 'section',
    );
    expect(section).toMatchObject({
      artifactId: everything.document,
      node: everything.node,
      place: 'title',
    });
  });

  it('SCH-010 finds nothing a user may not read, by every path, counts included', async () => {
    const made = await service.withTenant(production, (trx) =>
      everyKind(trx, { author: ada, spaceId: quality, word: 'Zebra', role: production.role }),
    );
    // Ivy is granted read on General, where none of it is; Quality, where it all is, she may not read.
    await service.withTenant(production, async (trx) => {
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: ivy },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ada,
      });
    });
    // Not vacuous: whoever may read all of it finds every kind.
    await service.withTenant(production, async (trx) => {
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: ada },
        level: { kind: 'space', id: quality },
        effect: 'allow',
        grantedBy: ada,
      });
    });
    const kinds = itemsOf(await search(ada, 'zebra')).map((each) => each.kind);
    expect([...new Set(kinds)].sort()).toEqual([...searchKinds].sort());
    // Every kind search finds, the section's node, and a dataset, which search never finds (D3).
    expect(Object.keys(made).length).toBe(searchKinds.length + 2);
    expect(made.dataset).toBeDefined();

    for (const query of [
      'zebra',
      '"zebra component"',
      'zebra -walrus',
      'zebra or quagga',
      'title:zebra',
      '-title:walrus zebra',
    ]) {
      const answer = await search(ivy, query);
      expect({ query, answer }).toEqual({
        query,
        answer: {
          outcome: 'results',
          count: 0,
          capped: false,
          items: [],
          // Nor does any facet count what she may not see.
          facets: {
            kinds: [],
            spaces: [],
            componentTypes: [],
            owners: [],
            changed: ['today', 'week', 'month', 'year', 'earlier'].map((value) => ({
              value,
              label: value,
              count: 0,
              capped: false,
            })),
            fields: [],
          },
        },
      });
    }
    // A field is a definition, read at the tenant, which Ivy may not: its name scopes nothing for her.
    expect(await search(ivy, 'Reviewer:grace')).toEqual({
      outcome: 'unknown_field',
      name: 'Reviewer',
    });
  });

  it('SCH-010 finds nothing a grant on the thing itself refuses, a definition included', async () => {
    const made = await service.withTenant(production, (trx) =>
      everyKind(trx, { author: ada, spaceId: general, word: 'Ibex', role: production.role }),
    );
    // Hal reads the whole tenant, and is refused read on one field, one component type and one
    // component by grants on each of them.
    const hal = await service.withTenant(production, async (trx) => {
      const id = await person(trx, 'hal', 'Hal');
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: id },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ada,
      });
      for (const artifact of [reviewer, made.componentType, made.component]) {
        await grant(trx, {
          roleId: reader!.id,
          subject: { principal: id },
          level: { kind: 'artifact', id: artifact },
          effect: 'deny',
          grantedBy: ada,
        });
      }
      return id;
    });

    const kinds = itemsOf(await search(hal, 'ibex')).map((each) => each.kind);
    expect(kinds).not.toContain('componentType');
    expect(kinds).not.toContain('component');
    // What he may read is still there: the schema beside the refused type, and the field beside it.
    expect(kinds).toEqual(expect.arrayContaining(['metadataSchema', 'field', 'document']));
    expect(itemsOf(await search(hal, 'reviewer'))).toEqual([]);
    // Nor is a refused field a scope, which would find what is written under it elsewhere.
    expect(await search(hal, 'Reviewer:grace')).toEqual({
      outcome: 'unknown_field',
      name: 'Reviewer',
    });
    expect(await search(ada, 'Reviewer:grace')).toMatchObject({ outcome: 'results' });
  });

  it('answers a query with nothing to look for by name, never with everything', async () => {
    expect(await search(ada, '  ')).toEqual({ outcome: 'empty' });
    expect(await search(ada, '-lever')).toEqual({
      outcome: 'nothing_to_match',
      excluded: ['lever'],
    });
    expect(await search(ada, '!!!')).toEqual({ outcome: 'nothing_to_match', excluded: [] });
    expect(await search(ada, 'Approver:grace')).toEqual({
      outcome: 'unknown_field',
      name: 'Approver',
    });
  });

  it('answers an unknown principal with nothing', async () => {
    await expect(search(randomUUID(), 'lever')).resolves.toBeUndefined();
  });
});
