import { randomUUID } from 'node:crypto';
import { DEFINITION_SCHEMA_VERSION, TEMPLATE_SCHEMA_VERSION } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { currentDefinitionsFor } from './creation.js';
import {
  createDefinition,
  listDefinitions,
  readDefinitionLatest,
  recordDefinitionVersion,
  type DefinitionAnswer,
} from './definitions.js';
import { DEFAULT_LAYOUT_ID } from './layouts.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
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
import { createArtifact, readVersion, recordVersion } from './versions.js';

const ISSUER = 'https://idp.example';

const field = (name: string, validation: object = {}) => ({
  schemaVersion: DEFINITION_SCHEMA_VERSION,
  name,
  dataType: 'text',
  multiplicity: 'one',
  validation,
});
const entry = (fieldId: string, value?: string) => ({
  field: fieldId,
  required: false,
  fixed: false,
  ...(value === undefined ? {} : { default: value }),
});
const schema = (name: string, entries: object[]) => ({
  schemaVersion: DEFINITION_SCHEMA_VERSION,
  name,
  entries,
});
const componentType = (name: string, schemas: string[]) => ({
  schemaVersion: DEFINITION_SCHEMA_VERSION,
  name,
  assignments: schemas.map((id) => ({ schema: id, requires: [] })),
});

/** The definition an answer made or recorded, or a failure naming the answer it was. */
function made(answer: DefinitionAnswer) {
  if (answer.answer !== 'created' && answer.answer !== 'recorded') {
    throw new Error(`Expected a definition, and was answered ${answer.answer}`);
  }
  return answer.definition;
}

