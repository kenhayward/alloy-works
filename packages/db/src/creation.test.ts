import { parseContentDocument, type ComponentTypeDefinition } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent, currentDefinitionsFor, STARTER_COMPONENT_TYPE_ID } from './creation.js';
import { createSpace } from './spaces.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { createArtifact, latestVersion } from './versions.js';

const ELSEWHERE = '11111111-1111-4111-8111-111111111111';

describe('creating a component', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let acme: Tenant;
  let other: Tenant;
  let grace: string;
  let general: string;

  const person = (tenant: Tenant, subject: string) =>
    service.withTenant(tenant, async (trx) => {
      const row = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject,
          email: `${subject}@example.com`,
          display_name: subject,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    });

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    acme = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    other = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    grace = await person(acme, 'grace');
    general = await service.withTenant(acme, async (trx) => {
      const space = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      return space.id;
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  const make = (input: Partial<Parameters<typeof createComponent>[1]> = {}, tenant = acme) =>
    service.withTenant(tenant, (trx) =>
      createComponent(trx, {
        spaceId: general,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        author: grace,
        ...input,
      }),
    );

  it('writes version 0.1 holding exactly one empty paragraph, with a fresh identifier', async () => {
    const answer = await make({ title: 'Replace the toner' });
    expect(answer.answer).toBe('created');
    if (answer.answer !== 'created') return;
    expect(answer.version.revision).toBe(0);
    expect(answer.version.version).toBe(1);
    expect(answer.version.author).toBe(grace);
    const document = parseContentDocument(answer.version.content);
    expect(document).toMatchObject({
      title: 'Replace the toner',
      language: 'en-GB',
      direction: 'ltr',
    });
    expect(document.content).toHaveLength(1);
    expect(document.content[0]).toMatchObject({ type: 'paragraph', style: 'body', content: [] });
    expect(document.content[0]?.id).toMatch(/^[a-z2-7]{26}$/);

    const second = await make({ title: 'Replace the toner' });
    if (second.answer !== 'created') throw new Error('not created');
    const again = parseContentDocument(second.version.content);
    expect(again.content[0]?.id).not.toBe(document.content[0]?.id);
  });

  it('takes the environment default when no type is named, and the named one when there is', async () => {
    const byDefault = await make();
    if (byDefault.answer !== 'created') throw new Error('not created');
    expect(byDefault.version.definitions).toEqual([
      { kind: 'componentType', id: STARTER_COMPONENT_TYPE_ID, version: expect.any(String) },
    ]);
    const named = await make({ componentTypeId: STARTER_COMPONENT_TYPE_ID });
    if (named.answer !== 'created') throw new Error('not created');
    expect(named.version.componentType).toBe(byDefault.version.componentType);
  });

  it('applies every default the type resolves to, a fixed field included', async () => {
    const made = await service.withTenant(acme, async (trx) => {
      const field = await createArtifact(trx, {
        author: grace,
        substance: {
          kind: 'field',
          content: {
            schemaVersion: 1,
            id: '22222222-2222-4222-8222-222222222222',
            name: 'Status',
            dataType: 'text',
            multiplicity: 'one',
            validation: {},
          },
        },
      });
      const schema = await createArtifact(trx, {
        author: grace,
        substance: {
          kind: 'metadataSchema',
          content: {
            schemaVersion: 1,
            id: '33333333-3333-4333-8333-333333333333',
            name: 'Regulatory',
            entries: [
              {
                field: '22222222-2222-4222-8222-222222222222',
                required: false,
                default: 'Draft',
                fixed: true,
              },
            ],
          },
        },
      });
      const type: ComponentTypeDefinition = {
        schemaVersion: 1,
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Procedure',
        assignments: [{ schema: '33333333-3333-4333-8333-333333333333', requires: [] }],
      };
      await createArtifact(trx, {
        author: grace,
        substance: { kind: 'componentType', content: type },
      });
      return { field: field.artifactId, schema: schema.artifactId };
    });
    const answer = await make({
      componentTypeId: '44444444-4444-4444-8444-444444444444',
      title: 'Calibrate the scale',
    });
    if (answer.answer !== 'created') throw new Error('not created');
    expect(answer.version.values).toEqual({ '22222222-2222-4222-8222-222222222222': 'Draft' });
    expect(answer.version.notCarried).toEqual([]);
    expect(answer.version.definitions.map((each) => each.kind)).toEqual([
      'componentType',
      'field',
      'metadataSchema',
    ]);
    expect(made.field).toBe('22222222-2222-4222-8222-222222222222');
    expect(made.schema).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('refuses a title, a language or a direction the model would not accept', async () => {
    expect((await make({ title: '' })).answer).toBe('content.invalid');
    expect((await make({ title: '   ' })).answer).toBe('content.invalid');
    expect((await make({ language: 'english' })).answer).toBe('content.invalid');
  });

  it('refuses a component type this environment does not hold, and one that is not a type', async () => {
    expect((await make({ componentTypeId: ELSEWHERE })).answer).toBe('component_type.missing');
    const component = await make();
    if (component.answer !== 'created') throw new Error('not created');
    expect((await make({ componentTypeId: component.version.artifactId })).answer).toBe(
      'component_type.missing',
    );
  });

  it("refuses another environment's space, and another environment's component type", async () => {
    const theirs = await service.withTenant(other, async (trx) => {
      const space = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      return space.id;
    });
    expect((await make({ spaceId: theirs })).answer).toBe('space.missing');

    const quality = await service.withTenant(other, (trx) => createSpace(trx, 'Quality'));
    const graceThere = await person(other, 'grace');
    const madeThere = await make({ spaceId: quality.id, author: graceThere }, other);
    expect(madeThere.answer).toBe('created');
    if (madeThere.answer !== 'created') return;
    const here = await service.withTenant(acme, (trx) =>
      latestVersion(trx, madeThere.version.artifactId),
    );
    expect(here).toBeUndefined();
  });

  it('answers nothing for a component type no version of this environment reads', async () => {
    const absent = await service.withTenant(acme, (trx) => currentDefinitionsFor(trx, ELSEWHERE));
    expect(absent).toBeUndefined();
  });
});
