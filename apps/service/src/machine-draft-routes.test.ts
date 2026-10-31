import { randomUUID } from 'node:crypto';

import { findRole } from '@alloy-works/db';
import type { ModelEvent, ModelRequest } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;
type Version = { id: string; number: string };

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

const para = (id: string, value: string) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [{ type: 'text', value, marks: [] }],
});

const ended: ModelEvent = {
  type: 'ended',
  model: 'stand-in-1',
  stop: 'end',
  usage: { in: 90, out: 40 },
};

/** The file a call sends, as the model is given it. */
const fileIn = (request: ModelRequest) => {
  const block = request.call.messages[0]!.content[0]!;
  const text = block.type === 'text' ? block.text : '';
  return text.replace(/^<content source="xliff">\n/, '').replace(/\n<\/content>$/, '');
};

/** A translator that gives each segment its words in brackets, every code where it was. */
const translator = (request: ModelRequest): ModelEvent[] => [
  {
    type: 'text',
    text:
      'Here is the file:\n```xml\n' +
      fileIn(request).replace(
        /<source>(.*?)<\/source>/g,
        '<source>$1</source><target>[$1]</target>',
      ) +
      '\n```',
  },
  ended,
];

/**
 * A machine draft through the service (the XL plan, XL-H to XL-K): Grace authors in General and may
 * edit; Ada approves there and administers; Alice reads General alone.
 */
