import { DEFAULT_LAYOUT_ID, DEFAULT_THEME_ID, findRole } from '@alloy-works/db';
import { DEFAULT_PROMPT_LIBRARY_ID } from '@alloy-works/domain';
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
  /** A document a prompt is tried on. */
  let triedOn: { id: string; nodes: string[] };

  beforeAll(async () => {
    h = await startHarness();
    // Ada approves in General.
    const approver = await h.tenantDb.withTenant(h.tenant, (trx) => findRole(trx, 'Approver'));
    await h.allow(h.ids.ada!, approver!.id, { kind: 'space', id: h.general });
    // A drafting endpoint, so a prompt can be tried before it is approved (GEN-045).
    const endpoint = (
      await h.call('ada', 'POST', '/v1/model-endpoints', {
        name: 'Drafting',
        protocol: 'anthropic',
        baseUrl: 'https://models.example.test',
        model: 'claude-sonnet-5-5',
        contextWindow: 200_000,
        priceIn: 3,
        priceOut: 15,
        currency: 'USD',
        boundary: 'outside',
      })
    ).json<{ endpoint: { id: string } }>().endpoint;
    await h.call('ada', 'PUT', `/v1/model-endpoints/${endpoint.id}/key`, {
      key: 'an-invented-key',
    });
    await h.call('ada', 'PUT', '/v1/model-routes/drafting', { endpoint: endpoint.id });
    h.connector.modelFor = () => [
      { type: 'text', text: 'Plainly put.' },
      { type: 'ended', model: 'claude-sonnet-5-5', stop: 'end', usage: { in: 10, out: 3 } },
    ];
    const tried = await h.component(h.general, 'Tried on');
    await h.place(tried, { type: 'text', value: 'Some words to try a prompt on.', marks: [] });
    triedOn = await h.documentReferencing([tried.id]);
    // And designs across the environment: libraries and templates.
    const designer = await h.tenantDb.withTenant(h.tenant, (trx) => findRole(trx, 'Designer'));
    await h.allow(h.ids.ada!, designer!.id, { kind: 'tenant' });
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
    // Tried, as approving needs (GN-F).
    const trial = await h.call(
      'grace',
      'POST',
      `/v1/prompts/${made.id}/versions/${made.version.id}/trials`,
      {
        document: triedOn.id,
        node: triedOn.nodes[0],
      },
    );
    expect(trial.statusCode, trial.body).toBe(200);

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
  const library = (name: string, prompts: string[]) => ({ schemaVersion: 1, name, prompts });
  const template = (over: Json = {}) => ({
    schemaVersion: 1,
    name: 'Report',
    theme: DEFAULT_THEME_ID,
    layout: DEFAULT_LAYOUT_ID,
    schemas: [],
    outline: { sections: [] },
    changes: { add: true, remove: true, reorder: true },
    ...over,
  });

  it('keeps libraries the environment designs, each listing prompts at the revision they run', async () => {
    const listed = (await h.call('ada', 'GET', '/v1/prompt-libraries')).json<{
      items: { id: string; name: string; isDefault: boolean; prompts: number }[];
    }>();
    expect(listed.items[0]).toMatchObject({
      id: DEFAULT_PROMPT_LIBRARY_ID,
      name: 'No prompts',
      isDefault: true,
      prompts: 0,
    });
    const one = (await make('grace', prompt({ title: 'Listed prompt' }))).json<{ id: string }>();
    expect(
      (await h.call('grace', 'POST', '/v1/prompt-libraries', { library: library('Ours', []) }))
        .statusCode,
    ).toBe(403);
    const made = await h.call('ada', 'POST', '/v1/prompt-libraries', {
      library: library('Ours', [one.id]),
    });
    expect(made.statusCode, made.body).toBe(200);
    const view = made.json<{ id: string; version: { id: string } }>();
    const read = await h.call('ada', 'GET', `/v1/prompt-libraries/${view.id}`);
    expect(read.json<{ mayEdit: boolean; prompts: unknown[] }>()).toMatchObject({
      mayEdit: true,
      prompts: [{ id: one.id, state: 'unapproved', title: 'Listed prompt' }],
    });
    // A library is the environment's: read by those who read it, not by a reader of one space.
    expect((await h.call('grace', 'GET', `/v1/prompt-libraries/${view.id}`)).statusCode).toBe(403);
    const wrong = await h.call('ada', 'POST', `/v1/prompt-libraries/${view.id}/versions`, {
      openedFrom: view.version.id,
      library: library('Ours', [one.id, DEFAULT_THEME_ID]),
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json<{ code: string; problems: { path: string }[] }>()).toMatchObject({
      code: 'library_invalid',
      problems: [{ path: 'prompts.1' }],
    });
  });

  it('TPL-061 TPL-004 a template binds one library, refused naming another kind or none there', async () => {
    const ours = (
      await h.call('ada', 'POST', '/v1/prompt-libraries', { library: library('For reports', []) })
    ).json<{ id: string }>();
    const bound = await h.call('ada', 'POST', `/v1/spaces/${h.general}/templates`, {
      definition: template({ prompts: ours.id }),
    });
    expect(bound.statusCode, bound.body).toBe(200);
    expect(bound.json<{ definition: { prompts: string } }>().definition.prompts).toBe(ours.id);
    for (const named of [DEFAULT_THEME_ID, '0b6f6a4e-8f4e-4c2b-9a51-3a3b1d1f2c09']) {
      const refused = await h.call('ada', 'POST', `/v1/spaces/${h.general}/templates`, {
        definition: template({ prompts: named }),
      });
      expect(refused.statusCode).toBe(400);
      expect(refused.json<{ code: string; unresolved: unknown[] }>()).toMatchObject({
        code: 'template_unresolved',
        unresolved: [{ reference: 'library', id: named }],
      });
    }
  });
});
