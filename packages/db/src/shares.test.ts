import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadReadableSet } from './access-facts.js';
import { bootstrapCluster } from './bootstrap.js';
import { createDocument } from './documents.js';
import { extendGrant, grant } from './grants.js';
import { invite } from './invitations.js';
import { findRole } from './roles.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import {
  listShares,
  recordSharedAccess,
  revokeShare,
  sharedReaderRole,
  sharePublication,
  supersession,
} from './shares.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import { publish } from './testing/every-kind.js';
import { recordVersion } from './versions.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const ISSUER = 'https://idp.example';
const DAY = 24 * 60 * 60 * 1000;

describe('publication shares (publishing.md, "Shares"; the R17 plan)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada: string;

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>, actor = ada) =>
    service.withTenant(tenant, work, { actorKind: 'person', actor });

  const person = (kind: 'user' | 'external', email: string | null = null, verified = false) =>
    service.withTenant(
      tenant,
      async (trx) =>
        (
          await trx
            .insertInto('principal')
            .values({
              issuer: ISSUER,
              subject: randomUUID(),
              email,
              email_verified: verified,
              display_name: 'Grace',
              kind,
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id,
    );

  /**
   * A document in a space of its own, published, then published again from a later version: the
   * first publication and the second. Each in a transaction of its own, so the second is later.
   */
  const published = () =>
    as(async (trx) => {
      const space = (await createSpace(trx, `Space ${randomUUID()}`)).id;
      const made = await createDocument(trx, {
        spaceId: space,
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
        title: 'Shared manual',
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return { space, document: { artifactId: made.version.artifactId, id: made.version.id } };
    }).then(async ({ space, document }) => {
      const first = await as((trx) => publish(trx, { document, author: ada, role: tenant.role }));
      const later = await as(async (trx) => {
        const { content } = await trx
          .selectFrom('artifact_version')
          .select('content')
          .where('id', '=', document.id)
          .executeTakeFirstOrThrow();
        const recorded = await recordVersion(trx, {
          artifactId: document.artifactId,
          openedFrom: document.id,
          author: ada,
          substance: {
            kind: 'document',
            content: { ...(content as object), title: 'Shared manual, corrected' },
          } as never,
        });
        if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
        return { artifactId: document.artifactId, id: recorded.version.id };
      });
      const second = await as((trx) =>
        publish(trx, { document: later, author: ada, role: tenant.role }),
      );
      return { space, document, later, first, second };
    });

  const readable = (principal: string) =>
    as((trx) => loadReadableSet(trx, principal).then((set) => set!));

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
    ada = await service.withTenant(
      tenant,
      async (trx) =>
        (
          await trx
            .insertInto('principal')
            .values({ issuer: ISSUER, subject: 'ada', email: null, display_name: 'Ada' })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id,
    );
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('PUB-057 shares a publication only with a named address, inviting it as somebody from outside, and refuses a member', async () => {
    const { first } = await published();
    const shared = await as((trx) =>
      sharePublication(trx, { publication: first, email: ' Ivy@Example.com ', sharedBy: ada }),
    );
    if (shared.answer !== 'shared') throw new Error(shared.answer);
    expect(shared.share.recipient).toMatchObject({ email: 'ivy@example.com', signedIn: false });
    // Its invitation waits as long as the share does.
    expect(shared.invitation!.expiresAt!.getTime()).toBe(shared.share.expiresAt.getTime());
    const kind = await as((trx) =>
      trx
        .selectFrom('principal')
        .select('kind')
        .where('id', '=', shared.share.recipient.id)
        .executeTakeFirstOrThrow(),
    );
    expect(kind.kind).toBe('external');

    // Somebody from outside who has signed in already is shared with as they are, uninvited.
    const outside = await person('external', 'iris@example.com', true);
    const again = await as((trx) =>
      sharePublication(trx, { publication: first, email: 'iris@example.com', sharedBy: ada }),
    );
    if (again.answer !== 'shared') throw new Error(again.answer);
    expect(again.share.recipient).toMatchObject({ id: outside, signedIn: true });
    expect(again.invitation).toBeNull();

    // An administrator's invitation waiting with access of its own, lapsed or not, is never revived
    // by a share.
    const general = await as((trx) => createSpace(trx, `Space ${randomUUID()}`));
    const waiting = await as(async (trx) => {
      const invited = await invite(trx, {
        email: 'iona@example.com',
        external: true,
        invitedBy: ada,
      });
      if (!('invited' in invited)) throw new Error(invited.refused);
      const reader = (await findRole(trx, 'Reader'))!;
      await grant(trx, {
        roleId: reader.id,
        subject: { principal: invited.invited.principalId },
        level: { kind: 'space', id: general.id },
        effect: 'allow',
        grantedBy: ada,
      });
      await trx
        .updateTable('invitation')
        .set({ expires_at: new Date(Date.now() - DAY) })
        .where('id', '=', invited.invited.id)
        .execute();
      return invited.invited;
    });
    expect(
      await as((trx) =>
        sharePublication(trx, { publication: first, email: 'iona@example.com', sharedBy: ada }),
      ),
    ).toEqual({ answer: 'share.invitation_waiting' });
    const kept = await as((trx) =>
      trx
        .selectFrom('invitation')
        .select('expires_at')
        .where('id', '=', waiting.id)
        .executeTakeFirstOrThrow(),
    );
    expect(kept.expires_at!.getTime()).toBeLessThan(Date.now());

    // One of the tenant's own reads through the ordinary model.
    await person('user', 'alice@example.com');
    expect(
      await as((trx) =>
        sharePublication(trx, { publication: first, email: 'alice@example.com', sharedBy: ada }),
      ),
    ).toEqual({ answer: 'share.member' });
    expect(
      await as((trx) =>
        sharePublication(trx, { publication: ada, email: 'ivy@example.com', sharedBy: ada }),
      ),
    ).toEqual({ answer: 'publication.missing' });
  });

  it('PUB-084 grants that publication alone, read only, through a fixed role, and lists it with the share', async () => {
    const { first, second } = await published();
    const ivy = await person('external', `ivy-${randomUUID()}@example.com`, true);
    const email = await as((trx) =>
      trx.selectFrom('principal').select('email').where('id', '=', ivy).executeTakeFirstOrThrow(),
    );
    const shared = await as((trx) =>
      sharePublication(trx, { publication: first, email: email.email!, sharedBy: ada }),
    );
    if (shared.answer !== 'shared') throw new Error(shared.answer);
    const set = await readable(ivy);
    expect(set).toMatchObject({ tenant: false, spaces: [], included: [first] });
    expect(set.included).not.toContain(second);

    const role = await as((trx) => sharedReaderRole(trx));
    expect(role.permissions).toEqual(['read']);
    // Fixed: no change, by any path, ever widens a share.
    await expect(
      as((trx) =>
        trx
          .updateTable('role')
          .set({ permissions: ['read', 'comment'] })
          .where('id', '=', role.id)
          .execute(),
      ),
    ).rejects.toThrow(/fixed/);
    await expect(
      as((trx) => trx.deleteFrom('role').where('id', '=', role.id).execute()),
    ).rejects.toThrow(/fixed/);
    // Nor is it granted but as a share.
    expect(
      await as((trx) =>
        grant(trx, {
          roleId: role.id,
          subject: { principal: ivy },
          level: { kind: 'artifact', id: second },
          effect: 'allow',
          grantedBy: ada,
        }),
      ),
    ).toEqual({ refused: 'grant.role_fixed' });

    const listed = await as((trx) => listShares(trx, first));
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: shared.share.id,
      recipient: { id: ivy, signedIn: true },
      sharedBy: { id: ada, name: 'Ada' },
      accesses: [],
    });
    expect(await as((trx) => listShares(trx, second))).toEqual([]);
  });

  it("PUB-058 expires a share by the tenant's default, refuses one past the cap, and revokes it at once", async () => {
    const { first } = await published();
    const now = Date.now();
    const shared = await as((trx) =>
      sharePublication(trx, { publication: first, email: 'ivy-58@example.com', sharedBy: ada }),
    );
    if (shared.answer !== 'shared') throw new Error(shared.answer);
    expect(Math.round((shared.share.expiresAt.getTime() - now) / DAY)).toBe(30);
    expect(
      await as((trx) =>
        sharePublication(trx, {
          publication: first,
          email: 'ivy-58b@example.com',
          expiresAt: new Date(now + 91 * DAY),
          sharedBy: ada,
        }),
      ),
    ).toEqual({ answer: 'share.past_cap' });
    expect(
      await as((trx) =>
        sharePublication(trx, {
          publication: first,
          email: 'ivy-58b@example.com',
          expiresAt: new Date(now - DAY),
          sharedBy: ada,
        }),
      ),
    ).toEqual({ answer: 'share.expiry_past' });
    expect(
      await as((trx) =>
        sharePublication(trx, { publication: first, email: 'ivy-58@example.com', sharedBy: ada }),
      ),
    ).toEqual({ answer: 'share.duplicate' });

    const ivy = shared.share.recipient.id;
    expect((await readable(ivy)).included).toEqual([first]);
    expect(
      await as((trx) => revokeShare(trx, { publication: first, share: shared.share.id })),
    ).toEqual({ answer: 'revoked' });
    expect((await readable(ivy)).included).toEqual([]);
    expect(
      await as((trx) => revokeShare(trx, { publication: first, share: shared.share.id })),
    ).toEqual({ answer: 'share.missing' });
    const revoked = await as((trx) =>
      sql<{ n: number }>`select count(*)::int as n from audit_event
        where kind = 'access.revoked' and subject = ${shared.share.id}`.execute(trx),
    );
    expect(revoked.rows[0]!.n).toBe(1);
  });

  it('PUB-058 keeps an invitation waiting as long as the longest share to it, an extended one included (the final review)', async () => {
    const { first, second } = await published();
    const email = `ines-${randomUUID()}@example.net`;
    const now = Date.now();
    const long = await as((trx) =>
      sharePublication(trx, {
        publication: first,
        email,
        expiresAt: new Date(now + 90 * DAY - 60_000),
        sharedBy: ada,
      }),
    );
    if (long.answer !== 'shared') throw new Error(long.answer);
    const short = await as((trx) =>
      sharePublication(trx, {
        publication: second,
        email,
        expiresAt: new Date(now + 10 * DAY),
        sharedBy: ada,
      }),
    );
    if (short.answer !== 'shared') throw new Error(short.answer);
    const waiting = () =>
      as((trx) =>
        trx
          .selectFrom('invitation')
          .select('expires_at')
          .where('principal_id', '=', long.share.recipient.id)
          .executeTakeFirstOrThrow(),
      ).then((row) => row.expires_at!.getTime());
    // The later, shorter share leaves the invitation as long as the first.
    expect(await waiting()).toBe(long.share.expiresAt.getTime());

    // An extended share takes its invitation with it.
    const third = await published();
    const lone = `iona-${randomUUID()}@example.net`;
    const made = await as((trx) =>
      sharePublication(trx, {
        publication: third.first,
        email: lone,
        expiresAt: new Date(now + 10 * DAY),
        sharedBy: ada,
      }),
    );
    if (made.answer !== 'shared') throw new Error(made.answer);
    const until = new Date(now + 60 * DAY);
    const extended = await as((trx) =>
      extendGrant(trx, { grant: made.share.id, expiresAt: until, by: ada }),
    );
    expect('granted' in extended).toBe(true);
    const invitation = await as((trx) =>
      trx
        .selectFrom('invitation')
        .select('expires_at')
        .where('principal_id', '=', made.share.recipient.id)
        .executeTakeFirstOrThrow(),
    );
    expect(invitation.expires_at!.getTime()).toBe(until.getTime());
  });

  it('PUB-058 shares again with somebody whose earlier share has ended (the final review)', async () => {
    const { first } = await published();
    const email = `isla-${randomUUID()}@example.net`;
    const isla = await person('external', email, true);
    // A share that ended yesterday, as one made long ago would have.
    await as(async (trx) => {
      const role = await sharedReaderRole(trx);
      const ended = await grant(trx, {
        roleId: role.id,
        subject: { principal: isla },
        level: { kind: 'artifact', id: first },
        effect: 'allow',
        expiresAt: new Date(Date.now() - DAY),
        share: true,
        grantedBy: ada,
      });
      if (!('granted' in ended)) throw new Error(ended.refused);
    });
    const again = await as((trx) =>
      sharePublication(trx, { publication: first, email, sharedBy: ada }),
    );
    expect(again.answer).toBe('shared');
    const listed = await as((trx) => listShares(trx, first));
    expect(listed.map((each) => each.expired)).toEqual([false]);
  });

  it('PUB-060 records each access by somebody from outside, who, when and which, and lists it with their share', async () => {
    const { first } = await published();
    const shared = await as((trx) =>
      sharePublication(trx, { publication: first, email: 'ivy-60@example.com', sharedBy: ada }),
    );
    if (shared.answer !== 'shared') throw new Error(shared.answer);
    const ivy = shared.share.recipient.id;
    await as(
      (trx) => recordSharedAccess(trx, { publication: first, output: null, principal: ivy }),
      ivy,
    );
    await as(
      (trx) => recordSharedAccess(trx, { publication: first, output: 'pdf', principal: ivy }),
      ivy,
    );
    // A member's read of it is no share's access.
    await as((trx) =>
      recordSharedAccess(trx, { publication: first, output: null, principal: ada }),
    );

    const [listed] = await as((trx) => listShares(trx, first));
    expect(listed!.accesses.map((each) => each.output)).toEqual(['pdf', null]);
    expect(listed!.accesses[0]!.at).toBeInstanceOf(Date);
    const events = await as((trx) =>
      sql<{ actor: string; subject: string; detail: unknown }>`
        select actor, subject, detail from audit_event
        where kind = 'publication.shared_accessed' and subject = ${first} order by sequence`.execute(
        trx,
      ),
    );
    expect(events.rows).toEqual([
      { actor: ivy, subject: first, detail: { output: null } },
      { actor: ivy, subject: first, detail: { output: 'pdf' } },
    ]);
  });

  it('PUB-059 says a publication is superseded by a later one of its document under the same profile', async () => {
    const { later, first, second } = await published();
    expect(await as((trx) => supersession(trx, second))).toEqual({
      superseded: false,
      newer: null,
    });
    expect(await as((trx) => supersession(trx, first))).toEqual({
      superseded: true,
      newer: second,
    });
    // A variant under another profile does not.
    await as((trx) =>
      publish(trx, {
        document: later,
        author: ada,
        role: tenant.role,
        profile: { values: {}, excludeUnset: true },
      }),
    );
    expect(await as((trx) => supersession(trx, second))).toEqual({
      superseded: false,
      newer: null,
    });
  });
});
