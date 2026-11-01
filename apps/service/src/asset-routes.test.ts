import { crc32, deflateSync } from 'node:zlib';
import {
  bootstrapCluster,
  createDefinition,
  createSpace,
  createTenant,
  findRole,
  grant,
  migrate,
  readAssetUpload,
  recordAsset,
  removeGrant,
  seedDevelopmentContent,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import { readImageHeader } from '@alloy-works/domain';
import { createObjectStores, type ObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
type Json = Record<string, unknown>;

const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/** A real PNG, decodable: RGB, eight bits, every pixel red. */
const png = (width = 4, height = 3) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0)]);
  for (let x = 0; x < width; x += 1) row[1 + x * 3] = 255;
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

describe('uploading an image through the service (figures 1)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let objects: TestObjectStore;
  let stores: ObjectStores;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let general: string;
  let quality: string;
  let graceOnQuality: string;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (
    as: string | undefined,
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    payload?: Json,
  ) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, ...(as ? { cookie: cookies[as]! } : {}) },
      ...(payload ? { payload } : {}),
    });

  const fill = (
    as: string,
    upload: string,
    bytes: Buffer,
    contentType = 'application/octet-stream',
  ) =>
    app.inject({
      method: 'PUT',
      url: `/v1/asset-uploads/${upload}/bytes`,
      headers: { host: HOST, cookie: cookies[as]!, 'content-type': contentType },
      payload: bytes,
    });

  /** An upload made by this caller in this space, and its id. */
  const made = async (as: string, space: string, alternative: Json | null = null) => {
    const answer = await call(as, 'POST', `/v1/spaces/${space}/asset-uploads`, { alternative });
    expect(answer.statusCode, answer.body).toBe(200);
    return answer.json<{ id: string }>().id;
  };

  const upload = async (as: string, id: string) =>
    (await call(as, 'GET', `/v1/asset-uploads/${id}`)).json<Json>();

  /** What the `ingest` job does on success, straight through the store, as the worker would. */
  const ingested = async (id: string, bytes: Buffer) => {
    const read = readImageHeader(bytes);
    if (!read.ok) throw new Error(read.refusal);
    return tenantDb.withTenant(tenant, (trx) => recordAsset(trx, id, read.header));
  };

  const code = (answer: { json: <T>() => T }) => answer.json<{ code: string }>().code;

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
    stores = createObjectStores(objects.settings, objects.sealingKey);
    await configureStandIn(db.adminUrl, tenant, {
      issuer: idp.issuer,
      clientId: 'alloy',
    });
    tenantDb = testTenantDatabase(db.serviceUrl);
    await tenantDb.withTenant(tenant, (trx) => seedDevelopmentContent(trx, { issuer: idp.issuer }));
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
      objects: stores,
    });
    for (const user of ['ada', 'grace', 'alice', 'ivy']) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
      ids[user] = (await call(user, 'GET', '/v1/me')).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      const [reader, author] = await Promise.all(
        ['Reader', 'Author'].map((name) => findRole(trx, name)),
      );
      // The seed makes Ada and Grace Authors on General; Grace also authors Quality, which Ada may
      // not read. Alice reads General and creates nothing; Ivy holds nothing.
      for (const [role, principal, space] of [
        [author!, ids.grace!, quality],
        [reader!, ids.alice!, general],
      ] as const) {
        const answer = await grant(trx, {
          roleId: role.id,
          subject: { principal },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ids.ada!,
        });
        if (!('granted' in answer)) throw new Error(JSON.stringify(answer));
        if (space === quality) graceOnQuality = answer.granted.id;
      }
    });
  });

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await objects?.drop();
    await db?.drop();
  });

  it('makes an upload by create in its space, awaiting its bytes, with the description it was given', async () => {
    const answer = await call('grace', 'POST', `/v1/spaces/${general}/asset-uploads`, {
      alternative: { text: 'A red square', language: 'en-GB' },
    });
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json()).toMatchObject({
      space: general,
      state: 'awaiting',
      reason: null,
      assetVersion: null,
    });
    // Alice may read General and not create in it; Ivy may not read it at all.
    const reader = await call('alice', 'POST', `/v1/spaces/${general}/asset-uploads`, {
      alternative: null,
    });
    expect(reader.statusCode).toBe(403);
    const stranger = await call('ivy', 'POST', `/v1/spaces/${general}/asset-uploads`, {
      alternative: null,
    });
    expect(stranger.statusCode).toBe(404);
    const blank = await call('grace', 'POST', `/v1/spaces/${general}/asset-uploads`, {
      alternative: { text: '  ', language: 'en' },
    });
    expect(blank.statusCode).toBe(400);
  });

  /** A licence of the environment permitting internal use and publication, by its key. */
  const aLicence = async (key: string) => {
    const answer = await tenantDb.withTenant(tenant, (trx) =>
      createDefinition(trx, {
        kind: 'licence',
        definition: {
          schemaVersion: 1,
          name: key,
          key,
          base: 'en',
          names: [{ language: 'en', text: key }],
          permits: ['internal', 'publication'],
          attribution: { required: true, wording: 'Photograph by Ada' },
        },
        author: ids.ada!,
      }),
    );
    if (answer.answer !== 'created') throw new Error(answer.answer);
    return answer.definition.id;
  };

  it('AST-044 asks for an image\'s source and licence at upload, and records what was declared with its name (AL-E)', async () => {
    const licence = await aLicence('stock_at_upload');
    const declared = {
      kind: 'declared',
      source: { text: 'A stock library', url: 'https://stock.example/harbour' },
      licence,
      expires: '2027-03-31',
      credit: 'Photograph by Ada',
    };
    const answer = await call('grace', 'POST', `/v1/spaces/${general}/asset-uploads`, {
      alternative: null,
      name: 'harbour.png',
      rights: declared,
    });
    expect(answer.statusCode, answer.body).toBe(200);
    const id = answer.json<{ id: string }>().id;
    const bytes = png(5, 3);
    await fill('grace', id, bytes);
    const version = await ingested(id, bytes);
    const read = await call('alice', 'GET', `/v1/asset-versions/${version.id}`);
    expect(read.json()).toMatchObject({ name: 'harbour.png' });
    const rights = await call('alice', 'GET', `/v1/assets/${version.artifactId}/rights`);
    expect(rights.statusCode, rights.body).toBe(200);
    expect(rights.json()).toEqual({
      asset: version.artifactId,
      current: declared,
      history: [{ rights: declared, by: { id: ids.grace, name: 'Grace' }, at: expect.any(String) }],
    });

    // A licence that is no licence of the environment is refused before anything is made.
    const unknown = await call('grace', 'POST', `/v1/spaces/${general}/asset-uploads`, {
      alternative: null,
      rights: { ...declared, licence: general },
    });
    expect(unknown.statusCode).toBe(422);
    expect(code(unknown)).toBe('asset_licence_missing');
    // A dataset's kind is never a person's to declare.
    const dataset = await call('grace', 'POST', `/v1/spaces/${general}/asset-uploads`, {
      alternative: null,
      rights: { kind: 'dataset' },
    });
    expect(dataset.statusCode).toBe(400);
  });

  it("AST-031 records each change to an image's rights by edit on it, keeping the earlier ones", async () => {
    const licence = await aLicence('stock_changed');
    const bytes = png(6, 3);
    const id = await made('grace', general);
    await fill('grace', id, bytes);
    const version = await ingested(id, bytes);
    const url = `/v1/assets/${version.artifactId}/rights`;
    expect((await call('grace', 'GET', url)).json()).toMatchObject({
      current: { kind: 'undeclared' },
    });
    const declared = { kind: 'declared', source: { text: 'Grace, who took it' }, licence };
    const changed = await call('grace', 'PUT', url, { rights: declared });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(
      changed.json<{ history: { rights: Json }[] }>().history.map((each) => each.rights),
    ).toEqual([declared, { kind: 'undeclared' }]);
    // Alice reads it and may not change it; Ivy may not read it; a licence not there is refused.
    expect((await call('alice', 'GET', url)).statusCode).toBe(200);
    expect((await call('alice', 'PUT', url, { rights: { kind: 'undeclared' } })).statusCode).toBe(
      403,
    );
    expect((await call('ivy', 'GET', url)).statusCode).toBe(404);
    const missing = await call('grace', 'PUT', url, { rights: { ...declared, licence: general } });
    expect(missing.statusCode).toBe(422);
    expect(code(missing)).toBe('asset_licence_missing');
    // An id that is not an asset's is no asset's rights.
    expect((await call('grace', 'GET', `/v1/assets/${licence}/rights`)).statusCode).toBe(404);
  });

  it('AST-001 AST-002 AST-038 refuses a file that is not a PNG or a JPEG, whatever it claims, and keeps the refusal', async () => {
    const id = await made('grace', general);
    const gif = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(20)]);
    const answer = await fill('grace', id, gif);
    expect(answer.statusCode).toBe(400);
    expect(code(answer)).toBe('asset_format_not_permitted');
    expect(answer.json()).toMatchObject({ rule: 'AST-001' });
    expect(await upload('grace', id)).toMatchObject({ state: 'refused', reason: 'not_permitted' });
    // Refused rather than stored: the upload names no bytes at all.
    const stored = await tenantDb.withTenant(tenant, (trx) => readAssetUpload(trx, id));
    expect(stored?.objectKey).toBeNull();
  });

  it('refuses anything but bytes before reading it, and leaves the upload to be filled properly', async () => {
    const id = await made('grace', general);
    expect((await fill('grace', id, png(), 'image/png')).statusCode).toBe(415);
    const json = await app.inject({
      method: 'PUT',
      url: `/v1/asset-uploads/${id}/bytes`,
      headers: { host: HOST, cookie: cookies.grace!, 'content-type': 'application/json' },
      payload: { image: 'not bytes' },
    });
    expect(json.statusCode).toBe(415);
    expect(code(json)).toBe('asset_bytes_expected');
    const none = await app.inject({
      method: 'PUT',
      url: `/v1/asset-uploads/${id}/bytes`,
      headers: { host: HOST, cookie: cookies.grace! },
    });
    expect(none.statusCode).toBe(415);
    expect(await upload('grace', id)).toMatchObject({ state: 'awaiting' });
    expect((await fill('grace', id, png())).statusCode).toBe(200);
  });

  it('keeps the image alone, leaving behind whatever follows its end: a second picture, a clip or a hidden file', async () => {
    const image = png(3, 2);
    const id = await made('grace', general);
    const followed = await fill(
      'grace',
      id,
      Buffer.concat([image, Buffer.from([0x50, 0x4b, 3, 4])]),
    );
    expect(followed.statusCode, followed.body).toBe(200);
    const version = await ingested(id, image);
    const content = await call('grace', 'GET', `/v1/asset-versions/${version.id}/content`);
    expect(content.rawPayload.equals(image)).toBe(true);
    expect((await call('grace', 'GET', `/v1/asset-versions/${version.id}`)).json()).toMatchObject({
      bytes: image.length,
    });
  });

  it('AST-040 refuses more pixels than the limit on the header alone, before storing anything', async () => {
    const huge = await made('grace', general);
    const tooMany = await fill('grace', huge, png(8000, 8000).subarray(0, 33));
    expect(tooMany.statusCode).toBe(413);
    expect(code(tooMany)).toBe('asset_too_large');
    expect(tooMany.json()).toMatchObject({ rule: 'AST-040' });
    expect(await upload('grace', huge)).toMatchObject({
      state: 'refused',
      reason: 'too_many_pixels',
    });
  });

  it('refuses a body over the byte limit before reading it whole, and leaves the upload awaiting', async () => {
    const id = await made('grace', general);
    const answer = await fill('grace', id, Buffer.alloc(25_000_001));
    expect(answer.statusCode).toBe(413);
    expect(code(answer)).toBe('asset_too_large');
    // A limit of the service's own on what it will read, and no requirement's: no rule is named.
    expect(answer.json()).not.toHaveProperty('rule');
    expect(await upload('grace', id)).toMatchObject({ state: 'awaiting' });
  });

  it('AST-035 holds an upload checking, seen by its uploader alone and naming no asset, until its check finishes', async () => {
    const id = await made('grace', general, { text: 'A red square', language: 'en-GB' });
    const answer = await fill('grace', id, png());
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json()).toMatchObject({ state: 'checking', assetVersion: null });
    expect(await upload('grace', id)).toMatchObject({ state: 'checking', assetVersion: null });
    for (const other of ['ada', 'alice', 'ivy']) {
      expect((await call(other, 'GET', `/v1/asset-uploads/${id}`)).statusCode, other).toBe(404);
      expect((await fill(other, id, png())).statusCode, other).toBe(404);
    }
    // The same bytes again - a retry after a lost answer - are answered with the upload as it
    // stands (ID-D); other bytes for it are refused, as it is filled.
    const again = await fill('grace', id, png());
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ id, state: 'checking', assetVersion: null });
    const other = await fill('grace', id, png(5, 5));
    expect(other.statusCode).toBe(409);
    expect(code(other)).toBe('asset_upload_filled');
  });

  it('AST-026 reads an asset version, and its bytes, by read on the space it is in, never sniffed and never run', async () => {
    const bytes = png();
    const id = await made('grace', general, { text: 'A red square', language: 'en-GB' });
    await fill('grace', id, bytes);
    const version = await ingested(id, bytes);
    expect(await upload('grace', id)).toMatchObject({ state: 'ready', assetVersion: version.id });

    const read = await call('alice', 'GET', `/v1/asset-versions/${version.id}`);
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toEqual({
      id: version.id,
      asset: version.artifactId,
      number: '0.1',
      format: 'png',
      bytes: bytes.length,
      width: 4,
      height: 3,
      resolution: null,
      name: null,
      alternative: { text: 'A red square', language: 'en-GB' },
    });
    const content = await call('alice', 'GET', `/v1/asset-versions/${version.id}/content`);
    expect(content.statusCode).toBe(200);
    expect(content.rawPayload.equals(bytes)).toBe(true);
    expect(content.headers).toMatchObject({
      'content-type': 'image/png',
      'x-content-type-options': 'nosniff',
      'content-security-policy': 'sandbox',
      'cache-control': 'private, max-age=31536000, immutable',
    });
    for (const path of [
      `/v1/asset-versions/${version.id}`,
      `/v1/asset-versions/${version.id}/content`,
    ]) {
      expect((await call('ivy', 'GET', path)).statusCode, path).toBe(404);
    }
  });

  it('AST-026 keeps an asset in a space the reader may not read from them, as a component there is', async () => {
    const bytes = png(2, 2);
    const id = await made('grace', quality);
    await fill('grace', id, bytes);
    const version = await ingested(id, bytes);
    expect((await call('grace', 'GET', `/v1/asset-versions/${version.id}`)).statusCode).toBe(200);
    expect((await call('ada', 'GET', `/v1/asset-versions/${version.id}`)).statusCode).toBe(404);
    expect((await call('ada', 'GET', `/v1/asset-versions/${version.id}/content`)).statusCode).toBe(
      404,
    );
  });

  it('answers a version that is not an asset, or none at all, as not found', async () => {
    const nobody = '11111111-1111-4111-8111-111111111111';
    expect((await call('grace', 'GET', `/v1/asset-versions/${nobody}`)).statusCode).toBe(404);
    const component = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('artifact_version')
        .select('id')
        .where('kind', '=', 'component')
        .executeTakeFirstOrThrow(),
    );
    expect((await call('grace', 'GET', `/v1/asset-versions/${component.id}`)).statusCode).toBe(404);
  });

  it('decides create in the space again when the bytes arrive, so a grant removed since stops the upload', async () => {
    const id = await made('grace', quality);
    await tenantDb.withTenant(tenant, (trx) => removeGrant(trx, graceOnQuality));
    const answer = await fill('grace', id, png());
    expect(answer.statusCode).toBe(404);
    const held = await tenantDb.withTenant(tenant, (trx) => readAssetUpload(trx, id));
    expect(held).toMatchObject({ state: 'awaiting', objectKey: null });
  });
  it("AST-053 keeps the environment's policy for undeclared images, read by anyone signed in and set by an administrator", async () => {
    expect((await call('alice', 'GET', '/v1/settings/images')).json()).toEqual({
      undeclared: 'warn',
    });
    const administers = await tenantDb.withTenant(tenant, async (trx) => {
      const administrator = await findRole(trx, 'Administrator');
      return grant(trx, {
        roleId: administrator!.id,
        subject: { principal: ids.ada! },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
    });
    expect(
      (await call('grace', 'PUT', '/v1/settings/images', { undeclared: 'refuse' })).statusCode,
    ).toBe(403);
    const set = await call('ada', 'PUT', '/v1/settings/images', { undeclared: 'refuse' });
    expect(set.statusCode, set.body).toBe(200);
    expect((await call('alice', 'GET', '/v1/settings/images')).json()).toEqual({
      undeclared: 'refuse',
    });
    expect(
      (await call('ada', 'PUT', '/v1/settings/images', { undeclared: 'never' })).statusCode,
    ).toBe(400);
    await call('ada', 'PUT', '/v1/settings/images', { undeclared: 'warn' });
    if (!('granted' in administers)) throw new Error(JSON.stringify(administers));
    await tenantDb.withTenant(tenant, (trx) => removeGrant(trx, administers.granted.id));
  });
});
