// packages/db/src/editing.test.ts
import { randomUUID } from 'node:crypto';
import {
  DEFINITION_SCHEMA_VERSION,
  definitionsFor,
  type ComponentTypeDefinition,
  type ContentDocument,
  type FieldDefinition,
  type MetadataSchemaDefinition,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import {
  claimLock,
  ITERATION_RETENTION_DAYS,
  LOCK_PERIOD_MINUTES,
  readLock,
  saveIteration,
} from './editing.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { createArtifact } from './versions.js';

const identity = (id: string, name: string) =>
  ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name }) as const;

const content = (...texts: string[]): ContentDocument => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: texts.map((text, index) => ({
    type: 'paragraph',
    id: `b${index + 1}`,
    style: 'body',
    content: text === '' ? [] : [{ type: 'text', value: text, marks: [] }],
  })),
});

describe('editing a component: its lock and its iterations', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let audience: string;
  let spaceId: string;
  let definitions: Awaited<ReturnType<typeof definitionsFor>>;

  /** A new component of the Procedure type, at version 0.1, holding one empty paragraph. */
  const newComponent = () =>
    service.withTenant(production, async (trx) => {
      const made = await createArtifact(trx, {
        author: ada,
        spaceId,
        substance: {
          kind: 'component',
          content: content(''),
          values: { [audience]: 'Engineers' },
          notCarried: [],
          definitions,
        },
      });
      return { id: made.artifactId, openedFrom: made.id };
    });

  const expireLock = (artifactId: string) =>
    service.withTenant(production, (trx) =>
      trx
        .updateTable('component_lock')
        .set({
          claimed_at: sql<Date>`clock_timestamp() - interval '2 hours'`,
          expires_at: sql<Date>`clock_timestamp() - interval '1 hour'`,
        })
        .where('artifact_id', '=', artifactId)
        .execute(),
    );

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    await service.withTenant(production, async (trx) => {
      const person = (subject: string, name: string) =>
        trx
          .insertInto('principal')
          .values({ issuer: 'https://idp.example', subject, email: null, display_name: name })
          .returning('id')
          .executeTakeFirstOrThrow()
          .then((row) => row.id);
      ada = await person('ada', 'Ada');
      grace = await person('grace', 'Grace');
      spaceId = (await createSpace(trx, 'Clinical')).id;
      const field: FieldDefinition = {
        ...identity(randomUUID(), 'Audience'),
        dataType: 'text',
        multiplicity: 'one',
        validation: {},
      };
      const schema: MetadataSchemaDefinition = {
        ...identity(randomUUID(), 'Publishing'),
        entries: [{ field: field.id, required: false, fixed: false }],
      };
      const type: ComponentTypeDefinition = {
        ...identity(randomUUID(), 'Procedure'),
        assignments: [{ schema: schema.id, requires: [] }],
      };
      const by = { author: ada };
      const storedField = await createArtifact(trx, {
        ...by,
        substance: { kind: 'field', content: field },
      });
      const storedSchema = await createArtifact(trx, {
        ...by,
        substance: { kind: 'metadataSchema', content: schema },
      });
      const storedType = await createArtifact(trx, {
        ...by,
        substance: { kind: 'componentType', content: type },
      });
      audience = field.id;
      definitions = definitionsFor(
        { version: storedType.id, definition: type },
        [{ version: storedSchema.id, definition: schema }],
        [{ version: storedField.id, definition: field }],
      );
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  describe('the lock', () => {
    it('is claimed by a session nobody else holds it against, and names that session', async () => {
      const component = await newComponent();
      const session = randomUUID();
      const answer = await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: ada, session }),
      );
      expect(answer).toMatchObject({
        answer: 'claimed',
        lock: { holder: ada, holderName: 'Ada', session },
      });
    });

    it('lasts the lock period from when it is claimed', async () => {
      const component = await newComponent();
      const before = Date.now();
      const answer = await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: ada, session: randomUUID() }),
      );
      if (answer.answer !== 'claimed') throw new Error(answer.answer);
      const period = LOCK_PERIOD_MINUTES * 60_000;
      expect(answer.lock.expiresAt.getTime()).toBeGreaterThanOrEqual(before + period - 5_000);
      expect(answer.lock.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + period + 5_000);
    });

    it('answers lock.held, naming the holder and when it is expected back, to anybody else', async () => {
      const component = await newComponent();
      const session = randomUUID();
      await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: ada, session }),
      );
      const answer = await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: grace, session: randomUUID() }),
      );
      expect(answer).toMatchObject({
        answer: 'lock.held',
        lock: { holder: ada, holderName: 'Ada', session, expiresAt: expect.any(Date) },
      });
    });

    it('refuses the same principal from another session unless told to move it there', async () => {
      const component = await newComponent();
      const first = randomUUID();
      const second = randomUUID();
      await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: ada, session: first }),
      );
      const refused = await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: ada, session: second }),
      );
      expect(refused).toMatchObject({ answer: 'lock.held', lock: { holder: ada, session: first } });
      const moved = await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: ada, session: second, move: true }),
      );
      expect(moved).toMatchObject({ answer: 'claimed', lock: { session: second } });
    });

    it('may be claimed by somebody else once it has expired', async () => {
      const component = await newComponent();
      await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: ada, session: randomUUID() }),
      );
      await expireLock(component.id);
      expect(await service.withTenant(production, (trx) => readLock(trx, component.id))).toBe(
        undefined,
      );
      const answer = await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: grace, session: randomUUID() }),
      );
      expect(answer).toMatchObject({ answer: 'claimed', lock: { holder: grace } });
    });

    it('answers artifact.missing for something that is not a component of this tenant', async () => {
      const component = await newComponent();
      for (const artifactId of [randomUUID(), 'not-a-uuid', definitions[0]!.id]) {
        const answer = await service.withTenant(production, (trx) =>
          claimLock(trx, { artifactId, principal: ada, session: randomUUID() }),
        );
        expect(answer, artifactId).toEqual({ answer: 'artifact.missing' });
      }
      // The second tenant does not hold the first tenant's component, however it is named.
      const elsewhere = await service.withTenant(development, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: ada, session: randomUUID() }),
      );
      expect(elsewhere).toEqual({ answer: 'artifact.missing' });
    });
  });

  describe('iterations', () => {
    /** A component Ada holds from one session, ready to save into. */
    const held = async () => {
      const component = await newComponent();
      const session = randomUUID();
      await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: ada, session }),
      );
      const save = (sequence: number, text: string, as = { principal: ada, session }) =>
        service.withTenant(production, (trx) =>
          saveIteration(trx, {
            artifactId: component.id,
            ...as,
            sequence,
            openedFrom: component.openedFrom,
            content: content(text),
          }),
        );
      return { ...component, session, save };
    };

    it('VER-001 keeps an iteration as its editor wrote it, timestamped, and the runtime role cannot change or remove it', async () => {
      const component = await held();
      expect(await component.save(1, 'Unbox the printer.')).toMatchObject({
        answer: 'accepted',
        sequence: 1,
        repeated: false,
      });
      const row = await service.withTenant(production, (trx) =>
        trx
          .selectFrom('iteration')
          .selectAll()
          .where('artifact_id', '=', component.id)
          .executeTakeFirstOrThrow(),
      );
      expect(row).toMatchObject({
        principal_id: ada,
        session_id: component.session,
        sequence: 1,
        opened_from: component.openedFrom,
        content: content('Unbox the printer.'),
        metadata_values: { [audience]: 'Engineers' },
      });
      expect(row.created_at).toBeInstanceOf(Date);
      const retention = ITERATION_RETENTION_DAYS * 24 * 60 * 60_000;
      expect(row.expires_at.getTime() - row.created_at.getTime()).toBe(retention);

      for (const statement of [
        sql`update iteration set sequence = 2 where id = ${row.id}`,
        sql`delete from iteration where id = ${row.id}`,
        sql`truncate iteration`,
      ]) {
        await expect(
          service.withTenant(production, (trx) => statement.execute(trx)),
        ).rejects.toThrow(/permission denied/);
      }
    });

    it('accepts a repeated sequence with the same content as it did the first time, making no second row', async () => {
      const component = await held();
      await component.save(1, 'Unbox the printer.');
      expect(await component.save(1, 'Unbox the printer.')).toMatchObject({
        answer: 'accepted',
        sequence: 1,
        repeated: true,
      });
      const rows = await service.withTenant(production, (trx) =>
        trx.selectFrom('iteration').select('id').where('artifact_id', '=', component.id).execute(),
      );
      expect(rows).toHaveLength(1);
    });

    it('refuses the latest sequence with different content as a conflict, and a lower one as stale', async () => {
      const component = await held();
      await component.save(1, 'Unbox the printer.');
      await component.save(2, 'Unbox the printer and connect it.');
      expect(await component.save(2, 'Something else')).toEqual({
        answer: 'iteration.conflict',
        latest: 2,
      });
      expect(await component.save(1, 'Unbox the printer.')).toEqual({
        answer: 'iteration.stale',
        latest: 2,
      });
    });

    it('extends the lock with each accepted iteration', async () => {
      const component = await held();
      await service.withTenant(production, (trx) =>
        trx
          .updateTable('component_lock')
          .set({ expires_at: sql<Date>`clock_timestamp() + interval '1 minute'` })
          .where('artifact_id', '=', component.id)
          .execute(),
      );
      const answer = await component.save(1, 'Unbox the printer.');
      if (answer.answer !== 'accepted') throw new Error(answer.answer);
      expect(answer.lock.expiresAt.getTime()).toBeGreaterThan(Date.now() + 10 * 60_000);
    });

    it('refuses an iteration from anybody but the holding session', async () => {
      const component = await held();
      expect(
        await component.save(1, 'Hers', { principal: grace, session: randomUUID() }),
      ).toMatchObject({ answer: 'lock.held', lock: { holder: ada, session: component.session } });
      expect(
        await component.save(1, 'Other window', { principal: ada, session: randomUUID() }),
      ).toMatchObject({ answer: 'lock.held', lock: { holder: ada } });
      await expireLock(component.id);
      expect(await component.save(1, 'Too late')).toEqual({ answer: 'lock.required' });
    });

    it('refuses an iteration against a version that is not the latest, naming the latest', async () => {
      const component = await held();
      const answer = await service.withTenant(production, (trx) =>
        saveIteration(trx, {
          artifactId: component.id,
          principal: ada,
          session: component.session,
          sequence: 1,
          openedFrom: randomUUID(),
          content: content('Opened from elsewhere'),
        }),
      );
      expect(answer).toMatchObject({
        answer: 'version.precondition',
        current: { id: component.openedFrom },
      });
    });

    it('answers artifact.missing to another tenant, however the component is named', async () => {
      const component = await held();
      const answer = await service.withTenant(development, (trx) =>
        saveIteration(trx, {
          artifactId: component.id,
          principal: ada,
          session: component.session,
          sequence: 1,
          openedFrom: component.openedFrom,
          content: content('Elsewhere'),
        }),
      );
      expect(answer).toEqual({ answer: 'artifact.missing' });
    });
  });

  it('keeps nothing referring to an iteration, so no comparison, audit or reader can reach one', async () => {
    const { rows } = await queryAs(
      db.adminUrl,
      `select conname from pg_constraint
        where contype = 'f' and confrelid = $1::regclass`,
      [`${production.schema}.iteration`],
    );
    expect(rows).toEqual([]);
  });
});