describe('definitions through the service', () => {
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
    service = testTenantDatabase(db.serviceUrl);
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
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  const run = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);
  const create = (kind: 'field' | 'metadataSchema' | 'componentType', definition: object) =>
    run((trx) => createDefinition(trx, { kind, definition, author: ada }));
  const version = (id: string, openedFrom: string, definition: object) =>
    run((trx) => recordDefinitionVersion(trx, { id, openedFrom, definition, author: ada }));
  const count = (kind: string) =>
    run(async (trx) =>
      Number(
        (
          await trx
            .selectFrom('artifact')
            .select((eb) => eb.fn.countAll().as('n'))
            .where('kind', '=', kind as never)
            .executeTakeFirstOrThrow()
        ).n,
      ),
    );

  it('MET-041 creates a new version for every change to a field, a schema or a component type', async () => {
    const owner = made(await create('field', field('Owner')));
    const review = made(await create('metadataSchema', schema('Review', [entry(owner.id)])));
    const protocol = made(await create('componentType', componentType('Protocol', [review.id])));
    for (const [each, next] of [
      [owner, field('Owner of record')],
      [review, schema('Review board', [entry(owner.id)])],
      [protocol, componentType('Protocol sheet', [review.id])],
    ] as const) {
      expect([each.version.revision, each.version.version]).toEqual([0, 1]);
      const changed = made(await version(each.id, each.version.id, next));
      expect([changed.version.revision, changed.version.version]).toEqual([0, 2]);
      // The version before is kept as it was, beside the one after it.
      const before = await run((trx) => readVersion(trx, each.version.id));
      expect((before!.content as { name: string }).name).toBe(each.definition.name);
      expect((await run((trx) => readDefinitionLatest(trx, each.id)))?.definition.name).toBe(
        next.name,
      );
      // Nothing changed is no version.
      expect((await version(each.id, changed.version.id, next)).answer).toBe('version.unchanged');
    }
  });

  it('MET-031 refuses a name another definition of its kind holds, compared folded', async () => {
    const study = made(await create('field', field('Study number')));
    expect(await create('field', field('  study NUMBER '))).toEqual({
      answer: 'definition.name_taken',
      holder: { id: study.id, name: 'Study number' },
    });
    // Another kind may hold the same name.
    expect((await create('metadataSchema', schema('Study number', []))).answer).toBe('created');
    // A rename is held to it too, and a definition may keep its own name.
    const site = made(await create('field', field('Site')));
    expect((await version(site.id, site.version.id, field('STUDY number'))).answer).toBe(
      'definition.name_taken',
    );
    expect((await version(site.id, site.version.id, field('site', { maxLength: 9 }))).answer).toBe(
      'recorded',
    );
    // The names every environment already held are held too: the starter component type is Topic.
    expect((await create('componentType', componentType('topic', []))).answer).toBe(
      'definition.name_taken',
    );
  });

  it('holds the name of a definition however it was made, and renamed, not only through the routes', async () => {
    // Made as development's seed makes its fields: straight onto the chain, with an identifier of its own.
    const direct = await run((trx) =>
      createArtifact(trx, {
        author: ada,
        substance: {
          kind: 'field',
          content: { ...field('Batch number'), id: randomUUID() } as never,
        },
      }),
    );
    expect((await create('field', field('batch NUMBER'))).answer).toBe('definition.name_taken');
    // And renamed straight onto the chain: the new name is held, and the old one is free.
    await run((trx) =>
      recordVersion(trx, {
        artifactId: direct.artifactId,
        openedFrom: direct.id,
        author: ada,
        substance: {
          kind: 'field',
          content: { ...field('Lot number'), id: direct.artifactId } as never,
        },
      }),
    );
    expect((await create('field', field('Lot number'))).answer).toBe('definition.name_taken');
    expect((await create('field', field('Batch number'))).answer).toBe('created');
  });

  it('MET-008 refuses a component type assigning two schemas whose defaults for a field differ, naming the field and both schemas', async () => {
    const status = made(await create('field', field('Status')));
    const first = made(
      await create('metadataSchema', schema('Drafting', [entry(status.id, 'draft')])),
    );
    const second = made(
      await create('metadataSchema', schema('Release', [entry(status.id, 'final')])),
    );
    const types = await count('componentType');
    expect(await create('componentType', componentType('Bulletin', [first.id, second.id]))).toEqual(
      {
        answer: 'assignment.conflict',
        failures: [
          expect.objectContaining({
            field: status.id,
            rule: 'defaultConflict',
            schemas: [first.id, second.id],
          }),
        ],
      },
    );
    expect(await count('componentType')).toBe(types);
  });

  it('MET-040 refuses a schema version whose default would differ from a schema applied beside it, naming the field, the other schema and every such place', async () => {
    const phase = made(await create('field', field('Phase')));
    const plan = made(await create('metadataSchema', schema('Plan', [entry(phase.id, 'one')])));
    const trial = made(await create('metadataSchema', schema('Trial', [entry(phase.id, 'one')])));
    const sheet = made(
      await create('componentType', componentType('Trial sheet', [plan.id, trial.id])),
    );
    const report = await run((trx) =>
      createTemplate(trx, {
        spaceId: general,
        author: ada,
        definition: {
          schemaVersion: TEMPLATE_SCHEMA_VERSION,
          name: 'Trial report',
          theme: DEFAULT_THEME_ID,
          layout: DEFAULT_LAYOUT_ID,
          schemas: [
            { schema: plan.id, level: 'section', requires: [] },
            { schema: trial.id, level: 'section', requires: [] },
          ],
          outline: { sections: [] },
          changes: { add: true, remove: true, reorder: true },
        },
      }),
    );
    if (report.answer !== 'created') throw new Error(report.answer);

    expect(
      await version(trial.id, trial.version.id, schema('Trial', [entry(phase.id, 'two')])),
    ).toEqual({
      answer: 'schema.conflict',
      conflicts: [
        {
          field: phase.id,
          other: plan.id,
          places: [
            { kind: 'componentType', id: sheet.id, name: 'Trial sheet' },
            { kind: 'template', id: report.template.id, name: 'Trial report', level: 'section' },
          ],
        },
      ],
    });
    // A version that agrees is taken, and every place assigning the schema takes it: assignments name
    // the schema and never a version of it.
    const agreeing = made(
      await version(trial.id, trial.version.id, schema('Trial phase', [entry(phase.id, 'one')])),
    );
    const current = await run((trx) => currentDefinitionsFor(trx, sheet.id));
    expect(current?.schemas.map((each) => each.version)).toContain(agreeing.version.id);
  });

  it("MET-037 refuses a field version that would make a schema's default invalid, naming each schema and its default", async () => {
    const code = made(await create('field', field('Code')));
    const batch = made(await create('metadataSchema', schema('Batch', [entry(code.id, 'ABCDE')])));
    // A default the next version still takes is not named.
    made(await create('metadataSchema', schema('Lot', [entry(code.id, 'AB')])));
    expect(await version(code.id, code.version.id, field('Code', { maxLength: 3 }))).toEqual({
      answer: 'field.breaks_default',
      broken: [expect.objectContaining({ schema: batch.id, default: 'ABCDE', rule: 'maxLength' })],
    });
  });

  it('refuses a definition naming one that is not there, or a default its own field refuses', async () => {
    const missing = '00000000-0000-4000-8000-00000000dead';
    expect(await create('metadataSchema', schema('Orphans', [entry(missing)]))).toEqual({
      answer: 'definition.unresolved',
      missing: [missing],
      requires: [],
    });
    expect(await create('componentType', componentType('Stray', [missing]))).toEqual({
      answer: 'definition.unresolved',
      missing: [missing],
      requires: [],
    });
    const size = made(await create('field', field('Size', { maxLength: 2 })));
    expect(
      await create('metadataSchema', schema('Sizes', [entry(size.id, 'large')])),
    ).toMatchObject({
      answer: 'definition.invalid',
      failures: [{ field: size.id, rule: 'default' }],
    });
  });

  it('serialises definition writes within one environment, and never across two', async () => {
    const other = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Staging' },
      hostnames: ['staging.acme.alloy.test'],
    });
    const grace = await service.withTenant(other, async (trx) =>
      trx
        .insertInto('principal')
        .values({ issuer: ISSUER, subject: 'grace', email: null, display_name: 'Grace' })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );
    // A write in Production that holds its transaction open.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let taken!: () => void;
    const holding = new Promise<void>((resolve) => (taken = resolve));
    const first = run(async (trx) => {
      await createDefinition(trx, { kind: 'field', definition: field('Held open'), author: ada });
      taken();
      await held;
    });
    await holding;
    // A write in Staging meanwhile is not held behind it.
    const second = service.withTenant(other, (trx) =>
      createDefinition(trx, { kind: 'field', definition: field('Elsewhere'), author: grace }),
    );
    const outcome = await Promise.race([
      second.then((answer) => answer.answer),
      new Promise((resolve) => setTimeout(() => resolve('blocked'), 3000)),
    ]);
    release();
    await Promise.all([first, second]);
    expect(outcome).toBe('created');
  });

  it('lists every definition at its latest version, and lets the runtime role rename but never unname one', async () => {
    const listed = await run((trx) => listDefinitions(trx));
    expect(listed.items.find((each) => each.name === 'Topic')).toMatchObject({
      kind: 'componentType',
    });
    await expect(run((trx) => sql`delete from definition_name`.execute(trx))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      run((trx) => sql`update definition_name set kind = 'field'`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
  });
});
