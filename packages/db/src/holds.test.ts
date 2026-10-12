import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDocument } from './documents.js';
import { isHeld, listHolds, placeHold, releaseHold } from './holds.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import { publish } from './testing/every-kind.js';
import { createArtifact } from './versions.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const ISSUER = 'https://idp.example';

describe('legal holds (lifecycle.md; the AH plan, AH-E to AH-H)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  /** A space of its own, Grace to hold things in it, and a component and a document in it. */
  const fresh = () =>
    as(async (trx) => {
      const space = (await createSpace(trx, `Space ${randomUUID()}`)).id;
      const grace = (
        await trx
          .insertInto('principal')
          .values({ issuer: ISSUER, subject: randomUUID(), email: null, display_name: 'Grace' })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
      const input = { spaceId: space, language: 'en-GB', direction: 'ltr', author: grace } as const;
      const component = await createComponent(trx, { ...input, title: 'Held procedure' });
      const document = await createDocument(trx, { ...input, title: 'Held manual' });
      if (component.answer !== 'created' || document.answer !== 'created') throw new Error('made');
      return {
        space,
        grace,
        component: component.version.artifactId,
        document: document.version.artifactId,
      };
    });

  const holds = () => as((trx) => listHolds(trx, { limit: 100 }));

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
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('LIF-022 records a hold with who placed it, when and why, and lists it in force', async () => {
    const { grace, component } = await fresh();
    const before = Date.now();
    const placed = await as((trx) =>
      placeHold(trx, { target: { artifact: component }, reason: '  Matter 2026-14  ', by: grace }),
    );
    if (placed.answer !== 'placed') throw new Error(placed.answer);
    expect(await as((trx) => isHeld(trx, component))).toBe(true);
    const listed = (await holds()).items.find((each) => each.id === placed.id)!;
    expect(listed).toMatchObject({
      target: { kind: 'component', id: component, title: 'Held procedure' },
      reason: 'Matter 2026-14',
      appliedBy: { id: grace, name: 'Grace' },
      released: null,
    });
    expect(listed.appliedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('LIF-022 releases a hold only with a reason, records who and when, and only once', async () => {
    const { grace, document } = await fresh();
    const placed = await as((trx) =>
      placeHold(trx, { target: { artifact: document }, reason: 'Audit request', by: grace }),
    );
    if (placed.answer !== 'placed') throw new Error(placed.answer);
    const release = (reason: string) =>
      as((trx) => releaseHold(trx, { hold: placed.id, reason, by: grace }));
    expect(await release('   ')).toEqual({ answer: 'reason.invalid' });
    expect(await as((trx) => isHeld(trx, document))).toBe(true);
    expect(await release('Matter closed')).toEqual({ answer: 'released' });
    expect(await release('Matter closed again')).toEqual({ answer: 'hold.released' });
    expect(
      await as((trx) => releaseHold(trx, { hold: randomUUID(), reason: 'Nothing', by: grace })),
    ).toEqual({ answer: 'hold.missing' });
    const listed = (await holds()).items.find((each) => each.id === placed.id)!;
    expect(listed.released).toMatchObject({
      reason: 'Matter closed',
      by: { id: grace, name: 'Grace' },
    });
    // A released hold no longer holds.
    expect(await as((trx) => isHeld(trx, document))).toBe(false);
  });

  it("LIF-022 holds every artifact in a space by the space's hold, and several holds may stand", async () => {
    const { space, grace, component, document } = await fresh();
    const onSpace = await as((trx) =>
      placeHold(trx, { target: { space }, reason: 'Whole space', by: grace }),
    );
    const onComponent = await as((trx) =>
      placeHold(trx, { target: { artifact: component }, reason: 'This one too', by: grace }),
    );
    if (onSpace.answer !== 'placed' || onComponent.answer !== 'placed') throw new Error('placed');
    expect(await as((trx) => isHeld(trx, document))).toBe(true);
    expect(await as((trx) => isHeld(trx, component))).toBe(true);
    await as((trx) => releaseHold(trx, { hold: onSpace.id, reason: 'Space done', by: grace }));
    expect(await as((trx) => isHeld(trx, document))).toBe(false);
    // Its own hold still stands.
    expect(await as((trx) => isHeld(trx, component))).toBe(true);
    const listed = (await holds()).items.find((each) => each.id === onSpace.id)!;
    expect(listed.target).toMatchObject({ kind: 'space', id: space });
  });

  it('refuses a reason that is empty, and a target that is not there or not held', async () => {
    const { grace, component } = await fresh();
    const place = (target: { artifact: string } | { space: string }, reason = 'A matter') =>
      as((trx) => placeHold(trx, { target, reason, by: grace }));
    expect(await place({ artifact: component }, ' ')).toEqual({ answer: 'reason.invalid' });
    expect(await place({ artifact: component }, 'x'.repeat(2001))).toEqual({
      answer: 'reason.invalid',
    });
    expect(await place({ artifact: randomUUID() })).toEqual({ answer: 'target.missing' });
    expect(await place({ space: randomUUID() })).toEqual({ answer: 'target.missing' });
    expect(await place({ artifact: 'not-an-id' })).toEqual({ answer: 'target.missing' });
    // A definition is not a record a matter holds.
    const definition = await as(async (trx) =>
      trx
        .selectFrom('artifact')
        .select('id')
        .where('kind', '=', 'componentType')
        .limit(1)
        .executeTakeFirstOrThrow(),
    );
    expect(await place({ artifact: definition.id })).toEqual({ answer: 'target.missing' });
  });

  it('LIF-057 records hold.applied and hold.removed about what it holds, without the reason', async () => {
    const { space, grace, component } = await fresh();
    const onComponent = await as((trx) =>
      placeHold(trx, { target: { artifact: component }, reason: 'Secret matter', by: grace }),
    );
    const onSpace = await as((trx) =>
      placeHold(trx, { target: { space }, reason: 'Secret matter', by: grace }),
    );
    if (onComponent.answer !== 'placed' || onSpace.answer !== 'placed') throw new Error('placed');
    await as((trx) =>
      releaseHold(trx, { hold: onComponent.id, reason: 'Secret release', by: grace }),
    );
    const events = await as(async (trx) => {
      const { rows } = await sql<{
        kind: string;
        subject_kind: string;
        subject: string;
        space: string;
        detail: unknown;
      }>`select kind, subject_kind, subject, space, detail from audit_event
          where kind like 'hold.%' and (subject = ${component} or subject = ${space})
          order by sequence`.execute(trx);
      return rows;
    });
    expect(events).toEqual([
      {
        kind: 'hold.applied',
        subject_kind: 'component',
        subject: component,
        space,
        detail: { hold: onComponent.id },
      },
      {
        kind: 'hold.applied',
        subject_kind: 'space',
        subject: space,
        space,
        detail: { hold: onSpace.id },
      },
      {
        kind: 'hold.removed',
        subject_kind: 'component',
        subject: component,
        space,
        detail: { hold: onComponent.id },
      },
    ]);
    const logged = await as(async (trx) => {
      const { rows } = await sql<{ text: string }>`
        select e.detail::text || ' ' || coalesce(string_agg(l.text, ' '), '') as text
        from audit_event e left join audit_label l on l.sequence = e.sequence
        where e.kind like 'hold.%' group by e.sequence, e.detail`.execute(trx);
      return rows.map((row) => row.text).join(' ');
    });
    expect(logged).not.toMatch(/Secret/);
  });

  it('LIF-057 names a held publication and asset by title and space, in the log and the listing', async () => {
    const { space, grace } = await fresh();
    const made = await as(async (trx) => {
      const input = { spaceId: space, language: 'en-GB', direction: 'ltr', author: grace } as const;
      const document = await createDocument(trx, { ...input, title: 'Published manual' });
      if (document.answer !== 'created') throw new Error(document.answer);
      const publication = await publish(trx, {
        document: document.version,
        author: grace,
        role: tenant.role,
      });
      const asset = await createArtifact(trx, {
        author: grace,
        spaceId: space,
        substance: {
          kind: 'asset',
          content: {
            schemaVersion: 1,
            object: `${tenant.role}/sha256/${'d'.repeat(64)}`,
            format: 'png',
            bytes: 10,
            width: 1,
            height: 1,
            orientation: 1,
            colour: 'rgb',
            alpha: false,
            depth: 8,
            resolution: null,
            alternative: { text: 'A heron in reeds', language: 'en' },
          },
        },
      });
      return { publication, asset: asset.artifactId };
    });
    const spaceName = await as(
      async (trx) =>
        (
          await trx
            .selectFrom('space')
            .select('name')
            .where('id', '=', space)
            .executeTakeFirstOrThrow()
        ).name,
    );
    for (const [artifact, kind, title] of [
      [made.publication, 'publication', 'Published manual'],
      [made.asset, 'asset', 'A heron in reeds'],
    ] as const) {
      const placed = await as((trx) =>
        placeHold(trx, { target: { artifact }, reason: 'A matter', by: grace }),
      );
      if (placed.answer !== 'placed') throw new Error(placed.answer);
      await as((trx) => releaseHold(trx, { hold: placed.id, reason: 'Closed', by: grace }));
      const listed = (await holds()).items.find((each) => each.id === placed.id)!;
      expect(listed.target).toEqual({ kind, id: artifact, title });
      const events = await as(async (trx) => {
        const { rows } = await sql<{
          kind: string;
          subject_kind: string;
          space: string | null;
          labels: unknown;
        }>`
          select e.kind, e.subject_kind, e.space,
            (select jsonb_object_agg(l.role, l.text) from audit_label l where l.sequence = e.sequence) as labels
          from audit_event e where e.kind like 'hold.%' and e.subject = ${artifact}
          order by e.sequence`.execute(trx);
        return rows;
      });
      expect(events).toEqual(
        ['hold.applied', 'hold.removed'].map((each) => ({
          kind: each,
          subject_kind: kind,
          space,
          labels: { subject: title, space: spaceName },
        })),
      );
    }
  });

  it('refuses at the store a change to a hold, a second release, and a hold on two things', async () => {
    const { space, grace, component } = await fresh();
    const placed = await as((trx) =>
      placeHold(trx, { target: { artifact: component }, reason: 'Guarded', by: grace }),
    );
    if (placed.answer !== 'placed') throw new Error(placed.answer);
    await expect(
      as((trx) => sql`update legal_hold set reason = 'Changed'`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    await expect(as((trx) => sql`delete from legal_hold`.execute(trx))).rejects.toThrow(
      /permission denied/,
    );
    await as((trx) => releaseHold(trx, { hold: placed.id, reason: 'Done', by: grace }));
    await expect(
      as((trx) =>
        trx
          .insertInto('legal_hold_release')
          .values({ hold_id: placed.id, reason: 'Again', released_by: grace })
          .execute(),
      ),
    ).rejects.toThrow(/legal_hold_release/);
    await expect(as((trx) => sql`delete from legal_hold_release`.execute(trx))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      as((trx) =>
        trx
          .insertInto('legal_hold')
          .values({
            artifact_id: component,
            kind: 'component',
            space_id: space,
            reason: 'Both',
            applied_by: grace,
          })
          .execute(),
      ),
    ).rejects.toThrow(/legal_hold_one_target/);
  });

  it('two releases at once record one between them', async () => {
    const { grace, component } = await fresh();
    const placed = await as((trx) =>
      placeHold(trx, { target: { artifact: component }, reason: 'Raced', by: grace }),
    );
    if (placed.answer !== 'placed') throw new Error(placed.answer);
    const answers = await Promise.all(
      ['First', 'Second'].map((reason) =>
        as((trx) => releaseHold(trx, { hold: placed.id, reason, by: grace })),
      ),
    );
    expect(answers.map((each) => each.answer).sort()).toEqual(['hold.released', 'released']);
  });

  it('pages the holds newest first, by their cursor', async () => {
    const { grace, component, document } = await fresh();
    for (const artifact of [component, document]) {
      await as((trx) => placeHold(trx, { target: { artifact }, reason: 'Paged', by: grace }));
    }
    const whole = (await holds()).items.map((each) => each.id);
    const walked: string[] = [];
    let after: string | undefined;
    do {
      const page = await as((trx) =>
        listHolds(trx, { limit: 1, ...(after === undefined ? {} : { after }) }),
      );
      walked.push(...page.items.map((each) => each.id));
      after = page.after ?? undefined;
    } while (after !== undefined);
    expect(walked).toEqual(whole);
    const times = (await holds()).items.map((each) => each.appliedAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});
