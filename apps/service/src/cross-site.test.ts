import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crossSiteRefusal } from './cross-site.js';
import { HOST, startHarness, type Harness } from './test/bindings-harness.js';

const own = 'https://aw.example';
const write = { method: 'POST', session: true, ownOrigin: own } as const;

describe('a write a browser sends from another site', () => {
  it('is refused when its Origin is another site, or none a browser can name', () => {
    expect(crossSiteRefusal({ ...write, origin: 'https://elsewhere.example' })?.code).toBe(
      'cross_site_refused',
    );
    expect(crossSiteRefusal({ ...write, origin: 'null' })?.status).toBe(403);
    // A sibling name is another origin: a page there must not write here either.
    expect(crossSiteRefusal({ ...write, origin: 'https://id.aw.example' })).toBeDefined();
    expect(crossSiteRefusal({ ...write, origin: 'http://aw.example' })).toBeDefined();
  });

  it('is refused when the browser says it came from another site, whatever its Origin', () => {
    for (const site of ['cross-site', 'same-site', 'none']) {
      expect(crossSiteRefusal({ ...write, fetchSite: site }), site).toBeDefined();
    }
    expect(crossSiteRefusal({ ...write, fetchSite: 'same-site', origin: own })).toBeDefined();
  });

  it('is let through from the app itself, and in any case for a caller with no session', () => {
    expect(crossSiteRefusal({ ...write, origin: own, fetchSite: 'same-origin' })).toBeUndefined();
    expect(crossSiteRefusal({ ...write, origin: 'HTTPS://AW.EXAMPLE' })).toBeUndefined();
    // No browser said anything: a script or an integration, which CSRF does not reach.
    expect(crossSiteRefusal(write)).toBeUndefined();
    // A token, a signature or nothing: no session cookie for another site to ride on.
    expect(
      crossSiteRefusal({ ...write, session: false, origin: 'https://elsewhere.example' }),
    ).toBeUndefined();
  });

  it('is only a write: a read from anywhere answers as before', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(
        crossSiteRefusal({ ...write, method, origin: 'https://elsewhere.example' }),
        method,
      ).toBeUndefined();
    }
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      expect(crossSiteRefusal({ ...write, method, fetchSite: 'cross-site' }), method).toBeDefined();
    }
  });
});

describe('the service refusing cross-site writes', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  const signOut = (headers: Record<string, string>) =>
    h.app.inject({
      method: 'POST',
      url: '/v1/sign-out',
      headers: { host: HOST, cookie: h.cookies['ada']!, ...headers },
    });

  it('refuses a signed-in write from another site before any route runs', async () => {
    const refused = await signOut({ origin: 'https://elsewhere.example' });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'cross_site_refused' });
    expect((await signOut({ 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403);
    // Still signed in: the refused sign-out ended nothing.
    expect((await h.call('ada', 'GET', '/v1/me')).statusCode).toBe(200);
  });

  it('lets the same write through from the app itself', async () => {
    const own = await signOut({ origin: `http://${HOST}`, 'sec-fetch-site': 'same-origin' });
    expect(own.statusCode).toBe(204);
  });
});
