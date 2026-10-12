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
import { claimLock } from './editing.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { previewRestore, restoreVersion } from './restore.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import {
  createArtifact,
  latestVersion,
  readVersion,
  recordVersion,
  substanceOf,
} from './versions.js';

const identity = (id: string, name: string) =>
  ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name }) as const;

const content = (text: string): ContentDocument => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    {
      type: 'paragraph',
      id: 'b1',
      style: 'body',
      content: [{ type: 'text', value: text, marks: [] }],
    },
  ],
});

describe('restoring an earlier version of a component (storage-and-versioning.md; the RS plan)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let spaceId = '';
  let audience = '';
  let region = '';
  let schema: MetadataSchemaDefinition;
  let definitions: ReturnType<typeof definitionsFor>;

  const work = <T>(fn: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, fn);

  /** The schema's next version, with these entries. */
  const reschema = (entries: MetadataSchemaDefinition['entries']) =>
    work(async (trx) => {
      const latest = (await latestVersion(trx, schema.id))!;
      const recorded = await recordVersion(trx, {
        artifactId: schema.id,
        openedFrom: latest.id,
        author: ada,
        substance: { kind: 'metadataSchema', content: { ...schema, entries } },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
    });

  /** A component at 0.1 saying "First" for Engineers in the EU, then 0.2 saying "Second" for Nurses. */
  const component = () =>
    work(async (trx) => {
      const first = await createArtifact(trx, {
        author: ada,
        spaceId,
        substance: {
          kind: 'component',
          content: content('First'),
          values: { [audience]: 'Engineers', [region]: 'EU' },
          notCarried: [],
          definitions,
        },
      });
      const second = await recordVersion(trx, {
        artifactId: first.artifactId,
        openedFrom: first.id,
        author: ada,
        substance: {
          ...(substanceOf(first) as Extract<ReturnType<typeof substanceOf>, { kind: 'component' }>),
          content: content('Second'),
          values: { [audience]: 'Nurses', [region]: 'EU' },
        },
      });
      if (second.answer !== 'recorded') throw new Error(second.answer);
      return { first, second: second.version };
    });

  const countOf = (artifactId: string) =>
    work(async (trx) => {
      const rows = await trx
        .selectFrom('artifact_version')
        .select('id')
        .where('artifact_id', '=', artifactId)
        .execute();
      return rows.length;
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
    await work(async (trx) => {
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
      const field = (name: string): FieldDefinition => ({
        ...identity(randomUUID(), name),
        dataType: 'text',
        multiplicity: 'one',
        validation: {},
      });
      const audienceField = field('Audience');
      const regionField = field('Region');
      schema = {
        ...identity(randomUUID(), 'Publishing'),
        entries: [
          { field: audienceField.id, required: false, fixed: false },
          { field: regionField.id, required: false, fixed: false },
        ],
      };
      const type: ComponentTypeDefinition = {
        ...identity(randomUUID(), 'Procedure'),
        assignments: [{ schema: schema.id, requires: [] }],
      };
      const by = { author: ada };
      const storedAudience = await createArtifact(trx, {
        ...by,
        substance: { kind: 'field', content: audienceField },
      });
      const storedRegion = await createArtifact(trx, {
        ...by,
        substance: { kind: 'field', content: regionField },
      });
      const storedSchema = await createArtifact(trx, {
        ...by,
        substance: { kind: 'metadataSchema', content: schema },
      });
      const storedType = await createArtifact(trx, {
        ...by,
        substance: { kind: 'componentType', content: type },
      });
      audience = audienceField.id;
      region = regionField.id;
      definitions = definitionsFor(
        { version: storedType.id, definition: type },
        [{ version: storedSchema.id, definition: schema }],
        [
          { version: storedAudience.id, definition: audienceField },
          { version: storedRegion.id, definition: regionField },
        ],
      );
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('VER-032 restores as a new version with the earlier content, the earlier row untouched', async () => {
    const { first, second } = await component();
    const before = await work((trx) => readVersion(trx, first.id));
    const answer = await work((trx) =>
      restoreVersion(trx, {
        artifactId: first.artifactId,
        version: first.id,
        latest: second.id,
        by: grace,
      }),
    );
    if (answer.answer !== 'restored') throw new Error(answer.answer);
    expect(answer.version).toMatchObject({ revision: 0, version: 3, author: grace });
    expect(answer.version.content).toEqual(first.content);
    expect(answer.version.values).toEqual(first.values);
    expect(await work((trx) => readVersion(trx, first.id))).toEqual(before);
    expect(await countOf(first.artifactId)).toBe(3);
  });

  it('VER-033 records what a restored version was restored from, and the database refuses another artifact or itself', async () => {
    const { first, second } = await component();
    const other = await component();
    const answer = await work((trx) =>
      restoreVersion(trx, {
        artifactId: first.artifactId,
        version: first.id,
        latest: second.id,
        by: ada,
      }),
    );
    if (answer.answer !== 'restored') throw new Error(answer.answer);
    expect(answer.version.restoredFrom).toBe(first.id);
    expect(second.restoredFrom).toBeNull();
    // The key names a version of the same artifact; the check, never the version itself.
    const copy = (id: string, from: string) =>
      work(async (trx) => {
        await sql`
          insert into artifact_version (id, artifact_id, kind, revision_no, version_no, author_id,
            schema_version, content, content_hash, metadata_values, not_carried,
            component_type_version_id, version_digest, restored_from)
          select ${id}, artifact_id, kind, 0, 9, author_id, schema_version, content, content_hash,
            metadata_values, not_carried, component_type_version_id, version_digest, ${from}
          from artifact_version where id = ${second.id}`.execute(trx);
      });
    await expect(copy(randomUUID(), other.first.id)).rejects.toThrow(
      /artifact_version_restored_from/,
    );
    const itself = randomUUID();
    await expect(copy(itself, itself)).rejects.toThrow(/artifact_version_restored_from/);
  });

  it('VER-033 audits a restore as content.restored, naming its kind and what it came from, beside the cut', async () => {
    const { first, second } = await component();
    const answer = await work((trx) =>
      restoreVersion(trx, {
        artifactId: first.artifactId,
        version: first.id,
        latest: second.id,
        by: ada,
      }),
    );
    if (answer.answer !== 'restored') throw new Error(answer.answer);
    const events = await work((trx) =>
      trx
        .selectFrom('audit_event')
        .select(['kind', 'subject', 'subject_version', 'detail'])
        .where('subject_version', '=', answer.version.id)
        .orderBy('sequence')
        .execute(),
    );
    expect(events).toEqual([
      {
        kind: 'content.version_cut',
        subject: first.artifactId,
        subject_version: answer.version.id,
        detail: { kind: 'component', parent: second.id, author: ada },
      },
      {
        kind: 'content.restored',
        subject: first.artifactId,
        subject_version: answer.version.id,
        detail: { kind: 'component', from: first.id },
      },
    ]);
  });

  it('VER-035 previews what a restore would make, inserting nothing, as the write then makes it', async () => {
    const { first, second } = await component();
    const preview = await work((trx) =>
      previewRestore(trx, { artifactId: first.artifactId, version: first.id, by: ada }),
    );
    expect(preview).toMatchObject({
      source: { id: first.id },
      latest: { id: second.id },
      notCarried: [],
      refusals: [],
    });
    expect(await countOf(first.artifactId)).toBe(2);
    const answer = await work((trx) =>
      restoreVersion(trx, {
        artifactId: first.artifactId,
        version: first.id,
        latest: second.id,
        by: ada,
      }),
    );
    if (answer.answer !== 'restored') throw new Error(answer.answer);
    expect(answer.version.notCarried).toEqual(preview!.notCarried);
  });

  it('answers nothing for a version that is not one of the component', async () => {
    const { first } = await component();
    const other = await component();
    expect(
      await work((trx) =>
        previewRestore(trx, { artifactId: first.artifactId, version: other.first.id, by: ada }),
      ),
    ).toBeUndefined();
    expect(
      await work((trx) =>
        restoreVersion(trx, {
          artifactId: first.artifactId,
          version: other.first.id,
          latest: other.second.id,
          by: ada,
        }),
      ),
    ).toEqual({ answer: 'artifact.missing' });
  });

  it('refuses restoring what the latest already is, and a restore previewed against a version since superseded', async () => {
    const { first, second } = await component();
    const latest = await work((trx) =>
      restoreVersion(trx, {
        artifactId: first.artifactId,
        version: second.id,
        latest: second.id,
        by: ada,
      }),
    );
    expect(latest).toEqual({ answer: 'restore.unchanged' });
    const restored = await work((trx) =>
      restoreVersion(trx, {
        artifactId: first.artifactId,
        version: first.id,
        latest: second.id,
        by: ada,
      }),
    );
    if (restored.answer !== 'restored') throw new Error(restored.answer);
    // Previewed against 0.2, which is no longer the latest.
    const stale = await work((trx) =>
      restoreVersion(trx, {
        artifactId: first.artifactId,
        version: second.id,
        latest: second.id,
        by: ada,
      }),
    );
    expect(stale).toMatchObject({
      answer: 'version.precondition',
      current: { id: restored.version.id },
    });
    // And 0.1 again is what 0.3 already holds.
    expect(
      await work((trx) =>
        previewRestore(trx, { artifactId: first.artifactId, version: first.id, by: ada }),
      ),
    ).toMatchObject({ refusals: [{ answer: 'restore.unchanged' }] });
  });

  it('refuses a component somebody holds the lock on, the restorer included', async () => {
    const { first, second } = await component();
    await work((trx) =>
      claimLock(trx, { artifactId: first.artifactId, principal: ada, session: randomUUID() }),
    );
    for (const by of [ada, grace]) {
      expect(
        await work((trx) =>
          restoreVersion(trx, {
            artifactId: first.artifactId,
            version: first.id,
            latest: second.id,
            by,
          }),
        ),
      ).toMatchObject({ answer: 'restore.locked', lock: { holder: ada } });
    }
    expect(await countOf(first.artifactId)).toBe(2);
  });

  it('refuses a source that no longer reads', async () => {
    const { first, second } = await component();
    // A version whose content no reader takes, as only a fault could leave one, then a later one.
    const unreadable = await work(async (trx) => {
      const { rows } = await sql<{ id: string }>`
        insert into artifact_version (artifact_id, kind, revision_no, version_no, author_id,
          schema_version, content, content_hash, metadata_values, not_carried,
          component_type_version_id, version_digest)
        select artifact_id, kind, 0, 3, author_id, 999,
          jsonb_set(content, '{schemaVersion}', '999'), content_hash, metadata_values, not_carried,
          component_type_version_id, version_digest
        from artifact_version where id = ${second.id}
        returning id`.execute(trx);
      const id = rows[0]!.id;
      await sql`
        insert into version_definition (version_id, definition_version_id, definition_artifact_id, definition_kind)
        select ${id}, definition_version_id, definition_artifact_id, definition_kind
        from version_definition where version_id = ${second.id}`.execute(trx);
      return id;
    });
    const later = await work(async (trx) => {
      const recorded = await recordVersion(trx, {
        artifactId: first.artifactId,
        openedFrom: unreadable,
        author: ada,
        substance: { ...substanceOf(second), content: content('Third') } as ReturnType<
          typeof substanceOf
        >,
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version;
    });
    expect(
      await work((trx) =>
        restoreVersion(trx, {
          artifactId: first.artifactId,
          version: unreadable,
          latest: later.id,
          by: ada,
        }),
      ),
    ).toEqual({ answer: 'restore.unreadable' });
  });

  it('VER-035 previews each value the restore would change from the latest, as carried forward', async () => {
    const { first } = await component();
    const preview = await work((trx) =>
      previewRestore(trx, { artifactId: first.artifactId, version: first.id, by: ada }),
    );
    expect(preview!.changed).toEqual([
      { field: audience, latest: 'Nurses', restored: 'Engineers' },
    ]);
  });

  it("refuses what the caller's content checks refuse, in the preview and the write, as a save's (the RS final review)", async () => {
    const { first, second } = await component();
    const seen: [ContentDocument, string][] = [];
    const check = async (checked: ContentDocument, latest: { readonly id: string }) => {
      seen.push([checked, latest.id]);
      return { answer: 'definition.unreadable' } as const;
    };
    const asked = { artifactId: first.artifactId, version: first.id, by: grace, check };
    expect(await work((trx) => previewRestore(trx, asked))).toMatchObject({
      refusals: [{ answer: 'definition.unreadable' }],
    });
    expect(await work((trx) => restoreVersion(trx, { ...asked, latest: second.id }))).toEqual({
      answer: 'definition.unreadable',
    });
    expect(seen).toEqual([
      [first.content, second.id],
      [first.content, second.id],
    ]);
    expect(await countOf(first.artifactId)).toBe(2);
  });

  // Last: each changes the definitions every component here is cut against.
  it('MET-018 carries the earlier values forward over the definitions current now, naming what is not carried', async () => {
    const { first, second } = await component();
    await reschema([{ field: audience, required: false, fixed: false }]);
    const preview = await work((trx) =>
      previewRestore(trx, { artifactId: first.artifactId, version: first.id, by: ada }),
    );
    expect(preview).toMatchObject({ notCarried: [{ field: region, value: 'EU' }], refusals: [] });
    const answer = await work((trx) =>
      restoreVersion(trx, {
        artifactId: first.artifactId,
        version: first.id,
        latest: second.id,
        by: ada,
      }),
    );
    if (answer.answer !== 'restored') throw new Error(answer.answer);
    expect(answer.version.values).toEqual({ [audience]: 'Engineers' });
    expect(answer.version.notCarried).toEqual([{ field: region, value: 'EU' }]);
  });

  it('refuses a value a field now fixes at another, as a cut does', async () => {
    const { first, second } = await component();
    await reschema([{ field: audience, required: false, default: 'Nurses', fixed: true }]);
    const answer = await work((trx) =>
      restoreVersion(trx, {
        artifactId: first.artifactId,
        version: first.id,
        latest: second.id,
        by: ada,
      }),
    );
    expect(answer).toMatchObject({
      answer: 'values.invalid',
      failures: [{ field: audience, rule: 'fixed' }],
    });
    expect(
      await work((trx) =>
        previewRestore(trx, { artifactId: first.artifactId, version: first.id, by: ada }),
      ),
    ).toMatchObject({ refusals: [{ answer: 'values.invalid' }] });
    expect(await countOf(first.artifactId)).toBe(2);
  });
});
