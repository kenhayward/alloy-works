import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTenantDatabase, resumeTenant, suspendTenant } from '@alloy-works/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOST, startHarness, type Harness } from './test/bindings-harness.js';

const OPERATOR = { actorKind: 'vendor' } as const;

describe('the gate on a tenant that is not active (the TL plan, TL-B)', () => {
  let h: Harness;
  let root: string;
  let steward: ReturnType<typeof createTenantDatabase>;
  const seen: { readonly method: string; readonly url: string }[] = [];

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'renderer-'));
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>Alloy Works</title>');
    writeFileSync(join(root, 'assets', 'app.js'), '// the renderer');
    h = await startHarness({
      events: true,
      secrets: { SINK_BRIDGE_KEYS: 'a-bridge-key-of-some-length-for-this-test' },
      appOptions: {
        rendererRoot: root,
        tenantCacheMs: 0,
        stateCheckMs: 50,
        onRoute: (route) => seen.push(route),
      },
    });
    steward = createTenantDatabase(h.db.stewardUrl);
  }, 120_000);

  afterAll(async () => {
    await steward?.close();
    await h?.close();
    rmSync(root, { recursive: true, force: true });
  });

  const suspended = async (work: () => Promise<void>) => {
    await steward.withTenant(h.tenant, (trx) => suspendTenant(trx, h.tenant, 'A test'), OPERATOR);
    try {
      await work();
    } finally {
      await steward.withTenant(h.tenant, (trx) => resumeTenant(trx, h.tenant), OPERATOR);
    }
  };

  it('ADM-028 refuses a session and a token, says why without the reason, and lets them back after', async () => {
    const made = await h.call('ada', 'POST', '/v1/tokens', {
      name: 'A probe',
      scopes: [],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(made.statusCode, made.body).toBe(200);
    const token = made.json<{ secret: string }>().secret;
    const byToken = () =>
      h.app.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { host: HOST, authorization: `Bearer ${token}` },
      });
    expect((await h.call('ada', 'GET', '/v1/me')).statusCode).toBe(200);
    expect((await byToken()).statusCode).toBe(200);
    await suspended(async () => {
      const refused = await h.call('ada', 'GET', '/v1/me');
      expect(refused.statusCode).toBe(503);
      expect(refused.json()).toMatchObject({ code: 'environment_suspended' });
      expect(refused.body).not.toContain('A test');
      expect((await byToken()).json()).toMatchObject({ code: 'environment_suspended' });
    });
    expect((await h.call('ada', 'GET', '/v1/me')).statusCode).toBe(200);
    expect((await byToken()).statusCode).toBe(200);
  });

  it('ADM-028 refuses every route the service has, those outside the contract too, but its health and the page', async () => {
    await suspended(async () => {
      const exempt: string[] = [];
      const routes = seen.filter(({ method }) => method !== 'HEAD' && method !== 'OPTIONS');
      // The contract, SCIM, MCP, the documentation and the bridge: not a list, or one could be missed.
      for (const prefix of ['/v1/', '/scim/', '/mcp', '/docs', '/openapi/', '/bridge/']) {
        expect(
          routes.some(({ url }) => url.startsWith(prefix)),
          prefix,
        ).toBe(true);
      }
      for (const { method, url } of routes) {
        const answer = await h.app.inject({
          method: method as 'GET',
          url: url
            .replace(/(?<!:):\w+/g, 'x')
            .replace('::', ':')
            .replace('*', 'x'),
          headers: { host: HOST },
        });
        if (answer.statusCode !== 503) exempt.push(url);
        // The bridge keeps to its contract's closed list, in which this is one to try again, and
        // MCP to its protocol's error.
        else if (url.startsWith('/bridge/')) {
          expect(answer.json(), url).toMatchObject({ class: 'retryable' });
        } else if (url === '/mcp' && method === 'POST') {
          expect(answer.json(), url).toMatchObject({ error: { message: /suspended/ } });
        } else expect(answer.json(), url).toMatchObject({ code: 'environment_suspended' });
      }
      expect(exempt.sort().join(' ')).toBe('/ /assets/app.js /health /index.html');
    });
  }, 120_000);

  it('ADM-028 still serves the page, at any address the renderer owns, to say what happened', async () => {
    await suspended(async () => {
      const page = await h.app.inject({ method: 'GET', url: '/', headers: { host: HOST } });
      expect(page.statusCode).toBe(200);
      const deep = await h.app.inject({ method: 'GET', url: '/nowhere', headers: { host: HOST } });
      expect(deep.statusCode).toBe(200);
      expect(deep.body).toContain('Alloy Works');
    });
  });

  it('ends a stream that was open when the tenant was suspended', async () => {
    const opened = h.call('ada', 'GET', '/v1/stream');
    let ended = false;
    void opened.then(() => {
      ended = true;
    });
    // Longer than several of its checks: open, and staying open.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(ended).toBe(false);
    await suspended(async () => {
      expect((await opened).statusCode).toBe(200);
    });
  });

  it('leaves an address with no environment answering as it always did', async () => {
    const unknown = await h.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { host: 'nobody.alloy.test' },
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ code: 'tenant_not_found' });
  });
});
