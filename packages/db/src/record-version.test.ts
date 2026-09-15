import { randomUUID } from 'node:crypto';
import {
  DEFINITION_SCHEMA_VERSION,
  type ComponentSubstance,
  type FieldDefinition,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import {
  createArtifact,
  latestVersion,
  readVersion,
  recordVersion,
  type NextVersion,
  type StoredVersion,
} from './versions.js';

const content = (title: string): ComponentSubstance['content'] => ({
  schemaVersion: 1,
  title,
  language: 'en-GB',
  direction: 'ltr',
  content: [{ type: 'paragraph', id: 'b1', style: 'body', content: [] }],
});

describe('recording the next version', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let grace: string;
  let spaceId: string;
  let definitions: ComponentSubstance['definitions'];

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
    // More than one connection, so two cuts can be in flight at once.
    service = createTenantDatabase(db.serviceUrl, { max: 4 });

    ({ ada, grace, spaceId, definitions } = await service.withTenant(production, async (trx) => {
      const [first, second] = await trx
        .insertInto('principal')
        .values([
          { issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' },
          { issuer: 'https://idp.example', subject: 'grace', email: null, display_name: 'Grace' },
        ])
        .returning('id')
        .execute();
      const type = await createArtifact(trx, {
        author: first!.id,
        substance: {
          kind: 'componentType',
          content: {
            schemaVersion: DEFINITION_SCHEMA_VERSION,
            id: randomUUID(),
            name: 'Protocol',
            assignments: [],
          },
        },
      });
      return {
        ada: first!.id,
        grace: second!.id,
        spaceId: (await createSpace(trx, 'Clinical')).id,
        definitions: [{ kind: 'componentType' as const, id: type.artifactId, version: type.id }],
      };
    }));
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const substance = (overrides: Partial<ComponentSubstance> = {}): ComponentSubstance => ({
    kind: 'component',
    content: content('Dosing'),
    values: { 'field-study': 'S-1' },
    notCarried: [],
    definitions,
    ...overrides,
  });

  const created = () =>
    service.withTenant(production, (trx) =>
      createArtifact(trx, { author: ada, spaceId, substance: substance() }),
    );

  const record = (tenant: Tenant, input: NextVersion) =>
    service.withTenant(tenant, (trx) => recordVersion(trx, input));

  const next = (from: StoredVersion, overrides: Partial<NextVersion> = {}): NextVersion => ({
    artifactId: from.artifactId,
    openedFrom: from.id,
    author: ada,
    substance: substance(),
    ...overrides,
  });

  it('VER-008 corrects a version by recording another, numbered next, and leaves the first as it was', async () => {
    const first = await created();
    const answer = await record(
      production,
      next(first, { substance: substance({ content: content('Dosing, corrected') }) }),
    );

    expect(answer).toMatchObject({ answer: 'recorded', version: { revision: 0, version: 2 } });
    await service.withTenant(production, async (trx) => {
      expect(await readVersion(trx, first.id)).toEqual(first);
      expect((await latestVersion(trx, first.artifactId))?.content).toMatchObject({
        title: 'Dosing, corrected',
      });
    });
  });

  it('answers version.unchanged when the version says nothing new, whoever cuts it and whatever they note', async () => {
    const first = await created();
    const answer = await record(production, next(first, { author: grace, note: 'No change' }));

    expect(answer).toEqual({ answer: 'version.unchanged', current: first });
    await service.withTenant(production, async (trx) => {
      expect(await latestVersion(trx, first.artifactId)).toEqual(first);
    });
  });

  it('records a version when only a metadata value changed, keeping the content hash', async () => {
    const first = await created();
    const answer = await record(
      production,
      next(first, { substance: substance({ values: { 'field-study': 'S-2' } }) }),
    );

    if (answer.answer !== 'recorded') throw new Error(`Expected a version, got ${answer.answer}`);
    expect(answer.version.contentHash).toBe(first.contentHash);
    expect(answer.version.versionDigest).not.toBe(first.versionDigest);
    expect(answer.version.values).toEqual({ 'field-study': 'S-2' });
  });

  it('records a version when only the values it did not carry changed', async () => {
    const first = await created();
    const answer = await record(
      production,
      next(first, {
        substance: substance({ notCarried: [{ field: 'field-old', value: 'Leeds' }] }),
      }),
    );
    expect(answer).toMatchObject({
      answer: 'recorded',
      version: { notCarried: [{ field: 'field-old', value: 'Leeds' }] },
    });
  });

  it('answers version.precondition, naming the current version, when it is not the one opened from', async () => {
    const first = await created();
    const second = await record(
      production,
      next(first, { substance: substance({ content: content('Dosing, second') }) }),
    );
    if (second.answer !== 'recorded') throw new Error(`Expected a version, got ${second.answer}`);

    // Stale, and saying nothing new against the version it opened from: the precondition comes first.
    const answer = await record(production, next(first));
    expect(answer).toEqual({ answer: 'version.precondition', current: second.version });
  });

  it('lets two cuts from one version take turns: one is recorded, the other told what is current', async () => {
    const first = await created();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));

    const winner = service.withTenant(production, async (trx) => {
      const answer = await recordVersion(
        trx,
        next(first, { substance: substance({ content: content('Dosing, Ada') }) }),
      );
      await held;
      return answer;
    });
    // Give the first cut time to take the lock and insert, then start the second behind it.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const loser = record(
      production,
      next(first, { author: grace, substance: substance({ content: content('Dosing, Grace') }) }),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();

    const [won, lost] = await Promise.all([winner, loser]);
    if (won.answer !== 'recorded') throw new Error(`Expected a version, got ${won.answer}`);
    expect(lost).toEqual({ answer: 'version.precondition', current: won.version });
  });

  it('records the next version of a definition, which keeps the identity it was created with', async () => {
    const id = randomUUID();
    const field = (name: string): FieldDefinition => ({
      schemaVersion: DEFINITION_SCHEMA_VERSION,
      id,
      name,
      dataType: 'text',
      multiplicity: 'one',
      validation: {},
    });
    const first = await service.withTenant(production, (trx) =>
      createArtifact(trx, { author: ada, substance: { kind: 'field', content: field('Site') } }),
    );

    expect(
      await record(
        production,
        next(first, { substance: { kind: 'field', content: field('Sites') } }),
      ),
    ).toMatchObject({ answer: 'recorded', version: { kind: 'field', version: 2 } });

    const current = await service.withTenant(production, (trx) => latestVersion(trx, id));
    await expect(
      record(production, {
        ...next(current!),
        substance: { kind: 'field', content: { ...field('Other'), id: randomUUID() } },
      }),
    ).rejects.toThrow(/cannot carry the identity/);
  });

  it('refuses a substance of another kind than its artifact', async () => {
    const first = await created();
    await expect(
      record(production, {
        ...next(first),
        substance: {
          kind: 'field',
          content: {
            schemaVersion: DEFINITION_SCHEMA_VERSION,
            id: first.artifactId,
            name: 'Site',
            dataType: 'text',
            multiplicity: 'one',
            validation: {},
          },
        },
      }),
    ).rejects.toThrow(/is a component, not a field/);
  });

  it('answers artifact.missing for an artifact this tenant does not hold', async () => {
    expect(
      await record(production, { ...next(await created()), artifactId: randomUUID() }),
    ).toEqual({
      answer: 'artifact.missing',
    });
    expect(await record(production, { ...next(await created()), artifactId: 'nothing' })).toEqual({
      answer: 'artifact.missing',
    });
  });

  it("cannot record a version of another tenant's artifact, and leaves that artifact alone", async () => {
    const theirs = await created();
    const answer = await record(
      development,
      next(theirs, { substance: substance({ content: content('Dosing, from elsewhere') }) }),
    );

    expect(answer).toEqual({ answer: 'artifact.missing' });
    await service.withTenant(production, async (trx) => {
      expect(await latestVersion(trx, theirs.artifactId)).toEqual(theirs);
    });
  });
});
