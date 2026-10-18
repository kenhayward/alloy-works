import { findRole } from '@alloy-works/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;

const prompt = (over: Json = {}) => ({
  schemaVersion: 1,
  title: 'Summarise the section',
  description: 'A short summary for the reader.',
  instructions: 'Summarise this for {{audience}}.',
  context: [
    { source: 'outline', scope: 'section' },
    { source: 'parameters', names: ['audience'] },
  ],
  output: { componentType: null },
  models: { purpose: 'drafting', accepts: ['claude-sonnet-5-5'] },
  ...over,
});

describe('the prompt routes (the G4 plan, G4-A)', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
    // Ada approves in General.
    const approver = await h.tenantDb.withTenant(h.tenant, (trx) => findRole(trx, 'Approver'));
    await h.allow(h.ids.ada!, approver!.id, { kind: 'space', id: h.general });
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const make = (by: string, body: Json = prompt()) =>
    h.call(by, 'POST', `/v1/spaces/${h.general}/prompts`, { prompt: body });

  it('makes a prompt in a space, cuts its versions and shows it to its readers alone', async () => {
    const made = await make('grace');
    expect(made.statusCode, made.body).toBe(200);
    const view = made.json<{
      id: string;
      version: { id: string; number: string };
      mayEdit: boolean;
    }>();
    expect(view.version.number).toBe('0.1');
    expect(view.mayEdit).toBe(true);

    const next = await h.call('grace', 'POST', `/v1/prompts/${view.id}/versions`, {
      openedFrom: view.version.id,
      prompt: prompt({ title: 'Summarise briefly' }),
    });
    expect(next.statusCode, next.body).toBe(200);
    expect(next.json<{ version: { number: string } }>().version.number).toBe('0.2');

    // An older version opened is answered with the newer one.
    const stale = await h.call('grace', 'POST', `/v1/prompts/${view.id}/versions`, {
      openedFrom: view.version.id,
      prompt: prompt({ title: 'Again' }),
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ code: string }>().code).toBe('version_precondition');

    // Alice reads it and may not change it; Ivy is told there is none.
    const asAlice = await h.call('alice', 'GET', `/v1/prompts/${view.id}`);
    expect(asAlice.json<{ mayEdit: boolean; prompt: { title: string } }>()).toMatchObject({
      mayEdit: false,
      prompt: { title: 'Summarise briefly' },
    });
    expect(
      (
        await h.call('alice', 'POST', `/v1/prompts/${view.id}/versions`, {
          openedFrom: next.json<{ version: { id: string } }>().version.id,
          prompt: prompt(),
        })
      ).statusCode,
    ).toBe(403);
    expect((await h.call('ivy', 'GET', `/v1/prompts/${view.id}`)).statusCode).toBe(404);
    expect((await make('alice')).statusCode).toBe(403);

    const listed = await h.call('alice', 'GET', '/v1/prompts');
    expect(listed.json<{ items: { id: string; purpose: string }[] }>().items).toContainEqual(
      expect.objectContaining({ id: view.id, purpose: 'drafting' }),
    );
    expect((await h.call('ivy', 'GET', '/v1/prompts')).json<{ total: number }>().total).toBe(0);
  });

  it('refuses a prompt placing a parameter it does not declare, or naming what is not there, each problem named', async () => {
    const undeclared = await make('grace', prompt({ instructions: 'For {{region}}.' }));
    expect(undeclared.statusCode).toBe(400);
    expect(undeclared.json<{ code: string; problems: { path: string }[] }>()).toMatchObject({
      code: 'prompt_invalid',
      problems: [{ path: 'instructions' }],
    });
    const missing = await make(
      'grace',
      prompt({ output: { componentType: '0b6f6a4e-8f4e-4c2b-9a51-3a3b1d1f2c09' } }),
    );
    expect(missing.statusCode).toBe(400);
    expect(missing.json<{ problems: { path: string }[] }>().problems).toEqual([
      expect.objectContaining({ path: 'output.componentType' }),
    ]);
    // Refused at the door by its shape: an embedding purpose writes no text.
    const embedding = await make(
      'grace',
      prompt({ models: { purpose: 'embedding', accepts: ['m'] } }),
    );
    expect(embedding.statusCode).toBe(400);
  });

  it('GEN-001 reviews a prompt as a query definition is: submitted, approved at a gate by another, designated, and back to draft when saved', async () => {
    const made = (await make('grace', prompt({ title: 'Reviewed prompt' }))).json<{
      id: string;
      version: { id: string };
      state: { key: string };
      transitions: { key: string }[];
    }>();
    expect(made.state.key).toBe('draft');
    expect(made.transitions.map((each) => each.key)).toContain('submit');

    const submitted = await h.call('grace', 'POST', `/v1/prompts/${made.id}/transitions`, {
      transition: 'submit',
      from: 'draft',
    });
    expect(submitted.statusCode, submitted.body).toBe(200);

    // The gate is not an author's to pass.
    const decision = { transition: 'approve', version: made.version.id, decision: 'approved' };
    const byAuthor = await h.call('grace', 'POST', `/v1/prompts/${made.id}/approvals`, decision);
    expect(byAuthor.statusCode).toBeGreaterThanOrEqual(400);
    const byAda = await h.call('ada', 'POST', `/v1/prompts/${made.id}/approvals`, decision);
    expect(byAda.statusCode, byAda.body).toBe(200);

    const approved = (await h.call('alice', 'GET', `/v1/prompts/${made.id}`)).json<{
      state: { key: string };
      revision: { number: number } | null;
      version: { id: string };
    }>();
    expect(approved.state.key).toBe('approved');
    expect(approved.revision?.number).toBe(1);
    const decided = await h.call('alice', 'GET', `/v1/prompts/${made.id}/approvals`);
    expect(decided.json<{ approvals: { decision: string }[] }>().approvals).toEqual([
      expect.objectContaining({ decision: 'approved' }),
    ]);

    // Saving the approved prompt starts a draft.
    await h.call('grace', 'POST', `/v1/prompts/${made.id}/versions`, {
      openedFrom: approved.version.id,
      prompt: prompt({ title: 'Reviewed prompt, changed' }),
    });
    const changed = (await h.call('grace', 'GET', `/v1/prompts/${made.id}`)).json<{
      state: { key: string };
    }>();
    expect(changed.state.key).toBe('draft');
  });

  it("answers another kind's id as no prompt", async () => {
    const component = await h.component(h.general, 'Not a prompt');
    expect((await h.call('ada', 'GET', `/v1/prompts/${component.id}`)).statusCode).toBe(404);
  });
});
