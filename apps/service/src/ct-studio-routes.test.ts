import { randomUUID } from 'node:crypto';
import type {
  BridgeSettingsView,
  CtStudioConnected,
  CtStudioStatus,
  CtStudioTokenIssued,
} from '@alloy-works/api-contract';
import { writeBridgeSettings, writeCtStudio, createServiceIdentity } from '@alloy-works/db';
import type { Tenant } from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Authorised } from './access.js';
import { ctStudioHandlers } from './bridge/ct-studio.js';
import { HOST, startHarness, type Harness } from './test/bindings-harness.js';
import { DELIVERED_URL, ensureDeliveredDatabase } from './test/delivered.js';

const KEY = 'a-signing-key-no-response-may-carry';

describe('connecting CT Studio through the service (docs/design/ct-studio-connect.md)', () => {
  let h: Harness;
  let keyless: Harness;

  const status = async (on: Harness = h, as = 'ada') => {
    const answer = await on.call(as, 'GET', '/v1/ct-studio');
    expect(answer.statusCode, answer.body).toBe(200);
    return answer;
  };

  beforeAll(async () => {
    h = await startHarness({ secrets: { SINK_BRIDGE_KEYS: KEY } });
    keyless = await startHarness();
  });

  afterAll(async () => {
    await h?.close();
    await keyless?.close();
  });

  it('API-074 a fresh environment answers no identity, bridgeOn from the keys', async () => {
    const on = (await status()).json<CtStudioStatus>();
    expect(on).toMatchObject({
      bridgeOn: true,
      identity: null,
      token: null,
      spaces: [],
      address: null,
      sinkId: null,
    });
    expect(on.hostnames).toContain(HOST);
    expect((await status(keyless)).json<CtStudioStatus>().bridgeOn).toBe(false);
  });

  it('API-074 the status never carries the signing key', async () => {
    expect((await status()).body).not.toContain(KEY);
  });

  it('API-074 a space whose grant was removed shows granted false', async () => {
    await h.tenantDb.withTenant(h.tenant, async (trx) => {
      const identity = await createServiceIdentity(trx, {
        name: 'CT Studio deliveries',
        description: '',
        by: h.ids.ada!,
      });
      await writeCtStudio(trx, { identityId: identity.id });
      await writeBridgeSettings(trx, {
        spaceId: h.quality,
        componentType: null,
        template: null,
        propertyMap: {},
        connectionId: null,
        tableSchema: null,
        changedBy: h.ids.ada!,
      });
    });
    const now = (await status()).json<CtStudioStatus>();
    expect(now.identity).toMatchObject({ name: 'CT Studio deliveries', disabled: false });
    expect(now.spaces).toEqual([{ id: h.quality, name: 'Quality', granted: false, data: false }]);
  });

  it('API-074 a person who is not an administrator is refused 403', async () => {
    expect((await h.call('grace', 'GET', '/v1/ct-studio')).statusCode).toBe(403);
  });
});

