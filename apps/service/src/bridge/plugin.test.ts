import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { finishDelivery, revokeApiToken, writeBridgeSettings } from '@alloy-works/db';
import { queryAs } from '@alloy-works/db/testing';
import {
  BridgeErrorSchema,
  BrowseResultSchema,
  signRequest,
  SinkDescribeSchema,
  type BridgePackage,
} from '@kenhayward/bridge-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOST, startHarness, type Harness } from '../test/bindings-harness.js';

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
    h = await startHarness({ secrets: { SECRET_BRIDGE_KEYS: `${retiring}, ${key}` } });
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
    // General, where it is an Author; never Quality, which it may only read.
    expect(result.nodes).toEqual([
      { id: h.general, label: 'General', kind: 'space', hasChildren: false, selectable: true },
    ]);
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
