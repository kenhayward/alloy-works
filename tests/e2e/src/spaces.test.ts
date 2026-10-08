import { beforeAll, describe, expect, it } from 'vitest';

import { SERVICE, signIn, untilReady } from './session.js';

/**
 * A space made, renamed, archived and restored over the whole system (the SP1 plan, task 3), as Ada,
 * who administers development; and a component made in it while archived refused, and made once it
 * is restored. The space is the test's own, so General is never touched.
 */
type Json = Record<string, unknown>;

describe('a space made, renamed, archived and restored over the whole system', () => {
  let cookie = '';

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${SERVICE}${path}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Json };
  };
  const ok = (answer: { status: number; body: Json }) => {
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    return answer.body;
  };
  const listed = async (query = '') =>
    ok(await call('GET', `/v1/spaces?limit=100${query}`))['items'] as {
      id: string;
      name: string;
      archived: boolean;
      mayCreate: boolean;
    }[];

  beforeAll(async () => {
    await untilReady();
    cookie = await signIn('ada');
  }, 180_000);

  it('ADM-049 makes, renames, archives and restores a space through the API, and refuses a component made in it while archived, over the whole system', async () => {
    const stamp = Date.now();
    const space = ok(await call('POST', '/v1/spaces', { name: `Made ${stamp}` }));
    const id = space['id'] as string;
    expect(space).toMatchObject({ name: `Made ${stamp}`, archived: false });

    ok(await call('PATCH', `/v1/spaces/${id}`, { name: `Renamed ${stamp}` }));
    const archived = ok(await call('PATCH', `/v1/spaces/${id}`, { archived: true }));
    expect(archived).toMatchObject({ name: `Renamed ${stamp}`, archived: true });
    expect((await listed()).find((each) => each.id === id)).toMatchObject({
      archived: true,
      mayCreate: false,
    });
    expect((await listed('&archived=false')).map((each) => each.id)).not.toContain(id);

    const component = { title: `In ${stamp}`, language: 'en-GB', direction: 'ltr' };
    const refused = await call('POST', `/v1/spaces/${id}/components`, component);
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(refused.body).toMatchObject({ code: 'space_archived' });

    expect(ok(await call('PATCH', `/v1/spaces/${id}`, { archived: false }))).toMatchObject({
      archived: false,
    });
    ok(await call('POST', `/v1/spaces/${id}/components`, component));
  });
});
