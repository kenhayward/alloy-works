import type { AuditContext } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findApiToken, issueApiToken, revokeApiToken } from './api-tokens.js';
import { eraseLabels } from './audit.js';
import { bootstrapCluster } from './bootstrap.js';
import { inviteFirstAdministrator } from './first-administrator.js';
import { grant, removeGrant } from './grants.js';
import {
  addToGroup,
  createGroup,
  deleteGroup,
  setGroupMembers,
  syncProviderGroups,
} from './groups.js';
import { claimInvitation, invite, withdrawInvitation } from './invitations.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import {
  closeSignInRoute,
  configureOrganisationSignIn,
  inviteToTenant,
  permitGoogleSignIn,
} from './sign-in.js';
import { archiveSpace, createSpace, renameSpace, restoreSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import {
  auditEvents,
  freshDatabase,
  newestEvent,
  queryAs,
  TEST_PASSWORDS,
  type ReadEvent,
  type TestDatabase,
} from './testing/database.js';

const ISSUER = 'https://idp.example';
const KEY = Buffer.alloc(32, 7);

/**
 * Identity, access and administration on the audit log (the AU1 plan, task 3; AU1-F to AU1-I): each
 * act's event, attributed by the transaction's context, with the labels it is read by.
 */
describe('identity, access and administration on the audit log', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let tenant: Tenant;
  let ada: string;
  let grace: string;
  let alan: string;
  let author: string;
  let reader: string;
  let acting: AuditContext;

  const person = (subject: string, name: string) =>
    service.withTenant(
      tenant,
      async (trx) =>
        (
          await trx
            .insertInto('principal')
            .values({
              issuer: ISSUER,
              subject,
              email: `${subject}@example.com`,
              email_verified: true,
              display_name: name,
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id,
      { actorKind: 'system' },
    );

  /** Runs `work` as Ada, and answers it with the events it recorded. */
  async function asAda<T>(
    work: (trx: TenantTransaction) => Promise<T>,
  ): Promise<{ answer: T; events: ReadEvent[] }> {
    return recorded(() => service.withTenant(tenant, work, acting));
  }

  async function recorded<T>(act: () => Promise<T>): Promise<{ answer: T; events: ReadEvent[] }> {
    const before = await service.withTenant(tenant, newestEvent, { actorKind: 'system' });
    const answer = await act();
    const events = await service.withTenant(tenant, (trx) => auditEvents(trx, before), {
      actorKind: 'system',
    });
    return { answer, events };
  }

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const id = db.newTenantId();
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Production' },
      hostnames: [`${id}.alloy.test`],
    });
    // No default context: every event here is attributed by the context each act names.
    service = createTenantDatabase(db.serviceUrl);
    ada = await person('ada', 'Ada');
    grace = await person('grace', 'Grace');
    alan = await person('alan', 'Alan');
    acting = { actorKind: 'person', actor: ada, actorLabel: 'Ada', traceId: 'req-ada' };
    const roles = await service.withTenant(tenant, async (trx) => ({
      author: (await findRole(trx, 'Author'))!.id,
      reader: (await findRole(trx, 'Reader'))!.id,
    }));
    author = roles.author;
    reader = roles.reader;
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('ADM-002 records a space made, renamed with its old and new names, archived and restored', async () => {
    const { answer: space, events } = await asAda(async (trx) => {
      const made = await createSpace(trx, 'Clinical');
      await createSpace(trx, 'Spare');
      await renameSpace(trx, made.id, 'Clinic');
      // Naming it what it is already changes nothing, and records nothing.
      await renameSpace(trx, made.id, 'Clinic');
      await archiveSpace(trx, made.id, ada);
      await archiveSpace(trx, made.id, ada);
      await restoreSpace(trx, made.id);
      await restoreSpace(trx, made.id);
      return made;
    });
    const ofSpace = events.filter((event) => event.subject === space.id);
    expect(ofSpace.map((event) => event.kind)).toEqual([
      'space.made',
      'space.renamed',
      'space.archived',
      'space.restored',
    ]);
    for (const event of ofSpace) {
      expect(event).toMatchObject({
        actorKind: 'person',
        actor: ada,
        subjectKind: 'space',
        space: space.id,
        outcome: 'done',
        traceId: 'req-ada',
      });
      expect(event.labels['actor']).toEqual({ text: 'Ada', refersTo: ada, erased: false });
    }
    expect(ofSpace[1]!.labels['subject']!.text).toBe('Clinic');
    expect(ofSpace[1]!.labels['previous']!.text).toBe('Clinical');
    // Restored before archived_by cleared: the event is there, and the space is live.
    expect(ofSpace[3]!.labels['subject']!.text).toBe('Clinic');
  });

  it('LIF-029 a space event reads with its old name after a rename, and a grant after its grantee is erased', async () => {
    const { answer, events } = await asAda(async (trx) => {
      const space = await createSpace(trx, 'Oncology');
      const made = await grant(trx, {
        roleId: reader,
        subject: { principal: alan },
        level: { kind: 'space', id: space.id },
        effect: 'allow',
        grantedBy: ada,
      });
      if (!('granted' in made)) throw new Error('refused');
      await renameSpace(trx, space.id, 'Haematology');
      return { space: space.id, grant: made.granted.id };
    });
    await service.withTenant(tenant, (trx) => eraseLabels(trx, alan), acting);
    const after = await service.withTenant(tenant, (trx) => auditEvents(trx), acting);
    const made = after.find((event) => event.sequence === events[0]!.sequence)!;
    expect(made).toMatchObject({ kind: 'space.made', subject: answer.space });
    expect(made.labels['subject']!.text).toBe('Oncology');
    const granted = after.find(
      (event) => event.kind === 'access.granted' && event.subject === answer.grant,
    )!;
    // The event stands whole; only the erased person's label is a fixed word now.
    expect(granted.detail).toMatchObject({ grantee: alan, granteeKind: 'principal' });
    expect(granted.labels['grantee']).toMatchObject({ refersTo: alan, erased: true });
    expect(granted.labels['grantee']!.text).not.toBe('Alan');
    expect(granted.labels['role']!.text).toBe('Reader');
    expect(granted.labels['space']!.text).toBe('Oncology');
  });

  it('ADM-002 records a grant made and removed, with its role, grantee and level', async () => {
    const { answer: id, events } = await asAda(async (trx) => {
      const made = await grant(trx, {
        roleId: author,
        subject: { principal: grace },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ada,
      });
      if (!('granted' in made)) throw new Error('refused');
      const removed = await removeGrant(trx, made.granted.id);
      if (!('removed' in removed)) throw new Error('refused');
      return made.granted.id;
    });
    expect(events.map((event) => [event.kind, event.subject])).toEqual([
      ['access.granted', id],
      ['access.revoked', id],
    ]);
    for (const event of events) {
      expect(event).toMatchObject({ actorKind: 'person', actor: ada, subjectKind: 'grant' });
      expect(event.detail).toEqual({
        role: author,
        level: 'tenant',
        effect: 'allow',
        grantee: grace,
        granteeKind: 'principal',
      });
      expect(event.labels['grantee']).toEqual({ text: 'Grace', refersTo: grace, erased: false });
      expect(event.labels['role']!.text).toBe('Author');
    }
  });

  it('ADM-002 records a group made, its members, and its deletion as one event per row it removes', async () => {
    const { answer: group, events } = await asAda(async (trx) => {
      const made = await createGroup(trx, 'Editors');
      if (!('group' in made)) throw new Error('refused');
      const id = made.group.id;
      await setGroupMembers(trx, id, [grace, alan]);
      await setGroupMembers(trx, id, [grace]);
      await addToGroup(trx, id, alan);
      await addToGroup(trx, id, alan);
      await grant(trx, {
        roleId: reader,
        subject: { group: id },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ada,
      });
      await deleteGroup(trx, id);
      return id;
    });
    expect(events.map((event) => [event.kind, event.detail['principal'] ?? null])).toEqual([
      ['group.made', null],
      ['group.member_added', expect.any(String)],
      ['group.member_added', expect.any(String)],
      ['group.member_removed', alan],
      ['group.member_added', alan],
      ['access.granted', null],
      // The cascade: its grant, each membership, then the group, all before the delete.
      ['access.revoked', null],
      ['group.member_removed', expect.any(String)],
      ['group.member_removed', expect.any(String)],
      ['group.deleted', null],
    ]);
    const cascade = events.slice(6);
    expect(cascade[0]!.detail).toMatchObject({ grantee: group, granteeKind: 'group' });
    expect(cascade[0]!.labels['grantee']!.text).toBe('Editors');
    expect(
      cascade
        .slice(1, 3)
        .map((event) => event.detail['principal'])
        .sort(),
    ).toEqual([grace, alan].sort());
    for (const event of events) {
      expect(event.actor).toBe(ada);
      if (event.kind.startsWith('group.')) {
        expect(event).toMatchObject({ subjectKind: 'group', subject: group });
        expect(event.labels['subject']!.text).toBe('Editors');
      }
    }
    expect(events[1]!.detail['through']).toBe('manual');
  });

  it("ADM-002 records the provider's memberships as a sign-in brings them into line", async () => {
    const { answer: group } = await asAda(async (trx) => {
      const made = await createGroup(trx, 'Nurses', { providerValue: 'nurses' });
      if (!('group' in made)) throw new Error('refused');
      return made.group.id;
    });
    const graceActs: AuditContext = { actorKind: 'person', actor: grace, actorLabel: 'Grace' };
    const joined = await recorded(() =>
      service.withTenant(tenant, (trx) => syncProviderGroups(trx, grace, ['nurses']), graceActs),
    );
    const left = await recorded(() =>
      service.withTenant(tenant, (trx) => syncProviderGroups(trx, grace, []), graceActs),
    );
    expect(joined.events.map((event) => [event.kind, event.detail])).toEqual([
      ['group.member_added', { group, principal: grace, through: 'provider' }],
    ]);
    expect(left.events.map((event) => [event.kind, event.detail])).toEqual([
      ['group.member_removed', { group, principal: grace, through: 'provider' }],
    ]);
  });

  it('ADM-002 records an invitation sent, and its withdrawal as one event per row it removes', async () => {
    const { answer, events } = await asAda(async (trx) => {
      const sent = await invite(trx, { email: 'Ivy@Example.com', external: false, invitedBy: ada });
      if (!('invited' in sent)) throw new Error('refused');
      const principal = sent.invited.principalId;
      await grant(trx, {
        roleId: reader,
        subject: { principal },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ada,
      });
      const group = await createGroup(trx, 'Visitors');
      if (!('group' in group)) throw new Error('refused');
      await addToGroup(trx, group.group.id, principal);
      await withdrawInvitation(trx, sent.invited.id);
      return { invitation: sent.invited.id, principal };
    });
    expect(events.map((event) => event.kind)).toEqual([
      'invitation.sent',
      'access.granted',
      'group.made',
      'group.member_added',
      'access.revoked',
      'group.member_removed',
      'invitation.withdrawn',
    ]);
    const [sent, , , , revoked, removed, withdrawn] = events;
    for (const event of [sent!, withdrawn!]) {
      expect(event).toMatchObject({
        actor: ada,
        subjectKind: 'invitation',
        subject: answer.invitation,
        detail: { principal: answer.principal },
      });
      expect(event.labels['invitee']).toEqual({
        text: 'ivy@example.com',
        refersTo: answer.principal,
        erased: false,
      });
    }
    expect(revoked!.detail['grantee']).toBe(answer.principal);
    expect(removed!.detail['principal']).toBe(answer.principal);
  });

  it('ADM-002 records an invitation accepted, by the person who claimed it', async () => {
    const sent = await service.withTenant(
      tenant,
      (trx) => invite(trx, { email: 'joan@example.com', external: false, invitedBy: ada }),
      acting,
    );
    if (!('invited' in sent)) throw new Error('refused');
    // A sign-in's transaction names nobody until the claim names the claimer.
    const { answer: claimed, events } = await recorded(() =>
      service.withTenant(tenant, (trx) =>
        claimInvitation(
          trx,
          {
            issuer: ISSUER,
            subject: 'joan',
            email: 'joan@example.com',
            emailVerified: true,
            name: 'Joan',
          },
          'organisation',
          'req-joan',
        ),
      ),
    );
    expect(claimed).toBe(sent.invited.principalId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'invitation.accepted',
      actorKind: 'person',
      actor: claimed,
      subject: sent.invited.id,
      traceId: 'req-joan',
    });
    expect(events[0]!.labels['actor']!.text).toBe('Joan');
  });

  it("erases a token's name with its holder's labels", async () => {
    const hedy = await person('hedy', 'Hedy');
    const { events } = await recorded(() =>
      service.withTenant(
        tenant,
        (trx) =>
          issueApiToken(trx, {
            principalId: hedy,
            name: 'Hedy export',
            tokenHash: 'e'.repeat(64),
            scopes: [],
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          }),
        { actorKind: 'person', actor: hedy, actorLabel: 'Hedy' },
      ),
    );
    expect(events[0]!.labels['subject']).toMatchObject({ text: 'Hedy export', refersTo: hedy });
    await service.withTenant(tenant, (trx) => eraseLabels(trx, hedy), acting);
    const after = await service.withTenant(
      tenant,
      async (trx) =>
        (await auditEvents(trx, String(Number(events[0]!.sequence) - 1))).find(
          (event) => event.sequence === events[0]!.sequence,
        )!,
      { actorKind: 'system' },
    );
    expect(after.labels['subject']).toMatchObject({ text: 'erased', erased: true });
  });

  it('IAM-037 records a token issued, one use a minute under concurrent requests, and its revocation', async () => {
    const now = new Date();
    const { answer: token, events: issued } = await asAda((trx) =>
      issueApiToken(trx, {
        principalId: ada,
        name: 'Nightly export',
        tokenHash: 'a'.repeat(64),
        scopes: ['edit'],
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      }),
    );
    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({
      kind: 'token.issued',
      actor: ada,
      subjectKind: 'token',
      subject: token.id,
      detail: { scopes: ['edit'] },
    });
    expect(issued[0]!.labels['subject']!.text).toBe('Nightly export');
    // The hash is never in the event.
    expect(JSON.stringify(issued[0])).not.toContain('a'.repeat(64));

    // A request's transaction names nobody until its token is found.
    const use = (at: Date) =>
      Promise.all(
        Array.from({ length: 6 }, () =>
          service.withTenant(tenant, (trx) => findApiToken(trx, 'a'.repeat(64), at, 'req-use')),
        ),
      );
    const first = await recorded(() => use(now));
    const again = await recorded(() => use(new Date(now.getTime() + 30 * 1000)));
    const later = await recorded(() => use(new Date(now.getTime() + 61 * 1000)));
    expect(first.answer.every((holder) => holder?.tokenId === token.id)).toBe(true);
    expect(first.events.map((event) => event.kind)).toEqual(['token.used']);
    expect(again.events).toEqual([]);
    expect(later.events.map((event) => event.kind)).toEqual(['token.used']);
    expect(first.events[0]).toMatchObject({
      actorKind: 'token',
      actor: ada,
      token: token.id,
      subject: token.id,
      traceId: 'req-use',
    });

    const { answer: revoked, events } = await asAda((trx) => revokeApiToken(trx, ada, token.id));
    expect(revoked).toBe(true);
    expect(events.map((event) => [event.kind, event.subject])).toEqual([
      ['token.revoked', token.id],
    ]);
    expect(events[0]!.labels['holder']).toEqual({ text: 'Ada', refersTo: ada, erased: false });
    // Another's token, or one gone, revokes and records nothing.
    expect((await asAda((trx) => revokeApiToken(trx, ada, token.id))).events).toEqual([]);
  });

  describe("the vendor's acts", () => {
    let fresh: Tenant;

    beforeAll(async () => {
      const id = db.newTenantId();
      fresh = await createTenant(db.adminUrl, db.migratorUrl, {
        organisation: { id: 'acme', name: 'Acme' },
        tenant: { id, name: 'Staging' },
        hostnames: [`${id}.alloy.test`],
      });
    });

    const eventsOf = (after = '0') =>
      service.withTenant(fresh, (trx) => auditEvents(trx, after), { actorKind: 'system' });
    const newest = () => service.withTenant(fresh, newestEvent, { actorKind: 'system' });

    it("IAM-060 records the vendor's naming of the first administrator, with who named them, and its claim", async () => {
      const answer = await inviteFirstAdministrator(db.adminUrl, fresh, {
        email: 'ada@example.com',
        namedBy: 'provisioning',
      });
      expect(answer).toEqual({ invited: true, renewed: false });
      const named = await eventsOf();
      expect(named.map((event) => event.kind)).toEqual([
        'tenant.administrator_named',
        'access.granted',
      ]);
      const principal = named[0]!.subject!;
      expect(named[0]).toMatchObject({
        actorKind: 'vendor',
        actor: null,
        subjectKind: 'principal',
        detail: { principal },
      });
      expect(named[0]!.labels['named_by']).toEqual({
        text: 'provisioning',
        refersTo: null,
        erased: false,
      });
      expect(named[0]!.labels['invitee']!.text).toBe('ada@example.com');
      expect(named[1]).toMatchObject({ actorKind: 'vendor', detail: { grantee: principal } });

      const before = await newest();
      const claimed = await service.withTenant(fresh, (trx) =>
        claimInvitation(
          trx,
          {
            issuer: ISSUER,
            subject: 'ada',
            email: 'ada@example.com',
            emailVerified: true,
            name: 'Ada',
          },
          'organisation',
        ),
      );
      expect(claimed).toBe(principal);
      const claim = await eventsOf(before);
      expect(claim.map((event) => [event.kind, event.actorKind, event.actor])).toEqual([
        ['invitation.accepted', 'person', principal],
        ['tenant.administrator_claimed', 'person', principal],
      ]);
      expect(claim[1]!.labels['named_by']!.text).toBe('provisioning');
    });

    it('ADM-002 records a lapsed first administrator replaced, one event per row it removes', async () => {
      const other = await createTenant(db.adminUrl, db.migratorUrl, {
        organisation: { id: 'acme', name: 'Acme' },
        tenant: { id: db.newTenantId(), name: 'Training' },
        hostnames: [`training-${db.newTenantId()}.alloy.test`],
      });
      await inviteFirstAdministrator(db.adminUrl, other, {
        email: 'grace@example.com',
        namedBy: 'provisioning',
      });
      await queryAs(
        db.adminUrl,
        `update ${other.schema}.invitation set expires_at = now() - interval '1 day'`,
      );
      const before = await service.withTenant(other, newestEvent, { actorKind: 'system' });
      await inviteFirstAdministrator(db.adminUrl, other, {
        email: 'ada@example.com',
        namedBy: 'provisioning',
      });
      const events = await service.withTenant(other, (trx) => auditEvents(trx, before), {
        actorKind: 'system',
      });
      expect(events.map((event) => [event.kind, event.actorKind])).toEqual([
        ['access.revoked', 'vendor'],
        ['invitation.withdrawn', 'vendor'],
        ['tenant.administrator_named', 'vendor'],
        ['access.granted', 'vendor'],
      ]);
      expect(events[0]!.labels['grantee']!.text).toBe('grace@example.com');
      expect(events[1]!.labels['invitee']!.text).toBe('grace@example.com');
    });

    it('IAM-013 records every session a closed route issued as ended, before its row goes', async () => {
      await configureOrganisationSignIn(
        db.adminUrl,
        fresh,
        { issuer: ISSUER, clientId: 'alloy', clientSecret: 'an-invented-secret' },
        KEY,
      );
      await permitGoogleSignIn(db.adminUrl, fresh);
      await inviteToTenant(db.adminUrl, fresh, 'Mary@example.com');
      const before = await newest();
      const sessions = await service.withTenant(
        fresh,
        async (trx) => {
          const holder = await trx
            .insertInto('principal')
            .values({ issuer: ISSUER, subject: 'bob', display_name: 'Bob' })
            .returning('id')
            .executeTakeFirstOrThrow();
          const later = new Date(Date.now() + 60 * 60 * 1000);
          return trx
            .insertInto('session')
            .values(
              ['b'.repeat(64), 'c'.repeat(64)].map((hash) => ({
                token_hash: hash,
                principal_id: holder.id,
                route: 'organisation',
                last_seen_at: new Date(),
                idle_expires_at: later,
                expires_at: later,
              })),
            )
            .returning(['id', 'principal_id'])
            .execute();
        },
        { actorKind: 'system' },
      );
      await closeSignInRoute(db.adminUrl, fresh, 'organisation');
      const closed = await eventsOf(before);
      expect(closed.map((event) => [event.kind, event.actorKind])).toEqual([
        ['authentication.signed_out', 'vendor'],
        ['authentication.signed_out', 'vendor'],
        ['sign_in_route.closed', 'vendor'],
      ]);
      expect(closed.slice(0, 2).map((event) => event.detail)).toEqual(
        [...sessions]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((session) => ({ ended: 'route_closed', session: session.id })),
      );
      expect(closed[0]).toMatchObject({
        subjectKind: 'principal',
        subject: sessions[0]!.principal_id,
      });
      expect(closed[0]!.labels['subject']!.text).toBe('Bob');
      expect(closed[2]!.detail).toEqual({ route: 'organisation' });

      const all = await eventsOf();
      expect(
        all
          .filter((event) => event.kind === 'sign_in_route.configured')
          .map((event) => [event.actorKind, event.detail['route']]),
      ).toEqual([
        ['vendor', 'organisation'],
        ['vendor', 'google'],
      ]);
      const invited = all.find((event) => event.kind === 'tenant.invited')!;
      expect(invited).toMatchObject({ actorKind: 'vendor', subjectKind: 'principal' });
      expect(invited.labels['invitee']).toMatchObject({
        text: 'mary@example.com',
        refersTo: invited.subject,
      });
      // Nothing of the client secret reaches the log.
      expect(JSON.stringify(all)).not.toContain('an-invented-secret');
    });

    it("records the vendor's act on a route only where it changes something", async () => {
      const provider = { issuer: ISSUER, clientId: 'alloy', clientSecret: 'an-invented-secret' };
      await configureOrganisationSignIn(db.adminUrl, fresh, provider, KEY);
      await permitGoogleSignIn(db.adminUrl, fresh);
      let before = await newest();
      // The same again, and closing what is closed, change nothing.
      await configureOrganisationSignIn(db.adminUrl, fresh, provider, KEY);
      await permitGoogleSignIn(db.adminUrl, fresh);
      await closeSignInRoute(db.adminUrl, fresh, 'google');
      await closeSignInRoute(db.adminUrl, fresh, 'google');
      expect((await eventsOf(before)).map((event) => event.kind)).toEqual(['sign_in_route.closed']);
      before = await newest();
      // Another client, another secret, a domain added: each a change.
      await configureOrganisationSignIn(
        db.adminUrl,
        fresh,
        { ...provider, clientId: 'other' },
        KEY,
      );
      await configureOrganisationSignIn(
        db.adminUrl,
        fresh,
        { ...provider, clientId: 'other', clientSecret: 'another-invented-one' },
        KEY,
      );
      await permitGoogleSignIn(db.adminUrl, fresh);
      await permitGoogleSignIn(db.adminUrl, fresh, { domains: ['example.com'] });
      expect((await eventsOf(before)).map((event) => event.detail['route'])).toEqual([
        'organisation',
        'organisation',
        'google',
        'google',
      ]);
    });
  });

  it('gives every identity event who, what, when and the subject acted on, and no version', async () => {
    const started = Date.now() - 60 * 1000;
    const { events } = await asAda(async (trx) => {
      const space = await createSpace(trx, `Checked ${Date.now()}`);
      const group = await createGroup(trx, `Checked ${Date.now()}`);
      if (!('group' in group)) throw new Error(group.refused);
      await grant(trx, {
        roleId: reader,
        subject: { principal: grace },
        level: { kind: 'space', id: space.id },
        effect: 'allow',
        grantedBy: ada,
      });
    });
    expect(events.map((event) => event.kind)).toEqual([
      'space.made',
      'group.made',
      'access.granted',
    ]);
    for (const event of events) {
      expect(event, event.kind).toMatchObject({ actorKind: 'person', actor: ada });
      expect(event.labels['actor']?.text, event.kind).toBe('Ada');
      expect(event.at.getTime(), event.kind).toBeGreaterThan(started);
      expect(event.subjectKind, event.kind).not.toBeNull();
      // None of these acts is on a versioned artifact, so none names a version.
      expect(event.subjectVersion, event.kind).toBeNull();
    }
  });
});
