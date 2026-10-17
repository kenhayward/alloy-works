import { randomUUID } from 'node:crypto';
import {
  DEFINITION_SCHEMA_VERSION,
  OUTLINE_SCHEMA_VERSION,
  parseOutlineDocument,
  type Scope,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDefinition } from './definitions.js';
import { grant } from './grants.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { resolveOccurrences } from './publishing.js';
import { findRole } from './roles.js';
import { acceptRevision, effectiveAt, readScopes, setScope } from './scopes.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';
import { recordVersion, substanceOf, type StoredVersion } from './versions.js';
import { latestRevisionsOf, moveArtifact } from './workflow.js';
import { decideGate } from './workflow-gates.js';

describe('revisions effective by scope (the R15 plan, R15-A to R15-D)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';
  let space = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, { actorKind: 'person', actor: ada });

  const component = (title: string) =>
    as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });
  const approve = (version: StoredVersion) =>
    as(async (trx) => {
      const moved = await moveArtifact(trx, {
        artifactId: version.artifactId,
        kind: 'component',
        transition: 'submit',
        from: 'draft',
        by: ada,
        may: () => true,
      });
      if (moved.answer !== 'moved') throw new Error(moved.answer);
      const passed = await decideGate(trx, {
        artifactId: version.artifactId,
        kind: 'component',
        transition: 'approve',
        version: version.id,
        decision: 'approved',
        by: grace,
        may: () => true,
      });
      if (passed.answer !== 'passed') throw new Error(passed.answer);
    });
  const edit = (version: StoredVersion) =>
    as(async (trx) => {
      const substance = substanceOf(version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const next = await recordVersion(trx, {
        artifactId: version.artifactId,
        openedFrom: version.id,
        author: ada,
        substance: {
          ...substance,
          content: {
            ...substance.content,
            content: [
              {
                type: 'paragraph',
                id: 'b1',
                style: 'body',
                content: [{ type: 'text', value: randomUUID(), marks: [] }],
              },
            ],
          },
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
    });
  const scope = (version: StoredVersion, entries: Scope) =>
    as((trx) =>
      setScope(trx, { artifactId: version.artifactId, kind: 'component', scope: entries, by: ada }),
    );
  const market = (value: string) => ({ axis: 'market', value, party: null });

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
    await service.withTenant(tenant, async (trx) => {
      space = (await createSpace(trx, `Space ${randomUUID()}`)).id;
      const person = async (name: string) =>
        (
          await trx
            .insertInto('principal')
            .values({
              issuer: 'https://idp.example',
              subject: randomUUID(),
              email: null,
              display_name: name,
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      ada = await person('Ada');
      grace = await person('Grace');
      for (const [who, role] of [
        [ada, 'Author'],
        [grace, 'Approver'],
      ] as const) {
        await grant(trx, {
          roleId: (await findRole(trx, role))!.id,
          subject: { principal: who },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        });
      }
      const axis = await createDefinition(trx, {
        kind: 'conditionAxis',
        definition: {
          schemaVersion: DEFINITION_SCHEMA_VERSION,
          name: 'Market',
          key: 'market',
          values: ['us', 'eu', 'apac'].map((key) => ({ key, label: key.toUpperCase() })),
        },
        author: ada,
      });
      if (axis.answer !== 'created') throw new Error(axis.answer);
    });
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('LIF-042 sets the values a next revision is effective for as an audited act, each declared, and fixes them as a gate designates it', async () => {
    const made = await component('Label the drum');
    expect(await scope(made, [market('mars')])).toEqual({
      answer: 'scope.unknown',
      unknown: ['market.mars'],
    });
    expect(await scope(made, [market('us')])).toMatchObject({
      answer: 'set',
      scope: { scope: [market('us')], by: ada },
    });
    expect(await scope(made, [market('us')])).toMatchObject({ answer: 'unchanged' });
    expect(
      (await as((trx) => readScopes(trx, [made.artifactId]))).get(made.artifactId)?.scope,
    ).toEqual([market('us')]);
    await approve(made);
    const events = await as(async (trx) => {
      const { rows } = await sql<{ kind: string; detail: Record<string, unknown> }>`
        select kind, detail from audit_event where subject = ${made.artifactId}
          and kind in ('scope.set', 'revision.designated') order by sequence`.execute(trx);
      return rows.map((row) => [row.kind, row.detail]);
    });
    expect(events).toEqual([
      ['scope.set', { kind: 'component', scope: [market('us')] }],
      [
        'revision.designated',
        expect.objectContaining({ revision: 1, scope: [{ axis: 'market', value: 'us' }] }),
      ],
    ]);
  });

  it('LIF-042 serves each scope the revision effective there, a reference in a document of each market among them', async () => {
    const first = await component('Seal the valve');
    await approve(first);
    const second = await edit(first);
    await scope(second, [market('us')]);
    await approve(second);
    const third = await edit(second);
    await scope(third, []);
    await approve(third);

    const revision = async (profile: Record<string, string[]>) =>
      (await as((trx) => latestRevisionsOf(trx, [first.artifactId], new Date(), profile))).get(
        first.artifactId,
      )?.versionId;
    expect(await revision({ market: ['us'] })).toBe(second.id);
    expect(await revision({ market: ['eu'] })).toBe(third.id);
    expect(await revision({})).toBe(third.id);

    const outline = (profile: Record<string, string[]> | null) =>
      parseOutlineDocument({
        schemaVersion: OUTLINE_SCHEMA_VERSION,
        title: 'Valve manual',
        language: 'en-GB',
        direction: 'ltr',
        ...(profile === null ? {} : { profile: { values: profile } }),
        nodes: [
          {
            type: 'reference',
            id: 'v'.repeat(26),
            component: first.artifactId,
            mode: { kind: 'approved' },
            numbered: true,
            matter: 'body',
            pageBreak: 'none',
            values: {},
            children: [],
          },
        ],
      });
    const served = async (profile: Record<string, string[]> | null) => {
      const [occurrence] = await as((trx) => resolveOccurrences(trx, outline(profile), ada));
      return occurrence?.outcome === 'resolved' ? occurrence.version : occurrence?.outcome;
    };
    expect(await served({ market: ['us'] })).toBe(second.id);
    expect(await served({ market: ['eu'] })).toBe(third.id);
    expect(await served(null)).toBe(third.id);
  });

  it('LIF-047 keeps the revision before effective in a scope until its party accepts, and only the party accepts', async () => {
    const first = await component('Weigh the batch');
    await approve(first);
    const second = await edit(first);
    await scope(second, [{ axis: 'market', value: 'us', party: { kind: 'principal', id: grace } }]);
    await approve(second);
    const inUs = async () =>
      (
        await as((trx) =>
          latestRevisionsOf(trx, [first.artifactId], new Date(), { market: ['us'] }),
        )
      ).get(first.artifactId)?.versionId;
    expect(await inUs()).toBe(first.id);
    const accept = (by: string, value = 'us') =>
      service.withTenant(
        tenant,
        (trx) =>
          acceptRevision(trx, {
            artifactId: first.artifactId,
            kind: 'component',
            revision: 2,
            axis: 'market',
            value,
            by,
          }),
        { actorKind: 'person', actor: by },
      );
    expect(await accept(ada)).toEqual({ answer: 'party.not' });
    expect(await accept(grace, 'eu')).toEqual({ answer: 'scope.missing' });
    expect(await accept(grace)).toEqual({ answer: 'accepted' });
    expect(await inUs()).toBe(second.id);
    expect(await accept(grace)).toEqual({ answer: 'unchanged' });
    const events = await as(async (trx) => {
      const { rows } = await sql<{ detail: Record<string, unknown> }>`
        select detail from audit_event where subject = ${first.artifactId}
          and kind = 'revision.accepted'`.execute(trx);
      return rows.map((row) => row.detail);
    });
    expect(events).toEqual([
      { kind: 'component', revision: 2, version: second.id, axis: 'market', value: 'us' },
    ]);
  });

  it('LIF-043 answers, for any scope and any instant, the one revision effective there then, and why', async () => {
    const first = await component('Clean the nozzle');
    await approve(first);
    const beforeUs = new Date();
    const second = await edit(first);
    await scope(second, [{ axis: 'market', value: 'us', party: { kind: 'principal', id: grace } }]);
    await approve(second);
    const beforeAccepted = new Date();
    await service.withTenant(
      tenant,
      (trx) =>
        acceptRevision(trx, {
          artifactId: first.artifactId,
          kind: 'component',
          revision: 2,
          axis: 'market',
          value: 'us',
          by: grace,
        }),
      { actorKind: 'person', actor: grace },
    );
    const asked = (scopeOf: { axis: string; value: string } | null, at: Date) =>
      as((trx) => effectiveAt(trx, first.artifactId, scopeOf, at));
    const us = { axis: 'market', value: 'us' };
    // Before the US revision, after it waits, and once accepted.
    expect(await asked(us, beforeUs)).toMatchObject({ revision: { number: 1 }, why: 'unscoped' });
    expect(await asked(us, beforeAccepted)).toMatchObject({
      revision: { number: 1 },
      why: 'unscoped',
    });
    expect(await asked(us, new Date())).toMatchObject({
      revision: { number: 2, versionId: second.id },
      why: 'scoped',
    });
    // Elsewhere, and with no scope asked: the newest unscoped.
    expect(await asked({ axis: 'market', value: 'eu' }, new Date())).toMatchObject({
      revision: { number: 1 },
      why: 'unscoped',
    });
    expect(await asked(null, new Date())).toMatchObject({
      revision: { number: 1 },
      why: 'unscoped',
    });
    // Before anything was approved: none.
    expect(await asked(us, new Date('2000-01-01T00:00:00Z'))).toEqual({
      revision: null,
      why: 'none',
    });
  });
});
