import { randomUUID } from 'node:crypto';
import { DEFINITION_SCHEMA_VERSION } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDefinition } from './definitions.js';
import { grant } from './grants.js';
import { diverge, readLines } from './lines.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { setScope } from './scopes.js';
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
  latestVersion,
  latestVersionsOf,
  listVersions,
  recordVersion,
  substanceOf,
  type StoredVersion,
} from './versions.js';
import {
  latestRevision,
  latestRevisionsOf,
  moveArtifact,
  workflowStanding,
} from './workflow.js';
import { decideGate } from './workflow-gates.js';

describe('divergent lines (the R16 plan, R16-A to R16-D)', () => {
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
  const approve = (version: StoredVersion, line?: string) =>
    as(async (trx) => {
      const moved = await moveArtifact(trx, {
        artifactId: version.artifactId,
        kind: 'component',
        transition: 'submit',
        from: 'draft',
        by: ada,
        may: () => true,
        ...(line === undefined ? {} : { line }),
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
        ...(line === undefined ? {} : { line }),
      });
      if (passed.answer !== 'passed') throw new Error(passed.answer);
    });
  const edit = (version: StoredVersion, words: string, line?: string) =>
    as(async (trx) => {
      const substance = substanceOf(version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const next = await recordVersion(trx, {
        artifactId: version.artifactId,
        openedFrom: version.id,
        author: ada,
        ...(line === undefined ? {} : { line }),
        substance: {
          ...substance,
          content: {
            ...substance.content,
            content: [
              {
                type: 'paragraph',
                id: 'b1',
                style: 'body',
                content: [{ type: 'text', value: words, marks: [] }],
              },
            ],
          },
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
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
          values: ['us', 'eu'].map((key) => ({ key, label: key.toUpperCase() })),
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

  it('LIF-044 diverges a line from a designated revision, numbered below the main line, and leaves every main-line read on the main line', async () => {
    const first = await component('Label the drum');
    await approve(first);
    const main = await edit(first, 'Central wording');

    expect(
      await as((trx) =>
        diverge(trx, { artifactId: first.artifactId, revision: 2, name: 'US', by: ada }),
      ),
    ).toEqual({ answer: 'revision.missing' });
    const begun = await as((trx) =>
      diverge(trx, { artifactId: first.artifactId, revision: 1, name: 'US', by: ada }),
    );
    if (begun.answer !== 'diverged') throw new Error(begun.answer);
    expect(
      await as((trx) =>
        diverge(trx, { artifactId: first.artifactId, revision: 1, name: 'US', by: ada }),
      ),
    ).toEqual({ answer: 'line.name_taken' });

    // A line's first version opens from the revision it diverged from, and its versions are its own.
    const us1 = await edit(first, 'US wording', begun.line.id);
    const us2 = await edit(us1, 'US wording, again', begun.line.id);
    expect([us1.line, us1.revision, us1.version]).toEqual([begun.line.id, -1, 1]);
    expect([us2.revision, us2.version]).toEqual([-1, 2]);

    // The main line reads as it did.
    expect((await as((trx) => latestVersion(trx, first.artifactId)))?.id).toBe(main.id);
    expect((await as((trx) => latestVersionsOf(trx, [first.artifactId]))).get(first.artifactId)?.id).toBe(
      main.id,
    );
    const listed = await as((trx) => listVersions(trx, first.artifactId, { limit: 50 }));
    expect(listed.items.map((each) => each.id)).toEqual([main.id, first.id]);
    expect(await as((trx) => readLines(trx, first.artifactId))).toEqual([
      expect.objectContaining({
        name: 'US',
        divergedFrom: { revision: 1, version: first.id },
        closed: false,
      }),
    ]);
    const events = await as(async (trx) => {
      const { rows } = await sql<{ detail: Record<string, unknown> }>`
        select detail from audit_event where subject = ${first.artifactId} and kind = 'line.diverged'`.execute(
        trx,
      );
      return rows.map((row) => row.detail);
    });
    expect(events).toEqual([
      { kind: 'component', line: begun.line.id, name: 'US', from: { revision: 1, version: first.id } },
    ]);
  });

  it("LIF-044 runs a line's workflow apart: its save leaves the main line approved, and its approval takes the next revision, served in its scope", async () => {
    const first = await component('Seal the drum');
    await approve(first);
    const begun = await as((trx) =>
      diverge(trx, { artifactId: first.artifactId, revision: 1, name: 'US', by: ada }),
    );
    if (begun.answer !== 'diverged') throw new Error(begun.answer);
    const us1 = await edit(first, 'US wording', begun.line.id);
    // Saving the line leaves the main line approved; the line is a draft of its own.
    expect((await as((trx) => workflowStanding(trx, first.artifactId)))?.state.key).toBe('approved');
    expect(
      (await as((trx) => workflowStanding(trx, first.artifactId, begun.line.id)))?.state.key,
    ).toBe('draft');

    await as((trx) =>
      setScope(trx, {
        artifactId: first.artifactId,
        kind: 'component',
        scope: [{ axis: 'market', value: 'us', party: null }],
        by: ada,
        line: begun.line.id,
      }),
    );
    await approve(us1, begun.line.id);
    // The line's approval takes revision 2; the main line still counts from revision 1.
    expect((await as((trx) => latestRevision(trx, first.artifactId, begun.line.id)))?.number).toBe(2);
    expect((await as((trx) => latestRevision(trx, first.artifactId)))?.number).toBe(1);
    const main = await edit(first, 'Central wording');
    expect([main.revision, main.version]).toEqual([1, 1]);

    const served = async (market: string) =>
      (
        await as((trx) =>
          latestRevisionsOf(trx, [first.artifactId], new Date(), { market: [market] }),
        )
      ).get(first.artifactId)?.versionId;
    expect(await served('us')).toBe(us1.id);
    expect(await served('eu')).toBe(first.id);
  });
});
