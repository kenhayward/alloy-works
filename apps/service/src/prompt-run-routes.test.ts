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
});
