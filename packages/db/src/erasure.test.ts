import { randomBytes, randomUUID } from 'node:crypto';
import {
  DEFINITION_SCHEMA_VERSION,
  type AuditContext,
  type ContentDocument,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issueApiToken } from './api-tokens.js';
import { principalLabel, recordEvent } from './audit.js';
import { bootstrapCluster } from './bootstrap.js';
import { listPeople } from './component-values.js';
import { createComponent } from './creation.js';
import { createDefinition } from './definitions.js';
import { claimLock, saveIteration } from './editing.js';
import { ERASED_NAME, erasePerson, erasureOf, holdPrincipal } from './erasure.js';
import { grant } from './grants.js';
import { addToGroup, createGroup, setGroupMembers, syncProviderGroups } from './groups.js';
import { claimInvitation, invite } from './invitations.js';
import { migrate } from './migrate.js';
import { cutVersion } from './promotion.js';
import { createTenant, type Tenant } from './provision.js';
import { findRole } from './roles.js';
import { identifyKnown } from './sign-in.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import {
  auditEvents,
  freshDatabase,
  newestEvent,
  queryAs,
  TEST_PASSWORDS,
  type TestDatabase,
  untilWaitingOnLocks,
} from './testing/database.js';

const ISSUER = 'https://idp.example';
const SYSTEM: AuditContext = { actorKind: 'system' };

