import { randomUUID } from 'node:crypto';
import { DEFINITION_SCHEMA_VERSION } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDefinition, recordDefinitionVersion } from './definitions.js';
import { createDocument } from './documents.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import {
  changeRelationship,
  makeRelationship,
  readRelationship,
  removeRelationship,
} from './relationships.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  auditEvents,
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

describe('relationships (the R8 plan, R8-A to R8-E)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let general = '';
  /** The Basis field and the Grounds schema requiring it, which a type may assign. */
  let field = '';
  let schema = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  const type = async (over: Record<string, unknown> = {}) => {
    const made = await as((trx) =>
      createDefinition(trx, {
        kind: 'relationshipType',
        definition: {
          schemaVersion: DEFINITION_SCHEMA_VERSION,
          name: `Supersedes ${randomUUID().slice(0, 8)}`,
          inverseName: 'Superseded by',
          directed: true,
          from: { kinds: ['document'], cardinality: 'many', permission: 'edit' },
          to: { kinds: ['document'], cardinality: 'many', permission: 'read' },
          selfReference: false,
          acyclic: false,
          informational: true,
          schemas: [],
          ...over,
        },
        author: ada,
      }),
    );
    if (made.answer !== 'created') throw new Error(made.answer);
    return made.definition;
  };
  const document = () =>
    as(async (trx) => {
      const made = await createDocument(trx, {
        spaceId: general,
        title: 'Procedure',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });
  const component = () =>
    as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: general,
        title: 'Step',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });
  const lastSequence = () => as(async (trx) => (await auditEvents(trx)).at(-1)?.sequence ?? '0');
  const relate = (
    typeId: string,
    from: string,
    to: string,
    extra: { values?: Record<string, unknown>; fromVersion?: string } = {},
  ) =>
    as((trx) =>
      makeRelationship(trx, {
        by: ada,
        type: typeId,
        from: { artifact: from, version: extra.fromVersion ?? null },
        to: { artifact: to },
        ...(extra.values ? { values: extra.values } : {}),
      }),
    );

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
    await as(async (trx) => {
      ada = (
        await trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'ada',
            email: null,
            display_name: 'Ada',
          })
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
    const basis = await as((trx) =>
      createDefinition(trx, {
        kind: 'field',
        definition: {
          schemaVersion: DEFINITION_SCHEMA_VERSION,
          name: 'Basis',
          dataType: 'text',
          multiplicity: 'one',
          validation: {},
        },
        author: ada,
      }),
    );
    if (basis.answer !== 'created') throw new Error(basis.answer);
    field = basis.definition.id;
    const grounds = await as((trx) =>
      createDefinition(trx, {
        kind: 'metadataSchema',
        definition: {
          schemaVersion: DEFINITION_SCHEMA_VERSION,
          name: 'Grounds',
          entries: [{ field, required: true, fixed: false }],
        },
        author: ada,
      }),
    );
    if (grounds.answer !== 'created') throw new Error(grounds.answer);
    schema = grounds.definition.id;
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('REL-001 REL-008 REL-013 REL-043 relates two artifacts by a declared type, each end pinned or floating, and refuses a kind it does not permit', async () => {
    const supersedes = await type();
    const [older, newer] = [await document(), await document()];
    const made = await relate(supersedes.id, newer.artifactId, older.artifactId, {
      fromVersion: newer.id,
    });
    if (made.answer !== 'made') throw new Error(made.answer);
    expect(made.relationship).toMatchObject({
      type: supersedes.id,
      from: { artifact: newer.artifactId, kind: 'document', version: newer.id },
      to: { artifact: older.artifactId, kind: 'document', version: null },
    });
    expect(await relate(randomUUID(), newer.artifactId, older.artifactId)).toEqual({
      answer: 'type.missing',
    });
    const step = await component();
    expect(await relate(supersedes.id, newer.artifactId, step.artifactId)).toEqual({
      answer: 'end.refused',
      refusal: { refused: 'kind', end: 'to', kind: 'component' },
    });
    // A version is pinned only from its own artifact.
    expect(
      await relate(supersedes.id, newer.artifactId, older.artifactId, { fromVersion: older.id }),
    ).toEqual({ answer: 'version.foreign', end: 'from' });
  });

  it('REL-045 REL-046 refuses an artifact related to itself, and a relationship closing a cycle where the type is acyclic', async () => {
    const supersedes = await type({ acyclic: true });
    const [a, b, c] = [await document(), await document(), await document()];
    expect(await relate(supersedes.id, a.artifactId, a.artifactId)).toEqual({
      answer: 'end.refused',
      refusal: { refused: 'self' },
    });
    expect((await relate(supersedes.id, a.artifactId, b.artifactId)).answer).toBe('made');
    expect((await relate(supersedes.id, b.artifactId, c.artifactId)).answer).toBe('made');
    expect(await relate(supersedes.id, c.artifactId, a.artifactId)).toEqual({ answer: 'cycle' });
  });

  it('REL-012 REL-042 REL-049 holds one relationship per end where its cardinality is one, two asked at once included', async () => {
    const supersedes = await type({
      from: { kinds: ['document'], cardinality: 'one', permission: 'edit' },
    });
    const [newer, a, b] = [await document(), await document(), await document()];
    const both = await Promise.all([
      relate(supersedes.id, newer.artifactId, a.artifactId),
      relate(supersedes.id, newer.artifactId, b.artifactId),
    ]);
    expect(both.map((each) => each.answer).sort()).toEqual(['cardinality.full', 'made']);
  });

  it('REL-010 REL-053 carries the fields its type assigns, checked when it is made', async () => {
    const grounded = await type({ schemas: [{ schema, requires: [] }] });
    const [a, b] = [await document(), await document()];
    const missing = await relate(grounded.id, a.artifactId, b.artifactId);
    expect(missing).toMatchObject({
      answer: 'values.invalid',
      failures: [{ field, rule: 'required' }],
    });
    const made = await relate(grounded.id, a.artifactId, b.artifactId, {
      values: { [field]: 'Revised dosing' },
    });
    expect(made).toMatchObject({
      answer: 'made',
      relationship: { values: { [field]: 'Revised dosing' } },
    });
  });

  it('REL-011 REL-033 REL-034 changes a relationship as it was made, re-targeted and re-pinned, and removes it, each recorded', async () => {
    const supersedes = await type({ acyclic: true });
    const [a, b, c] = [await document(), await document(), await document()];
    const before = await lastSequence();
    const made = await relate(supersedes.id, a.artifactId, b.artifactId);
    if (made.answer !== 'made') throw new Error(made.answer);
    await relate(supersedes.id, c.artifactId, a.artifactId);
    // Re-targeted to close a cycle: refused as creating it would be.
    expect(
      await as((trx) =>
        changeRelationship(trx, { id: made.relationship.id, to: { artifact: c.artifactId } }),
      ),
    ).toEqual({ answer: 'cycle' });
    const repinned = await as((trx) =>
      changeRelationship(trx, {
        id: made.relationship.id,
        to: { artifact: b.artifactId, version: b.id },
      }),
    );
    expect(repinned).toMatchObject({ answer: 'changed', relationship: { to: { version: b.id } } });
    expect(await as((trx) => removeRelationship(trx, made.relationship.id))).toEqual({
      answer: 'removed',
    });
    expect(await as((trx) => readRelationship(trx, made.relationship.id))).toBeUndefined();
    const recorded = (await as((trx) => auditEvents(trx, before)))
      .filter(
        (each) => (each.detail as { relationship?: string }).relationship === made.relationship.id,
      )
      .map((each) => each.kind);
    expect(recorded).toEqual(['relationship.made', 'relationship.changed', 'relationship.removed']);
  });

  it('REL-037 REL-038 REL-054 renames a type without touching its relationships, deprecates it, and refuses a change that would break them, counted', async () => {
    const supersedes = await type();
    const [a, b] = [await document(), await document()];
    const held = await relate(supersedes.id, a.artifactId, b.artifactId);
    if (held.answer !== 'made') throw new Error(held.answer);
    const next = (over: Record<string, unknown>) =>
      as((trx) =>
        recordDefinitionVersion(trx, {
          id: supersedes.id,
          openedFrom: supersedes.version.id,
          definition: {
            schemaVersion: DEFINITION_SCHEMA_VERSION,
            name: 'Replaces',
            inverseName: 'Replaced by',
            directed: true,
            from: { kinds: ['document'], cardinality: 'many', permission: 'edit' },
            to: { kinds: ['document'], cardinality: 'many', permission: 'read' },
            selfReference: false,
            acyclic: false,
            informational: true,
            schemas: [],
            ...over,
          },
          author: ada,
        }),
      );
    expect(
      await next({ to: { kinds: ['component'], cardinality: 'many', permission: 'read' } }),
    ).toMatchObject({
      answer: 'definition.invalid',
      failures: [{ detail: '1 relationship of this type would become invalid' }],
    });
    const renamed = await next({ deprecated: {} });
    expect(renamed.answer).toBe('recorded');
    // Renamed, its identifier unchanged: the relationship holding it is as it was.
    expect(await as((trx) => readRelationship(trx, held.relationship.id))).toEqual(
      held.relationship,
    );
    // Still valid where held, and offered for no new relationship.
    const [c, d] = [await document(), await document()];
    expect(await relate(supersedes.id, c.artifactId, d.artifactId)).toEqual({
      answer: 'end.refused',
      refusal: { refused: 'deprecated' },
    });
  });
});
