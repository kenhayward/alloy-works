import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

describe('a person’s own preferences (the UI plan, UI-E)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  it('LOC-005 keeps each person’s interface language apart from any content’s, theirs alone', async () => {
    expect((await h.call('ada', 'GET', '/v1/me/preferences')).json()).toEqual({
      interfaceLanguage: null,
    });
    const chosen = await h.call('ada', 'PUT', '/v1/me/preferences', { interfaceLanguage: 'en-XA' });
    expect(chosen.statusCode, chosen.body).toBe(200);
    expect(chosen.json()).toEqual({ interfaceLanguage: 'en-XA' });
    expect((await h.call('ada', 'GET', '/v1/me')).json()).toMatchObject({
      interfaceLanguage: 'en-XA',
    });
    // Grace's is her own.
    expect((await h.call('grace', 'GET', '/v1/me')).json()).toMatchObject({
      interfaceLanguage: null,
    });
    expect(
      (await h.call('ada', 'PUT', '/v1/me/preferences', { interfaceLanguage: 'fr-FR' })).statusCode,
    ).toBe(400);
    await h.call('ada', 'PUT', '/v1/me/preferences', { interfaceLanguage: null });
    expect((await h.call('ada', 'GET', '/v1/me/preferences')).json()).toEqual({
      interfaceLanguage: null,
    });
  });
});