describe('connecting a space to CT Studio (docs/design/ct-studio-connect.md)', () => {
  let h: Harness;
  const ADDRESS = 'https://acme.alloy.test';
  const blank = { componentType: null, template: null, propertyMap: {}, data: false };
  const connect = (space: string, identity: unknown, settings: unknown = blank) =>
    h.call('ada', 'POST', '/v1/ct-studio/connections', {
      space,
      identity,
      settings,
      address: ADDRESS,
      sinkId: 'alloy-acme',
    });
  const identities = () =>
    h.tenantDb.withTenant(h.tenant, (trx) =>
      trx
        .selectFrom('service_identity as s')
        .innerJoin('principal as p', 'p.id', 's.principal_id')
        .select(['p.id', 'p.display_name', 's.disabled_at'])
        .orderBy('p.display_name')
        .execute(),
    );
  const authorGrants = (principal: string, space?: string) =>
    h.tenantDb.withTenant(h.tenant, (trx) => {
      let query = trx
        .selectFrom('access_grant')
        .select('id')
        .where('principal_id', '=', principal)
        .where('role_id', '=', h.roles.Author!)
        .where('level', '=', 'space');
      if (space !== undefined) query = query.where('space_id', '=', space);
      return query.execute();
    });
  const tokensOf = (principal: string) =>
    h.tenantDb.withTenant(h.tenant, (trx) =>
      trx.selectFrom('api_token').select('id').where('principal_id', '=', principal).execute(),
    );

  beforeAll(async () => {
    await ensureDeliveredDatabase();
    h = await startHarness({
      secrets: { SINK_BRIDGE_KEYS: KEY, SECRET_DELIVERED_URL: DELIVERED_URL },
    });
  });

  afterAll(async () => {
    await h?.close();
  });

  it('API-074 a refused setting leaves nothing made', async () => {
    const answer = await connect(h.general, { make: true }, { ...blank, template: randomUUID() });
    expect(answer.statusCode, answer.body).toBe(422);
    expect(await identities()).toEqual([]);
    const status = (await h.call('ada', 'GET', '/v1/ct-studio')).json<CtStudioStatus>();
    expect(status.identity).toBeNull();
  });

  it('API-074 reusing before anything is set up is refused ct_studio_not_set_up', async () => {
    const answer = await connect(h.general, null);
    expect(answer.statusCode, answer.body).toBe(409);
    expect(answer.json()).toMatchObject({ code: 'ct_studio_not_set_up' });
  });

  it('API-074 the first connection makes the identity, grants Author and issues one token', async () => {
    const answer = await connect(h.general, { make: true });
    expect(answer.statusCode, answer.body).toBe(200);
    const body = answer.json<CtStudioConnected>();
    const made = await identities();
    expect(made).toHaveLength(1);
    expect(made[0]!.display_name).toBe('CT Studio deliveries');
    expect(await authorGrants(made[0]!.id, h.general)).toHaveLength(1);
    expect(body.issued!.secret).toMatch(/^awt_/);
    expect([...body.issued!.scopes].sort()).toEqual(['create', 'edit']);
    const days = (Date.parse(body.issued!.expiresAt) - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(365);
    expect(body.status).toMatchObject({
      identity: { id: made[0]!.id, disabled: false },
      token: { id: body.issued!.id },
      address: ADDRESS,
      sinkId: 'alloy-acme',
      spaces: [{ id: h.general, granted: true }],
    });
    expect(answer.headers['cache-control']).toBe('no-store');
  });

  it('API-074 making or adopting again once set up is refused ct_studio_already_set_up', async () => {
    const answer = await connect(h.quality, { make: true });
    expect(answer.statusCode, answer.body).toBe(409);
    expect(answer.json()).toMatchObject({ code: 'ct_studio_already_set_up' });
  });

  it('API-074 a later space reuses the identity and issues no token', async () => {
    const answer = await connect(h.quality, null);
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json<CtStudioConnected>().issued).toBeNull();
    const [identity] = await identities();
    expect(await authorGrants(identity!.id)).toHaveLength(2);
    expect(await tokensOf(identity!.id)).toHaveLength(1);
  });

  it('API-074 connecting a space again adds no second grant', async () => {
    expect((await connect(h.quality, null)).statusCode).toBe(200);
    const [identity] = await identities();
    expect(await authorGrants(identity!.id, h.quality)).toHaveLength(1);
  });

  it('API-074 data on makes the connection', async () => {
    const answer = await connect(h.quality, null, { ...blank, data: true });
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json<CtStudioConnected>().settings.connection).toEqual(expect.any(String));
  });

  it('API-074 a new token replaces the recorded one; the old one stays live', async () => {
    const [identity] = await identities();
    const before = (await h.call('ada', 'GET', '/v1/ct-studio')).json<CtStudioStatus>().token!;
    const answer = await h.call('ada', 'POST', '/v1/ct-studio/tokens', { replaceIdentity: false });
    expect(answer.statusCode, answer.body).toBe(200);
    const body = answer.json<CtStudioTokenIssued>();
    expect(body.issued.secret).toMatch(/^awt_/);
    expect(body.status.token!.id).toBe(body.issued.id);
    expect((await tokensOf(identity!.id)).map((each) => each.id)).toContain(before.id);
    expect(answer.headers['cache-control']).toBe('no-store');
  });

  it('API-074 replacing an identity that is still enabled is refused ct_studio_identity_enabled', async () => {
    const [identity] = await identities();
    const answer = await h.call('ada', 'POST', '/v1/ct-studio/tokens', { replaceIdentity: true });
    expect(answer.statusCode, answer.body).toBe(409);
    expect(answer.json()).toMatchObject({ code: 'ct_studio_identity_enabled' });
    expect(await identities()).toHaveLength(1);
    const status = (await h.call('ada', 'GET', '/v1/ct-studio')).json<CtStudioStatus>();
    expect(status.identity!.id).toBe(identity!.id);
  });

  it('API-074 replacing a disabled identity grants the new one at every connected space', async () => {
    const [old] = await identities();
    const disabled = await h.call('ada', 'POST', `/v1/service-identities/${old!.id}/disablement`);
    expect(disabled.statusCode, disabled.body).toBe(200);
    const refused = await h.call('ada', 'POST', '/v1/ct-studio/tokens', { replaceIdentity: false });
    expect(refused.json()).toMatchObject({ code: 'ct_studio_identity_disabled' });
    const answer = await h.call('ada', 'POST', '/v1/ct-studio/tokens', { replaceIdentity: true });
    expect(answer.statusCode, answer.body).toBe(200);
    const status = answer.json<CtStudioTokenIssued>().status;
    expect(status.identity!.id).not.toBe(old!.id);
    expect(status.spaces.map((space) => space.granted)).toEqual([true, true]);
    expect(await authorGrants(status.identity!.id)).toHaveLength(2);
  });
});

