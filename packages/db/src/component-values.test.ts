import { randomUUID } from 'node:crypto';
import { DEFINITION_SCHEMA_VERSION, type ContentDocument } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDefinition, recordDefinitionVersion, type StoredDefinition } from './definitions.js';
import { claimLock, saveIteration } from './editing.js';
import { migrate } from './migrate.js';
import { cutVersion } from './promotion.js';
import { createTenant, type Tenant } from './provision.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import type { StoredVersion } from './versions.js';

const ISSUER = 'https://idp.example';

const field = (name: string, dataType = 'text', validation: object = {}) => ({
  schemaVersion: DEFINITION_SCHEMA_VERSION,
  name,
  dataType,
  multiplicity: 'one',
  validation,
});

describe("a component's values, written with its iterations", () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let general: string;
  let review: StoredDefinition;
  let protocol: StoredDefinition;
  const fields: Record<string, string> = {};

  const run = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(production, work);
  const made = async (answer: Promise<{ answer: string }>) => {
    const settled = (await answer) as { answer: string; definition?: StoredDefinition };
    if (settled.answer !== 'created' && settled.answer !== 'recorded') {
      throw new Error(settled.answer);
    }
    return settled.definition!;
  };

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
    await run(async (trx) => {
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
    const define = (definition: object) =>
      made(run((trx) => createDefinition(trx, { kind: 'field', definition, author: ada })));
    fields.market = (await define(field('Market'))).id;
    fields.owner = (await define(field('Owner', 'user'))).id;
    fields.code = (await define(field('Code', 'text', { maxLength: 4 }))).id;
    review = await made(
      run((trx) =>
        createDefinition(trx, {
          kind: 'metadataSchema',
          author: ada,
          definition: {
            schemaVersion: DEFINITION_SCHEMA_VERSION,
            name: 'Review',
            entries: [
              { field: fields.market, required: false, fixed: true, default: 'uk' },
              { field: fields.owner, required: false, fixed: false },
              { field: fields.code, required: true, fixed: false },
            ],
          },
        }),
      ),
    );
    protocol = await made(
      run((trx) =>
        createDefinition(trx, {
          kind: 'componentType',
          author: ada,
          definition: {
            schemaVersion: DEFINITION_SCHEMA_VERSION,
            name: 'Protocol',
            assignments: [{ schema: review.id, requires: [] }],
          },
        }),
      ),
    );
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  /** A component of the Protocol type, its lock held by a session of Ada's. */
  const opened = async () => {
    const session = randomUUID();
    const created = await run((trx) =>
      createComponent(trx, {
        spaceId: general,
        componentTypeId: protocol.id,
        title: 'Dosing',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      }),
    );
    if (created.answer !== 'created') throw new Error(created.answer);
    const version = created.version;
    const claimed = await run((trx) =>
      claimLock(trx, { artifactId: version.artifactId, principal: ada, session }),
    );
    if (claimed.answer !== 'claimed') throw new Error(claimed.answer);
    return { version, session };
  };
  const save = (
    at: { version: StoredVersion; session: string },
    sequence: number,
    values: Record<string, unknown>,
  ) =>
    run((trx) =>
      saveIteration(trx, {
        artifactId: at.version.artifactId,
        principal: ada,
        session: at.session,
        sequence,
        openedFrom: at.version.id,
        content: at.version.content as ContentDocument,
        values,
      }),
    );
  const cut = (at: { version: StoredVersion; session: string }) =>
    run((trx) =>
      cutVersion(trx, {
        artifactId: at.version.artifactId,
        principal: ada,
        session: at.session,
        openedFrom: at.version.id,
      }),
    );

  it('keeps the values an iteration carries, and cuts them into the next version', async () => {
    const at = await opened();
    // Created with the fixed market's default.
    expect(at.version.values).toEqual({ [fields.market!]: 'uk' });
    const values = {
      [fields.market!]: 'uk',
      [fields.code!]: 'AB12',
      [fields.owner!]: { user: ada },
    };
    expect((await save(at, 1, values)).answer).toBe('accepted');
    const answer = await cut(at);
    if (answer.answer !== 'recorded') throw new Error(answer.answer);
    expect(answer.version.values).toEqual(values);
  });

  it("MET-033 refuses an iteration or a cut holding a fixed field's value other than its default, naming the field and the schema", async () => {
    const at = await opened();
    expect(await save(at, 1, { [fields.market!]: 'us' })).toMatchObject({
      answer: 'values.invalid',
      failures: [{ field: fields.market, rule: 'fixed', schemas: [review.id] }],
    });
    // Saved with the default; then the schema fixes the market at another value before the cut.
    expect((await save(at, 2, { [fields.market!]: 'uk' })).answer).toBe('accepted');
    const next = await run((trx) =>
      recordDefinitionVersion(trx, {
        id: review.id,
        openedFrom: review.version.id,
        author: ada,
        definition: {
          schemaVersion: DEFINITION_SCHEMA_VERSION,
          name: 'Review',
          entries: [
            { field: fields.market, required: false, fixed: true, default: 'fr' },
            { field: fields.owner, required: false, fixed: false },
            { field: fields.code, required: true, fixed: false },
          ],
        },
      }),
    );
    expect(next.answer).toBe('recorded');
    expect(await cut(at)).toMatchObject({
      answer: 'values.invalid',
      failures: [{ field: fields.market, rule: 'fixed', schemas: [review.id] }],
    });
    // Put back, for the tests after this one.
    if (next.answer !== 'recorded') return;
    review = next.definition;
    const back = await run((trx) =>
      recordDefinitionVersion(trx, {
        id: review.id,
        openedFrom: review.version.id,
        author: ada,
        definition: {
          schemaVersion: DEFINITION_SCHEMA_VERSION,
          name: 'Review',
          entries: [
            { field: fields.market, required: false, fixed: true, default: 'uk' },
            { field: fields.owner, required: false, fixed: false },
            { field: fields.code, required: true, fixed: false },
          ],
        },
      }),
    );
    if (back.answer !== 'recorded') throw new Error(back.answer);
    review = back.definition;
  });

  it('MET-038 refuses a user value naming no user of this tenant', async () => {
    const at = await opened();
    const stranger = randomUUID();
    expect(
      await save(at, 1, { [fields.market!]: 'uk', [fields.owner!]: { user: stranger } }),
    ).toMatchObject({
      answer: 'values.invalid',
      failures: [{ field: fields.owner, rule: 'user' }],
    });
    expect(
      (await save(at, 1, { [fields.market!]: 'uk', [fields.owner!]: { user: ada } })).answer,
    ).toBe('accepted');
  });

  it('refuses a value that is not its data type, and saves and cuts one its field would refuse otherwise', async () => {
    const at = await opened();
    expect(await save(at, 1, { [fields.market!]: 'uk', [fields.code!]: 42 })).toMatchObject({
      answer: 'values.invalid',
      failures: [{ field: fields.code, rule: 'type' }],
    });
    // Too long, and the required code missing on the next: saved, and cut, and held at publication.
    expect((await save(at, 1, { [fields.market!]: 'uk', [fields.code!]: 'ABCDEFG' })).answer).toBe(
      'accepted',
    );
    // The owner given, so the cut has something to record, and the required code still missing.
    expect(
      (await save(at, 2, { [fields.market!]: 'uk', [fields.owner!]: { user: ada } })).answer,
    ).toBe('accepted');
    const answer = await cut(at);
    expect(answer.answer).toBe('recorded');
  });
});
