import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './test/bindings-harness.js';

interface View {
  id: string;
  state: string;
  refusal: { code: string } | null;
}

describe('restoring through the service (the EI plan, EIc)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const send = (user: string, id: string, bytes: Buffer) =>
    h.bytes(user, 'PUT', `/v1/restorations/${id}/archive`, bytes, 'application/x-tar');

  it('IMP-048 lets only a holder of import_environment begin one or send an archive', async () => {
    expect((await h.call('alice', 'POST', '/v1/restorations')).statusCode).toBe(403);
    const made = (await h.call('ada', 'POST', '/v1/restorations')).json<View>();
    expect(made.state).toBe('awaiting_archive');
    expect((await send('alice', made.id, Buffer.from('tar'))).statusCode).toBe(403);
    expect((await h.call('ada', 'GET', `/v1/restorations/${made.id}`)).json<View>().state).toBe(
      'awaiting_archive',
    );
  });

  it('IMP-039 keeps an archive once, as a job to check, and accepts no second one', async () => {
    const made = (await h.call('ada', 'POST', '/v1/restorations')).json<View>();
    const sent = await send('ada', made.id, Buffer.from('not much of an archive'));
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json<View>().state).toBe('checking');
    const again = await send('ada', made.id, Buffer.from('another'));
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'restoration_filled' });
  });

  it('IMP-048 will not apply one that has not been checked', async () => {
    const made = (await h.call('ada', 'POST', '/v1/restorations')).json<View>();
    const applied = await h.call('ada', 'POST', `/v1/restorations/${made.id}/apply`);
    expect(applied.statusCode).toBe(409);
    expect(applied.json()).toMatchObject({ code: 'restoration_not_previewed' });
  });

  it('says there is nothing to review in an environment never restored', async () => {
    const review = await h.call('ada', 'GET', '/v1/restore-review');
    expect(review.json()).toEqual({
      restoredAt: null,
      underReview: false,
      datesPast: 0,
      reviewDatesPast: 0,
    });
    expect((await h.call('ada', 'POST', '/v1/restore-review/end')).statusCode).toBe(200);
  });
});