describe('adopting a service identity made by hand', () => {
  let h: Harness;
  const adopt = (identity: string, token: string) =>
    h.call('ada', 'POST', '/v1/ct-studio/connections', {
      space: h.general,
      identity: { adopt: identity, token },
      settings: { componentType: null, template: null, propertyMap: {}, data: false },
      address: 'https://acme.alloy.test',
      sinkId: 'alloy-acme',
    });
  const handMade = async (scopes: readonly string[] = ['create', 'edit']) => {
    const made = await h.call('ada', 'POST', '/v1/service-identities', {
      name: 'By hand',
      description: '',
    });
    const identity = made.json<{ id: string }>().id;
    const issued = await h.call('ada', 'POST', `/v1/service-identities/${identity}/tokens`, {
      name: 'CT Studio',
      scopes,
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    return { identity, token: issued.json<{ id: string }>().id };
  };

  beforeAll(async () => {
    h = await startHarness({ secrets: { SINK_BRIDGE_KEYS: KEY } });
  });

  afterAll(async () => {
    await h?.close();
  });

  it('API-074 adopting a revoked token is refused ct_studio_token_unusable and records nothing', async () => {
    const { identity, token } = await handMade();
    const revoked = await h.call('ada', 'DELETE', `/v1/principals/${identity}/tokens/${token}`);
    expect(revoked.statusCode, revoked.body).toBeLessThan(300);
    const answer = await adopt(identity, token);
    expect(answer.statusCode, answer.body).toBe(422);
    expect(answer.json()).toMatchObject({ code: 'ct_studio_token_unusable' });
    const status = (await h.call('ada', 'GET', '/v1/ct-studio')).json<CtStudioStatus>();
    expect(status.identity).toBeNull();
  });

  it('API-074 adopting a token that cannot both create and edit is refused ct_studio_token_unusable', async () => {
    const { identity, token } = await handMade(['create']);
    const answer = await adopt(identity, token);
    expect(answer.statusCode, answer.body).toBe(422);
    expect(answer.json()).toMatchObject({ code: 'ct_studio_token_unusable' });
    const status = (await h.call('ada', 'GET', '/v1/ct-studio')).json<CtStudioStatus>();
    expect(status.identity).toBeNull();
  });

  it('API-074 adopting a disabled identity is refused ct_studio_identity_disabled', async () => {
    const { identity, token } = await handMade();
    await h.call('ada', 'POST', `/v1/service-identities/${identity}/disablement`);
    const answer = await adopt(identity, token);
    expect(answer.statusCode, answer.body).toBe(409);
    expect(answer.json()).toMatchObject({ code: 'ct_studio_identity_disabled' });
  });

  it('API-074 adopting keeps the identity and its token and records it', async () => {
    const { identity, token } = await handMade();
    const answer = await adopt(identity, token);
    expect(answer.statusCode, answer.body).toBe(200);
    const body = answer.json<CtStudioConnected>();
    expect(body.issued).toBeNull();
    expect(body.status).toMatchObject({ identity: { id: identity }, token: { id: token } });
  });
});

describe('the delivery store password changing last on connect', () => {
  let h: Harness;
  const view = { data: true } as unknown as BridgeSettingsView;
  const connectWith = (tenantOf: () => Tenant, commit: () => Promise<void>) => {
    const { handlers } = ctStudioHandlers({
      db: h.tenantDb,
      tenantOf,
      bridgeOn: true,
      saveSettings: async () => ({ view, commit }),
    });
    const body = {
      space: h.general,
      identity: { make: true },
      settings: { componentType: null, template: null, propertyMap: {}, data: true },
      address: 'https://acme.alloy.test',
      sinkId: 'alloy-acme',
    };
    return h.tenantDb.withTenant(h.tenant, (trx) =>
      handlers.connectCtStudio(
        { body } as unknown as FastifyRequest,
        {
          trx,
          principalId: h.ids.ada!,
        } as unknown as Authorised,
      ),
    );
  };

  beforeAll(async () => {
    h = await startHarness({ secrets: { SINK_BRIDGE_KEYS: KEY } });
  });

  afterAll(async () => {
    await h?.close();
  });

  it('API-074 a connect that fails after the settings are saved leaves the password unchanged', async () => {
    const commit = vi.fn(async () => {});
    const failing = () => {
      throw new Error('the status read failed');
    };
    await expect(connectWith(failing, commit)).rejects.toThrow('the status read failed');
    expect(commit).not.toHaveBeenCalled();
  });

  it('API-074 a connect that answers changes the password once, after everything else', async () => {
    const commit = vi.fn(async () => {});
    const answer = await connectWith(() => h.tenant, commit);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(answer.settings).toBe(view);
  });
});

describe('disconnecting a space from CT Studio', () => {
  let h: Harness;
  const blank = { componentType: null, template: null, propertyMap: {}, data: false };
  const connect = (space: string, identity: unknown) =>
    h.call('ada', 'POST', '/v1/ct-studio/connections', {
      space,
      identity,
      settings: blank,
      address: 'https://acme.alloy.test',
      sinkId: 'alloy-acme',
    });
  const disconnect = (space: string) =>
    h.call('ada', 'DELETE', `/v1/ct-studio/connections/${space}`);
  const authorGrants = (principal: string, space: string) =>
    h.tenantDb.withTenant(h.tenant, (trx) =>
      trx
        .selectFrom('access_grant')
        .select('id')
        .where('principal_id', '=', principal)
        .where('role_id', '=', h.roles.Author!)
        .where('space_id', '=', space)
        .execute(),
    );

  beforeAll(async () => {
    h = await startHarness({ secrets: { SINK_BRIDGE_KEYS: KEY } });
  });

  afterAll(async () => {
    await h?.close();
  });

  it('API-077 disconnecting before anything is set up is refused ct_studio_not_set_up', async () => {
    const answer = await disconnect(h.general);
    expect(answer.statusCode, answer.body).toBe(409);
    expect(answer.json()).toMatchObject({ code: 'ct_studio_not_set_up' });
  });

  it('API-077 disconnecting a space removes its grant and settings and keeps the identity, token and other spaces', async () => {
    expect((await connect(h.general, { make: true })).statusCode).toBe(200);
    expect((await connect(h.quality, null)).statusCode).toBe(200);
    const before = (await h.call('ada', 'GET', '/v1/ct-studio')).json<CtStudioStatus>();
    const answer = await disconnect(h.quality);
    expect(answer.statusCode, answer.body).toBe(200);
    const status = answer.json<CtStudioStatus>();
    expect(status.spaces.map((space) => space.id)).toEqual([h.general]);
    expect(status.identity).toEqual(before.identity);
    expect(status.token).toEqual(before.token);
    expect(await authorGrants(before.identity!.id, h.quality)).toEqual([]);
    expect(await authorGrants(before.identity!.id, h.general)).toHaveLength(1);
    const settings = await h.call('ada', 'GET', `/v1/spaces/${h.quality}/bridge-settings`);
    expect(settings.json()).toMatchObject({ template: null, propertyMap: {}, data: false });
  });

  it('API-077 disconnecting a space that is not connected is refused 404 ct_studio_not_connected', async () => {
    const answer = await disconnect(h.quality);
    expect(answer.statusCode, answer.body).toBe(404);
    expect(answer.json()).toMatchObject({ code: 'ct_studio_not_connected' });
  });

  it('API-077 a disconnected space connects again on the same token, nothing issued', async () => {
    const answer = await connect(h.quality, null);
    expect(answer.statusCode, answer.body).toBe(200);
    const body = answer.json<CtStudioConnected>();
    expect(body.issued).toBeNull();
    expect(body.status.spaces.find((space) => space.id === h.quality)?.granted).toBe(true);
  });
});