/** Erasure of a person (lifecycle.md, "Erasure"; the ER plan, ER-A to ER-E). */
describe('erasure of a person', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let tenant: Tenant;
  let ada: string;
  let adaActs: AuditContext;
  let space: string;
  let owner: string;
  let protocol: string;

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>, context: AuditContext = SYSTEM) =>
    service.withTenant(tenant, work, context);

  /** Somebody signed in, by a subject of their own, acting as themselves where they act. */
  const signedIn = (name: string, kind: 'user' | 'service' | 'external' = 'user') =>
    as(async (trx) => {
      const subject = randomUUID();
      const row = await trx
        .insertInto('principal')
        .values(
          kind === 'service'
            ? { issuer: null, subject: null, email: null, display_name: name, kind }
            : {
                issuer: ISSUER,
                subject,
                email: `${subject}@example.test`,
                email_verified: true,
                display_name: name,
                kind,
              },
        )
        .returning('id')
        .executeTakeFirstOrThrow();
      return { id: row.id, subject, email: `${subject}@example.test` };
    });

  const session = (principal: string) =>
    as((trx) =>
      trx
        .insertInto('session')
        .values({
          token_hash: randomBytes(32).toString('hex'),
          principal_id: principal,
          route: 'organisation',
          idle_expires_at: new Date(Date.now() + 3_600_000),
          expires_at: new Date(Date.now() + 7_200_000),
        })
        .execute(),
    );

  const count = (
    table: 'session' | 'api_token' | 'group_member' | 'invitation',
    principal: string,
  ) =>
    as(async (trx) =>
      Number(
        (
          await trx
            .selectFrom(table)
            .select((eb) => eb.fn.countAll<string>().as('count'))
            .where('principal_id', '=', principal)
            .executeTakeFirstOrThrow()
        ).count,
      ),
    );

  /** Labels naming them that no erasure has reached. */
  const liveLabels = (principal: string) =>
    as(async (trx) =>
      Number(
        (
          await trx
            .selectFrom('audit_label')
            .select((eb) => eb.fn.countAll<string>().as('count'))
            .where('refers_to', '=', principal)
            .where('erased_at', 'is', null)
            .executeTakeFirstOrThrow()
        ).count,
      ),
    );

  const principalRow = (id: string) =>
    as((trx) =>
      trx
        .selectFrom('principal')
        .select(['id', 'issuer', 'subject', 'email', 'email_verified', 'display_name'])
        .select(sql<boolean>`erased_at is not null`.as('erased'))
        .where('id', '=', id)
        .executeTakeFirst(),
    );

  const recorded = async <T>(act: () => Promise<T>) => {
    const before = await as(newestEvent);
    const answer = await act();
    return { answer, events: await as((trx) => auditEvents(trx, before)) };
  };

  /** Grace, as everything a person leaves holds her: signed in twice, a token, two groups, an invitation. */
  async function grace() {
    const address = `grace-${randomUUID()}@example.test`;
    const subject = randomUUID();
    const id = await as(async (trx) => {
      const invited = await invite(trx, { email: address, external: false, invitedBy: ada });
      if (!('invited' in invited)) throw new Error('not invited');
      const claimed = await claimInvitation(
        trx,
        { issuer: ISSUER, subject, email: address, emailVerified: true, name: 'Grace' },
        'organisation',
      );
      return claimed!;
    }, adaActs);
    const graceActs: AuditContext = { actorKind: 'person', actor: id, actorLabel: 'Grace' };
    await session(id);
    await session(id);
    await as(
      (trx) =>
        issueApiToken(trx, {
          principalId: id,
          name: 'Grace laptop',
          tokenHash: randomBytes(32).toString('hex'),
          scopes: ['edit'],
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      graceActs,
    );
    await as(async (trx) => {
      const own = await createGroup(trx, `Nurses ${randomUUID()}`);
      if (!('group' in own)) throw new Error('no group');
      await addToGroup(trx, own.group.id, id);
      const value = `wards-${randomUUID()}`;
      await createGroup(trx, `Wards ${randomUUID()}`, { providerValue: value });
      await syncProviderGroups(trx, id, [value]);
    }, adaActs);
    const authored = await as(async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title: 'Ward procedure',
        language: 'en-GB',
        direction: 'ltr',
        author: id,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version.artifactId;
    }, graceActs);
    return { id, subject, address, authored };
  }

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const tenantId = db.newTenantId();
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: tenantId, name: 'Production' },
      hostnames: [`${tenantId}.alloy.test`],
    });
    service = createTenantDatabase(db.serviceUrl);
    ada = (await signedIn('Ada')).id;
    adaActs = { actorKind: 'person', actor: ada, actorLabel: 'Ada', traceId: 'req-erase' };
    space = (await as((trx) => createSpace(trx, 'Clinical'), adaActs)).id;
    // A person-valued Owner on a Protocol type, so a component names somebody in its words.
    const defined = async (kind: 'field' | 'metadataSchema' | 'componentType', body: object) => {
      const made = await as((trx) =>
        createDefinition(trx, {
          kind,
          author: ada,
          definition: { schemaVersion: DEFINITION_SCHEMA_VERSION, ...body },
        } as never),
      );
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.definition.id;
    };
    owner = await defined('field', {
      name: 'Owner',
      dataType: 'user',
      multiplicity: 'one',
      validation: {},
    });
    const review = await defined('metadataSchema', {
      name: 'Review',
      entries: [{ field: owner, required: false, fixed: false }],
    });
    protocol = await defined('componentType', {
      name: 'Protocol',
      assignments: [{ schema: review, requires: [] }],
    });
  });

  /** A component of the Protocol type whose owner is `person`, saved; `cut` makes it a version. */
  async function ownedBy(person: string) {
    const session = randomUUID();
    const made = await as((trx) =>
      createComponent(trx, {
        spaceId: space,
        componentTypeId: protocol,
        title: 'Dosing',
        language: 'en-GB',
        direction: 'ltr',
        author: ada,
      }),
    );
    if (made.answer !== 'created') throw new Error(made.answer);
    const { version } = made;
    const at = { artifactId: version.artifactId, principal: ada, session };
    await as((trx) => claimLock(trx, at));
    const saved = await as((trx) =>
      saveIteration(trx, {
        ...at,
        sequence: 1,
        openedFrom: version.id,
        content: version.content as ContentDocument,
        values: { [owner]: { user: person } },
      }),
    );
    if (saved.answer !== 'accepted') throw new Error(saved.answer);
    return {
      artifactId: version.artifactId,
      cut: async (trx: TenantTransaction) => {
        const cut = await cutVersion(trx, { ...at, openedFrom: version.id });
        if (cut.answer !== 'recorded') throw new Error(cut.answer);
      },
    };
  }

  /** Every word search holds of an artifact, entries and places alike. */
  const searched = (artifact: string) =>
    as(async (trx) => {
      const entries = await trx
        .selectFrom('search_entry')
        .select('body')
        .where('artifact_id', '=', artifact)
        .execute();
      const places = await trx
        .selectFrom('search_text as t')
        .innerJoin('search_entry as e', 'e.id', 't.entry_id')
        .select('t.body')
        .where('e.artifact_id', '=', artifact)
        .execute();
      return [...entries, ...places].map((row) => row.body).join(' ');
    });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('VER-038 erases their name, address and every label naming them, and keeps their id, identity and what they wrote', async () => {
    const { id, subject, address, authored } = await grace();
    const preview = await as((trx) => erasureOf(trx, id, ada));
    expect(preview).toMatchObject({
      person: { id, kind: 'user', invited: false, erased: false },
      erases: { sessions: 2, tokens: 1, memberships: 2, invitation: true },
      refusals: [],
    });
    expect(preview!.erases.labels).toBeGreaterThan(0);
    expect(preview!.remains.events).toBeGreaterThan(0);

    const { answer, events } = await recorded(() =>
      as((trx) => erasePerson(trx, id, ada), adaActs),
    );
    expect(answer).toMatchObject({ answer: 'erased' });

    // Every label naming her erased, the act's own events' included.
    expect(await liveLabels(id)).toBe(0);
    const named = await queryAs(
      db.adminUrl,
      `select count(*)::int as count from ${tenant.schema}.audit_label
        where text in ('Grace', 'Grace laptop', $1)`,
      [address],
    );
    expect(named.rows[0]!.count).toBe(0);
    // Her name the fixed word, her address gone; her id, issuer and subject kept.
    expect(await principalRow(id)).toEqual({
      id,
      issuer: ISSUER,
      subject,
      email: null,
      email_verified: false,
      display_name: ERASED_NAME,
      erased: true,
    });
    // Her access ended: sessions, token, memberships and the accepted invitation, whose row held her address.
    expect(await count('session', id)).toBe(0);
    expect(await count('api_token', id)).toBe(0);
    expect(await count('group_member', id)).toBe(0);
    expect(await count('invitation', id)).toBe(0);
    // What she wrote stays, still hers by id.
    const author = await as((trx) =>
      trx
        .selectFrom('artifact_version')
        .select('author_id')
        .where('artifact_id', '=', authored)
        .executeTakeFirstOrThrow(),
    );
    expect(author.author_id).toBe(id);

    // Every event recorded before the erasure of labels, which comes last, naming Ada and nobody erased.
    expect(events.map((event) => event.kind)).toEqual([
      'authentication.signed_out',
      'authentication.signed_out',
      'token.revoked',
      'group.member_removed',
      'group.member_removed',
      'audit.label_erased',
    ]);
    expect(events.slice(0, 2).map((event) => event.detail['ended'])).toEqual(['erased', 'erased']);
    const erasure = events.at(-1)!;
    expect(erasure).toMatchObject({
      actorKind: 'person',
      actor: ada,
      subjectKind: 'principal',
      subject: id,
      outcome: 'done',
      traceId: 'req-erase',
      // Those named now, and the six the act's own events wrote: a token's name is its holder's.
      detail: { labels: preview!.erases.labels + 6 },
    });
    expect(erasure.labels).toEqual({ actor: { text: 'Ada', refersTo: ada, erased: false } });
  });

  it('refuses while a grant names them, for oneself and for a service, and erases the erased once', async () => {
    const alan = (await signedIn('Alan')).id;
    const reader = (await as((trx) => findRole(trx, 'Reader')))!.id;
    const granted = await as(
      (trx) =>
        grant(trx, {
          roleId: reader,
          subject: { principal: alan },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        }),
      adaActs,
    );
    expect(granted).toHaveProperty('granted');
    const refused = await recorded(() => as((trx) => erasePerson(trx, alan, ada), adaActs));
    expect(refused).toEqual({
      answer: { answer: 'refused', refusals: [{ reason: 'granted', grants: 1 }] },
      events: [],
    });
    expect((await principalRow(alan))!.display_name).toBe('Alan');

    expect(await as((trx) => erasePerson(trx, ada, ada), adaActs)).toEqual({
      answer: 'refused',
      refusals: [{ reason: 'self' }],
    });
    const robot = (await signedIn('Publishing robot', 'service')).id;
    expect(await as((trx) => erasureOf(trx, robot, ada))).toMatchObject({
      refusals: [{ reason: 'service' }],
    });
    expect(await as((trx) => erasePerson(trx, robot, ada), adaActs)).toEqual({
      answer: 'refused',
      refusals: [{ reason: 'service' }],
    });
    expect(await as((trx) => erasePerson(trx, randomUUID(), ada), adaActs)).toBeUndefined();

    const { id } = await grace();
    await as((trx) => erasePerson(trx, id, ada), adaActs);
    const again = await recorded(() => as((trx) => erasePerson(trx, id, ada), adaActs));
    expect(again).toEqual({ answer: { answer: 'unchanged' }, events: [] });
    expect(await as((trx) => erasureOf(trx, id, ada))).toMatchObject({
      person: { erased: true },
      refusals: [],
    });
  });

  it('VER-038 withdraws and erases somebody invited who never signed in, in one act', async () => {
    const address = `ivy-${randomUUID()}@example.test`;
    const ivy = await as(async (trx) => {
      const invited = await invite(trx, { email: address, external: true, invitedBy: ada });
      if (!('invited' in invited)) throw new Error('not invited');
      return invited.invited.principalId;
    }, adaActs);
    expect(await as((trx) => erasureOf(trx, ivy, ada))).toMatchObject({
      person: { invited: true },
      erases: { invitation: true },
    });
    const { answer, events } = await recorded(() =>
      as((trx) => erasePerson(trx, ivy, ada), adaActs),
    );
    expect(answer).toMatchObject({ answer: 'erased' });
    expect(events.map((event) => event.kind)).toEqual([
      'invitation.withdrawn',
      'audit.label_erased',
    ]);
    expect(await liveLabels(ivy)).toBe(0);
    expect(await principalRow(ivy)).toBeUndefined();
    const held = await queryAs(
      db.adminUrl,
      `select count(*)::int as count from ${tenant.schema}.invitation where email = $1`,
      [address],
    );
    expect(held.rows[0]!.count).toBe(0);
  });

  it('refuses their own id in capitals as erasing oneself', async () => {
    expect(await as((trx) => erasureOf(trx, ada.toUpperCase(), ada))).toMatchObject({
      refusals: [{ reason: 'self' }],
    });
  });

  it('withdraws somebody invited who holds a grant, recording the grant revoked', async () => {
    const ivy = await as(async (trx) => {
      const invited = await invite(trx, {
        email: `ivy-${randomUUID()}@example.test`,
        external: false,
        invitedBy: ada,
      });
      if (!('invited' in invited)) throw new Error('not invited');
      const granted = await grant(trx, {
        roleId: (await findRole(trx, 'Reader'))!.id,
        subject: { principal: invited.invited.principalId },
        level: { kind: 'space', id: space },
        effect: 'allow',
        grantedBy: ada,
      });
      if (!('granted' in granted)) throw new Error('not granted');
      return invited.invited.principalId;
    }, adaActs);
    expect(await as((trx) => erasureOf(trx, ivy, ada))).toMatchObject({ refusals: [] });
    const { answer, events } = await recorded(() =>
      as((trx) => erasePerson(trx, ivy, ada), adaActs),
    );
    expect(answer).toMatchObject({ answer: 'erased' });
    expect(events.map((event) => event.kind)).toEqual([
      'access.revoked',
      'invitation.withdrawn',
      'audit.label_erased',
    ]);
    expect(await principalRow(ivy)).toBeUndefined();
  });

  it('throws, changing nothing, where an invitation cannot be withdrawn', async () => {
    const orphan = await as((trx) =>
      trx
        .insertInto('principal')
        .values({ display_name: 'Nell', email: `nell-${randomUUID()}@example.test`, kind: 'user' })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    await expect(as((trx) => erasePerson(trx, orphan.id, ada), adaActs)).rejects.toThrow(
      /could not be withdrawn/,
    );
    expect((await principalRow(orphan.id))!.display_name).toBe('Nell');
  });

  it('ends what an erased person still holds when they are erased again, naming nobody', async () => {
    const { id } = await grace();
    await as((trx) => erasePerson(trx, id, ada), adaActs);
    // Left behind by a sign-in or a grant that raced the act.
    const reader = (await as((trx) => findRole(trx, 'Reader')))!.id;
    await session(id);
    await as(async (trx) => {
      await issueApiToken(trx, {
        principalId: id,
        name: 'Laptop',
        tokenHash: randomBytes(32).toString('hex'),
        scopes: ['edit'],
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      const own = await createGroup(trx, `Porters ${randomUUID()}`);
      if (!('group' in own)) throw new Error('no group');
      await trx
        .insertInto('group_member')
        .values({ group_id: own.group.id, principal_id: id, asserted_at: null })
        .execute();
      await trx
        .insertInto('access_grant')
        .values({
          role_id: reader,
          principal_id: id,
          level: 'space',
          space_id: space,
          effect: 'allow',
          granted_by: ada,
        })
        .execute();
    });
    const again = await recorded(() => as((trx) => erasePerson(trx, id, ada), adaActs));
    expect(again.answer).toEqual({ answer: 'unchanged' });
    expect(again.events.map((event) => event.kind)).toEqual([
      'authentication.signed_out',
      'token.revoked',
      'access.revoked',
      'group.member_removed',
    ]);
    for (const table of ['session', 'api_token', 'group_member'] as const) {
      expect(await count(table, id), table).toBe(0);
    }
    const grants = await queryAs(
      db.adminUrl,
      `select count(*)::int as count from ${tenant.schema}.access_grant where principal_id = $1`,
      [id],
    );
    expect(grants.rows[0]!.count).toBe(0);
    expect(await liveLabels(id)).toBe(0);
  });

  it('refuses a grant or a membership naming an erased person', async () => {
    const { id } = await grace();
    await as((trx) => erasePerson(trx, id, ada), adaActs);
    const reader = (await as((trx) => findRole(trx, 'Reader')))!.id;
    expect(
      await as((trx) =>
        grant(trx, {
          roleId: reader,
          subject: { principal: id },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ada,
        }),
      ),
    ).toEqual({ refused: 'grant.subject_erased' });
    const group = await as(async (trx) => {
      const made = await createGroup(trx, `Cleaners ${randomUUID()}`);
      if (!('group' in made)) throw new Error('no group');
      return made.group.id;
    });
    expect(await as((trx) => setGroupMembers(trx, group, [ada, id]))).toEqual({
      refused: 'group.member_erased',
    });
    expect(await as((trx) => addToGroup(trx, group, id))).toEqual({
      refused: 'group.member_erased',
    });
    expect(await count('group_member', id)).toBe(0);
  });

  it('writes every label naming them as the fixed word once they are erased, from a stale context or racing the act', async () => {
    const stale = await grace();
    await as((trx) => erasePerson(trx, stale.id, ada), adaActs);
    // A request that read her name before the act, recording after it.
    const before = await as(newestEvent);
    await as(
      (trx) =>
        recordEvent(
          trx,
          {
            kind: 'authentication.signed_out',
            subject: { kind: 'principal', id: stale.id },
            detail: { ended: 'signed_out', session: randomUUID() },
          },
          [{ role: 'subject', text: 'Grace', refersTo: stale.id }],
        ),
      { actorKind: 'person', actor: stale.id, actorLabel: 'Grace' },
    );
    const [late] = await as((trx) => auditEvents(trx, before));
    expect(late!.labels).toEqual({
      actor: { text: 'erased', refersTo: stale.id, erased: true },
      subject: { text: 'erased', refersTo: stale.id, erased: true },
    });

    // A worker naming her while the act is in flight waits for it, then names nobody.
    const { id } = await grace();
    let erased!: () => void;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (erased = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const erasing = as(async (trx) => {
      await erasePerson(trx, id, ada);
      erased();
      await gate;
    }, adaActs);
    await held;
    const writing = as((trx) =>
      recordEvent(
        trx,
        {
          kind: 'authentication.signed_out',
          subject: { kind: 'principal', id },
          detail: { ended: 'expired', session: randomUUID() },
        },
        [{ role: 'subject', text: 'Grace', refersTo: id }],
      ),
    );
    await untilWaitingOnLocks(db.adminUrl, 1);
    release();
    await erasing;
    await writing;
    expect(await liveLabels(id)).toBe(0);
  });

  it('answers missing for a principal it cannot hold, apart from erased', async () => {
    expect(await as((trx) => holdPrincipal(trx, randomUUID()))).toBe('missing');
    expect(await as((trx) => holdPrincipal(trx, ada))).toBe('held');
  });

  it('refuses a later sign-in by the same issuer and subject, never naming them again, and lists them as nobody', async () => {
    const { id, subject } = await grace();
    await as((trx) => erasePerson(trx, id, ada), adaActs);
    const identity = {
      issuer: ISSUER,
      subject,
      email: 'grace@example.test',
      emailVerified: true,
      name: 'Grace',
    };
    expect(await as((trx) => identifyKnown(trx, identity))).toBe('erased');
    expect((await principalRow(id))!.display_name).toBe(ERASED_NAME);
    // Not even the schema's owner names them again.
    await expect(
      queryAs(
        db.adminUrl,
        `update ${tenant.schema}.principal set display_name = 'Grace' where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/never named again/);
    // No label is ever written for them, and the people picker leaves them out.
    expect(await as((trx) => principalLabel(trx, 'subject', id))).toBeUndefined();
    const people = await as((trx) => listPeople(trx, { limit: 100 }));
    expect(people.items.map((each) => each.id)).not.toContain(id);
    // Somebody never erased is found, and their claims kept.
    const alan = await signedIn('Alan');
    expect(
      await as((trx) =>
        identifyKnown(trx, { ...identity, subject: alan.subject, name: 'Alan Turing' }),
      ),
    ).toEqual({ id: alan.id });
    expect((await principalRow(alan.id))!.display_name).toBe('Alan Turing');
  });

  it('serialises a sign-in racing the act: it waits, then is refused', async () => {
    const { id, subject } = await grace();
    let erased!: () => void;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (erased = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const erasing = as(async (trx) => {
      const answer = await erasePerson(trx, id, ada);
      erased();
      await gate;
      return answer;
    }, adaActs);
    await held;
    const signing = as((trx) =>
      identifyKnown(trx, {
        issuer: ISSUER,
        subject,
        email: 'grace@example.test',
        emailVerified: true,
        name: 'Grace',
      }),
    );
    // Its lookup waits behind the act's hold of her row.
    await untilWaitingOnLocks(db.adminUrl, 1);
    release();
    expect(await erasing).toMatchObject({ answer: 'erased' });
    expect(await signing).toBe('erased');
    expect((await principalRow(id))!.display_name).toBe(ERASED_NAME);
    expect(await liveLabels(id)).toBe(0);
  });

  it('VER-038 rewrites search, so their former name finds nothing that named them', async () => {
    const { id } = await grace();
    const named = await ownedBy(id);
    await as(named.cut);
    expect(await searched(named.artifactId)).toContain('Grace');
    await as((trx) => erasePerson(trx, id, ada), adaActs);
    const said = await searched(named.artifactId);
    expect(said).not.toContain('Grace');
    expect(said).toContain(ERASED_NAME);
  });

  it('VER-038 rewrites search for somebody invited who never signed in', async () => {
    const id = await as(async (trx) => {
      const invited = await invite(trx, {
        email: `alan-${randomUUID()}@example.test`,
        external: false,
        invitedBy: ada,
      });
      if (!('invited' in invited)) throw new Error('not invited');
      return invited.invited.principalId;
    }, adaActs);
    await as((trx) =>
      trx.updateTable('principal').set({ display_name: 'Alan' }).where('id', '=', id).execute(),
    );
    const named = await ownedBy(id);
    await as(named.cut);
    expect(await searched(named.artifactId)).toContain('Alan');
    expect(await as((trx) => erasePerson(trx, id, ada), adaActs)).toMatchObject({
      answer: 'erased',
    });
    expect(await searched(named.artifactId)).not.toContain('Alan');
  });

  it('serialises a version indexed while the act runs: the act waits, then rewrites it', async () => {
    const { id } = await grace();
    const named = await ownedBy(id);
    let indexed!: () => void;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (indexed = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const cutting = as(async (trx) => {
      await named.cut(trx);
      indexed();
      await gate;
    });
    await held;
    const erasing = as((trx) => erasePerson(trx, id, ada), adaActs);
    // The act waits behind the version's hold of her row.
    try {
      await untilWaitingOnLocks(db.adminUrl, 1);
    } finally {
      release();
    }
    await cutting;
    expect(await erasing).toMatchObject({ answer: 'erased' });
    expect(await searched(named.artifactId)).not.toContain('Grace');
  });
});
