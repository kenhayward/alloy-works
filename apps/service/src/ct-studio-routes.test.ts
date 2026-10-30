import type { CtStudioStatus } from '@alloy-works/api-contract';
import { writeBridgeSettings, writeCtStudio, createServiceIdentity } from '@alloy-works/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOST, startHarness, type Harness } from './test/bindings-harness.js';

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
    h = await startHarness({ secrets: { SECRET_BRIDGE_KEYS: KEY } });
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
