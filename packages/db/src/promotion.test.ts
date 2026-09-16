// packages/db/src/promotion.test.ts
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
import { claimLock, readLock, saveIteration } from './editing.js';
import { migrate } from './migrate.js';
import { cutVersion, releaseLock } from './promotion.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { createArtifact, latestVersion } from './versions.js';

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

describe('cutting a version from an editing session, and releasing its lock', () => {
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

  const versionsOf = (artifactId: string) =>
    service.withTenant(production, async (trx) => {
      const rows = await trx
        .selectFrom('artifact_version')
        .select('id')
        .where('artifact_id', '=', artifactId)
        .execute();
      return rows.length;
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

  describe('cutting a version', () => {
    it('VER-006 cuts a version only by promoting the latest iteration, and saving iterations inserts none', async () => {
      const component = await newComponent();
      const session = randomUUID();
      const as = { artifactId: component.id, principal: ada, session };
      await service.withTenant(production, (trx) => claimLock(trx, as));
      for (const [sequence, text] of [
        [1, 'Unbox'],
        [2, 'Unbox the printer.'],
      ] as const) {
        await service.withTenant(production, (trx) =>
          saveIteration(trx, {
            ...as,
            sequence,
            openedFrom: component.openedFrom,
            content: content(text),
          }),
        );
      }
      expect(await versionsOf(component.id)).toBe(1);

      const cut = await service.withTenant(production, (trx) =>
        cutVersion(trx, { ...as, openedFrom: component.openedFrom, note: 'First draft' }),
      );
      if (cut.answer !== 'recorded') throw new Error(cut.answer);
      expect(cut.version).toMatchObject({
        revision: 0,
        version: 2,
        author: ada,
        note: 'First draft',
        content: content('Unbox the printer.'),
        values: { [audience]: 'Engineers' },
        notCarried: [],
        definitions,
      });
      expect(await versionsOf(component.id)).toBe(2);
      const kept = await service.withTenant(production, (trx) =>
        trx.selectFrom('iteration').select('id').where('artifact_id', '=', component.id).execute(),
      );
      expect(kept).toHaveLength(2);
    });

    it('answers version.unchanged when nothing was saved since the session opened, or nothing differs', async () => {
      const component = await newComponent();
      const session = randomUUID();
      const as = { artifactId: component.id, principal: ada, session };
      await service.withTenant(production, (trx) => claimLock(trx, as));
      const nothing = await service.withTenant(production, (trx) =>
        cutVersion(trx, { ...as, openedFrom: component.openedFrom }),
      );
      expect(nothing).toMatchObject({
        answer: 'version.unchanged',
        current: { id: component.openedFrom },
      });
      await service.withTenant(production, (trx) =>
        saveIteration(trx, {
          ...as,
          sequence: 1,
          openedFrom: component.openedFrom,
          content: content(''),
        }),
      );
      const same = await service.withTenant(production, (trx) =>
        cutVersion(trx, { ...as, openedFrom: component.openedFrom }),
      );
      expect(same).toMatchObject({ answer: 'version.unchanged' });
      expect(await versionsOf(component.id)).toBe(1);
    });

    it('refuses a cut from anybody but the holding session, and against a version that has moved on', async () => {
      const component = await newComponent();
      const session = randomUUID();
      await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: ada, session }),
      );
      const theirs = await service.withTenant(production, (trx) =>
        cutVersion(trx, {
          artifactId: component.id,
          principal: grace,
          session: randomUUID(),
          openedFrom: component.openedFrom,
        }),
      );
      expect(theirs).toMatchObject({ answer: 'lock.held', lock: { holder: ada } });
      const stale = await service.withTenant(production, (trx) =>
        cutVersion(trx, {
          artifactId: component.id,
          principal: ada,
          session,
          openedFrom: randomUUID(),
        }),
      );
      expect(stale).toMatchObject({
        answer: 'version.precondition',
        current: { id: component.openedFrom },
      });
    });
  });

  describe('releasing the lock', () => {
    it('COL-010 cuts a version when the lock is released deliberately, and none when it times out', async () => {
      const component = await newComponent();
      const first = randomUUID();
      const as = { artifactId: component.id, principal: ada, session: first };
      await service.withTenant(production, (trx) => claimLock(trx, as));
      await service.withTenant(production, (trx) =>
        saveIteration(trx, {
          ...as,
          sequence: 1,
          openedFrom: component.openedFrom,
          content: content('Released'),
        }),
      );
      const released = await service.withTenant(production, (trx) =>
        releaseLock(trx, { ...as, openedFrom: component.openedFrom }),
      );
      if (released.answer !== 'released' || !released.version) throw new Error('nothing cut');
      expect(released.version.content).toEqual(content('Released'));
      expect(await service.withTenant(production, (trx) => readLock(trx, component.id))).toBe(
        undefined,
      );
      expect(await versionsOf(component.id)).toBe(2);

      const second = randomUUID();
      const again = { artifactId: component.id, principal: ada, session: second };
      await service.withTenant(production, (trx) => claimLock(trx, again));
      await service.withTenant(production, (trx) =>
        saveIteration(trx, {
          ...again,
          sequence: 1,
          openedFrom: released.version!.id,
          content: content('Timed out'),
        }),
      );
      await expireLock(component.id);
      const cutAfterTimeout = await service.withTenant(production, (trx) =>
        cutVersion(trx, { ...again, openedFrom: released.version!.id }),
      );
      expect(cutAfterTimeout).toMatchObject({ answer: 'lock.required' });
      const releasedAfterTimeout = await service.withTenant(production, (trx) =>
        releaseLock(trx, { ...again, openedFrom: released.version!.id }),
      );
      expect(releasedAfterTimeout).toMatchObject({ answer: 'lock.required' });
      expect(await versionsOf(component.id)).toBe(2);

      const claimed = await service.withTenant(production, (trx) =>
        claimLock(trx, { artifactId: component.id, principal: grace, session: randomUUID() }),
      );
      expect(claimed).toMatchObject({ answer: 'claimed' });
      expect(await versionsOf(component.id)).toBe(2);
      const latest = await service.withTenant(production, (trx) =>
        latestVersion(trx, component.id),
      );
      expect(latest?.content).toEqual(content('Released'));
    });

    it('answers lock.required to a cut when nobody has ever claimed the lock', async () => {
      const component = await newComponent();
      const cut = await service.withTenant(production, (trx) =>
        cutVersion(trx, {
          artifactId: component.id,
          principal: ada,
          session: randomUUID(),
          openedFrom: component.openedFrom,
        }),
      );
      expect(cut).toMatchObject({ answer: 'lock.required' });
      expect(await versionsOf(component.id)).toBe(1);
    });

    it('releases with nothing cut when the saved iteration already matches the latest version', async () => {
      const component = await newComponent();
      const as = { artifactId: component.id, principal: ada, session: randomUUID() };
      await service.withTenant(production, (trx) => claimLock(trx, as));
      await service.withTenant(production, (trx) =>
        saveIteration(trx, {
          ...as,
          sequence: 1,
          openedFrom: component.openedFrom,
          content: content(''),
        }),
      );
      const released = await service.withTenant(production, (trx) =>
        releaseLock(trx, { ...as, openedFrom: component.openedFrom }),
      );
      expect(released).toEqual({ answer: 'released', version: null });
      expect(await service.withTenant(production, (trx) => readLock(trx, component.id))).toBe(
        undefined,
      );
      expect(await versionsOf(component.id)).toBe(1);
    });

    it('releases with nothing cut when nothing changed', async () => {
      const component = await newComponent();
      const as = { artifactId: component.id, principal: ada, session: randomUUID() };
      await service.withTenant(production, (trx) => claimLock(trx, as));
      const released = await service.withTenant(production, (trx) =>
        releaseLock(trx, { ...as, openedFrom: component.openedFrom }),
      );
      expect(released).toEqual({ answer: 'released', version: null });
      expect(await versionsOf(component.id)).toBe(1);
    });

    it('releases nothing when the cut is refused', async () => {
      const component = await newComponent();
      const as = { artifactId: component.id, principal: ada, session: randomUUID() };
      await service.withTenant(production, (trx) => claimLock(trx, as));
      const refused = await service.withTenant(production, (trx) =>
        releaseLock(trx, { ...as, openedFrom: randomUUID() }),
      );
      expect(refused).toMatchObject({ answer: 'version.precondition' });
      expect(
        await service.withTenant(production, (trx) => readLock(trx, component.id)),
      ).toMatchObject({ holder: ada });
    });
  });

  it('finds none of the lapsed holders iterations when another principal reuses its session id, and judges its own sequence alone', async () => {
    const component = await newComponent();
    const session = randomUUID();
    const adaAs = { artifactId: component.id, principal: ada, session };
    await service.withTenant(production, (trx) => claimLock(trx, adaAs));
    await service.withTenant(production, (trx) =>
      saveIteration(trx, {
        ...adaAs,
        sequence: 5,
        openedFrom: component.openedFrom,
        content: content('Ada private work'),
      }),
    );
    await expireLock(component.id);

    const graceAs = { artifactId: component.id, principal: grace, session };
    const claimed = await service.withTenant(production, (trx) => claimLock(trx, graceAs));
    expect(claimed).toMatchObject({ answer: 'claimed' });

    const cut = await service.withTenant(production, (trx) =>
      cutVersion(trx, { ...graceAs, openedFrom: component.openedFrom }),
    );
    expect(cut).toMatchObject({
      answer: 'version.unchanged',
      current: { id: component.openedFrom },
    });
    expect(await versionsOf(component.id)).toBe(1);

    const saved = await service.withTenant(production, (trx) =>
      saveIteration(trx, {
        ...graceAs,
        sequence: 1,
        openedFrom: component.openedFrom,
        content: content('Grace, first save in a reused session'),
      }),
    );
    expect(saved).toMatchObject({ answer: 'accepted', sequence: 1, repeated: false });
  });

  it('answers artifact.missing to another tenant cutting or releasing, however the component is named', async () => {
    const component = await newComponent();
    const as = { artifactId: component.id, principal: ada, session: randomUUID() };
    await service.withTenant(production, (trx) => claimLock(trx, as));
    const cut = await service.withTenant(development, (trx) =>
      cutVersion(trx, { ...as, openedFrom: component.openedFrom }),
    );
    const released = await service.withTenant(development, (trx) =>
      releaseLock(trx, { ...as, openedFrom: component.openedFrom }),
    );
    expect([cut, released]).toEqual([
      { answer: 'artifact.missing' },
      { answer: 'artifact.missing' },
    ]);
    expect(await versionsOf(component.id)).toBe(1);
  });
});
