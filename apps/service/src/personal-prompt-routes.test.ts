import {
  DEFAULT_LAYOUT_ID,
  DEFAULT_THEME_ID,
  findRole,
  listPersonalPrompts,
  savePersonalPrompt,
} from '@alloy-works/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;

const promotion = (space: string, over: Json = {}) => ({
  space,
  context: [{ source: 'outline', scope: 'part' }],
  output: { componentType: null },
  models: { purpose: 'drafting', accepts: ['stand-in-1'] },
  ...over,
});

describe('personal prompts through the service (the G5 plan, G5-G)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const save = async (as: string, title: string) => {
    const saved = await h.call(as, 'POST', '/v1/me/prompts', {
      title,
      instructions: 'Say it plainly, for engineers.',
    });
    expect(saved.statusCode, saved.body).toBe(200);
    return saved.json<{ id: string }>().id;
  };

  it('GEN-054 TPL-061 keeps a personal prompt its owner’s alone: nobody else reads, changes or promotes it, and no template binds it', async () => {
    const id = await save('grace', 'Plain words');
    expect(
      (await h.call('grace', 'GET', '/v1/me/prompts')).json<{ items: { id: string }[] }>().items,
    ).toEqual([expect.objectContaining({ id })]);
    // Alice is told it does not exist, whatever she asks.
    expect(
      (await h.call('alice', 'GET', '/v1/me/prompts')).json<{ items: unknown[] }>().items,
    ).toEqual([]);
    expect(
      (
        await h.call('alice', 'PUT', `/v1/me/prompts/${id}`, {
          title: 'Mine',
          instructions: 'Mine now.',
        })
      ).statusCode,
    ).toBe(404);
    expect((await h.call('alice', 'POST', `/v1/me/prompts/${id}/removal`)).statusCode).toBe(404);
    expect(
      (await h.call('alice', 'POST', `/v1/me/prompts/${id}/promotion`, promotion(h.general)))
        .statusCode,
    ).toBe(404);
    // A template binds a library, an artifact: a personal prompt is none, and is refused by name.
    const designer = await h.tenantDb.withTenant(h.tenant, (trx) => findRole(trx, 'Designer'));
    await h.allow(h.ids.ada!, designer!.id, { kind: 'space', id: h.general });
    const bound = await h.call('ada', 'POST', `/v1/spaces/${h.general}/templates`, {
      definition: {
        schemaVersion: 1,
        name: 'Report',
        theme: DEFAULT_THEME_ID,
        layout: DEFAULT_LAYOUT_ID,
        prompts: id,
        schemas: [],
        outline: { sections: [] },
        changes: { add: true, remove: true, reorder: true },
      },
    });
    expect(bound.statusCode).toBe(400);
    expect(bound.json<{ unresolved: unknown[] }>().unresolved).toEqual([
      { reference: 'library', id },
    ]);
  });

  it('GEN-055 promotes one deliberately, as a new prompt at draft in a space its owner may edit, the one path to a shared prompt', async () => {
    const id = await save('grace', 'Promote me');
    const promoted = await h.call(
      'grace',
      'POST',
      `/v1/me/prompts/${id}/promotion`,
      promotion(h.general),
    );
    expect(promoted.statusCode, promoted.body).toBe(200);
    const answer = promoted.json<{ personal: { promotedTo: string }; prompt: { id: string } }>();
    expect(answer.personal.promotedTo).toBe(answer.prompt.id);
    // Once: another shared prompt is made by saving anew, never by promoting again.
    const again = await h.call(
      'grace',
      'POST',
      `/v1/me/prompts/${id}/promotion`,
      promotion(h.general),
    );
    expect(again.statusCode).toBe(409);
    expect(again.json<{ code: string }>().code).toBe('already_promoted');
    const prompt = (await h.call('alice', 'GET', `/v1/prompts/${answer.prompt.id}`)).json<{
      prompt: { title: string; instructions: string };
      version: { number: string };
      state: { key: string };
    }>();
    expect(prompt).toMatchObject({
      prompt: { title: 'Promote me', instructions: 'Say it plainly, for engineers.' },
      version: { number: '0.1' },
      state: { key: 'draft' },
    });
    // Changing her own afterwards changes nothing shared.
    await h.call('grace', 'PUT', `/v1/me/prompts/${id}`, {
      title: 'Promote me',
      instructions: 'Something else entirely.',
    });
    expect(
      (await h.call('alice', 'GET', `/v1/prompts/${answer.prompt.id}`)).json<{
        prompt: { instructions: string };
      }>().prompt.instructions,
    ).toBe('Say it plainly, for engineers.');
    // Alice, who reads General and may not edit there, promotes nothing into it.
    const hers = await save('alice', 'Hers');
    expect(
      (await h.call('alice', 'POST', `/v1/me/prompts/${hers}/promotion`, promotion(h.general)))
        .statusCode,
    ).toBe(403);
  });

  it('deletes a person’s personal prompts when they are erased', async () => {
    await h.tenantDb.withTenant(h.tenant, (trx) =>
      savePersonalPrompt(trx, h.ids.ivy!, { title: 'Ivy’s', instructions: 'Hers alone.' }),
    );
    const erased = await h.call('ada', 'POST', `/v1/principals/${h.ids.ivy}/erase`);
    expect(erased.statusCode, erased.body).toBe(200);
    expect(
      await h.tenantDb.withTenant(h.tenant, (trx) => listPersonalPrompts(trx, h.ids.ivy!)),
    ).toEqual([]);
  });
});