describe('a machine draft of a translation (the XL plan, XLc)', () => {
  let h: Harness;
  const asked: ModelRequest[] = [];
  const endpoints: Record<string, string> = {};

  const cut = async (
    who: string,
    id: string,
    openedFrom: string,
    blocks: unknown[],
    language: string,
  ) => {
    const session = randomUUID();
    await h.call(who, 'POST', `/v1/components/${id}/lock`, { session, move: true });
    await h.call(who, 'PUT', `/v1/components/${id}/iterations/${session}/1`, {
      openedFrom,
      content: { schemaVersion: 1, title: 'Sampling', language, direction: 'ltr', content: blocks },
    });
    const made = await h.call(who, 'POST', `/v1/components/${id}/versions`, {
      session,
      openedFrom,
    });
    return made.json<{ version: Version }>().version;
  };

  /** A component of Grace's, approved by Ada, with a French translation begun. */
  const translatable = async (title: string, blocks: unknown[] = [para('b1', title)]) => {
    const made = await h.call('grace', 'POST', `/v1/spaces/${h.general}/components`, {
      title,
      language: 'en-GB',
      direction: 'ltr',
    });
    const created = made.json<{ id: string; version: Version }>();
    const version = await cut('grace', created.id, created.version.id, blocks, 'en-GB');
    await h.call('grace', 'POST', `/v1/components/${created.id}/transitions`, {
      transition: 'submit',
      from: 'draft',
    });
    await h.call('ada', 'POST', `/v1/components/${created.id}/approvals`, {
      transition: 'approve',
      version: version.id,
      decision: 'approved',
    });
    const begun = await h.call('grace', 'POST', `/v1/components/${created.id}/translations`, {
      language: 'fr-FR',
    });
    return { id: created.id, line: begun.json<{ line: string }>().line };
  };

  const policy = (machine: string) =>
    h.call('ada', 'PUT', '/v1/settings/translation', {
      fallback: 'source',
      outOfDate: 'publish',
      note: {},
      machine,
    });
  const route = (name: string) =>
    h.call('ada', 'PUT', '/v1/model-routes/translate', { endpoint: endpoints[name] });
  const draft = (who: string, component: { id: string; line: string }) =>
    h.call(
      who,
      'POST',
      `/v1/components/${component.id}/translations/${component.line}/machine-draft`,
    );
  const translations = async (component: { id: string }) =>
    (await h.call('grace', 'GET', `/v1/components/${component.id}/translations`)).json<{
      translations: Json[];
    }>().translations[0]!;

  beforeAll(async () => {
    h = await startHarness();
    const role = (name: string) => h.tenantDb.withTenant(h.tenant, (trx) => findRole(trx, name));
    await h.allow(h.ids.ada!, (await role('Approver'))!.id, { kind: 'space', id: h.general });
    for (const boundary of ['inside', 'outside'] as const) {
      const made = (
        await h.call('ada', 'POST', '/v1/model-endpoints', {
          name: `Translator ${boundary}`,
          protocol: 'anthropic',
          baseUrl: 'https://models.example.test',
          model: 'stand-in-1',
          contextWindow: 200_000,
          priceIn: 3,
          priceOut: 15,
          currency: 'USD',
          boundary,
        })
      ).json<{ endpoint: { id: string } }>().endpoint;
      await h.call('ada', 'PUT', `/v1/model-endpoints/${made.id}/key`, { key: 'an-invented-key' });
      endpoints[boundary] = made.id;
    }
    h.connector.modelFor = (request) => {
      asked.push(request);
      return translator(request);
    };
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  it('LOC-023 LOC-024 LOC-041 drafts a translation by the translate endpoint, marked until a person with approve accepts it', async () => {
    const component = await translatable('Ponds were sampled.');
    expect((await policy('inside')).statusCode).toBe(200);
    expect((await draft('grace', component)).json()).toMatchObject({ code: 'model_unconfigured' });
    await route('inside');
    expect((await draft('alice', component)).statusCode).toBe(403);

    const drafted = await draft('grace', component);
    expect(drafted.statusCode, drafted.body).toBe(200);
    const frames = framesOf(drafted.body);
    expect(frames.map((frame) => frame.event)).toEqual(['run', 'drafted', 'ended']);
    expect(frames[1]!.data).toMatchObject({
      version: { number: expect.stringContaining('fr-FR') },
    });
    expect(fileIn(asked.at(-1)!)).toContain('trgLang="fr-FR"');
    expect(await translations(component)).toMatchObject({
      status: { status: 'machineDrafted' },
      machine: { version: { id: (frames[1]!.data.version as Version).id }, missedTerms: [] },
    });

    const accept = (who: string) =>
      h.call(
        who,
        'POST',
        `/v1/components/${component.id}/translations/${component.line}/machine-draft/accept`,
      );
    expect((await accept('grace')).statusCode).toBe(403);
    const accepted = await accept('ada');
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toMatchObject({ status: { status: 'translated' } });
    expect((await accept('ada')).json()).toMatchObject({ code: 'translation_nothing_drafted' });
    expect(await translations(component)).toMatchObject({ machine: null });
  });

  it('LOC-026 sends nothing while the policy is off, and nothing outside the boundary where it says inside', async () => {
    const component = await translatable('Streams were walked.');
    await route('inside');
    expect((await policy('off')).statusCode).toBe(200);
    const sent = asked.length;
    expect((await draft('grace', component)).json()).toMatchObject({
      code: 'translation_machine_off',
    });
    await policy('inside');
    await route('outside');
    expect((await draft('grace', component)).json()).toMatchObject({
      code: 'translation_machine_outside',
    });
    expect(asked.length).toBe(sent);
    await route('inside');
    // A body written before the policy said anything of machines leaves it as it is (the XL final review).
    const older = await h.call('ada', 'PUT', '/v1/settings/translation', {
      fallback: 'source',
      outOfDate: 'publish',
      note: {},
    });
    expect(older.json()).toMatchObject({ machine: 'inside', conflict: 'review' });
  });

  it('refuses the whole draft where the model invents a code, and drafts nothing', async () => {
    const component = await translatable('Wells were dipped.');
    await policy('inside');
    await route('inside');
    h.connector.modelFor = (request) => [
      {
        type: 'text',
        text: fileIn(request).replace(
          /<source>(.*?)<\/source>/g,
          '<source>$1</source><target>[$1]<ph id="p9"/></target>',
        ),
      },
      ended,
    ];
    const drafted = await draft('grace', component);
    expect(framesOf(drafted.body).at(-1)).toMatchObject({
      event: 'failed',
      data: { code: 'translation_unreadable' },
    });
    expect(await translations(component)).toMatchObject({
      status: { status: 'untranslated' },
      machine: null,
    });
    h.connector.modelFor = (request) => {
      asked.push(request);
      return translator(request);
    };
  });

  it("LOC-025 gives the model the space's terms the source uses as a glossary, with the target's label", async () => {
    const made = await h.call('grace', 'POST', `/v1/spaces/${h.general}/terms`, {
      term: {
        schemaVersion: 1,
        base: 'en',
        labels: [
          { language: 'en', preferred: 'Breeding pond', alternatives: [] },
          { language: 'fr', preferred: 'Mare de reproduction', alternatives: [] },
        ],
        definition: [],
        broader: [],
        narrower: [],
        related: [],
      },
    });
    expect(made.statusCode, made.body).toBe(200);
    const term = made.json<{ id: string; version: { id: string } }>();
    const approved = await h.call('ada', 'POST', `/v1/terms/${term.id}/approvals`, {
      transition: 'approve',
      version: term.version.id,
      decision: 'approved',
    });
    expect(approved.statusCode, approved.body).toBe(200);
    const component = await translatable('Ponds', [
      {
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [
          { type: 'text', value: 'Each ', marks: [] },
          {
            type: 'text',
            value: 'breeding pond',
            marks: [{ type: 'definedTerm', id: 'd1', term: term.id }],
          },
          { type: 'text', value: ' was netted.', marks: [] },
        ],
      },
    ]);
    await policy('inside');
    await route('inside');

    const drafted = await draft('grace', component);
    expect(drafted.statusCode, drafted.body).toBe(200);
    expect(fileIn(asked.at(-1)!)).toContain(
      '<gls:glossary><gls:glossEntry><gls:term>Breeding pond</gls:term>' +
        '<gls:translation>Mare de reproduction</gls:translation></gls:glossEntry></gls:glossary>',
    );
  });
});
