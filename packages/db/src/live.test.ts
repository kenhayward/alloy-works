import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findRole } from './roles.js';
import { bootstrapCluster } from './bootstrap.js';
import { createComponent } from './creation.js';
import { createDocument } from './documents.js';
import { claimLock } from './editing.js';
import { grant } from './grants.js';
import {
  beatPresence,
  leavePresence,
  locksShown,
  presenceShown,
  streamScope,
  sweepPresence,
} from './live.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { listenToTenants, type TenantEvent, type TenantListener } from './realtime.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const SESSION = '11111111-1111-4111-8111-111111111111';

describe("what a document's stream hears, said by the database (the PL plan)", () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let listener: TenantListener;
  let tenant: Tenant;
  let ada = '';
  let grace = '';
  let general = '';
  let restricted = '';

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
    listener = listenToTenants(db.serviceUrl);
    ({ ada, grace, general, restricted } = await service.withTenant(tenant, async (trx) => {
      const person = (name: string) =>
        trx
          .insertInto('principal')
          .values({ issuer: 'https://idp.example', subject: name, email: null, display_name: name })
          .returning('id')
          .executeTakeFirstOrThrow();
      const adaRow = await person('Ada');
      const graceRow = await person('Grace');
      const generalRow = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      const restrictedSpace = await createSpace(trx, 'Restricted');
      // Ada reads everywhere; Grace reads General alone.
      const reader = (await findRole(trx, 'Reader'))!.id;
      await grant(trx, {
        roleId: reader,
        subject: { principal: adaRow.id },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: adaRow.id,
      });
      await grant(trx, {
        roleId: reader,
        subject: { principal: graceRow.id },
        level: { kind: 'space', id: generalRow.id },
        effect: 'allow',
        grantedBy: adaRow.id,
      });
      return {
        ada: adaRow.id,
        grace: graceRow.id,
        general: generalRow.id,
        restricted: restrictedSpace.id,
      };
    }));
  }, 120_000);

  afterAll(async () => {
    await listener.close();
    await service.close();
    await db.drop();
  });

  /** Everything the tenant's channel says while `act` runs, once it has been heard. */
  async function heard(act: () => Promise<unknown>): Promise<TenantEvent[]> {
    const said: TenantEvent[] = [];
    const subscription = listener.subscribe(tenant.id, (event) => said.push(event));
    await subscription.ready;
    await act();
    // A notification is delivered after its commit; one more round trip lets it arrive.
    await service.withTenant(tenant, (trx) => sql`select 1`.execute(trx));
    await new Promise((resolve) => setTimeout(resolve, 100));
    subscription.stop();
    return said;
  }

  const component = (trx: TenantTransaction, spaceId: string, title: string) =>
    createComponent(trx, { spaceId, title, language: 'en-GB', direction: 'ltr', author: ada }).then(
      (made) => {
        if (made.answer !== 'created') throw new Error(made.answer);
        return made.version.artifactId;
      },
    );

  it('IAM-045 says a person present from outside the organisation is from outside it (the R13 plan, R13-A)', async () => {
    const { eve, here } = await service.withTenant(tenant, async (trx) => {
      const row = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: 'eve',
          email: null,
          display_name: 'Eve',
          kind: 'external',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const made = await createDocument(trx, {
        spaceId: general,
        title: 'Who is here',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return { eve: row.id, here: made.version.artifactId };
    });
    await service.withTenant(tenant, async (trx) => {
      for (const who of [ada, eve]) {
        await beatPresence(trx, {
          viewer:
            who === ada
              ? '44444444-4444-4444-8444-444444444444'
              : '55555555-5555-4555-8555-555555555555',
          principalId: who,
          document: here,
          component: null,
          mode: 'author',
        });
      }
    });
    const shown = await service.withTenant(tenant, (trx) => presenceShown(trx, here, new Set()));
    expect(shown.map((each) => each.person)).toEqual([
      { id: ada, name: 'Ada' },
      { id: eve, name: 'Eve', external: true },
    ]);
  });

  it('says a lock claimed, moved on by a minute and released, and not one moved within its minute', async () => {
    const id = await service.withTenant(tenant, (trx) => component(trx, general, 'Dosing'));
    expect(
      await heard(() =>
        service.withTenant(tenant, (trx) =>
          claimLock(trx, { artifactId: id, principal: ada, session: SESSION }),
        ),
      ),
    ).toContainEqual({ kind: 'lock', component: id });

    const moved = (by: string) =>
      heard(() =>
        service.withTenant(tenant, (trx) =>
          sql`update component_lock set expires_at = ${sql.raw(by)} where artifact_id = ${id}`.execute(
            trx,
          ),
        ),
      );
    // Within its minute: the expected release a viewer reads is unchanged.
    expect(await moved("date_trunc('minute', expires_at) + interval '1 second'")).toEqual([]);
    expect(await moved("expires_at + interval '2 minutes'")).toEqual([
      { kind: 'lock', component: id },
    ]);
    expect(
      await heard(() =>
        service.withTenant(tenant, (trx) =>
          trx.deleteFrom('component_lock').where('artifact_id', '=', id).execute(),
        ),
      ),
    ).toEqual([{ kind: 'lock', component: id }]);
  });

  it("says a document's new version, and any change to access", async () => {
    const said = await heard(() =>
      service.withTenant(tenant, (trx) =>
        createDocument(trx, {
          spaceId: general,
          title: 'Report',
          language: 'en-GB',
          direction: 'ltr',
          author: ada,
        }),
      ),
    );
    const outline = said.find((event) => event.kind === 'outline');
    expect(outline).toMatchObject({ kind: 'outline', document: expect.any(String) });

    const access = await heard(() =>
      service.withTenant(tenant, async (trx) =>
        grant(trx, {
          roleId: (await findRole(trx, 'Author'))!.id,
          subject: { principal: grace },
          level: { kind: 'space', id: general },
          effect: 'allow',
          grantedBy: ada,
        }),
      ),
    );
    expect(access).toContainEqual({ kind: 'permissions' });
  });

  it('ranges a stream over the components of its scope the viewer may read, and refuses a scope they may not read', async () => {
    const { open, closed } = await service.withTenant(tenant, async (trx) => ({
      open: await component(trx, general, 'Open'),
      closed: await component(trx, restricted, 'Closed'),
    }));
    expect(
      await service.withTenant(tenant, (trx) => streamScope(trx, grace, { component: open })),
    ).toEqual(new Set([open]));
    expect(
      await service.withTenant(tenant, (trx) => streamScope(trx, grace, { component: closed })),
    ).toBeUndefined();
    expect(
      await service.withTenant(tenant, (trx) =>
        streamScope(trx, grace, { component: 'not-an-id' }),
      ),
    ).toBeUndefined();

    await service.withTenant(tenant, (trx) =>
      claimLock(trx, { artifactId: closed, principal: ada, session: SESSION }),
    );
    expect(await service.withTenant(tenant, (trx) => locksShown(trx, [open, closed]))).toEqual([
      { component: open, holder: null, expectedRelease: null, taking: null },
      {
        component: closed,
        holder: { id: ada, name: 'Ada' },
        expectedRelease: expect.any(String),
        taking: null,
      },
    ]);
  });

  it("says a window's beat and its leaving, shows each person in the document with what the viewer may read of where they are, and none silent a minute", async () => {
    const VIEWER = '33333333-3333-4333-8333-333333333333';
    const { open, closed, report } = await service.withTenant(tenant, async (trx) => {
      const made = await createDocument(trx, {
        spaceId: general,
        title: 'Where people are',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return {
        open: await component(trx, general, 'Here'),
        closed: await component(trx, restricted, 'Elsewhere'),
        report: made.version.artifactId,
      };
    });
    const beat = (component: string | null, who = ada) =>
      service.withTenant(tenant, (trx) =>
        beatPresence(trx, {
          viewer: VIEWER,
          principalId: who,
          document: report,
          component,
          mode: 'author',
        }),
      );
    expect(await heard(() => beat(closed))).toEqual([
      { kind: 'presence', viewer: VIEWER, document: report },
    ]);
    // Grace may not read where Ada is: Ada is in the document alone.
    const asGrace = await service.withTenant(tenant, (trx) =>
      presenceShown(trx, report, new Set([open])),
    );
    expect(asGrace).toEqual([
      {
        viewer: VIEWER,
        person: { id: ada, name: 'Ada' },
        component: null,
        mode: null,
        beatAt: expect.any(String),
        ageMs: expect.any(Number),
      },
    ]);
    await beat(open);
    expect(
      await service.withTenant(tenant, (trx) => presenceShown(trx, report, new Set([open]))),
    ).toEqual([expect.objectContaining({ component: open, mode: 'author' })]);

    // A window is its principal's: another's beat under the same id is a window of their own, and
    // Ada's stands (the PL final review, finding 6).
    expect(await beat(open, grace)).toBe(true);
    expect(
      (await service.withTenant(tenant, (trx) => presenceShown(trx, report, new Set([open])))).map(
        (each) => each.person.id,
      ),
    ).toEqual(expect.arrayContaining([ada, grace]));
    await service.withTenant(tenant, (trx) => leavePresence(trx, grace, VIEWER));

    // Silent a minute: absent, and the sweep tidies it.
    await service.withTenant(tenant, (trx) =>
      sql`update presence set beat_at = now() - interval '61 seconds' where viewer = ${VIEWER}`.execute(
        trx,
      ),
    );
    expect(
      await service.withTenant(tenant, (trx) => presenceShown(trx, report, new Set([open]))),
    ).toEqual([]);
    expect(await heard(() => service.withTenant(tenant, (trx) => sweepPresence(trx)))).toEqual([
      { kind: 'presence_left', viewer: VIEWER, document: report },
    ]);

    await beat(open);
    expect(
      await heard(() => service.withTenant(tenant, (trx) => leavePresence(trx, ada, VIEWER))),
    ).toEqual([{ kind: 'presence_left', viewer: VIEWER, document: report }]);
  });
});
