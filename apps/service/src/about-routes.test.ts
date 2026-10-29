import { CONTENT_LANGUAGES_CLDR } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HOST, startHarness, type Harness } from './test/bindings-harness.js';

describe('what the service runs on, for About (the TE plan, TE-F)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  it("LOC-044 names the service's locale data, its plural rules' CLDR and each collation's version to a signed-in person", async () => {
    const answered = await h.call('ada', 'GET', '/v1/about');
    expect(answered.statusCode, answered.body).toBe(200);
    expect(answered.json()).toEqual({
      localeData: {
        icu: process.versions.icu,
        unicode: process.versions.unicode,
        cldr: process.versions.cldr,
        // The CLDR the domain's plural rules were compiled from (the MF plan, MF-H).
        plurals: CONTENT_LANGUAGES_CLDR,
        collations: [
          { language: 'en-GB', collation: 'en-GB-x-icu', version: expect.any(String) },
          { language: 'en-XA', collation: 'en-GB-x-icu', version: expect.any(String) },
          { language: 'ar-XB', collation: 'ar-x-icu', version: expect.any(String) },
        ],
      },
    });
  });

  it('refuses somebody not signed in', async () => {
    const answered = await h.app.inject({ url: '/v1/about', headers: { host: HOST } });
    expect(answered.statusCode).toBe(401);
    expect(answered.body).not.toContain(String(process.versions.icu));
  });
});
