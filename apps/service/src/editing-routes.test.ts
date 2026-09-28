// apps/service/src/editing-routes.test.ts
import { randomUUID } from 'node:crypto';
import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createArtifact,
  createSpace,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  latestVersion,
  migrate,
  seedDevelopmentContent,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  whileAccessIsDecided,
  type TestDatabase,
} from '@alloy-works/db/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
const MISSING = '00000000-0000-4000-8000-000000000000';

type Json = Record<string, unknown>;

const paragraphs = (...texts: string[]) => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: texts.map((text, index) => ({
    type: 'paragraph',
    id: `p${index + 1}`,
    style: 'body',
    content: [{ type: 'text', value: text, marks: [] }],
  })),
});

describe('writing in an editing session through the service', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let hidden: string;

  const call = (
    as: string | undefined,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    payload?: Json,
  ) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, ...(as ? { cookie: cookies[as]! } : {}) },
      ...(payload ? { payload } : {}),
    });

  /** A fresh component in General, which Ada and Grace author and Alice reads, at 0.1. */
  const component = async () =>
    tenantDb.withTenant(tenant, async (trx) => {
      const seeded = await trx
        .selectFrom('artifact')
        .select(['id', 'space_id'])
        .where('kind', '=', 'component')
        .orderBy('created_at')
        .executeTakeFirstOrThrow();
      const first = (await latestVersion(trx, seeded.id))!;
      const made = await createArtifact(trx, {
        author: ids.ada!,
        spaceId: seeded.space_id!,
        substance: {
          kind: 'component',
          content: paragraphs('Unbox the printer.') as never,
          values: {},
          notCarried: [],
          definitions: first.definitions,
        },
      });
      return { id: made.artifactId, openedFrom: made.id };
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
    await configureOrganisationSignIn(db.adminUrl, tenant, {
      issuer: idp.issuer,
      clientId: 'alloy',
      secretName: 'stand_in',
    });
    tenantDb = createTenantDatabase(db.serviceUrl);
    // Ada and Grace author General, as the development environment has them.
    await tenantDb.withTenant(tenant, (trx) => seedDevelopmentContent(trx, { issuer: idp.issuer }));
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
    });
    for (const user of ['ada', 'grace', 'alice']) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
      ids[user] = (await call(user, 'GET', '/v1/me')).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      const general = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: ids.alice! },
        level: { kind: 'space', id: general.id },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
      const seeded = await trx
        .selectFrom('artifact')
        .select('id')
        .where('kind', '=', 'component')
        .executeTakeFirstOrThrow();
      const first = (await latestVersion(trx, seeded.id))!;
      const quality = await createSpace(trx, 'Quality');
      hidden = (
        await createArtifact(trx, {
          author: ids.ada!,
          spaceId: quality.id,
          substance: {
            kind: 'component',
            content: paragraphs('Audit the fleet.') as never,
            values: {},
            notCarried: [],
            definitions: first.definitions,
          },
        })
      ).artifactId;
    });
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  describe('a session', () => {
    it('claims, saves, cuts a version and releases, and the version is what opening it shows', async () => {
      const made = await component();
      const session = randomUUID();
      const claimed = await call('ada', 'POST', `/v1/components/${made.id}/lock`, { session });
      expect(claimed.statusCode).toBe(200);
      expect(claimed.json()).toEqual({
        lock: {
          holder: { id: ids.ada, name: 'Ada' },
          expectedRelease: expect.any(String),
          yours: true,
          session,
        },
      });

      for (const [sequence, text] of [
        [1, 'Unbox'],
        [2, 'Unbox the printer and keep the box.'],
      ] as const) {
        const saved = await call(
          'ada',
          'PUT',
          `/v1/components/${made.id}/iterations/${session}/${sequence}`,
          { openedFrom: made.openedFrom, content: paragraphs(text) },
        );
        expect(saved.statusCode).toBe(200);
        expect(saved.json()).toMatchObject({ sequence, lock: { yours: true } });
      }

      const cut = await call('ada', 'POST', `/v1/components/${made.id}/versions`, {
        session,
        openedFrom: made.openedFrom,
        note: 'Keep the box',
      });
      expect(cut.statusCode).toBe(200);
      const version = cut.json<{ outcome: string; version: { id: string; number: string } }>();
      expect(version).toMatchObject({
        outcome: 'cut',
        version: { number: '0.2', note: 'Keep the box' },
      });

      const opened = await call('grace', 'GET', `/v1/components/${made.id}`);
      expect(opened.json()).toMatchObject({
        version: { id: version.version.id, number: '0.2' },
        content: paragraphs('Unbox the printer and keep the box.'),
        lock: { holder: { id: ids.ada, name: 'Ada' }, yours: false, session: null },
      });

      const released = await call(
        'ada',
        'DELETE',
        `/v1/components/${made.id}/lock?session=${session}&openedFrom=${version.version.id}`,
      );
      expect(released.statusCode).toBe(200);
      expect(released.json()).toMatchObject({ outcome: 'unchanged', version: { number: '0.2' } });
      expect((await call('ada', 'GET', `/v1/components/${made.id}`)).json()).toMatchObject({
        lock: null,
      });
    });

    it('VER-009 numbers each version cut next in its revision, and presents the pair as revision.version', async () => {
      const made = await component();
      const session = randomUUID();
      await call('ada', 'POST', `/v1/components/${made.id}/lock`, { session });

      // Opened at 0.1; two versions cut in one session. Only revision 0 exists until a revision is
      // designated (T4), so "within their revision" is shown within that one.
      const opened = await call('ada', 'GET', `/v1/components/${made.id}`);
      const numbers = [opened.json<{ version: { number: string } }>().version.number];
      let openedFrom = made.openedFrom;
      for (const [sequence, text] of [
        [1, 'Unbox the printer.'],
        [2, 'Unbox the printer and keep the box.'],
      ] as const) {
        await call('ada', 'PUT', `/v1/components/${made.id}/iterations/${session}/${sequence}`, {
          openedFrom,
          content: paragraphs(text, `Step ${sequence}.`),
        });
        const cut = await call('ada', 'POST', `/v1/components/${made.id}/versions`, {
          session,
          openedFrom,
        });
        const { version } = cut.json<{ version: { id: string; number: string } }>();
        numbers.push(version.number);
        // The session goes on from the version it cut.
        openedFrom = version.id;
      }

      expect(numbers).toEqual(['0.1', '0.2', '0.3']);
      expect((await call('grace', 'GET', `/v1/components/${made.id}`)).json()).toMatchObject({
        version: { number: '0.3' },
      });
      // What is stored is the pair, numbered 1, 2, 3 within revision 0.
      const stored = await tenantDb.withTenant(tenant, (trx) =>
        trx
          .selectFrom('artifact_version')
          .select(['revision_no', 'version_no'])
          .where('artifact_id', '=', made.id)
          .orderBy('version_no')
          .execute(),
      );
      expect(stored).toEqual([
        { revision_no: 0, version_no: 1 },
        { revision_no: 0, version_no: 2 },
        { revision_no: 0, version_no: 3 },
      ]);
    });

    it('CNT-173 stores characters outside the Basic Multilingual Plane and gives them back whole, in NFC', async () => {
      const made = await component();
      const session = randomUUID();
      await call('ada', 'POST', `/v1/components/${made.id}/lock`, { session });
      // Mathematical bold capital A, a grinning face, a Linear B syllable and a CJK Extension B
      // ideograph: four planes' worth, each two UTF-16 units.
      // And an e written as a letter and a combining acute, which the store keeps in NFC as one.
      const written = 'Mass \u{1d400}, \u{1f600}, \u{10000} and \u{20000}, café.';
      const kept = written.normalize('NFC');
      expect(kept).not.toBe(written);
      await call('ada', 'PUT', `/v1/components/${made.id}/iterations/${session}/1`, {
        openedFrom: made.openedFrom,
        content: paragraphs(written),
      });
      const cut = await call('ada', 'POST', `/v1/components/${made.id}/versions`, {
        session,
        openedFrom: made.openedFrom,
      });
      expect(cut.statusCode, cut.body).toBe(200);

      const opened = await call('grace', 'GET', `/v1/components/${made.id}`);
      const read = opened.json<{ content: { content: { content: { value: string }[] }[] } }>()
        .content.content[0]!.content[0]!.value;
      expect(read).toBe(kept);
      expect([...read].map((character) => character.codePointAt(0)!.toString(16))).toEqual(
        [...kept].map((character) => character.codePointAt(0)!.toString(16)),
      );
    });

    it('API-039 refuses every write to a component another identity holds, naming the holder and when it is expected back', async () => {
      const made = await component();
      const session = randomUUID();
      const claimed = await call('ada', 'POST', `/v1/components/${made.id}/lock`, { session });
      const expectedRelease = claimed.json<{ lock: { expectedRelease: string } }>().lock
        .expectedRelease;
      const theirs = randomUUID();
      const writes = [
        call('grace', 'POST', `/v1/components/${made.id}/lock`, { session: theirs }),
        // move does not let a different principal steal or move another's lock: still lock_held.
        call('grace', 'POST', `/v1/components/${made.id}/lock`, { session: theirs, move: true }),
        call('grace', 'PUT', `/v1/components/${made.id}/iterations/${theirs}/1`, {
          openedFrom: made.openedFrom,
          content: paragraphs('Hers'),
        }),
        call('grace', 'POST', `/v1/components/${made.id}/versions`, {
          session: theirs,
          openedFrom: made.openedFrom,
        }),
        call(
          'grace',
          'DELETE',
          `/v1/components/${made.id}/lock?session=${theirs}&openedFrom=${made.openedFrom}`,
        ),
      ];
      for (const response of await Promise.all(writes)) {
        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({
          code: 'lock_held',
          rule: 'API-039',
          holder: { id: ids.ada, name: 'Ada' },
          expectedRelease,
        });
        // Held is not forbidden: Grace may edit this component, and the refusal does not say otherwise.
        expect(response.json().message).not.toMatch(/permission/);
      }

      // None of Grace's refused writes left a trace: no iteration of hers, and no version beyond 0.1.
      const gracesIterations = await tenantDb.withTenant(tenant, (trx) =>
        trx
          .selectFrom('iteration')
          .select('id')
          .where('artifact_id', '=', made.id)
          .where('principal_id', '=', ids.grace!)
          .execute(),
      );
      expect(gracesIterations).toHaveLength(0);
      const versions = await tenantDb.withTenant(tenant, (trx) =>
        trx
          .selectFrom('artifact_version')
          .select('id')
          .where('artifact_id', '=', made.id)
          .execute(),
      );
      expect(versions).toHaveLength(1);
    });

    it('CNT-071 governs every write by the lock, even between two sessions of one author', async () => {
      const made = await component();
      const first = randomUUID();
      const second = randomUUID();
      await call('ada', 'POST', `/v1/components/${made.id}/lock`, { session: first });
      const elsewhere = await call(
        'ada',
        'PUT',
        `/v1/components/${made.id}/iterations/${second}/1`,
        { openedFrom: made.openedFrom, content: paragraphs('From the other window') },
      );
      expect(elsewhere.statusCode).toBe(409);
      expect(elsewhere.json()).toMatchObject({
        code: 'lock_held',
        rule: 'API-039',
        holder: { id: ids.ada },
      });

      const moved = await call('ada', 'POST', `/v1/components/${made.id}/lock`, {
        session: second,
        move: true,
      });
      expect(moved.statusCode).toBe(200);
      expect(moved.json()).toMatchObject({ lock: { session: second } });
      const stranded = await call('ada', 'PUT', `/v1/components/${made.id}/iterations/${first}/1`, {
        openedFrom: made.openedFrom,
        content: paragraphs('From the first window'),
      });
      expect(stranded.statusCode).toBe(409);
      expect(stranded.json()).toMatchObject({
        code: 'lock_held',
        rule: 'API-039',
        holder: { id: ids.ada },
      });

      const unheld = await component();
      const nobody = await call('ada', 'PUT', `/v1/components/${unheld.id}/iterations/${first}/1`, {
        openedFrom: unheld.openedFrom,
        content: paragraphs('Never claimed'),
      });
      expect(nobody.statusCode).toBe(409);
      expect(nobody.json()).toMatchObject({ code: 'lock_required', rule: 'COL-005' });
    });

    it('refuses a stale sequence, a conflicting one and a version that has moved on, with what the author needs', async () => {
      const made = await component();
      const session = randomUUID();
      const at = (sequence: number) =>
        `/v1/components/${made.id}/iterations/${session}/${sequence}`;
      await call('ada', 'POST', `/v1/components/${made.id}/lock`, { session });
      await call('ada', 'PUT', at(2), { openedFrom: made.openedFrom, content: paragraphs('Two') });

      const stale = await call('ada', 'PUT', at(1), {
        openedFrom: made.openedFrom,
        content: paragraphs('One'),
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({ code: 'iteration_stale', latest: 2 });
      const conflict = await call('ada', 'PUT', at(2), {
        openedFrom: made.openedFrom,
        content: paragraphs('Not two'),
      });
      expect(conflict.json()).toMatchObject({ code: 'iteration_conflict', latest: 2 });
      const retried = await call('ada', 'PUT', at(2), {
        openedFrom: made.openedFrom,
        content: paragraphs('Two'),
      });
      expect(retried.statusCode).toBe(200);

      const moved = await call('ada', 'PUT', at(3), {
        openedFrom: MISSING,
        content: paragraphs('Three'),
      });
      expect(moved.statusCode).toBe(409);
      expect(moved.json()).toMatchObject({
        code: 'version_precondition',
        rule: 'API-037',
        current: { id: made.openedFrom, number: '0.1' },
      });
    });

    it('answers a cut with nothing to cut as unchanged, not as a failure', async () => {
      const made = await component();
      const session = randomUUID();
      await call('ada', 'POST', `/v1/components/${made.id}/lock`, { session });
      const cut = await call('ada', 'POST', `/v1/components/${made.id}/versions`, {
        session,
        openedFrom: made.openedFrom,
      });
      expect(cut.statusCode).toBe(200);
      expect(cut.json()).toMatchObject({ outcome: 'unchanged', version: { id: made.openedFrom } });
    });

    it('refuses content the model does not accept, without quoting it back', async () => {
      const made = await component();
      const session = randomUUID();
      await call('ada', 'POST', `/v1/components/${made.id}/lock`, { session });
      const twice = paragraphs('Secret words', 'Secret words');
      twice.content[1]!.id = 'p1';
      const response = await call(
        'ada',
        'PUT',
        `/v1/components/${made.id}/iterations/${session}/1`,
        {
          openedFrom: made.openedFrom,
          content: twice,
        },
      );
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'content_invalid' });
      expect(response.body).not.toContain('Secret');
      expect(response.body).not.toContain('p1');
    });

    it('refuses a blank title, and text the store cannot hold, as invalid content rather than as a failure', async () => {
      // Issues #116 and #127: creating a component refuses a title of spaces, and a section title
      // refuses a NUL or half a surrogate pair, but saving an iteration took both - the first stored
      // a blank title, the second failed the insert and was answered as the service's fault.
      const made = await component();
      const session = randomUUID();
      await call('ada', 'POST', `/v1/components/${made.id}/lock`, { session });
      const nul = String.fromCharCode(0);
      const halfAPair = String.fromCharCode(0xd800);
      const refused = [
        { ...paragraphs('Unbox it.'), title: '   ' },
        paragraphs(`Unbox${nul} it.`),
        paragraphs(`Unbox ${halfAPair} it.`),
      ];
      for (const [index, content] of refused.entries()) {
        const response = await call(
          'ada',
          'PUT',
          `/v1/components/${made.id}/iterations/${session}/${index + 1}`,
          { openedFrom: made.openedFrom, content },
        );
        expect(response.statusCode, `case ${index}`).toBe(400);
        expect(response.json()).toMatchObject({ code: 'content_invalid' });
      }
    });

    it('refuses an uppercase session as invalid, on claim and on save, rather than comparing it wrong forever', async () => {
      const made = await component();
      const upper = randomUUID().toUpperCase();
      const claimed = await call('ada', 'POST', `/v1/components/${made.id}/lock`, {
        session: upper,
      });
      expect(claimed.statusCode).toBe(400);
      expect(claimed.json()).toMatchObject({ code: 'invalid_request' });

      const session = randomUUID();
      await call('ada', 'POST', `/v1/components/${made.id}/lock`, { session });
      const saved = await call('ada', 'PUT', `/v1/components/${made.id}/iterations/${upper}/1`, {
        openedFrom: made.openedFrom,
        content: paragraphs('Upper'),
      });
      expect(saved.statusCode).toBe(400);
      expect(saved.json()).toMatchObject({ code: 'invalid_request' });
    });

    it('refuses an unknown member in a write body as invalid, rather than silently dropping it', async () => {
      const made = await component();
      const session = randomUUID();
      await call('ada', 'POST', `/v1/components/${made.id}/lock`, { session });
      const cut = await call('ada', 'POST', `/v1/components/${made.id}/versions`, {
        session,
        openedFrom: made.openedFrom,
        notes: 'Keep the box',
      });
      expect(cut.statusCode).toBe(400);
      expect(cut.json()).toMatchObject({ code: 'invalid_request' });
    });

    it('refuses a reader who may not edit as forbidden, and a component they may not read as not found', async () => {
      const made = await component();
      const refused = await call('alice', 'POST', `/v1/components/${made.id}/lock`, {
        session: randomUUID(),
      });
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({
        code: 'forbidden',
        message: 'This needs the edit permission.',
      });
      const unreadable = await call('grace', 'POST', `/v1/components/${hidden}/lock`, {
        session: randomUUID(),
      });
      expect(unreadable.statusCode).toBe(404);
      const anonymous = await call(undefined, 'POST', `/v1/components/${made.id}/lock`, {
        session: randomUUID(),
      });
      expect(anonymous.statusCode).toBe(401);
    });

    it('never takes the access epoch for update, so a write cannot deadlock against a decision in flight', async () => {
      const made = await component();
      const session = randomUUID();
      // Another transaction holds the epoch as every decision does. A route that took it for update
      // would wait for this one to end, and this one waits for the route: the race below would time out.
      const timedOut = new Promise<'timed out'>((resolve) => {
        setTimeout(() => resolve('timed out'), 5_000).unref();
      });
      const statuses = await whileAccessIsDecided(tenantDb, tenant, () =>
        Promise.race([
          (async () => [
            (await call('ada', 'POST', `/v1/components/${made.id}/lock`, { session })).statusCode,
            (
              await call('ada', 'PUT', `/v1/components/${made.id}/iterations/${session}/1`, {
                openedFrom: made.openedFrom,
                content: paragraphs('Under a shared lock'),
              })
            ).statusCode,
            (
              await call('ada', 'POST', `/v1/components/${made.id}/versions`, {
                session,
                openedFrom: made.openedFrom,
              })
            ).statusCode,
          ])(),
          timedOut,
        ]),
      );
      expect(statuses).toEqual([200, 200, 200]);
    });
  });

  describe('reading iterations back for Recovery', () => {
    type Listed = {
      items: {
        id: string;
        session: string;
        sequence: number;
        createdAt: string;
        openedFrom: { id: string; number: string };
      }[];
      next: string | null;
    };

    /** Claims for a session of `who`, moving it from their own other one, and saves each text. */
    const saving = async (
      who: string,
      made: { id: string; openedFrom: string },
      ...texts: string[]
    ) => {
      const session = randomUUID();
      const claimed = await call(who, 'POST', `/v1/components/${made.id}/lock`, {
        session,
        move: true,
      });
      expect(claimed.statusCode, claimed.body).toBe(200);
      for (const [at, text] of texts.entries()) {
        const saved = await call(
          who,
          'PUT',
          `/v1/components/${made.id}/iterations/${session}/${at + 1}`,
          { openedFrom: made.openedFrom, content: paragraphs(text) },
        );
        expect(saved.statusCode, saved.body).toBe(200);
      }
      return session;
    };

    const listed = (who: string | undefined, id: string, session: string, more = '') =>
      call(who, 'GET', `/v1/components/${id}/iterations?session=${session}${more}`);

    it('CNT-174 answers the writer their own iterations while they hold the lock, from any session of theirs, newest first and content only one at a time', async () => {
      const made = await component();
      const first = await saving('ada', made, 'Unbox', 'Unbox the printer and keep the box.');
      // Ada's second window, which moved the lock to itself.
      const second = await saving('ada', made, 'Plug it in.');

      const page = await listed('ada', made.id, second);
      expect(page.statusCode, page.body).toBe(200);
      const { items, next } = page.json<Listed>();
      expect(next).toBeNull();
      expect(items.map((each) => [each.session, each.sequence])).toEqual([
        [second, 1],
        [first, 2],
        [first, 1],
      ]);
      expect(items[0]).toEqual({
        id: expect.any(String),
        session: second,
        sequence: 1,
        createdAt: expect.any(String),
        openedFrom: { id: made.openedFrom, number: '0.1' },
      });

      const one = await call(
        'ada',
        'GET',
        `/v1/components/${made.id}/iterations/${items[1]!.id}?session=${second}`,
      );
      expect(one.statusCode, one.body).toBe(200);
      expect(one.json()).toEqual({
        ...items[1],
        content: paragraphs('Unbox the printer and keep the box.'),
        values: {},
      });
    });

    it('CNT-174 refuses the writer without the lock, and never answers anybody else, a reader, or a component they may not read', async () => {
      const made = await component();
      const first = await saving('ada', made, 'Unbox the printer.');
      const [mine] = (await listed('ada', made.id, first)).json<Listed>().items;
      const one = (who: string | undefined, session: string) =>
        call(who, 'GET', `/v1/components/${made.id}/iterations/${mine!.id}?session=${session}`);

      // Moved to Ada's other window: the first is refused as any write from it is.
      const second = await saving('ada', made);
      for (const response of [await listed('ada', made.id, first), await one('ada', first)]) {
        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({ code: 'lock_held', holder: { id: ids.ada } });
      }

      // Nobody holds it now.
      await tenantDb.withTenant(tenant, (trx) =>
        trx.deleteFrom('component_lock').where('artifact_id', '=', made.id).execute(),
      );
      for (const response of [await listed('ada', made.id, second), await one('ada', second)]) {
        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({ code: 'lock_required' });
      }

      // Grace takes it, and is answered her own, which is nothing: never her predecessor's.
      const hers = await saving('grace', made);
      const graces = await listed('grace', made.id, hers);
      expect(graces.statusCode).toBe(200);
      expect(graces.json()).toEqual({ items: [], next: null });
      const asked = await one('grace', hers);
      expect(asked.statusCode).toBe(404);
      expect(asked.body).not.toContain('Unbox');
      // Ada, while Grace holds it, is told who.
      const held = await listed('ada', made.id, first);
      expect(held.statusCode).toBe(409);
      expect(held.json()).toMatchObject({ code: 'lock_held', holder: { id: ids.grace } });

      // A reader may not edit, so may not ask; a component nobody here may read is not there.
      expect((await listed('alice', made.id, randomUUID())).statusCode).toBe(403);
      expect((await one('alice', randomUUID())).statusCode).toBe(403);
      expect((await listed('grace', hidden, hers)).statusCode).toBe(404);
      expect((await listed(undefined, made.id, hers)).statusCode).toBe(401);
    });

    it('pages the listing over a cursor it gave out, and refuses one it did not', async () => {
      const made = await component();
      const session = await saving('ada', made, 'One.', 'Two.', 'Three.');
      const first = (await listed('ada', made.id, session, '&limit=2')).json<Listed>();
      expect(first.items.map((each) => each.sequence)).toEqual([3, 2]);
      expect(first.next).toEqual(expect.any(String));
      const second = await listed('ada', made.id, session, `&limit=2&cursor=${first.next}`);
      expect(second.json<Listed>().items.map((each) => each.sequence)).toEqual([1]);
      expect(second.json<Listed>().next).toBeNull();

      const people = (await call('ada', 'GET', '/v1/people?limit=1')).json<{ next: string }>();
      const foreign = await listed('ada', made.id, session, `&cursor=${people.next}`);
      expect(foreign.statusCode).toBe(400);
    });

    it("tells the component's caller, and nobody else, when they last saved work never made a version", async () => {
      const made = await component();
      const unsaved = async (who: string) =>
        (await call(who, 'GET', `/v1/components/${made.id}`)).json<{ unsaved: unknown }>().unsaved;
      expect(await unsaved('ada')).toBeNull();

      const session = await saving('ada', made, 'Unbox the printer and keep the box.');
      const [newest] = (await listed('ada', made.id, session)).json<Listed>().items;
      expect(await unsaved('ada')).toEqual({ savedAt: newest!.createdAt });
      expect(await unsaved('grace')).toBeNull();
      expect(await unsaved('alice')).toBeNull();

      await call('ada', 'POST', `/v1/components/${made.id}/versions`, {
        session,
        openedFrom: made.openedFrom,
      });
      expect(await unsaved('ada')).toBeNull();
    });

    it('answers the session a reload names the latest sequence it saved, and nobody else theirs (W11.3)', async () => {
      const made = await component();
      const sequence = async (who: string, session?: string) => {
        const response = await call(
          who,
          'GET',
          `/v1/components/${made.id}${session === undefined ? '' : `?session=${session}`}`,
        );
        expect(response.statusCode).toBe(200);
        return response.json<{ sequence: unknown }>().sequence;
      };
      const session = await saving('ada', made, 'One.', 'Two.', 'Three.');
      expect(await sequence('ada', session)).toBe(3);
      // Named by nobody, another of Ada's sessions, or Ada's session named by Grace: nothing.
      expect(await sequence('ada')).toBeNull();
      expect(await sequence('ada', randomUUID())).toBeNull();
      expect(await sequence('grace', session)).toBeNull();
      // Released, and a version cut, it is still the session's: saving would judge the next against it.
      const released = await call(
        'ada',
        'DELETE',
        `/v1/components/${made.id}/lock?session=${session}&openedFrom=${made.openedFrom}`,
      );
      expect(released.statusCode).toBe(200);
      expect(await sequence('ada', session)).toBe(3);
      // A session that is not an id is refused before anything is read.
      const refused = await call('ada', 'GET', `/v1/components/${made.id}?session=not-an-id`);
      expect(refused.statusCode).toBe(400);
    });
  });
});
