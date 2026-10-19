import { createHash } from 'node:crypto';

import { DEFAULT_LAYOUT_ID, DEFAULT_THEME_ID, findRole } from '@alloy-works/db';
import {
  canonicalCall,
  SEED_PROMPT_WORKFLOW,
  type ModelEvent,
  type ModelRequest,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;

/** Server-sent events as the route wrote them: each frame's event and its data. */
function framesOf(body: string): { event: string; data: Json }[] {
  return body
    .split('\n\n')
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      return event && data ? { event, data: JSON.parse(data) as Json } : undefined;
    })
    .filter((frame): frame is { event: string; data: Json } => frame !== undefined);
}

const ended: ModelEvent = {
  type: 'ended',
  model: 'stand-in-1',
  stop: 'end',
  usage: { in: 90, out: 12 },
};
const text = (value: string): ModelEvent => ({ type: 'text', text: value });

const prompt = (over: Json = {}) => ({
  schemaVersion: 1,
  title: 'Say it plainly',
  description: '',
  instructions: 'Rewrite the part in plain words.',
  context: [{ source: 'outline', scope: 'part' }],
  output: { componentType: null },
  models: { purpose: 'drafting', accepts: ['stand-in-1'] },
  ...over,
});

describe('a prompt run through the service (the G4 plan, G4-H and G4-I)', () => {
  let h: Harness;
  let sites: { id: string; version: string };
  let secret: { id: string; version: string };
  let document: { id: string; version: string; nodes: string[] };
  /** What the connector was asked, each call in order. */
  const asked: ModelRequest[] = [];

  beforeAll(async () => {
    h = await startHarness();
    for (const [name, model, window, purpose] of [
      ['Drafting', 'stand-in-1', 200_000, 'drafting'],
      ['Small', 'stand-in-1', 1024, 'summarising'],
    ] as const) {
      const made = (
        await h.call('ada', 'POST', '/v1/model-endpoints', {
          name,
          protocol: 'anthropic',
          baseUrl: 'https://models.example.test',
          model,
          contextWindow: window,
          priceIn: 3,
          priceOut: 15,
          currency: 'USD',
          boundary: 'outside',
        })
      ).json<{ endpoint: { id: string } }>().endpoint;
      await h.call('ada', 'PUT', `/v1/model-endpoints/${made.id}/key`, { key: 'an-invented-key' });
      await h.call('ada', 'PUT', `/v1/model-routes/${purpose}`, { endpoint: made.id });
    }
    h.connector.modelFor = (request) => {
      asked.push(request);
      return [text('The north weir '), text('floods every spring.'), ended];
    };
    const role = (name: string) => h.tenantDb.withTenant(h.tenant, (trx) => findRole(trx, name));
    await h.allow(h.ids.ada!, (await role('Approver'))!.id, { kind: 'space', id: h.general });
    await h.allow(h.ids.ada!, (await role('Designer'))!.id, { kind: 'tenant' });
    sites = await h.component(h.general, 'Sites');
    await h.place(sites, { type: 'text', value: 'The north weir floods each spring.', marks: [] });
    // Ada authors in Quality too; Grace may not read it.
    await h.allow(h.ids.ada!, h.roles.Author!, { kind: 'space', id: h.quality });
    secret = await h.component(h.quality, 'Quality notes');
    await h.place(secret, { type: 'text', value: 'A confidential finding.', marks: [] });
    document = await h.documentReferencing([sites.id, secret.id]);
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  /** A prompt Grace makes in General: its id and version. */
  const made = async (over: Json = {}) =>
    (
      await h.call('grace', 'POST', `/v1/spaces/${h.general}/prompts`, { prompt: prompt(over) })
    ).json<{
      id: string;
      version: { id: string };
    }>();

  const trial = (as: string, made: { id: string; version: { id: string } }, node: string) =>
    h.call(as, 'POST', `/v1/prompts/${made.id}/versions/${made.version.id}/trials`, {
      document: document.id,
      node,
    });

  /** Grace submits it and tries it; Ada approves it. */
  const approved = async (over: Json = {}) => {
    const one = await made(over);
    await h.call('grace', 'POST', `/v1/prompts/${one.id}/transitions`, {
      transition: 'submit',
      from: 'draft',
    });
    expect((await trial('grace', one, document.nodes[0]!)).statusCode).toBe(200);
    const passed = await h.call('ada', 'POST', `/v1/prompts/${one.id}/approvals`, {
      transition: 'approve',
      version: one.version.id,
      decision: 'approved',
    });
    expect(passed.statusCode, passed.body).toBe(200);
    return one;
  };

  /** A document made by Ada from a template binding a library listing these prompts. */
  const bound = async (prompts: string[]) => {
    const library = (
      await h.call('ada', 'POST', '/v1/prompt-libraries', {
        library: { schemaVersion: 1, name: `Library ${prompts.length}`, prompts },
      })
    ).json<{ id: string }>();
    const template = (
      await h.call('ada', 'POST', `/v1/spaces/${h.general}/templates`, {
        definition: {
          schemaVersion: 1,
          name: 'Report',
          theme: DEFAULT_THEME_ID,
          layout: DEFAULT_LAYOUT_ID,
          prompts: library.id,
          schemas: [],
          outline: { sections: [] },
          changes: { add: true, remove: true, reorder: true },
        },
      })
    ).json<{ id: string }>();
    return h.documentReferencing([sites.id, secret.id], h.general, { template: template.id });
  };

  it('GEN-045 refuses to approve a prompt version before a finished trial of it, and approves it after; no prompt workflow saved lifts it', async () => {
    const one = await made({ title: 'Not yet tried' });
    await h.call('grace', 'POST', `/v1/prompts/${one.id}/transitions`, {
      transition: 'submit',
      from: 'draft',
    });
    const decision = { transition: 'approve', version: one.version.id, decision: 'approved' };
    const early = await h.call('ada', 'POST', `/v1/prompts/${one.id}/approvals`, decision);
    expect(early.statusCode).toBe(409);
    expect(early.json<{ code: string; unmet: { condition: string }[] }>()).toMatchObject({
      code: 'conditions_unmet',
      unmet: [{ condition: 'trial' }],
    });
    const tried = await trial('grace', one, document.nodes[0]!);
    expect(tried.statusCode, tried.body).toBe(200);
    expect(framesOf(tried.body).map((frame) => frame.event)).toEqual([
      'run',
      'text',
      'text',
      'ended',
    ]);
    expect(
      (await h.call('ada', 'POST', `/v1/prompts/${one.id}/approvals`, decision)).statusCode,
    ).toBe(200);

    // A tenant's prompt workflow without it is refused, whatever else it says.
    const lifted = await h.call('ada', 'POST', '/v1/workflows', {
      kind: 'prompt',
      ...SEED_PROMPT_WORKFLOW,
      transitions: SEED_PROMPT_WORKFLOW.transitions.map(({ requires: _, ...each }) => each),
    });
    expect(lifted.statusCode).toBe(400);
    expect(lifted.json<{ problems: { rule: string }[] }>().problems).toEqual([
      expect.objectContaining({ rule: 'trial_required' }),
    ]);
  });

  it("GEN-006 GEN-057 runs a library's prompt on a part at its approved version, the run recording the version, model, parameters, digest and what it read", async () => {
    const one = await approved({ title: 'Plain words' });
    const report = await bound([one.id]);
    const listed = await h.call('grace', 'GET', `/v1/documents/${report.id}/prompts`);
    expect(listed.json<{ prompts: { id: string; state: string }[] }>().prompts).toEqual([
      expect.objectContaining({ id: one.id, state: 'approved' }),
    ]);
    const before = asked.length;
    const ran = await h.call('grace', 'POST', `/v1/documents/${report.id}/prompt-runs`, {
      prompt: one.id,
      node: report.nodes[0],
    });
    expect(ran.statusCode, ran.body).toBe(200);
    const frames = framesOf(ran.body);
    expect(frames.map((frame) => frame.event)).toEqual([
      'run',
      'text',
      'text',
      'proposal',
      'ended',
    ]);
    const proposal = frames.find((frame) => frame.event === 'proposal')!.data;
    expect(proposal).toMatchObject({ component: sites.id });
    expect(JSON.stringify(proposal.proposed)).toContain('The north weir floods every spring.');

    const run = (
      await h.call('grace', 'GET', `/v1/assistant/runs/${String(frames[0]!.data.run)}`)
    ).json<{ run: Json }>().run;
    const call = asked[before]!.call;
    expect(run).toMatchObject({
      purpose: 'drafting',
      promptVersion: one.version.id,
      model: 'stand-in-1',
      parameters: { instructions: 'prompt-run-1', maxTokens: 4096 },
      contextDigest: createHash('sha256').update(canonicalCall(call), 'utf8').digest('hex'),
    });
    expect(run.read).toEqual([
      { component: sites.id, version: expect.any(String), blocks: ['p1'] },
    ]);
  });

  it('GEN-003 GEN-058 sends what the context declares and nothing else, a part the runner may not read left out', async () => {
    const before = asked.length;
    const one = await made({ context: [{ source: 'outline', scope: 'document' }] });
    expect((await trial('grace', one, document.nodes[0]!)).statusCode).toBe(200);
    const sent = JSON.stringify(asked[before]!.call);
    expect(asked[before]!.call.tools).toEqual([]);
    // One message: the instructions and the parts declared, as data; not even the document's title.
    expect(asked[before]!.call.messages).toHaveLength(1);
    expect(sent).not.toContain('The readings report');
    expect(sent).toContain('The north weir floods each spring.');
    expect(sent).not.toContain('A confidential finding.');
    // A part's context alone sends that part alone, to anybody.
    const alone = await made({ context: [{ source: 'outline', scope: 'part' }] });
    expect((await trial('ada', alone, document.nodes[0]!)).statusCode).toBe(200);
    const aloneSent = JSON.stringify(asked[before + 1]!.call);
    expect(aloneSent).toContain('The north weir floods each spring.');
    expect(aloneSent).not.toContain('A confidential finding.');
  });

  it('GEN-059 refuses a context resolving to nothing, and one more than the endpoint takes, before any call', async () => {
    const before = asked.length;
    // The document holds no value for this parameter, and the prompt reads nothing else.
    const unmatched = await made({
      instructions: 'Write for {{audience}}.',
      context: [{ source: 'parameters', names: ['audience'] }],
    });
    const empty = await trial('grace', unmatched, document.nodes[0]!);
    expect(empty.statusCode).toBe(409);
    expect(empty.json<{ code: string }>().code).toBe('context_empty');
    const small = await made({ models: { purpose: 'summarising', accepts: ['stand-in-1'] } });
    const large = await trial('grace', small, document.nodes[0]!);
    expect(large.statusCode).toBe(409);
    expect(large.json<{ code: string; message: string }>()).toMatchObject({
      code: 'context_too_large',
      message: expect.stringContaining('1,024'),
    });
    expect(asked.length).toBe(before);
  });

  it('GEN-005 refuses a run on an endpoint whose model the prompt does not accept, before any call', async () => {
    const before = asked.length;
    const other = await made({ models: { purpose: 'drafting', accepts: ['another-model'] } });
    const refused = await trial('grace', other, document.nodes[0]!);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ code: string }>().code).toBe('model_mismatch');
    // A release of one it accepts is accepted: `stand-in-1` is a release of `stand-in`.
    const family = await made({ models: { purpose: 'drafting', accepts: ['stand-in'] } });
    expect((await trial('grace', family, document.nodes[0]!)).statusCode).toBe(200);
    expect(asked.length).toBe(before + 1);
  });

  it('runs only an approved prompt the library lists, and refuses a part the runner may not read', async () => {
    const one = await approved({ title: 'Listed and approved' });
    const unlisted = await approved({ title: 'Approved, not listed' });
    const report = await bound([one.id]);
    const run = (prompt: string, node: string) =>
      h.call('grace', 'POST', `/v1/documents/${report.id}/prompt-runs`, { prompt, node });
    expect((await run(unlisted.id, report.nodes[0]!)).statusCode).toBe(404);
    expect((await run(one.id, report.nodes[1]!)).statusCode).toBe(404);
    // Alice reads General and may not suggest: a run proposes.
    expect(
      (
        await h.call('alice', 'POST', `/v1/documents/${report.id}/prompt-runs`, {
          prompt: one.id,
          node: report.nodes[0],
        })
      ).statusCode,
    ).toBe(403);
  });

  it("GEN-036 reuses the runner's own identical run at no cost, never another person's, and calls afresh when asked, after a repointing, or for a trial", async () => {
    const one = await approved({ title: 'Reused' });
    const report = await bound([one.id]);
    const run = async (as: string, fresh?: boolean) => {
      const before = asked.length;
      const frames = framesOf(
        (
          await h.call(as, 'POST', `/v1/documents/${report.id}/prompt-runs`, {
            prompt: one.id,
            node: report.nodes[0],
            ...(fresh === undefined ? {} : { fresh }),
          })
        ).body,
      );
      return { frames, called: asked.length - before };
    };
    const first = await run('grace');
    expect(first.called).toBe(1);
    expect(first.frames.at(-1)!.data.cost).not.toBe('0.000000');
    // Again: her own run's words, checked again and proposed anew, calling nothing and costing nothing.
    const again = await run('grace');
    expect(again.called).toBe(0);
    expect(again.frames.map((frame) => frame.event)).toEqual(['run', 'text', 'proposal', 'ended']);
    expect(again.frames[0]!.data.cachedFrom).toBe(first.frames[0]!.data.run);
    expect(again.frames[1]!.data.text).toBe('The north weir floods every spring.');
    expect(again.frames.at(-1)!.data).toMatchObject({
      tokensIn: 0,
      tokensOut: 0,
      cost: '0.000000',
    });
    // Asked afresh, it calls.
    expect((await run('grace', true)).called).toBe(1);
    // Ada's identical run is hers alone to reuse: Grace's is never served to her.
    const hers = await run('ada');
    expect(hers.called).toBe(1);
    expect(hers.frames[0]!.data.cachedFrom).toBeUndefined();
    // The endpoint pointed elsewhere: nothing run before it is reused.
    const endpoints = (await h.call('ada', 'GET', '/v1/model-endpoints')).json<{
      items: { id: string; name: string }[];
    }>().items;
    const drafting = endpoints.find((each) => each.name === 'Drafting')!;
    const moved = await h.call('ada', 'PUT', `/v1/model-endpoints/${drafting.id}`, {
      name: 'Drafting',
      protocol: 'anthropic',
      baseUrl: 'https://models.example.test/v2',
      model: 'stand-in-1',
      contextWindow: 200_000,
      priceIn: 3,
      priceOut: 15,
      currency: 'USD',
      boundary: 'outside',
    });
    expect(moved.statusCode, moved.body).toBe(200);
    try {
      expect((await run('grace')).called).toBe(1);
    } finally {
      await h.call('ada', 'PUT', `/v1/model-endpoints/${drafting.id}`, {
        name: 'Drafting',
        protocol: 'anthropic',
        baseUrl: 'https://models.example.test',
        model: 'stand-in-1',
        contextWindow: 200_000,
        priceIn: 3,
        priceOut: 15,
        currency: 'USD',
        boundary: 'outside',
      });
    }
    // A trial is run to be seen again: never reused.
    const tried = asked.length;
    await trial('grace', one, document.nodes[0]!);
    await trial('grace', one, document.nodes[0]!);
    expect(asked.length - tried).toBe(2);
  });

  it('proposes nothing from a blank reply, saying so, and never empties the part', async () => {
    const one = await approved({ title: 'Says nothing' });
    const report = await bound([one.id]);
    const was = h.connector.modelFor;
    h.connector.modelFor = (request) => {
      asked.push(request);
      return [text('   '), ended];
    };
    try {
      const ran = await h.call('grace', 'POST', `/v1/documents/${report.id}/prompt-runs`, {
        prompt: one.id,
        node: report.nodes[0],
      });
      const frames = framesOf(ran.body);
      expect(frames.map((frame) => frame.event)).toEqual(['run', 'text', 'ended']);
      expect(frames.at(-1)!.data.refused).toBe('The model wrote nothing, so nothing is proposed.');
    } finally {
      h.connector.modelFor = was;
    }
  });
});
