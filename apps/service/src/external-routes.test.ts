import {
  bootstrapCluster,
  createComponent,
  createDocument,
  createSpace,
  createTenant,
  findRole,
  foldDigests,
  grant,
  migrate,
  recordVersion,
  substanceOf,
  type StoredVersion,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import type { BlockNode, ContentDocument, OutlineDocument, OutlineNode } from '@alloy-works/domain';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = '127.0.0.1';
const text = (value: string) => ({ type: 'text' as const, value, marks: [] });
const para = (id: string, value: string): BlockNode => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [text(value)],
});
const said = (value: string) => [{ text: value }];
const SPAN = { kind: 'span', block: 'p1', quote: 'the tray', before: 'Set ' };

describe('people from outside the organisation (the R13 plan)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let clinical = '';
  let quality = '';
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (method: 'GET' | 'POST' | 'PUT', url: string, who: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, cookie: cookies[who]! },
      ...(payload ? { payload } : {}),
    });

  /** A component in a space, by its author, at a version holding these blocks. */
  const component = (blocks: BlockNode[], space = clinical, author = 'ada') =>
    tenantDb
      .withTenant(tenant, async (trx) => {
        const made = await createComponent(trx, {
          spaceId: space,
          title: 'Install the printer',
          language: 'en-GB',
          direction: 'ltr',
          author: ids[author]!,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        return made.version;
      })
      .then((made) => revise(made, blocks, author));
  const revise = (version: StoredVersion, blocks: BlockNode[], author = 'ada') =>
    tenantDb.withTenant(tenant, async (trx) => {
      const substance = substanceOf(version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const next = await recordVersion(trx, {
        artifactId: version.artifactId,
        openedFrom: version.id,
        author: ids[author]!,
        substance: {
          ...substance,
          content: { ...substance.content, content: blocks } as ContentDocument,
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
    });
  const documentWith = (nodes: OutlineNode[]) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const made = await createDocument(trx, {
        spaceId: clinical,
        title: 'Report',
        language: 'en-GB',
        direction: 'ltr',
        author: ids.ada!,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const recorded = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ids.ada!,
        substance: {
          kind: 'document',
          content: { ...(made.version.content as OutlineDocument), nodes },
        },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version;
    });
  const reference = (
    id: string,
    to: string,
    mode: OutlineNode extends never
      ? never
      : { kind: 'latest' } | { kind: 'pinned'; version: string },
  ): OutlineNode =>
    ({
      type: 'reference',
      id,
      component: to,
      mode,
      numbered: true,
      matter: 'body',
      pageBreak: 'none',
      values: {},
      children: [],
    }) as OutlineNode;
  const start = (on: StoredVersion, anchor: object, who = 'ada', kind = 'components') =>
    call('POST', `/v1/${kind}/${on.artifactId}/threads`, who, {
      version: on.id,
      anchor,
      parts: said('Is this right?'),
    });

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    idp = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy',
          clientSecret: 'stand-in-secret',
          redirectUris: [`http://${HOST}/v1/sign-in/organisation/callback`],
        },
      ],
    });
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    await configureStandIn(db.adminUrl, tenant, { issuer: idp.issuer, clientId: 'alloy' });
    tenantDb = testTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
    });
    // Alice is from outside the organisation, invited as such before she signs in (IAM-045).
    await tenantDb.withTenant(tenant, (trx) =>
      trx
        .insertInto('principal')
        .values({
          issuer: idp.issuer,
          subject: 'alice',
          email: null,
          display_name: 'Alice',
          kind: 'external',
        })
        .execute(),
    );
    for (const who of ['ada', 'grace', 'ivy', 'alice']) {
      cookies[who] = await signIn(app, HOST, who, idp.issuer);
      ids[who] = (await call('GET', '/v1/me', who)).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      clinical = (await createSpace(trx, 'Clinical')).id;
      quality = (await createSpace(trx, 'Quality')).id;
      const role = async (name: string) => (await findRole(trx, name))!.id;
      // Ada authors Clinical; Grace reviews it and authors Quality, which Ada may not read; Ivy reads
      // Clinical and may not comment.
      for (const [who, name, space] of [
        ['ada', 'Author', clinical],
        ['grace', 'Reviewer', clinical],
        ['grace', 'Author', quality],
        ['ivy', 'Reader', clinical],
        ['alice', 'Reviewer', clinical],
      ] as const) {
        await grant(trx, {
          roleId: await role(name),
          subject: { principal: ids[who]! },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ids.ada!,
        });
      }
      // Ada administers the environment, which managing access needs (the R13 plan, R13-E, R13-F).
      await grant(trx, {
        roleId: await role('Administrator'),
        subject: { principal: ids.ada! },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await tenantDb?.close();
    await db?.drop();
  });

  it('IAM-045 says who is from outside on a thread, a comment, a suggestion, a round and the people picker', async () => {
    const version = await component([para('p1', 'Set the tray carefully.')]);
    const started = await start(version, SPAN, 'alice');
    expect(started.statusCode, started.body).toBe(200);
    const thread = started.json<{ id: string }>().id;
    const replied = await call('POST', `/v1/threads/${thread}/comments`, 'ada', {
      parts: said('Agreed.'),
    });
    expect(replied.statusCode, replied.body).toBe(200);

    const listed = (await call('GET', `/v1/components/${version.artifactId}/threads`, 'ada')).json<{
      threads: { startedBy: object }[];
    }>();
    expect(listed.threads[0]!.startedBy).toEqual({ id: ids.alice, name: 'Alice', external: true });
    const read = (await call('GET', `/v1/threads/${thread}`, 'ada')).json<{
      comments: { author: object }[];
    }>();
    expect(read.comments.map((each) => each.author)).toEqual([
      { id: ids.alice, name: 'Alice', external: true },
      { id: ids.ada, name: 'Ada' },
    ]);

    const suggested = await call(
      'POST',
      `/v1/components/${version.artifactId}/suggestions`,
      'alice',
      {
        version: version.id,
        content: {
          ...(version.content as ContentDocument),
          content: [para('p1', 'Set the tray with care.')],
        },
      },
    );
    expect(suggested.statusCode, suggested.body).toBe(200);
    const pending = (
      await call('GET', `/v1/components/${version.artifactId}/suggestions?state=pending`, 'ada')
    ).json<{ suggestions: { madeBy: object }[] }>();
    expect(pending.suggestions.map((each) => each.madeBy)).toEqual([
      { id: ids.alice, name: 'Alice', external: true },
    ]);

    const people = (await call('GET', '/v1/people', 'ada')).json<{
      items: { id: string; name: string; external?: true }[];
    }>();
    expect(people.items.find((each) => each.id === ids.alice)).toEqual({
      id: ids.alice,
      name: 'Alice',
      external: true,
    });
    expect(people.items.find((each) => each.id === ids.ada)).toEqual({ id: ids.ada, name: 'Ada' });
  });

  it('COL-059 names a reviewer from outside on a round on the same terms as one inside', async () => {
    const printer = await component([para('p1', 'Set the tray.')]);
    const document = await documentWith([
      reference('a'.repeat(26), printer.artifactId, { kind: 'latest' }),
    ]);
    const opened = await call('POST', `/v1/documents/${document.artifactId}/rounds`, 'ada', {
      title: 'Client review',
      dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      reviewers: [ids.alice, ids.grace],
    });
    expect(opened.statusCode, opened.body).toBe(200);
    expect(
      opened.json<{ reviewers: { person: object; mayReview: boolean }[] }>().reviewers,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          person: { id: ids.alice, name: 'Alice', external: true },
          mayReview: true,
        }),
        expect.objectContaining({ person: { id: ids.grace, name: 'Grace' }, mayReview: true }),
      ]),
    );
    // Ivy, who may read and not comment or suggest, is refused, as she always was.
    const refused = await call('POST', `/v1/documents/${document.artifactId}/rounds`, 'ada', {
      title: 'Client review',
      dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      reviewers: [ids.ivy],
    });
    expect(refused.statusCode).toBe(400);
  });

  describe('internal threads (the R13 plan, R13-C, R13-D)', () => {
    const inbox = async (who: string) =>
      (await call('GET', '/v1/inbox', who)).json<{ notifications: { thread: string | null }[] }>()
        .notifications;

    it('COL-038 keeps an internal thread from somebody outside by every route, and shows it, marked, to everybody inside', async () => {
      const version = await component([para('p1', 'Set the tray carefully.')]);
      const started = await call('POST', `/v1/components/${version.artifactId}/threads`, 'ada', {
        version: version.id,
        anchor: SPAN,
        parts: [
          { text: 'Before the client sees it, ' },
          { mention: ids.alice },
          { mention: ids.grace },
        ],
        internal: true,
      });
      expect(started.statusCode, started.body).toBe(200);
      const thread = started.json<{ id: string; internal: boolean }>();
      expect(thread.internal).toBe(true);

      // Somebody inside sees it, marked; and is told of it.
      const asGrace = await call('GET', `/v1/threads/${thread.id}`, 'grace');
      expect(asGrace.json<{ internal: boolean }>().internal).toBe(true);
      expect((await inbox('grace')).map((each) => each.thread)).toContain(thread.id);

      // Somebody outside is shown nothing of it, and told nothing.
      const listed = (await call('GET', `/v1/components/${version.artifactId}/threads`, 'alice'))
        .json<{ threads: { id: string }[] }>()
        .threads.map((each) => each.id);
      expect(listed).not.toContain(thread.id);
      for (const [method, url, body] of [
        ['GET', `/v1/threads/${thread.id}`, undefined],
        ['POST', `/v1/threads/${thread.id}/comments`, { parts: said('May I see?') }],
        ['POST', `/v1/threads/${thread.id}/resolution`, {}],
      ] as const) {
        expect((await call(method, url, 'alice', body)).statusCode, `${method} ${url}`).toBe(404);
      }
      expect((await inbox('alice')).map((each) => each.thread)).not.toContain(thread.id);
    });

    it('COL-038 makes an open thread internal, never public again, and only by somebody inside', async () => {
      const version = await component([para('p1', 'Set the tray carefully.')]);
      const started = await start(version, SPAN, 'ada');
      const thread = started.json<{ id: string; internal: boolean }>();
      expect(thread.internal).toBe(false);
      expect((await call('GET', `/v1/threads/${thread.id}`, 'alice')).statusCode).toBe(200);

      // Somebody outside may not make it so.
      expect(
        (await call('POST', `/v1/threads/${thread.id}/internal`, 'alice', {})).statusCode,
      ).toBe(404);
      const marked = await call('POST', `/v1/threads/${thread.id}/internal`, 'grace', {});
      expect(marked.statusCode, marked.body).toBe(200);
      expect(marked.json<{ internal: boolean }>().internal).toBe(true);
      expect((await call('GET', `/v1/threads/${thread.id}`, 'alice')).statusCode).toBe(404);
      // Marked again, it stays as it is.
      expect(
        (await call('POST', `/v1/threads/${thread.id}/internal`, 'ada', {})).json<{
          internal: boolean;
        }>().internal,
      ).toBe(true);

      // A resolved thread is not marked: it is closed as it stood.
      const other = (await start(version, SPAN, 'ada')).json<{ id: string }>();
      await call('POST', `/v1/threads/${other.id}/resolution`, 'ada', {});
      const refused = await call('POST', `/v1/threads/${other.id}/internal`, 'ada', {});
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ code: 'thread_resolved' });
    });

    it('COL-038 counts no internal thread for somebody outside, on a round they review', async () => {
      const printer = await component([para('p1', 'Set the tray carefully.')]);
      const document = await documentWith([
        reference('b'.repeat(26), printer.artifactId, { kind: 'latest' }),
      ]);
      const opened = await call('POST', `/v1/documents/${document.artifactId}/rounds`, 'ada', {
        title: 'Client review',
        dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        reviewers: [ids.alice, ids.grace],
      });
      const round = opened.json<{ id: string }>().id;
      const grace = await call('POST', `/v1/components/${printer.artifactId}/threads`, 'grace', {
        version: printer.id,
        anchor: SPAN,
        parts: said('Between us: is this right?'),
        internal: true,
      });
      expect(grace.statusCode, grace.body).toBe(200);
      const threadsOf = async (who: string) =>
        (await call('GET', `/v1/rounds/${round}`, who))
          .json<{ reviewers: { person: { id: string }; threads: number }[] }>()
          .reviewers.find((each) => each.person.id === ids.grace)!.threads;
      expect(await threadsOf('ada')).toBe(1);
      expect(await threadsOf('alice')).toBe(0);
    });

    it('COL-038 counts nothing in a digest for somebody outside of a thread made internal before it folded', async () => {
      await call('PUT', '/v1/inbox/preferences', 'alice', {
        mention: 'daily',
        reply: 'daily',
        resolution: 'daily',
        round: 'at_once',
      });
      const version = await component([para('p1', 'Set the tray carefully.')]);
      const thread = (await start(version, SPAN, 'ada')).json<{ id: string }>().id;
      await call('POST', `/v1/threads/${thread}/comments`, 'alice', { parts: said('Looks fine.') });
      await call('POST', `/v1/threads/${thread}/comments`, 'ada', { parts: said('Thanks.') });
      await call('POST', `/v1/threads/${thread}/internal`, 'ada', {});
      await tenantDb.withTenant(tenant, (trx) =>
        foldDigests(trx, new Date(Date.now() + 2 * 86_400_000)),
      );
      const digests = (await call('GET', '/v1/inbox', 'alice'))
        .json<{ notifications: { kind: string; counts: { reply: number } | null }[] }>()
        .notifications.filter((each) => each.kind === 'digest');
      expect(digests.every((each) => (each.counts?.reply ?? 0) === 0)).toBe(true);
    });

    it('SCH-072 filters threads in search by whether they are internal, and never finds an internal one for somebody outside', async () => {
      const version = await component([para('p1', 'Set the tray carefully.')]);
      const word = 'zephyrine';
      const open = async (internal: boolean) =>
        (
          await call('POST', `/v1/components/${version.artifactId}/threads`, 'ada', {
            version: version.id,
            anchor: SPAN,
            parts: said(`The ${word} reading`),
            internal,
          })
        ).json<{ id: string }>().id;
      const inside = await open(true);
      const shared = await open(false);
      const found = async (who: string, filter = '') =>
        (await call('GET', `/v1/search?q=${word}&kind=thread${filter}`, who))
          .json<{ items: { thread: { id: string } | null }[] }>()
          .items.map((each) => each.thread?.id)
          .sort();
      expect(await found('ada')).toEqual([inside, shared].sort());
      expect(await found('ada', '&internal=true')).toEqual([inside]);
      expect(await found('ada', '&internal=false')).toEqual([shared]);
      expect(await found('alice')).toEqual([shared]);
      expect(await found('alice', '&internal=true')).toEqual([]);
    });
  });

  describe('extending access from outside, and listing it (the R13 plan, R13-E, R13-F)', () => {
    const DAY = 86_400_000;
    const grantsAt = async (level: string) =>
      (await call('GET', `/v1/grants?level=${level}`, 'ada')).json<{
        items: {
          id: string;
          subject: { principal?: { id: string } };
          expiresAt: string | null;
          extends: string | null;
        }[];
      }>().items;
    const aliceAt = async (level: string) =>
      (await grantsAt(level)).find((each) => each.subject.principal?.id === ids.alice)!;

    it('IAM-050 extends access from outside as an act of somebody inside, no further than the cap, audited with both expiries', async () => {
      const before = await aliceAt(`space:${clinical}`);
      expect(before.expiresAt).not.toBeNull();
      const extend = (id: string, expiresAt: string, who = 'ada') =>
        call('POST', `/v1/grants/${id}/extension`, who, { expiresAt });

      // Past the tenant's cap, refused; no later than it stands, refused.
      const past = await extend(before.id, new Date(Date.now() + 200 * DAY).toISOString());
      expect(past.statusCode).toBe(409);
      expect(past.json()).toMatchObject({ code: 'grant_external_past_cap' });
      // Not to a day already past, whatever the grant held (the R13 final review).
      const gone = await extend(before.id, new Date(Date.now() - DAY).toISOString());
      expect(gone.statusCode).toBe(409);
      expect(gone.json()).toMatchObject({ code: 'grant_not_later' });
      const sooner = await extend(before.id, new Date(Date.now() + DAY).toISOString());
      expect(sooner.statusCode).toBe(409);
      expect(sooner.json()).toMatchObject({ code: 'grant_not_later' });
      // Somebody inside the organisation is not extended this way.
      const grace = (await grantsAt(`space:${clinical}`)).find(
        (each) => each.subject.principal?.id === ids.grace,
      )!;
      const inside = await extend(grace.id, new Date(Date.now() + 60 * DAY).toISOString());
      expect(inside.statusCode).toBe(409);
      expect(inside.json()).toMatchObject({ code: 'grant_not_external' });
      // Nor by anybody who does not administer where it stands.
      expect(
        (await extend(before.id, new Date(Date.now() + 60 * DAY).toISOString(), 'grace'))
          .statusCode,
      ).toBe(404);

      const until = new Date(Date.now() + 60 * DAY).toISOString();
      const extended = await extend(before.id, until);
      expect(extended.statusCode, extended.body).toBe(200);
      const made = extended.json<{ grant: { id: string; expiresAt: string; extends: string } }>()
        .grant;
      expect(made.extends).toBe(before.id);
      expect(new Date(made.expiresAt).toISOString()).toBe(until);
      // The grant it extends is gone, in the same change.
      expect((await grantsAt(`space:${clinical}`)).map((each) => each.id)).not.toContain(before.id);
      const events = (
        await call('GET', `/v1/audit?kind=access.granted&subject=${made.id}`, 'ada')
      ).json<{ items: { detail: Record<string, unknown> }[] }>().items;
      expect(events[0]!.detail).toMatchObject({
        extends: before.id,
        expiresAt: until,
        extendedFrom: before.expiresAt,
      });
    });

    it('IAM-049 takes the expiry a grant to somebody from outside is made with, within the cap', async () => {
      const until = new Date(Date.now() + 10 * DAY).toISOString();
      const roles = (await call('GET', `/v1/roles?level=space:${quality}`, 'ada')).json<{
        items: { id: string; name: string }[];
      }>().items;
      const reader = roles.find((each) => each.name === 'Reader')!.id;
      // Not one already past: it would confer nothing from the moment it was made.
      const past = await call('POST', '/v1/grants', 'ada', {
        role: reader,
        subject: { principal: ids.alice },
        level: `space:${quality}`,
        effect: 'allow',
        expiresAt: new Date(Date.now() - DAY).toISOString(),
      });
      expect(past.statusCode).toBe(409);
      expect(past.json()).toMatchObject({ code: 'grant_expiry_past' });
      const made = await call('POST', '/v1/grants', 'ada', {
        role: reader,
        subject: { principal: ids.alice },
        level: `space:${quality}`,
        effect: 'allow',
        expiresAt: until,
      });
      expect(made.statusCode, made.body).toBe(200);
      expect(made.json<{ grant: { expiresAt: string } }>().grant.expiresAt).toBe(until);
    });

    it('IAM-051 lists everybody from outside, each grant reaching them with its level and expiry, and what they may read', async () => {
      const listed = await call('GET', '/v1/access/external', 'ada');
      expect(listed.statusCode, listed.body).toBe(200);
      const items = listed.json<{
        items: {
          principal: { id: string; name: string | null };
          grants: { level: string; expiresAt: string | null; role: { name: string } }[];
          reads: { spaces: { id: string; name: string }[] };
        }[];
      }>().items;
      expect(items.map((each) => each.principal.id)).toEqual([ids.alice]);
      const alice = items[0]!;
      expect(alice.grants.map((each) => [each.role.name, each.level])).toEqual(
        expect.arrayContaining([['Reviewer', `space:${clinical}`]]),
      );
      expect(alice.grants.every((each) => each.expiresAt !== null)).toBe(true);
      expect(
        alice.grants.every((each) => typeof (each as { expired?: boolean }).expired === 'boolean'),
      ).toBe(true);
      expect(alice.reads.spaces.map((each) => each.name)).toContain('Clinical');
      // An administrator's report alone.
      expect((await call('GET', '/v1/access/external', 'grace')).statusCode).toBe(403);
    });
  });
});
