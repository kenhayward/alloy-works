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
  takeLock,
  iterationDigest,
  LOCK_PERIOD_MINUTES,
  readLock,
  readLocks,
  saveIteration,
  sessionContent,
} from './editing.js';
import { migrate } from './migrate.js';
import { editingPolicy, setEditingPolicy } from './retention.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  queryAs,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { createArtifact } from './versions.js';

/** One paragraph of the content document, which this file builds runs inside. */
type Paragraph = Extract<ContentDocument['content'][number], { type: 'paragraph' }>;

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

/** A promise and the function that settles it: what two transactions take turns on. */
function latch() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

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
    service = testTenantDatabase(db.serviceUrl);
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
    it("reads many components' locks in one call, answering each as readLock does", async () => {
      const [held, free, other] = [
        await newComponent(),
        await newComponent(),
        await newComponent(),
      ];
      await service.withTenant(production, async (trx) => {
        await claimLock(trx, { artifactId: held.id, principal: ada, session: randomUUID() });
        await claimLock(trx, { artifactId: other.id, principal: grace, session: randomUUID() });
      });
      const ids = [held.id, free.id, other.id, 'not-an-artifact'];
      const [many, each] = await service.withTenant(production, async (trx) => [
        await readLocks(trx, ids),
        await Promise.all(ids.map((id) => readLock(trx, id))),
      ]);
      expect([...many.keys()].sort()).toEqual([held.id, other.id].sort());
      ids.forEach((id, at) => expect(many.get(id), id).toEqual(each[at]));
    });

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

    it('COL-008 lasts the release period an administrator sets, and is free to anybody once its holder has done nothing for it', async () => {
      const set = (change: Parameters<typeof setEditingPolicy>[1]) =>
        service.withTenant(production, (trx) => setEditingPolicy(trx, change));
      expect(await set({ lockReleaseMinutes: 7, lockTakeMinutes: 2 })).toMatchObject({
        policy: { lockReleaseMinutes: 7, lockTakeMinutes: 2 },
      });
      try {
        const component = await newComponent();
        const before = Date.now();
        const answer = await service.withTenant(production, (trx) =>
          claimLock(trx, { artifactId: component.id, principal: ada, session: randomUUID() }),
        );
        if (answer.answer !== 'claimed') throw new Error(answer.answer);
        expect(answer.lock.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 7 * 60_000 - 5_000);
        expect(answer.lock.expiresAt.getTime()).toBeLessThanOrEqual(
          Date.now() + 7 * 60_000 + 5_000,
        );

        // Its holder idle past the period: free, and Grace claims it.
        await service.withTenant(production, (trx) =>
          sql`update component_lock set claimed_at = now() - interval '9 minutes',
            active_at = now() - interval '8 minutes',
            expires_at = now() - interval '1 minute' where artifact_id = ${component.id}`.execute(
            trx,
          ),
        );
        expect(
          await service.withTenant(production, (trx) =>
            claimLock(trx, { artifactId: component.id, principal: grace, session: randomUUID() }),
          ),
        ).toMatchObject({ answer: 'claimed', lock: { holder: grace } });
      } finally {
        await set({ lockReleaseMinutes: 15, lockTakeMinutes: 5 });
      }
    });

    it('COL-046 refuses a take period not shorter than the release period, in the store and by the table itself', async () => {
      expect(
        await service.withTenant(production, (trx) =>
          setEditingPolicy(trx, { lockReleaseMinutes: 10, lockTakeMinutes: 10 }),
        ),
      ).toEqual({ refused: 'lock_periods.invalid' });
      await expect(
        service.withTenant(production, (trx) =>
          sql`update editing_policy set lock_take_minutes = 20, lock_release_minutes = 10`.execute(
            trx,
          ),
        ),
      ).rejects.toThrow(/editing_policy_take_before_release|check constraint/);
      expect(await service.withTenant(production, (trx) => editingPolicy(trx))).toMatchObject({
        lockReleaseMinutes: 15,
        lockTakeMinutes: 5,
      });
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

    it('reads nothing from another tenant, however the component is named', async () => {
      const component = await newComponent();
      await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: ada, session: randomUUID() }),
      );
      const elsewhere = await service.withTenant(development, (trx) => readLock(trx, component.id));
      expect(elsewhere).toBe(undefined);
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

    it("reads a session's content only while that session holds the lock: not from another window of the author's, nor once it lapses, nor while another principal holds it", async () => {
      const component = await held();
      expect(await component.save(1, 'Unbox the printer.')).toMatchObject({ answer: 'accepted' });
      const read = () =>
        service.withTenant(production, (trx) =>
          sessionContent(trx, {
            artifactId: component.id,
            principal: ada,
            session: component.session,
          }),
        );
      const claim = (principal: string, session: string) =>
        service.withTenant(production, (trx) =>
          claimLock(trx, { artifactId: component.id, principal, session, move: true }),
        );
      expect(await read()).toMatchObject({ openedFrom: component.openedFrom });
      await claim(ada, randomUUID());
      expect(await read()).toBeUndefined();
      await claim(ada, component.session);
      expect(await read()).toBeDefined();
      await expireLock(component.id);
      expect(await read()).toBeUndefined();
      await claim(grace, randomUUID());
      expect(await read()).toBeUndefined();
    });

    it('VER-001 keeps an iteration as its editor wrote it, timestamped, and the runtime role cannot change it, nor remove it before its window', async () => {
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

      for (const statement of [
        sql`update iteration set sequence = 2 where id = ${row.id}`,
        sql`truncate iteration`,
      ]) {
        await expect(
          service.withTenant(production, (trx) => statement.execute(trx)),
        ).rejects.toThrow(/permission denied/);
      }
      // Only the sweep removes one, once the next cut is past its window (VER-003, retention.test.ts).
      await expect(
        service.withTenant(production, (trx) =>
          sql`delete from iteration where id = ${row.id}`.execute(trx),
        ),
      ).rejects.toThrow(/kept until the next version is cut, and for the window after it/);
    });

    it('stores an iteration with its runs merged, so a split and a whole spelling are one iteration', async () => {
      const component = await held();
      const emphasis = [{ type: 'emphasis' as const, id: 'm1' }];
      const runs = (inline: Paragraph['content']): ContentDocument => ({
        schemaVersion: 1,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        content: [{ type: 'paragraph', id: 'b1', style: 'body', content: inline }],
      });
      const whole = runs([{ type: 'text', value: 'Unbox the printer.', marks: emphasis }]);
      const save = (content: ContentDocument, sequence: number) =>
        service.withTenant(production, (trx) =>
          saveIteration(trx, {
            artifactId: component.id,
            principal: ada,
            session: component.session,
            sequence,
            openedFrom: component.openedFrom,
            content,
          }),
        );

      expect(
        await save(
          runs([
            { type: 'text', value: 'Unbox ', marks: emphasis },
            { type: 'text', value: '', marks: [] },
            { type: 'text', value: 'the printer.', marks: emphasis },
          ]),
          1,
        ),
      ).toMatchObject({ answer: 'accepted', sequence: 1, repeated: false });
      const row = await service.withTenant(production, (trx) =>
        trx
          .selectFrom('iteration')
          .selectAll()
          .where('artifact_id', '=', component.id)
          .executeTakeFirstOrThrow(),
      );
      expect(row.content).toEqual(whole);
      expect(row.digest).toBe(iterationDigest(whole, { [audience]: 'Engineers' }));
      // The whole spelling at the same sequence is the same content, never a conflict, and makes no
      // second row: the two spellings are one stored value.
      expect(await save(whole, 1)).toMatchObject({ answer: 'accepted', repeated: true });
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

    it('accepts a sequence a second principal saves under a reused session id, even when the first principal already used that sequence number', async () => {
      const component = await held();
      await component.save(1, 'Ada, sequence one');
      await expireLock(component.id);
      await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: grace, session: component.session }),
      );
      expect(
        await component.save(1, 'Grace, sequence one too', {
          principal: grace,
          session: component.session,
        }),
      ).toMatchObject({ answer: 'accepted', sequence: 1, repeated: false });
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

    it('refuses a sequence above what the column can hold, before it ever reaches the database', async () => {
      const component = await held();
      await expect(component.save(2147483648, 'Too big')).rejects.toThrow(
        /whole number from 1 to 2147483647/,
      );
    });
  });

  describe('taking a lock from an idle holder (collaboration.md, Taking)', () => {
    /** A component Ada holds, idle since `minutesAgo`, and a way to save into it as her. */
    const heldIdle = async (minutesAgo: number) => {
      const component = await newComponent();
      const session = randomUUID();
      await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: ada, session }),
      );
      await service.withTenant(production, (trx) =>
        sql`update component_lock set claimed_at = now() - make_interval(mins => ${minutesAgo + 1}),
          active_at = now() - make_interval(mins => ${minutesAgo})
          where artifact_id = ${component.id}`.execute(trx),
      );
      const save = (sequence: number) =>
        service.withTenant(production, (trx) =>
          saveIteration(trx, {
            artifactId: component.id,
            principal: ada,
            session,
            sequence,
            openedFrom: component.openedFrom,
            content: content(`Draft ${sequence}`),
          }),
        );
      return { ...component, session, save };
    };
    const take = (artifactId: string, principal: string, session: string) =>
      service.withTenant(production, (trx) => takeLock(trx, { artifactId, principal, session }));
    /** The grace of an ask, passed, as though a minute had gone by. */
    const graceOver = (artifactId: string) =>
      service.withTenant(production, (trx) =>
        sql`update component_lock set taking_until = now() - interval '1 second'
          where artifact_id = ${artifactId}`.execute(trx),
      );

    it('COL-046 refuses to ask for a lock whose holder has been active within the take period, saying when it may be asked', async () => {
      const component = await heldIdle(2);
      const answer = await take(component.id, grace, randomUUID());
      expect(answer).toMatchObject({ answer: 'lock.active', lock: { holder: ada } });
      if (answer.answer !== 'lock.active') throw new Error(answer.answer);
      expect(answer.lock.takeableAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('COL-047 warns the holder at once and keeps the lock theirs through the grace, any work they save keeping it; never taken at the first ask', async () => {
      const component = await heldIdle(6);
      const graces = randomUUID();
      const asked = await take(component.id, grace, graces);
      expect(asked).toMatchObject({
        answer: 'asked',
        lock: { holder: ada, taking: { by: grace, byName: 'Grace' } },
      });
      // Asked again within the grace: still asked, never taken.
      expect(await take(component.id, grace, graces)).toMatchObject({ answer: 'asked' });
      // Ada saves: she keeps it, and the ask is gone.
      expect(await component.save(1)).toMatchObject({ answer: 'accepted' });
      const lock = await service.withTenant(production, (trx) => readLock(trx, component.id));
      expect(lock).toMatchObject({ holder: ada, taking: null });
      expect(await take(component.id, grace, graces)).toMatchObject({ answer: 'lock.active' });
    });

    it("COL-009 takes it once the grace passes with the holder idle, and tells the holder's next save who has it", async () => {
      const component = await heldIdle(6);
      const graces = randomUUID();
      expect(await take(component.id, grace, graces)).toMatchObject({ answer: 'asked' });
      await graceOver(component.id);
      const taken = await take(component.id, grace, graces);
      expect(taken).toMatchObject({
        answer: 'taken',
        lock: { holder: grace, session: graces, taking: null },
        from: { holder: ada, session: component.session },
      });
      expect(await component.save(1)).toMatchObject({
        answer: 'lock.taken',
        lock: { holder: grace, holderName: 'Grace' },
      });
    });

    it("answers somebody else's standing ask as theirs, and a lock nobody or the asker holds as not to take", async () => {
      const component = await heldIdle(6);
      expect(await take(component.id, grace, randomUUID())).toMatchObject({ answer: 'asked' });
      const alan = await service.withTenant(
        production,
        async (trx) =>
          (
            await trx
              .insertInto('principal')
              .values({
                issuer: 'https://idp.example',
                subject: 'alan',
                email: null,
                display_name: 'Alan',
              })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id,
      );
      expect(await take(component.id, alan, randomUUID())).toMatchObject({
        answer: 'lock.taking',
        lock: { taking: { by: grace } },
      });
      expect(await take(component.id, ada, randomUUID())).toMatchObject({ answer: 'lock.own' });
      const free = await newComponent();
      expect(await take(free.id, grace, randomUUID())).toEqual({ answer: 'lock.free' });
    });
  });

  describe('two sessions racing the same lock, genuinely overlapping in Postgres', () => {
    it('COL-044 lets only one of two concurrent claims win, never both, and tells the other at once who holds it', async () => {
      const component = await newComponent();
      const sessionA = randomUUID();
      const sessionG = randomUUID();
      const claimed = latch();
      const release = latch();

      let answerA: Awaited<ReturnType<typeof claimLock>> | undefined;
      const first = service.withTenant(production, async (trx) => {
        answerA = await claimLock(trx, {
          artifactId: component.id,
          principal: ada,
          session: sessionA,
        });
        claimed.open();
        await release.opened;
      });
      await claimed.opened;

      // Started while the first is still open, uncommitted: a real second transaction, not a second
      // call in the same one. Given a moment to reach its own read and write before the first is
      // released, so the two genuinely overlap in Postgres rather than merely in program order.
      const second = service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: grace, session: sessionG }),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      release.open();
      await first;
      const answerG = await second;

      expect(answerA).toMatchObject({
        answer: 'claimed',
        lock: { holder: ada, session: sessionA },
      });
      expect(answerG).toMatchObject({
        answer: 'lock.held',
        lock: { holder: ada, session: sessionA },
      });
    });

    it('never lets an old session save land once another session has moved the lock underneath it', async () => {
      const component = await newComponent();
      const sessionA = randomUUID();
      const sessionB = randomUUID();
      await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: ada, session: sessionA }),
      );

      const moved = latch();
      const release = latch();

      let moveAnswer: Awaited<ReturnType<typeof claimLock>> | undefined;
      const move = service.withTenant(production, async (trx) => {
        moveAnswer = await claimLock(trx, {
          artifactId: component.id,
          principal: ada,
          session: sessionB,
          move: true,
        });
        moved.open();
        await release.opened;
      });
      await moved.opened;

      // The old session's save starts while the move is still open, uncommitted, and is given a
      // moment to reach its own read and write before the move is released, so the two genuinely
      // overlap in Postgres rather than merely in program order.
      let saveAnswer: Awaited<ReturnType<typeof saveIteration>> | undefined;
      const save = service.withTenant(production, async (trx) => {
        saveAnswer = await saveIteration(trx, {
          artifactId: component.id,
          principal: ada,
          session: sessionA,
          sequence: 1,
          openedFrom: component.openedFrom,
          content: content('Unbox the printer.'),
        });
      });

      await new Promise((resolve) => setTimeout(resolve, 300));
      release.open();
      await move;
      await save;

      expect(moveAnswer).toMatchObject({ answer: 'claimed', lock: { session: sessionB } });
      // Never 'accepted': the old session's write is refused once the lock has genuinely moved,
      // rather than landing after the move on a stale read of who held it.
      expect(saveAnswer).toMatchObject({
        answer: 'lock.held',
        lock: { holder: ada, session: sessionB },
      });
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
