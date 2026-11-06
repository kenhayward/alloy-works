import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

const CHANNEL = '/v1/mail-channel';
const OWN = {
  enabled: false,
  relay: 'own',
  host: 'mail.example.test',
  port: 587,
  username: 'alloy',
  fromAddress: 'documents@example.test',
  fromName: 'Example documents',
};
const PASSWORD = 'not-a-real-password-1234';

describe('a tenant’s mail channel through the API (the EM plan)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const code = (answer: { json: <T>() => T }) => answer.json<{ code: string }>().code;

  it('starts off, and says whether the operator offers a relay', async () => {
    const read = await h.call('ada', 'GET', CHANNEL);
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toMatchObject({
      channel: { enabled: false, relay: 'platform', hasPassword: false },
      platform: { offered: false },
    });
  });

  it('refuses the operator’s relay where the operator offers none', async () => {
    const refused = await h.call('ada', 'PUT', CHANNEL, {
      enabled: true,
      relay: 'platform',
      fromName: 'Example',
    });
    expect(refused.statusCode).toBe(409);
    expect(code(refused)).toBe('mail_relay_unavailable');
  });

  it('refuses a port that is not TLS, and a line break in a name', async () => {
    expect((await h.call('ada', 'PUT', CHANNEL, { ...OWN, port: 25 })).statusCode).toBe(400);
    const broken = { ...OWN, fromName: `Example${String.fromCharCode(10)}Bcc: a@example.test` };
    expect((await h.call('ada', 'PUT', CHANNEL, broken)).statusCode).toBe(400);
  });

  it('will not turn on a relay needing a password it does not hold', async () => {
    expect((await h.call('ada', 'PUT', CHANNEL, OWN)).statusCode).toBe(200);
    const refused = await h.call('ada', 'PUT', CHANNEL, { ...OWN, enabled: true });
    expect(refused.statusCode).toBe(409);
    expect(code(refused)).toBe('mail_no_password');
  });

  it('seals a password to the relay, answers it never, and turns on', async () => {
    const set = await h.call('ada', 'PUT', `${CHANNEL}/password`, { password: PASSWORD });
    expect(set.statusCode, set.body).toBe(200);
    const sealed = h.connector.asked.find((each) => each.path === '/v1/mail/seal');
    expect(sealed?.body).toMatchObject({
      host: OWN.host,
      port: OWN.port,
      username: OWN.username,
    });
    const on = await h.call('ada', 'PUT', CHANNEL, { ...OWN, enabled: true });
    expect(on.statusCode, on.body).toBe(200);
    expect(on.json()).toMatchObject({ channel: { enabled: true, hasPassword: true } });
    const read = await h.call('ada', 'GET', CHANNEL);
    expect(read.body).not.toContain(PASSWORD);
    expect(read.body).not.toContain('sealed');
  });

  it('asks for the password again on moving the relay, so it never goes to another host', async () => {
    const moving = { ...OWN, host: 'elsewhere.example.test', enabled: true };
    const refused = await h.call('ada', 'PUT', CHANNEL, moving);
    expect(refused.statusCode).toBe(409);
    expect(code(refused)).toBe('mail_no_password');
    expect((await h.call('ada', 'GET', CHANNEL)).json()).toMatchObject({
      channel: { host: OWN.host, enabled: true, hasPassword: true },
    });
    const moved = await h.call('ada', 'PUT', CHANNEL, { ...moving, enabled: false });
    expect(moved.json()).toMatchObject({
      channel: { host: moving.host, enabled: false, hasPassword: false },
    });
  });

  it('turns on a relay with no sign-in, TLS still required, and holds no password', async () => {
    const open = { ...OWN, username: null, enabled: true };
    const on = await h.call('ada', 'PUT', CHANNEL, open);
    expect(on.statusCode, on.body).toBe(200);
    const refused = await h.call('ada', 'PUT', `${CHANNEL}/password`, { password: PASSWORD });
    expect(refused.statusCode).toBe(409);
    expect(code(refused)).toBe('mail_no_password_needed');
    expect((await h.call('ada', 'PUT', CHANNEL, OWN)).statusCode).toBe(200);
  });

  it('records each change, naming no host, address or password', async () => {
    const events = await h.tenantDb.withTenant(h.tenant, (trx) =>
      trx
        .selectFrom('audit_event')
        .select(['kind', 'detail'])
        .where('kind', '=', 'mail_channel.changed')
        .execute(),
    );
    expect(events.length).toBeGreaterThan(3);
    const told = JSON.stringify(events);
    expect(told).toContain('password_set');
    for (const secret of [PASSWORD, OWN.host, OWN.fromAddress, OWN.username]) {
      expect(told).not.toContain(secret);
    }
  });

  const asTenant = <T>(work: Parameters<Harness['tenantDb']['withTenant']>[1]) =>
    h.tenantDb.withTenant(h.tenant, work, { actorKind: 'system' }) as Promise<T>;

  it('sends a test only to the caller’s own address, and lists it with none of its words', async () => {
    await asTenant(async (trx) => {
      await trx
        .updateTable('principal')
        .set({ email: 'ada@example.test', email_verified: true })
        .where('id', '=', h.ids.ada!)
        .execute();
    });
    const queued = await h.call('ada', 'POST', `${CHANNEL}/test`);
    expect(queued.statusCode, queued.body).toBe(200);
    const { id } = queued.json<{ id: string }>();
    const row = await asTenant<{ principal_id: string; purpose: string }>((trx) =>
      trx
        .selectFrom('email_delivery')
        .select(['principal_id', 'purpose'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
    );
    expect(row).toEqual({ principal_id: h.ids.ada, purpose: 'test' });
    const listed = await h.call('ada', 'GET', `${CHANNEL}/mail`);
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json()).toMatchObject({
      items: [{ id, purpose: 'test', state: 'pending', attempts: 0, last: null }],
      next: null,
      counts: { waiting: 1, sent: 0, givenUp: 0, dropped: {} },
    });
    expect(listed.body).not.toContain('@');
  });

  it('sends no test to a caller whose own address is not verified', async () => {
    await asTenant(async (trx) => {
      await trx
        .updateTable('principal')
        .set({ email_verified: false })
        .where('id', '=', h.ids.ada!)
        .execute();
    });
    const refused = await h.call('ada', 'POST', `${CHANNEL}/test`);
    expect(refused.statusCode).toBe(409);
    expect(code(refused)).toBe('mail_no_verified_address');
  });

  it('refuses anybody without the permission', async () => {
    expect((await h.call('grace', 'GET', CHANNEL)).statusCode).toBe(403);
    expect((await h.call('grace', 'PUT', CHANNEL, OWN)).statusCode).toBe(403);
    const password = await h.call('grace', 'PUT', `${CHANNEL}/password`, { password: PASSWORD });
    expect(password.statusCode).toBe(403);
    expect((await h.call('grace', 'POST', `${CHANNEL}/test`)).statusCode).toBe(403);
    expect((await h.call('grace', 'GET', `${CHANNEL}/mail`)).statusCode).toBe(403);
  });
});

describe('a tenant on the operator’s relay (the EM plan, EM-B, EM-K)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness({ appOptions: { mailPlatform: { fromAddress: 'mail@operator.test' } } });
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  it('turns on with the operator’s address and the tenant’s name, naming no address of its own', async () => {
    const on = await h.call('ada', 'PUT', CHANNEL, {
      enabled: true,
      relay: 'platform',
      fromName: 'Example documents',
    });
    expect(on.statusCode, on.body).toBe(200);
    expect(on.json()).toMatchObject({
      channel: {
        enabled: true,
        relay: 'platform',
        fromAddress: null,
        fromName: 'Example documents',
      },
      platform: { offered: true, fromAddress: 'mail@operator.test' },
    });
    const claiming = await h.call('ada', 'PUT', CHANNEL, {
      enabled: true,
      relay: 'platform',
      fromAddress: 'ceo@bank.example',
    });
    expect(claiming.statusCode).toBe(400);
  });
});
