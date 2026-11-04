import { allRoutes } from '@alloy-works/api-contract';
import {
  advanceClosure,
  createTenantDatabase,
  finishTenantExport,
  startClosing,
} from '@alloy-works/db';
import { queryAs, testTenantDatabase } from '@alloy-works/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HOST, startHarness, type Harness } from './test/bindings-harness.js';

interface View {
  state: string;
  name: string;
  graceEndsAt: string | null;
  holds: number;
  mayCancel: boolean;
  effects: Record<string, string>;
}

describe('closing an environment through the service (the TL plan, TLb)', () => {
  let h: Harness;
  const seen: { readonly method: string; readonly url: string }[] = [];

  beforeAll(async () => {
    h = await startHarness({
      secrets: { SINK_BRIDGE_KEYS: 'a-bridge-key-of-some-length-for-this-test' },
      appOptions: { tenantCacheMs: 0, onRoute: (route) => seen.push(route) },
    });
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  /** Each test begins with the tenant open again, however it left it. */
  afterEach(async () => {
    await asAdmin(
      `update platform.tenant
          set state = 'active', closing_from = null, closing_by = null, grace_ends_at = null
        where id = $1`,
      [h.tenant.id],
    );
    // Closing took Alice's session, as it should.
    h.cookies['alice'] = h.cookies[await h.session('alice')]!;
  });

  const asAdmin = (text: string, values: unknown[]) => queryAs(h.db.adminUrl, text, values);
  const NAME = 'Production';
  const close = (as = 'ada') => h.call(as, 'POST', '/v1/closure', { name: NAME, declined: true });

  it('ADM-030 lets only a holder of close_environment close it, and no token', async () => {
    expect((await close('alice')).statusCode).toBe(403);
    const made = await h.call('ada', 'POST', '/v1/tokens', {
      name: 'A probe',
      scopes: ['administer'],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const refused = await h.app.inject({
      method: 'POST',
      url: '/v1/closure',
      headers: {
        host: HOST,
        authorization: `Bearer ${made.json<{ secret: string }>().secret}`,
        'content-type': 'application/json',
      },
      payload: { name: NAME, declined: true },
    });
    expect(refused.statusCode).toBe(403);
    expect((await h.call('ada', 'GET', '/v1/closure')).json<View>().state).toBe('active');
  });

  it('ADM-030 asks for the name typed', async () => {
    const wrong = await h.call('ada', 'POST', '/v1/closure', { name: 'Prod', declined: true });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json()).toMatchObject({ code: 'closure_name_mismatch' });
  });

  it('ADM-029 will not close until an export has been answered for, and takes only a recent whole one', async () => {
    const neither = await h.call('ada', 'POST', '/v1/closure', { name: NAME });
    expect(neither.json()).toMatchObject({ code: 'closure_export_unanswered' });
    const unknown = await h.call('ada', 'POST', '/v1/closure', {
      name: NAME,
      export: '11111111-1111-4111-8111-111111111111',
    });
    expect(unknown.json()).toMatchObject({ code: 'closure_export_unanswered' });

    const madeExport = await h.call('ada', 'POST', '/v1/exports', { scope: 'tenant' });
    const { id } = madeExport.json<{ export: { id: string } }>().export;
    await h.tenantDb.withTenant(h.tenant, (trx) =>
      finishTenantExport(trx, id, { key: 'k', sha256: 'x', size: 1 }, {}),
    );
    const age = (hours: number) =>
      asAdmin(
        `update ${h.tenant.schema}.tenant_export
            set requested_at = now() - make_interval(hours => $1) where id = $2`,
        [hours, id],
      );
    await age(25);
    const stale = await h.call('ada', 'POST', '/v1/closure', { name: NAME, export: id });
    expect(stale.json()).toMatchObject({ code: 'closure_export_unanswered' });
    await age(23);
    const taken = await h.call('ada', 'POST', '/v1/closure', { name: NAME, export: id });
    expect(taken.statusCode, taken.body).toBe(200);
    expect(taken.json<View>().state).toBe('closing');
    // Nothing sweeps it now: it stays until deletion, so it says no date.
    const shown = await h.call('ada', 'GET', `/v1/exports/${id}`);
    expect(shown.json()).toMatchObject({ export: { id, expiresAt: null } });
  });

  it('ADM-045 shows what stops before anything is done, and how many holds would keep it', async () => {
    const before = (await h.call('ada', 'GET', '/v1/closure')).json<View>();
    expect(before.effects).toMatchObject({ webhookDelivery: 'stops, dropped at deletion' });
    expect(before.state).toBe('active');
    expect(before.mayCancel).toBe(false);
    expect((await h.call('alice', 'GET', '/v1/closure')).statusCode).toBe(403);
  });

  it('ADM-030 takes everyone but those allowed out of a closing environment at once', async () => {
    expect((await h.call('alice', 'GET', '/v1/me')).statusCode).toBe(200);
    expect((await close()).statusCode).toBe(200);
    // Alice holds none of it: her session went with the act.
    expect((await h.call('alice', 'GET', '/v1/me')).statusCode).toBe(401);
    const me = await h.call('ada', 'GET', '/v1/me');
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ environmentState: 'closing' });
    const shut = await h.call('ada', 'GET', '/v1/spaces');
    expect(shut.statusCode).toBe(503);
    expect(shut.json()).toMatchObject({ code: 'environment_closing' });
  });

  it('ADM-030 refuses every route of a closing environment but those that help it close', async () => {
    expect((await close()).statusCode).toBe(200);
    const open: string[] = [];
    for (const { method, url } of seen.filter(
      (route) => route.method !== 'HEAD' && route.method !== 'OPTIONS',
    )) {
      const answer = await h.app.inject({
        method: method as 'GET',
        url: url
          .replace(/(?<!:):\w+/g, 'x')
          .replace('::', ':')
          .replace('*', 'x'),
        headers: { host: HOST },
      });
      if (answer.statusCode !== 503) open.push(`${method} ${url}`);
    }
    expect(open.sort()).toEqual(
      [
        'DELETE /v1/closure',
        'POST /v1/holds/:id/release',
        'GET /health',
        'GET /v1/closure',
        'GET /v1/exports',
        'GET /v1/exports/:id',
        'GET /v1/exports/:id/download',
        'GET /v1/holds',
        'GET /v1/me',
        'GET /v1/sign-in/google',
        'GET /v1/sign-in/google/complete',
        'GET /v1/sign-in/organisation',
        'GET /v1/sign-in/organisation/callback',
        'GET /v1/tenant',
        'POST /v1/exports',
        'POST /v1/holds',
        'POST /v1/sessions/current/reauthentication',
        'POST /v1/sign-out',
      ].sort(),
    );
  }, 120_000);

  it('ADM-030 lets in only those allowed to sign in while closing, and writes nobody new', async () => {
    expect((await close()).statusCode).toBe(200);
    const people = async () =>
      (await asAdmin(`select count(*)::int as n from ${h.tenant.schema}.principal`, [])).rows[0].n;
    const before = await people();
    await expect(h.session('alice')).rejects.toThrow('did not finish');
    // Somebody it has never seen, who would otherwise be made a principal holding nothing.
    const forget = (subject: string) =>
      asAdmin(`update ${h.tenant.schema}.principal set subject = $1 where id = $2`, [
        subject,
        h.ids['ivy'],
      ]);
    await forget('forgotten');
    try {
      await expect(h.session('ivy')).rejects.toThrow('did not finish');
      expect(await people()).toBe(before);
    } finally {
      await forget('ivy');
    }
    expect(h.cookies[await h.session('ada')]).toBeDefined();
  });

  it('ADM-030 refuses a token even on what stays open', async () => {
    const made = await h.call('ada', 'POST', '/v1/tokens', {
      name: 'Another probe',
      scopes: ['export_environment'],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect((await close()).statusCode).toBe(200);
    const refused = await h.app.inject({
      method: 'GET',
      url: '/v1/exports',
      headers: { host: HOST, authorization: `Bearer ${made.json<{ secret: string }>().secret}` },
    });
    expect(refused.statusCode).toBe(503);
    expect(refused.json()).toMatchObject({ code: 'environment_closing' });
  });

  it('ADM-030 can be cancelled by a holder, and everything answers again', async () => {
    expect((await close()).statusCode).toBe(200);
    const view = (await h.call('ada', 'GET', '/v1/closure')).json<View>();
    expect(view.mayCancel).toBe(true);
    const back = await h.call('ada', 'DELETE', '/v1/closure');
    expect(back.statusCode, back.body).toBe(200);
    expect(back.json<View>().state).toBe('active');
    expect((await h.call('ada', 'GET', '/v1/spaces')).statusCode).toBe(200);
  });

  it("ADM-030 will not let an administrator cancel the operator's closure", async () => {
    const steward = createTenantDatabase(h.db.stewardUrl);
    try {
      await steward.withTenant(h.tenant, (trx) => startClosing(trx, h.tenant, { notice: 'N-1' }), {
        actorKind: 'vendor',
      });
    } finally {
      await steward.close();
    }
    expect((await h.call('ada', 'GET', '/v1/closure')).json<View>().mayCancel).toBe(false);
    const refused = await h.call('ada', 'DELETE', '/v1/closure');
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'closure_begun_by_operator' });
  });

  it('LIF-066 lets a holder read and release a hold while retained, which is its declared path', async () => {
    const worker = testTenantDatabase(h.db.workerUrl);
    try {
      const placed = await h.call('ada', 'POST', '/v1/holds', {
        target: { space: h.general },
        reason: 'A dispute',
      });
      expect(placed.statusCode, placed.body).toBe(200);
      expect((await close()).statusCode).toBe(200);
      await asAdmin(
        `update platform.tenant set grace_ends_at = now() - interval '1 second' where id = $1`,
        [h.tenant.id],
      );
      await worker.withTenant(h.tenant, (trx) => advanceClosure(trx, h.tenant), {
        actorKind: 'system',
      });
      const retained = (await h.call('ada', 'GET', '/v1/closure')).json<View>();
      expect(retained).toMatchObject({ state: 'retained', holds: 1 });
      expect((await h.call('ada', 'GET', '/v1/holds')).statusCode).toBe(200);
      const released = await h.call(
        'ada',
        'POST',
        `/v1/holds/${placed.json<{ id: string }>().id}/release`,
        { reason: 'Settled' },
      );
      expect(released.statusCode, released.body).toBe(200);
    } finally {
      await worker.close();
    }
  });

  it('marks in the contract only the routes the census expects', () => {
    expect(allRoutes.filter((route) => route.openWhileClosing).length).toBe(17);
  });
});
