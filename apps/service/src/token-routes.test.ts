// apps/service/src/token-routes.test.ts
import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import { crc32, deflateSync } from 'node:zlib';
import {
  bootstrapCluster,
  createSpace,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  migrate,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { createObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
const DAY_MS = 24 * 60 * 60 * 1000;
const SECRET = /^awt_[A-Za-z0-9_-]{43}$/;

const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/** A real PNG, one red pixel. */
const png = () => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

interface Issued {
  readonly id: string;
  readonly name: string;
  readonly scopes: string[];
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly lastUsedAt: string | null;
  readonly secret: string;
}

describe('personal tokens (service-foundations.md, "Personal tokens, as W12 builds them")', () => {
  let db: TestDatabase;
  let objects: TestObjectStore;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  const logged: string[] = [];
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let clinical = '';
  let dosing = '';
  let report = '';

  type Headers = Record<string, string>;
  const call = (
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    headers: Headers,
    payload?: object,
  ) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, ...headers },
      ...(payload ? { payload } : {}),
    });
  const as = (who: string): Headers => ({ cookie: cookies[who]! });
  const bearer = (secret: string): Headers => ({ authorization: `Bearer ${secret}` });
  const inDays = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();

  const issue = async (who: string, scopes: string[], name = 'Nightly import') => {
    const response = await call('POST', '/v1/tokens', as(who), {
      name,
      scopes,
      expiresAt: inDays(30),
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Issued>();
  };

  const stored = (id: string) =>
    queryAs(
      db.adminUrl,
      `select token_hash, scopes, last_used_at from "${tenant.schema}".api_token where id = $1`,
      [id],
    ).then(
      (result) => result.rows[0] as { token_hash: string; last_used_at: Date | null } | undefined,
    );

  beforeAll(async () => {
    db = await freshDatabase();
    objects = await testObjectStore();
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
    await objects.setUp(db.adminUrl, tenant);
    await configureStandIn(db.adminUrl, tenant, {
      issuer: idp.issuer,
      clientId: 'alloy',
    });
    tenantDb = createTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      // Every line a request writes, so the last test can say none of them carries a secret.
      logLevel: 'debug',
      logStream: new Writable({
        write(chunk: Buffer, _encoding, done) {
          logged.push(chunk.toString());
          done();
        },
      }),
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
      objects: createObjectStores(objects.settings, objects.sealingKey),
    });
    for (const user of ['ada', 'grace', 'alice']) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
      ids[user] = (await call('GET', '/v1/me', as(user))).json<{ id: string }>().id;
    }
    // Grace authors and publishes in Clinical; Alice authors there and may not publish. Ada
    // administers the environment, and holds nothing in Clinical.
    await tenantDb.withTenant(tenant, async (trx) => {
      const administrator = await findRole(trx, 'Administrator');
      await grant(trx, {
        roleId: administrator!.id,
        subject: { principal: ids.ada! },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
      clinical = (await createSpace(trx, 'Clinical')).id;
      for (const [role, who] of [
        ['Author', 'grace'],
        ['Publisher', 'grace'],
        ['Author', 'alice'],
      ] as const) {
        const found = await findRole(trx, role);
        await grant(trx, {
          roleId: found!.id,
          subject: { principal: ids[who]! },
          level: { kind: 'space', id: clinical },
          effect: 'allow',
          grantedBy: ids[who]!,
        });
      }
    });
    const made = await call('POST', `/v1/spaces/${clinical}/components`, as('grace'), {
      title: 'Dosing',
      language: 'en-GB',
      direction: 'ltr',
    });
    expect(made.statusCode, made.body).toBe(200);
    dosing = made.json<{ id: string }>().id;
    const document = await call('POST', `/v1/spaces/${clinical}/documents`, as('grace'), {
      title: 'The dosing report',
      language: 'en-GB',
      direction: 'ltr',
    });
    expect(document.statusCode, document.body).toBe(200);
    const created = document.json<{ id: string; version: { id: string } }>();
    report = created.id;
    const placed = await call('POST', `/v1/documents/${report}/outline`, as('grace'), {
      openedFrom: created.version.id,
      operation: {
        operation: 'insert',
        parent: null,
        position: 0,
        node: { type: 'reference', component: dosing, mode: { kind: 'latest' } },
      },
    });
    expect(placed.statusCode, placed.body).toBe(200);
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await objects.drop();
    await db.drop();
  });

  describe('issued, listed and revoked by their owner', () => {
    it('issues a token once, as awt_ and 43 characters, and keeps only its hash', async () => {
      const issued = await issue('grace', ['edit']);
      expect(issued.secret).toMatch(SECRET);
      expect(issued).toMatchObject({
        name: 'Nightly import',
        scopes: ['edit'],
        lastUsedAt: null,
      });
      const row = await stored(issued.id);
      expect(row?.token_hash).toBe(createHash('sha256').update(issued.secret).digest('hex'));
      expect(JSON.stringify(row)).not.toContain(issued.secret);
    });

    it('answers the secret with Cache-Control: no-store, so no cache between keeps it', async () => {
      const response = await call('POST', '/v1/tokens', as('grace'), {
        name: 'Cached nowhere',
        scopes: [],
        expiresAt: inDays(30),
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<Issued>().secret).toMatch(SECRET);
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it("lists the caller's own tokens, never a secret or a hash, and nobody else's", async () => {
      const graces = await issue('grace', ['edit', 'publish'], 'Publish on merge');
      const alices = await issue('alice', []);
      const listed = await call('GET', '/v1/tokens', as('grace'));
      expect(listed.statusCode, listed.body).toBe(200);
      const items = listed.json<{ items: Record<string, unknown>[] }>().items;
      expect(items).toContainEqual({
        id: graces.id,
        name: 'Publish on merge',
        scopes: ['edit', 'publish'],
        createdAt: graces.createdAt,
        expiresAt: graces.expiresAt,
        lastUsedAt: null,
      });
      expect(items.map((item) => item.id)).not.toContain(alices.id);
      expect(listed.body).not.toContain(graces.secret);
      expect(listed.body).not.toContain('awt_');
      expect(listed.body).not.toContain((await stored(graces.id))!.token_hash);
    });

    it('IAM-034 refuses a token without an expiry, with one past, and with one more than 365 days away', async () => {
      const ask = (expiresAt: string | undefined) =>
        call('POST', '/v1/tokens', as('grace'), {
          name: 'Script',
          scopes: ['edit'],
          ...(expiresAt === undefined ? {} : { expiresAt }),
        });
      const missing = await ask(undefined);
      expect(missing.statusCode).toBe(400);
      expect(missing.json()).toMatchObject({ code: 'invalid_request' });
      for (const expiresAt of [inDays(-1), inDays(366), new Date().toISOString()]) {
        const refused = await ask(expiresAt);
        expect(refused.statusCode, expiresAt).toBe(400);
        expect(refused.json()).toMatchObject({ code: 'token_expiry_invalid', rule: 'IAM-034' });
      }
      expect((await ask(inDays(364.9))).statusCode).toBe(200);
    });

    it('refuses a scope outside the closed set, read among them, a scope named twice, and a name that is blank or too long', async () => {
      for (const body of [
        { name: 'Script', scopes: ['read'] },
        { name: 'Script', scopes: ['edit', 'read'] },
        { name: 'Script', scopes: ['delete'] },
        { name: 'Script', scopes: ['edit', 'edit'] },
        { name: '   ', scopes: [] },
        { name: 'x'.repeat(81), scopes: [] },
      ]) {
        const refused = await call('POST', '/v1/tokens', as('grace'), {
          ...body,
          expiresAt: inDays(30),
        });
        expect(refused.statusCode, JSON.stringify(body)).toBe(400);
        expect(refused.json()).toMatchObject({ code: 'invalid_request' });
      }
      const trimmed = await call('POST', '/v1/tokens', as('grace'), {
        name: '  Script  ',
        scopes: [],
        expiresAt: inDays(30),
      });
      expect(trimmed.json()).toMatchObject({ name: 'Script' });
    });

    it('IAM-035 refuses a revoked token at the very next request', async () => {
      const issued = await issue('grace', ['edit']);
      expect((await call('GET', '/v1/me', bearer(issued.secret))).statusCode).toBe(200);
      const revoked = await call('DELETE', `/v1/tokens/${issued.id}`, as('grace'));
      expect(revoked.statusCode, revoked.body).toBe(204);
      const after = await call('GET', '/v1/me', bearer(issued.secret));
      expect(after.statusCode).toBe(401);
      expect(after.json()).toMatchObject({ code: 'unauthenticated' });
      expect(await stored(issued.id)).toBeUndefined();
    });

    it("revokes only the caller's own: another's token is not found, and goes on working", async () => {
      const graces = await issue('grace', ['edit']);
      const elsewhere = await call('DELETE', `/v1/tokens/${graces.id}`, as('alice'));
      expect(elsewhere.statusCode).toBe(404);
      expect(elsewhere.json()).toMatchObject({ code: 'not_found' });
      expect((await call('GET', '/v1/me', bearer(graces.secret))).statusCode).toBe(200);
    });

    it('IAM-034 refuses a token once it has expired', async () => {
      const issued = await issue('grace', ['edit']);
      expect((await call('GET', '/v1/me', bearer(issued.secret))).statusCode).toBe(200);
      await queryAs(
        db.adminUrl,
        `update "${tenant.schema}".api_token
            set created_at = now() - interval '2 days', expires_at = now() - interval '1 second'
          where id = $1`,
        [issued.id],
      );
      const expired = await call('GET', '/v1/me', bearer(issued.secret));
      expect(expired.statusCode).toBe(401);
      expect(expired.json()).toMatchObject({ code: 'unauthenticated' });
    });
  });

  describe('listed and revoked by an administrator of the environment (TK-E)', () => {
    const MISSING = '00000000-0000-4000-8000-000000000000';
    const theirs = (who: string) => `/v1/principals/${ids[who]!}/tokens`;

    it("IAM-035 lets an administrator list Grace's tokens and revoke one, refused at Grace's very next request", async () => {
      const issued = await issue('grace', ['edit'], 'Left with Grace');
      expect((await call('GET', '/v1/me', bearer(issued.secret))).statusCode).toBe(200);

      const listed = await call('GET', theirs('grace'), as('ada'));
      expect(listed.statusCode, listed.body).toBe(200);
      const items = listed.json<{ items: Record<string, unknown>[] }>().items;
      expect(items).toContainEqual({
        id: issued.id,
        name: 'Left with Grace',
        scopes: ['edit'],
        createdAt: issued.createdAt,
        expiresAt: issued.expiresAt,
        lastUsedAt: expect.any(String),
      });
      expect(listed.body).not.toContain('awt_');
      expect(listed.body).not.toContain((await stored(issued.id))!.token_hash);

      const revoked = await call('DELETE', `${theirs('grace')}/${issued.id}`, as('ada'));
      expect(revoked.statusCode, revoked.body).toBe(200);
      expect(revoked.json()).toEqual({ revoked: issued.id });
      const after = await call('GET', '/v1/me', bearer(issued.secret));
      expect(after.statusCode).toBe(401);
      expect(after.json()).toMatchObject({ code: 'unauthenticated' });
      const own = await call('GET', '/v1/tokens', as('grace'));
      expect(own.json<{ items: Issued[] }>().items.map((item) => item.id)).not.toContain(issued.id);
    });

    it('lists only the person named: nobody else, the administrator included', async () => {
      const graces = await issue('grace', [], 'Grace alone');
      const adas = await issue('ada', [], 'Ada alone');
      const listed = await call('GET', theirs('grace'), as('ada'));
      const shown = listed.json<{ items: Issued[] }>().items.map((item) => item.id);
      expect(shown).toContain(graces.id);
      expect(shown).not.toContain(adas.id);
    });

    it("refuses anybody who may not administer the environment, Grace herself included, and leaves Grace's token working", async () => {
      const issued = await issue('grace', ['edit']);
      for (const who of ['alice', 'grace']) {
        const listed = await call('GET', theirs('grace'), as(who));
        expect(listed.statusCode, who).toBe(403);
        expect(listed.json()).toMatchObject({ code: 'forbidden' });
        const revoked = await call('DELETE', `${theirs('grace')}/${issued.id}`, as(who));
        expect(revoked.statusCode, who).toBe(403);
        expect(revoked.json()).toMatchObject({ code: 'forbidden' });
      }
      expect((await call('GET', '/v1/me', bearer(issued.secret))).statusCode).toBe(200);
    });

    it('refuses a token at both, even one scoped to administer, as it does every route managing tokens (TK-D)', async () => {
      const adas = await issue('ada', ['administer']);
      const graces = await issue('grace', ['edit']);
      for (const [method, url] of [
        ['GET', theirs('grace')],
        ['DELETE', `${theirs('grace')}/${graces.id}`],
      ] as const) {
        const response = await call(method, url, bearer(adas.secret));
        expect(response.statusCode, `${method} ${url}`).toBe(403);
        expect(response.json()).toMatchObject({ code: 'token_not_allowed' });
      }
      expect((await call('GET', '/v1/me', bearer(graces.secret))).statusCode).toBe(200);
    });

    it('answers a person who is not here, and a token that is not the named person, as not found', async () => {
      const graces = await issue('grace', ['edit']);
      const nobody = await call('GET', `/v1/principals/${MISSING}/tokens`, as('ada'));
      expect(nobody.statusCode).toBe(404);
      expect(nobody.json()).toMatchObject({ code: 'not_found' });
      const elsewhere = await call('DELETE', `${theirs('alice')}/${graces.id}`, as('ada'));
      expect(elsewhere.statusCode).toBe(404);
      expect(elsewhere.json()).toMatchObject({ code: 'not_found' });
      const gone = await call('DELETE', `${theirs('grace')}/${MISSING}`, as('ada'));
      expect(gone.statusCode).toBe(404);
      expect((await call('GET', '/v1/me', bearer(graces.secret))).statusCode).toBe(200);
    });
  });

  describe('presented as a bearer', () => {
    it('acts as the person who issued it, whatever cookie the request also carries', async () => {
      const graces = await issue('grace', []);
      const me = await call('GET', '/v1/me', { ...as('alice'), ...bearer(graces.secret) });
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({ id: ids.grace, displayName: 'Grace' });
    });

    it('refuses a malformed bearer, and one that is not a token, even beside a good cookie', async () => {
      for (const authorization of [
        'Bearer',
        'Bearer ',
        'bearer ',
        'Bearer not-a-token',
        `Bearer awt_${'a'.repeat(42)}`,
        `Bearer awt_${'a'.repeat(43)}`,
        `Bearer awt_${'a'.repeat(43)} extra`,
        `bearer awt_${'a'.repeat(43)}`,
      ]) {
        const response = await call('GET', '/v1/me', { ...as('grace'), authorization });
        expect(response.statusCode, authorization).toBe(401);
        expect(response.json()).toMatchObject({ code: 'unauthenticated' });
      }
    });

    it('passes over any other scheme, which a proxy in front may have added, and lets the cookie decide', async () => {
      for (const authorization of [
        'Basic Z3JhY2U6c2VjcmV0',
        'Negotiate YIIBhwYGKwYBBQUCoIIBezCCAXeg',
        'Digest username="grace"',
        'Bearerish awt_x',
      ]) {
        const signedIn = await call('GET', '/v1/me', { ...as('grace'), authorization });
        expect(signedIn.statusCode, authorization).toBe(200);
        expect(signedIn.json()).toMatchObject({ id: ids.grace });
        const alone = await call('GET', '/v1/me', { authorization });
        expect(alone.statusCode, authorization).toBe(401);
        expect(alone.json()).toMatchObject({ code: 'unauthenticated' });
      }
    });

    it('records a use at most once a minute', async () => {
      const issued = await issue('grace', []);
      await call('GET', '/v1/me', bearer(issued.secret));
      const first = (await stored(issued.id))!.last_used_at;
      expect(first).toBeInstanceOf(Date);
      await queryAs(
        db.adminUrl,
        `update "${tenant.schema}".api_token set last_used_at = now() - interval '30 seconds'
          where id = $1`,
        [issued.id],
      );
      const recent = (await stored(issued.id))!.last_used_at!;
      await call('GET', '/v1/me', bearer(issued.secret));
      expect((await stored(issued.id))!.last_used_at).toEqual(recent);
      await queryAs(
        db.adminUrl,
        `update "${tenant.schema}".api_token set last_used_at = now() - interval '2 minutes'
          where id = $1`,
        [issued.id],
      );
      await call('GET', '/v1/me', bearer(issued.secret));
      expect((await stored(issued.id))!.last_used_at!.getTime()).toBeGreaterThan(recent.getTime());
      const listed = await call('GET', '/v1/tokens', as('grace'));
      const shown = listed.json<{ items: Issued[] }>().items.find((item) => item.id === issued.id);
      expect(shown?.lastUsedAt).not.toBeNull();
    });

    it('takes a session alone for managing tokens, signing out and the event stream (TK-D)', async () => {
      const issued = await issue('grace', ['edit', 'publish', 'administer']);
      const other = await issue('grace', []);
      for (const [method, url, payload] of [
        ['GET', '/v1/tokens', undefined],
        ['POST', '/v1/tokens', { name: 'Successor', scopes: [], expiresAt: inDays(30) }],
        ['DELETE', `/v1/tokens/${other.id}`, undefined],
        ['POST', '/v1/sign-out', undefined],
        ['GET', '/v1/stream', undefined],
      ] as const) {
        const response = await call(
          method,
          url,
          { ...as('grace'), ...bearer(issued.secret) },
          payload,
        );
        expect(response.statusCode, `${method} ${url}`).toBe(403);
        expect(response.json()).toMatchObject({ code: 'token_not_allowed' });
      }
      // Nothing was minted, revoked or ended by any of it.
      expect((await call('GET', '/v1/me', bearer(other.secret))).statusCode).toBe(200);
      expect((await call('GET', '/v1/me', as('grace'))).statusCode).toBe(200);
      const listed = await call('GET', '/v1/tokens', as('grace'));
      expect(
        listed.json<{ items: Issued[] }>().items.filter((item) => item.name === 'Successor'),
      ).toEqual([]);
    });
  });

  describe("a mask over its creator's grants, in every decision (TK-A)", () => {
    const allowedOn = async (secret: string, target: string) => {
      const response = await call('GET', `/v1/access?target=${target}`, bearer(secret));
      expect(response.statusCode, response.body).toBe(200);
      return response
        .json<{ permissions: { permission: string; allowed: boolean }[] }>()
        .permissions.filter((answer) => answer.allowed)
        .map((answer) => answer.permission);
    };

    it('IAM-034 lets a token scoped to edit edit where its creator may, and refuses it publishing that its creator may do', async () => {
      const issued = await issue('grace', ['edit']);
      expect(await allowedOn(issued.secret, `artifact:${dosing}`)).toEqual(['read', 'edit']);
      const claimed = await call('POST', `/v1/components/${dosing}/lock`, bearer(issued.secret), {
        session: '00000000-0000-4000-8000-00000000abcd',
      });
      expect(claimed.statusCode, claimed.body).toBe(200);
      const published = await call(
        'POST',
        `/v1/documents/${report}/publications`,
        bearer(issued.secret),
        { version: '00000000-0000-4000-8000-000000000000', formats: ['pdf'] },
      );
      expect(published.statusCode).toBe(403);
      expect(published.json()).toMatchObject({ code: 'forbidden' });
      // Grace herself, signed in, may publish it: the token was issued with less than she holds.
      expect(
        (await call('GET', `/v1/access?target=artifact:${report}`, as('grace'))).json(),
      ).toMatchObject({
        permissions: expect.arrayContaining([{ permission: 'publish', allowed: true }]),
      });
    });

    it('IAM-034 IAM-062 never lets a scope confer what its creator holds through no role', async () => {
      const issued = await issue('alice', ['edit', 'publish', 'administer']);
      expect(await allowedOn(issued.secret, `artifact:${report}`)).toEqual(['read', 'edit']);
      const published = await call(
        'POST',
        `/v1/documents/${report}/publications`,
        bearer(issued.secret),
        { version: '00000000-0000-4000-8000-000000000000', formats: ['pdf'] },
      );
      expect(published.statusCode).toBe(403);
      const explained = await call(
        'GET',
        `/v1/access/explain?principal=${ids.alice}&target=tenant`,
        bearer(issued.secret),
      );
      expect(explained.statusCode).toBe(403);
    });

    it('IAM-034 reads through a token with no scopes, and may ask for a preview, and does nothing else', async () => {
      const issued = await issue('grace', []);
      expect(await allowedOn(issued.secret, `artifact:${dosing}`)).toEqual(['read']);
      expect(
        (await call('GET', `/v1/components/${dosing}`, bearer(issued.secret))).statusCode,
      ).toBe(200);
      const opened = await call('GET', `/v1/documents/${report}`, bearer(issued.secret));
      expect(opened.statusCode).toBe(200);
      // A preview is decided on read (PV-B): seeing the pages is reading, so a token may ask for one.
      const previewed = await call(
        'POST',
        `/v1/documents/${report}/previews`,
        bearer(issued.secret),
        {
          version: opened.json<{ version: { id: string } }>().version.id,
        },
      );
      expect(previewed.statusCode, previewed.body).toBe(200);
      const listed = await call('GET', '/v1/components', bearer(issued.secret));
      expect(listed.json<{ items: { id: string }[] }>().items.map((item) => item.id)).toContain(
        dosing,
      );
      const claimed = await call('POST', `/v1/components/${dosing}/lock`, bearer(issued.secret), {
        session: '00000000-0000-4000-8000-00000000abce',
      });
      expect(claimed.statusCode).toBe(403);
      const created = await call(
        'POST',
        `/v1/spaces/${clinical}/components`,
        bearer(issued.secret),
        { title: 'Not by this token', language: 'en-GB', direction: 'ltr' },
      );
      expect(created.statusCode).toBe(403);
      const document = await call(
        'POST',
        `/v1/spaces/${clinical}/documents`,
        bearer(issued.secret),
        { title: 'Not by this token', language: 'en-GB', direction: 'ltr' },
      );
      expect(document.statusCode).toBe(403);
      // The development sample writes and queues a job, and takes a session alone.
      const sampled = await call('POST', '/v1/samples', bearer(issued.secret));
      expect(sampled.statusCode).toBe(403);
      expect(sampled.json()).toMatchObject({ code: 'token_not_allowed' });
    });

    it("IAM-034 refuses a token without create the bytes of an upload its creator's session began, and lets one scoped to create fill it", async () => {
      const begun = await call('POST', `/v1/spaces/${clinical}/asset-uploads`, as('grace'), {
        alternative: null,
      });
      expect(begun.statusCode, begun.body).toBe(200);
      const upload = begun.json<{ id: string }>().id;
      const fill = (secret: string) =>
        app.inject({
          method: 'PUT',
          url: `/v1/asset-uploads/${upload}/bytes`,
          headers: {
            host: HOST,
            ...bearer(secret),
            'content-type': 'application/octet-stream',
          },
          payload: png(),
        });
      // Decided by `authoriseAt` on the upload's space, which the route's path does not name.
      const editing = await issue('grace', ['edit']);
      const refused = await fill(editing.secret);
      expect(refused.statusCode, refused.body).toBe(403);
      expect(refused.json()).toMatchObject({ code: 'forbidden' });
      const creating = await issue('grace', ['create']);
      const filled = await fill(creating.secret);
      expect(filled.statusCode, filled.body).toBe(200);
      expect(filled.json()).toMatchObject({ id: upload, reason: null });
    });

    it('says in every answer that a token may not do what its scopes leave out: mayEdit, mayPublish and mayCreate', async () => {
      const reading = await issue('grace', []);
      const editing = await issue('grace', ['edit']);
      const creating = await issue('grace', ['create']);
      const read = (url: string, secret: string) =>
        call('GET', url, bearer(secret)).then((response) => {
          expect(response.statusCode, response.body).toBe(200);
          return response.json<Record<string, unknown>>();
        });

      // Grace signed in may do all of it; each flag is her token's, not hers.
      expect(await read(`/v1/components/${dosing}`, editing.secret)).toMatchObject({
        mayEdit: true,
      });
      expect(await read(`/v1/components/${dosing}`, reading.secret)).toMatchObject({
        mayEdit: false,
      });
      expect(await read(`/v1/documents/${report}`, editing.secret)).toMatchObject({
        mayEdit: true,
        mayPublish: false,
      });
      expect(await read(`/v1/documents/${report}`, reading.secret)).toMatchObject({
        mayEdit: false,
        mayPublish: false,
      });
      const texts = (secret: string) =>
        read(`/v1/documents/${report}/texts`, secret).then(
          (body) => (body.occurrences as { mayEdit: boolean }[])[0]?.mayEdit,
        );
      expect(await texts(editing.secret)).toBe(true);
      expect(await texts(reading.secret)).toBe(false);
      const mayCreate = (secret: string) =>
        read('/v1/spaces', secret).then(
          (body) =>
            (body.items as { id: string; mayCreate: boolean }[]).find(
              (space) => space.id === clinical,
            )?.mayCreate,
        );
      expect(await mayCreate(creating.secret)).toBe(true);
      expect(await mayCreate(editing.secret)).toBe(false);
      // Made by a token that may create and not edit: the new component says it may not be edited.
      const made = await call(
        'POST',
        `/v1/spaces/${clinical}/components`,
        bearer(creating.secret),
        {
          title: 'Made by a script',
          language: 'en-GB',
          direction: 'ltr',
        },
      );
      expect(made.statusCode, made.body).toBe(200);
      expect(made.json()).toMatchObject({ mayEdit: false });
      const document = await call(
        'POST',
        `/v1/spaces/${clinical}/documents`,
        bearer(creating.secret),
        { title: 'Made by a script', language: 'en-GB', direction: 'ltr' },
      );
      expect(document.statusCode, document.body).toBe(200);
      expect(document.json()).toMatchObject({ mayEdit: false, mayPublish: false });
    });
  });

  it('never writes a secret to the log, whether the token is issued, used, refused or revoked', async () => {
    const issued = await issue('grace', ['edit']);
    await call('GET', '/v1/me', bearer(issued.secret));
    await call('GET', `/v1/components/${dosing}`, bearer(issued.secret));
    await call('POST', '/v1/sign-out', bearer(issued.secret));
    await call('DELETE', `/v1/tokens/${issued.id}`, as('grace'));
    await call('GET', '/v1/me', bearer(issued.secret));
    await call('GET', '/v1/me', { authorization: 'Bearer awt_not-one-at-all' });
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.join('\n')).toContain('request completed');
    expect(logged.join('\n')).not.toContain(issued.secret);
    expect(logged.join('\n')).not.toContain('awt_');
  });
});
