import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  createServiceIdentity,
  createSpace,
  createTenant,
  finishDelivery,
  issueApiToken,
  refuseDelivery,
  revokeApiToken,
  writeBridgeSettings,
} from '@alloy-works/db';
import type { ObjectStores } from '@alloy-works/objects';
import { queryAs } from '@alloy-works/db/testing';
import {
  bridgeError,
  BridgeErrorSchema,
  BrowseResultSchema,
  signRequest,
  SinkDescribeSchema,
  type BridgePackage,
} from '@kenhayward/bridge-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '../sessions.js';
import { HOST, startHarness, type Harness } from '../test/bindings-harness.js';
import { newTokenSecret } from '../tokens.js';

const inAMonth = () => new Date(Date.now() + 30 * 86_400_000).toISOString();

/** The contract's own wire fixtures, as CT Studio sends them. */
const fixtures = join(
  dirname(createRequire(import.meta.url).resolve('@kenhayward/bridge-contract')),
  '..',
  'test',
  'fixtures',
);
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(fixtures, name), 'utf8')) as BridgePackage;

type Method = 'GET' | 'POST';

describe('the bridge contract served under /bridge (API-065, API-068)', () => {
  let h: Harness;
  // Made here for the test alone: two, as while a key is rotated.
  const key = randomBytes(32).toString('hex');
  const retiring = randomBytes(32).toString('hex');
  let identity = '';
  let token = { id: '', secret: '' };
  let personal = '';
  let instance = '';
  /** A space the identity may create in, with no bridge settings. */
  let inbox = '';
  /** Whether the object store the service is given refuses to keep anything, as one down would. */
  let storeDown = false;

  const failable = (stores: ObjectStores): ObjectStores => ({
    forTenant: async (trx, tenant) => {
      const store = await stores.forTenant(trx, tenant);
      return {
        put: (body, type) =>
          storeDown ? Promise.reject(new Error('the store is down')) : store.put(body, type),
        putFile: (path, type) => store.putFile(path, type),
        get: (key) => store.get(key),
        remove: (key) => store.remove(key),
        signedLink: (...args) => store.signedLink(...args),
      };
    },
  });

  /** A token of a service identity, as Ada issues one. */
  const issue = async (scopes: string[], to = identity) => {
    const issued = await h.call('ada', 'POST', `/v1/service-identities/${to}/tokens`, {
      name: 'Another',
      scopes,
      expiresAt: inAMonth(),
    });
    expect(issued.statusCode, issued.body).toBe(200);
    return issued.json<{ id: string; secret: string }>();
  };

  /** A request signed as the bridge signs it: the path relative to /bridge, over the exact bytes. */
  const signed = (
    method: Method,
    path: string,
    body?: unknown,
    options: { readonly with?: string; readonly sent?: string; readonly host?: string } = {},
  ) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    return h.app.inject({
      method,
      url: `/bridge${path}`,
      headers: {
        host: options.host ?? HOST,
        ...signRequest(options.with ?? key, { method, path, body: payload }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { payload: options.sent ?? payload }),
    });
  };

  const credential = () => ({ token: token.secret });

  const delivery = (over: Record<string, unknown> = {}) => ({
    instanceId: instance,
    credential: credential(),
    destination: { space: h.general },
    idempotencyKey: randomBytes(32).toString('hex'),
    actingUser: null,
    package: fixture('package-decomposed.json'),
    ...over,
  });

  beforeAll(async () => {
    h = await startHarness({
      secrets: { SECRET_BRIDGE_KEYS: `${retiring}, ${key}` },
      objects: failable,
    });
    instance = h.tenant.id;
    const made = await h.call('ada', 'POST', '/v1/service-identities', {
      name: 'CT Studio',
      description: 'The delivery bridge',
    });
    expect(made.statusCode, made.body).toBe(200);
    identity = made.json<{ id: string }>().id;
    const issued = await h.call('ada', 'POST', `/v1/service-identities/${identity}/tokens`, {
      name: 'Bridge',
      scopes: ['create', 'edit'],
      expiresAt: inAMonth(),
    });
    expect(issued.statusCode, issued.body).toBe(200);
    token = issued.json<{ id: string; secret: string }>();
    await h.allow(identity, h.roles.Author!, { kind: 'space', id: h.general });
    await h.allow(identity, h.roles.Reader!, { kind: 'space', id: h.quality });
    inbox = (await h.tenantDb.withTenant(h.tenant, (trx) => createSpace(trx, 'Inbox'))).id;
    await h.allow(identity, h.roles.Author!, { kind: 'space', id: inbox });
    const own = await h.call('grace', 'POST', '/v1/tokens', {
      name: 'Mine',
      scopes: ['create', 'edit'],
      expiresAt: inAMonth(),
    });
    expect(own.statusCode, own.body).toBe(200);
    personal = own.json<{ secret: string }>().secret;
    await h.tenantDb.withTenant(h.tenant, (trx) =>
      writeBridgeSettings(trx, {
        spaceId: h.general,
        componentType: null,
        template: null,
        propertyMap: {},
        connectionId: null,
        tableSchema: null,
        changedBy: h.ids.ada!,
      }),
    );
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  it('API-065 an unsigned, stale, replayed or tampered request is refused 401', async () => {
    const unsigned = await h.app.inject({ url: '/bridge/describe', headers: { host: HOST } });
    expect(unsigned.statusCode).toBe(401);
    expect(unsigned.json()).toMatchObject({
      code: 'credential_rejected',
      details: { reason: 'missing' },
    });

    // An address no route claims is refused for its signature too, before its body is read.
    const nowhere = await h.app.inject({
      method: 'POST',
      url: '/bridge/nowhere',
      headers: { host: HOST, 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(nowhere.statusCode).toBe(401);
    expect(nowhere.json()).toMatchObject({ details: { reason: 'missing' } });
    // Refused on its headers, before its body is read: one claiming more than the limit is not
    // answered as too large, since nothing of it was taken in.
    const unread = await h.app.inject({
      method: 'POST',
      url: '/bridge/deliveries',
      headers: {
        host: HOST,
        'content-type': 'application/json',
        'content-length': String(200 * 1024 * 1024),
      },
      payload: '{}',
    });
    expect(unread.statusCode).toBe(401);

    const stale = await h.app.inject({
      url: '/bridge/describe',
      headers: {
        host: HOST,
        ...signRequest(
          key,
          { method: 'GET', path: '/describe', body: '' },
          () => Math.floor(Date.now() / 1000) - 600,
        ),
      },
    });
    expect(stale.statusCode).toBe(401);
    expect(stale.json()).toMatchObject({ details: { reason: 'stale' } });

    const headers = {
      host: HOST,
      ...signRequest(key, { method: 'GET', path: '/describe', body: '' }),
    };
    const first = await h.app.inject({ url: '/bridge/describe', headers });
    expect(first.statusCode, first.body).toBe(200);
    const again = await h.app.inject({ url: '/bridge/describe', headers });
    expect(again.statusCode).toBe(401);
    expect(again.json()).toMatchObject({
      code: 'credential_rejected',
      details: { reason: 'replayed' },
    });

    const tampered = await signed(
      'POST',
      '/connections:test',
      { instanceId: instance, credential: credential() },
      { sent: JSON.stringify({ instanceId: `${instance}x`, credential: credential() }) },
    );
    expect(tampered.statusCode).toBe(401);
    expect(tampered.json()).toMatchObject({ details: { reason: 'bad_signature' } });

    // Signed over the path as sent rather than relative to /bridge: not the bridge's signature.
    const absolute = await h.app.inject({
      url: '/bridge/describe',
      headers: {
        host: HOST,
        ...signRequest(key, { method: 'GET', path: '/bridge/describe', body: '' }),
      },
    });
    expect(absolute.statusCode).toBe(401);
    expect((await signed('GET', '/describe', undefined, { with: 'not-a-key' })).statusCode).toBe(
      401,
    );
    // Either key signs while one is rotated out.
    expect((await signed('GET', '/describe', undefined, { with: retiring })).statusCode).toBe(200);
  });

  it('API-065 describes contract version 2 with the tenant as its one instance', async () => {
    const answer = await signed('GET', '/describe');
    expect(answer.statusCode, answer.body).toBe(200);
    const described = SinkDescribeSchema.parse(answer.json());
    expect(described).toMatchObject({
      name: 'Alloy Works',
      contractVersion: 2,
      connectionKind: 'shared',
      instances: [{ id: h.tenant.id, label: 'Production' }],
      credentialFields: [{ id: 'token', secret: true }],
    });
    expect(described.destinationFields.map((field) => field.id)).toEqual([
      'space',
      'documentName',
      'tableSet',
    ]);
    const unknown = await signed('GET', '/describe', undefined, { host: 'nowhere.alloy.test' });
    expect(unknown.json()).toMatchObject({ code: 'instance_not_allowed' });
  });

  it("API-065 a person's token is credential_rejected", async () => {
    const asked = (secret: string) =>
      signed('POST', '/connections:test', { instanceId: instance, credential: { token: secret } });
    const person = await asked(personal);
    expect(person.statusCode).toBe(422);
    expect(person.json()).toMatchObject({ class: 'needs_user', code: 'credential_rejected' });
    expect((await asked(`awt_${randomBytes(32).toString('base64url')}`)).json()).toMatchObject({
      code: 'credential_rejected',
    });
    expect((await asked('not a token')).json()).toMatchObject({ code: 'credential_rejected' });
    const none = await signed('POST', '/connections:test', {
      instanceId: instance,
      credential: {},
    });
    expect(none.json()).toMatchObject({ code: 'credential_missing' });
    // A revoked token of the identity is refused at the very next call.
    const spare = await h.call('ada', 'POST', `/v1/service-identities/${identity}/tokens`, {
      name: 'Spare',
      scopes: [],
      expiresAt: inAMonth(),
    });
    const revoked = spare.json<{ id: string; secret: string }>();
    expect((await asked(revoked.secret)).statusCode).toBe(200);
    await h.tenantDb.withTenant(h.tenant, (trx) => revokeApiToken(trx, identity, revoked.id));
    expect((await asked(revoked.secret)).json()).toMatchObject({ code: 'credential_rejected' });
  });

  it('connections:test names the identity and tenant', async () => {
    const tested = await signed('POST', '/connections:test', {
      instanceId: instance,
      credential: credential(),
    });
    expect(tested.statusCode, tested.body).toBe(200);
    expect(tested.json()).toEqual({ ok: true, identity: 'CT Studio on Production' });
    const elsewhere = await signed('POST', '/connections:test', {
      instanceId: 'another',
      credential: credential(),
    });
    expect(elsewhere.json()).toMatchObject({ code: 'instance_not_allowed' });
  });

  it('browse lists spaces the identity may create in', async () => {
    const browsed = await signed('POST', '/browse', {
      instanceId: instance,
      credential: credential(),
      field: 'space',
      parentId: null,
      cursor: null,
    });
    expect(browsed.statusCode, browsed.body).toBe(200);
    const result = BrowseResultSchema.parse(browsed.json());
    // General and Inbox, where it is an Author; never Quality, which it may only read.
    const creatable = [
      { id: h.general, label: 'General', kind: 'space', hasChildren: false, selectable: true },
      { id: inbox, label: 'Inbox', kind: 'space', hasChildren: false, selectable: true },
    ];
    expect(result).toEqual({ nodes: creatable, nextCursor: null });

    // More spaces it may read than a listing page holds, all ahead of the two it may create in: the
    // browse reads on rather than answer an empty page with a cursor.
    await h.tenantDb.withTenant(h.tenant, async (trx) => {
      for (let n = 0; n < 60; n += 1) await createSpace(trx, `Annex ${String(n).padStart(2, '0')}`);
    });
    await h.allow(identity, h.roles.Reader!, { kind: 'tenant' });
    const past = await signed('POST', '/browse', {
      instanceId: instance,
      credential: credential(),
      field: 'space',
      parentId: null,
      cursor: null,
    });
    expect(past.json()).toEqual({ nodes: creatable, nextCursor: null });
    const children = await signed('POST', '/browse', {
      instanceId: instance,
      credential: credential(),
      field: 'space',
      parentId: h.general,
      cursor: null,
    });
    expect(children.json()).toEqual({ nodes: [], nextCursor: null });
  });

  it('API-068 a delivery answers pending, and the same key the same job', async () => {
    const asked = delivery();
    const first = await signed('POST', '/deliveries', asked);
    expect(first.statusCode, first.body).toBe(200);
    const { status, sinkJobId } = first.json<{ status: string; sinkJobId: string }>();
    expect(status).toBe('pending');
    const again = await signed('POST', '/deliveries', asked);
    expect(again.json()).toEqual({ status: 'pending', sinkJobId });
    expect((await signed('GET', `/deliveries/${sinkJobId}`)).json()).toEqual({ status: 'pending' });

    // One job, about the delivery; the delivery names the token by its id and its package by key.
    const jobs = await queryAs(
      h.db.adminUrl,
      `select kind from platform.job where tenant_id = $1 and subject_id = $2`,
      [h.tenant.id, sinkJobId],
    );
    expect(jobs.rows).toEqual([{ kind: 'bridge_deliver' }]);
    const row = await h.tenantDb.withTenant(h.tenant, (trx) =>
      trx
        .selectFrom('bridge_delivery')
        .selectAll()
        .where('id', '=', sinkJobId)
        .executeTakeFirstOrThrow(),
    );
    expect(row).toMatchObject({
      state: 'running',
      family: 'document',
      space_id: h.general,
      token_id: token.id,
    });
    expect(JSON.stringify(row)).not.toContain(token.secret);
    const stored = await h.tenantDb.withTenant(h.tenant, async (trx) =>
      (await h.stores.forTenant(trx, h.tenant)).get(row.package_key!),
    );
    const kept = JSON.parse(stored.toString('utf8')) as Record<string, unknown>;
    expect(kept).toMatchObject({
      destination: { space: h.general },
      idempotencyKey: asked.idempotencyKey,
    });
    expect(kept['package']).toEqual(asked.package);
    expect(stored.toString('utf8')).not.toContain(token.secret);

    // Once written, the key answers the first receipt and starts nothing.
    const receipt = { written: [{ kind: 'document', id: randomUUID(), label: null, url: null }] };
    await h.tenantDb.withTenant(h.tenant, (trx) => finishDelivery(trx, sinkJobId, receipt, []));
    expect((await signed('POST', '/deliveries', asked)).json()).toEqual({
      status: 'succeeded',
      receipt,
    });
    expect((await signed('GET', `/deliveries/${sinkJobId}`)).json()).toEqual({
      status: 'succeeded',
      receipt,
    });
    const after = await queryAs(
      h.db.adminUrl,
      `select count(*)::int as jobs from platform.job where tenant_id = $1 and kind = 'bridge_deliver'`,
      [h.tenant.id],
    );
    expect(after.rows).toEqual([{ jobs: 1 }]);
  });

  it('API-068 a package over 1 MiB of files alone is accepted, and needs no settings', async () => {
    // Ruling 24: files alone are taken and written as nothing; Inbox has no bridge settings.
    const files = fixture('package-document.json');
    const big = randomBytes(1_200_000).toString('base64');
    const asked = delivery({
      destination: { space: inbox },
      package: { ...files, data: null, files: [{ ...files.files[0]!, content: big }] },
    });
    expect(JSON.stringify(asked).length).toBeGreaterThan(1024 * 1024);
    const answer = await signed('POST', '/deliveries', asked);
    expect(answer.statusCode, answer.body.slice(0, 300)).toBe(200);
    expect(answer.json()).toMatchObject({ status: 'pending' });
    // A data package there is refused: its settings name no delivery store.
    const data = await signed(
      'POST',
      '/deliveries',
      delivery({ destination: { space: inbox }, package: fixture('package-document.json') }),
    );
    expect(data.json()).toMatchObject({ details: { reason: 'not_configured' } });
  });

  it('API-068 a key reused for another space or identity is refused, never answered', async () => {
    const asked = delivery();
    const first = (await signed('POST', '/deliveries', asked)).json<{ sinkJobId: string }>();
    const elsewhere = await signed('POST', '/deliveries', {
      ...asked,
      destination: { space: inbox },
    });
    expect(elsewhere.json()).toMatchObject({
      code: 'content_rejected',
      details: { reason: 'key_reused' },
    });
    const made = await h.call('ada', 'POST', '/v1/service-identities', {
      name: 'Another importer',
      description: 'Invented for the test',
    });
    expect(made.statusCode, made.body).toBe(200);
    const other = made.json<{ id: string }>().id;
    await h.allow(other, h.roles.Author!, { kind: 'space', id: h.general });
    const theirs = await issue(['create', 'edit'], other);
    const byOther = await signed('POST', '/deliveries', {
      ...asked,
      credential: { token: theirs.secret },
    });
    expect(byOther.json()).toMatchObject({ details: { reason: 'key_reused' } });
    expect(byOther.body).not.toContain(first.sinkJobId);
    // Another token of the same identity, as after a rotation, is the same caller.
    const rotated = await issue(['create', 'edit']);
    const same = await signed('POST', '/deliveries', {
      ...asked,
      credential: { token: rotated.secret },
    });
    expect(same.json()).toEqual({ status: 'pending', sinkJobId: first.sinkJobId });
  });

  it('API-065 a token expired, scoped short or of another tenant is refused', async () => {
    const expired = await issue(['create', 'edit']);
    await queryAs(
      h.db.adminUrl,
      `update ${h.tenant.schema}.api_token
          set created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
        where id = $1`,
      [expired.id],
    );
    const tested = await signed('POST', '/connections:test', {
      instanceId: instance,
      credential: { token: expired.secret },
    });
    expect(tested.json()).toMatchObject({ code: 'credential_rejected' });

    // Its grants are masked by its token's scopes: none, then create without edit for an update.
    const readOnly = await issue([]);
    const unscoped = await signed(
      'POST',
      '/deliveries',
      delivery({ credential: { token: readOnly.secret } }),
    );
    expect(unscoped.json()).toMatchObject({
      code: 'credential_rejected',
      details: { permission: 'create' },
    });
    const createOnly = await issue(['create']);
    const update = {
      persistentId: randomUUID(),
      expected: [{ kind: 'component', id: randomUUID(), version: '0.1', element: null }],
    };
    const updating = await signed(
      'POST',
      '/deliveries',
      delivery({ credential: { token: createOnly.secret }, update }),
    );
    expect(updating.json()).toMatchObject({
      code: 'credential_rejected',
      details: { permission: 'edit' },
    });
    const creating = await signed(
      'POST',
      '/deliveries',
      delivery({ credential: { token: createOnly.secret } }),
    );
    expect(creating.json()).toMatchObject({ status: 'pending' });

    // A live service identity's token in another environment is not one of this one's.
    const other = await createTenant(h.db.adminUrl, h.db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: h.db.newTenantId(), name: 'Elsewhere' },
      hostnames: ['elsewhere.alloy.test'],
    });
    const foreign = newTokenSecret();
    await h.tenantDb.withTenant(other, async (trx) => {
      const made = await createServiceIdentity(trx, {
        name: 'CT Studio',
        description: 'Elsewhere',
        by: null,
      });
      await issueApiToken(trx, {
        principalId: made.id,
        name: 'Bridge',
        tokenHash: hashToken(foreign),
        scopes: ['create', 'edit'],
        expiresAt: new Date(Date.now() + 86_400_000),
      });
    });
    const crossing = await signed('POST', '/connections:test', {
      instanceId: instance,
      credential: { token: foreign },
    });
    expect(crossing.json()).toMatchObject({ code: 'credential_rejected' });
  });

  it('a refused delivery answers failed, with its refusal', async () => {
    const started = (await signed('POST', '/deliveries', delivery())).json<{
      sinkJobId: string;
    }>();
    const refusal = bridgeError('content_rejected', 'A component was deleted.', {
      reason: 'component_deleted',
    });
    await h.tenantDb.withTenant(h.tenant, (trx) => refuseDelivery(trx, started.sinkJobId, refusal));
    expect((await signed('GET', `/deliveries/${started.sinkJobId}`)).json()).toEqual({
      status: 'failed',
      error: refusal,
    });
  });

  it('an object store that is down answers sink_unavailable, 503', async () => {
    storeDown = true;
    try {
      const asked = delivery();
      const answer = await signed('POST', '/deliveries', asked);
      expect(answer.statusCode).toBe(503);
      expect(answer.json()).toMatchObject({ class: 'retryable', code: 'sink_unavailable' });
      const kept = await h.tenantDb.withTenant(h.tenant, (trx) =>
        trx
          .selectFrom('bridge_delivery')
          .select('id')
          .where('key', '=', asked.idempotencyKey)
          .execute(),
      );
      expect(kept).toEqual([]);
    } finally {
      storeDown = false;
    }
  });

  it("every error is the contract's shape and never holds the token", async () => {
    const answers = [
      await signed('POST', '/deliveries', delivery({ instanceId: 'another' })),
      await signed('POST', '/deliveries', delivery({ credential: { token: personal } })),
      await signed('POST', '/deliveries', delivery({ destination: { space: h.quality } })),
      await signed('POST', '/deliveries', delivery({ destination: { space: randomUUID() } })),
      await signed('POST', '/deliveries', delivery({ destination: {} })),
      await signed('POST', '/deliveries', delivery({ package: fixture('package-document.json') })),
      await signed('POST', '/deliveries', delivery({ package: fixture('package-graph.json') })),
      await signed('POST', '/deliveries', { ...delivery(), stray: token.secret }),
      await signed('POST', '/deliveries', { credential: credential() }),
      await signed('POST', '/browse', {
        instanceId: instance,
        credential: credential(),
        field: 'x',
        parentId: null,
        cursor: null,
      }),
      await signed('POST', '/nowhere', { credential: credential() }),
    ];
    const codes = answers.map((answer) => {
      expect(answer.statusCode).toBeGreaterThanOrEqual(400);
      expect(answer.headers['cache-control']).toBe('no-store');
      expect(answer.body).not.toContain(token.secret);
      expect(answer.body).not.toContain(personal);
      const error = BridgeErrorSchema.parse(answer.json());
      return [error.code, (error.details as { reason?: string } | undefined)?.reason];
    });
    expect(codes).toEqual([
      ['instance_not_allowed', undefined],
      ['credential_rejected', undefined],
      // Quality, where it may only read.
      ['credential_rejected', undefined],
      ['not_found', undefined],
      ['content_rejected', 'invalid_request'],
      // A data package for a space whose settings name no delivery store.
      ['content_rejected', 'not_configured'],
      ['unsupported_part', undefined],
      ['content_rejected', 'invalid_request'],
      ['content_rejected', 'invalid_request'],
      ['content_rejected', 'invalid_request'],
      ['not_found', undefined],
    ]);
    expect(h.lines.join('')).not.toContain(token.secret);
    expect(h.lines.join('')).not.toContain(personal);
  });

  it('an unknown delivery id is not_found', async () => {
    for (const id of [randomUUID(), 'not-an-id']) {
      const answer = await signed('GET', `/deliveries/${id}`);
      expect(answer.statusCode).toBe(422);
      expect(answer.json()).toMatchObject({ class: 'needs_user', code: 'not_found' });
    }
  });
});
