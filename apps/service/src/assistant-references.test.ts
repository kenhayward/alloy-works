import {
  PENDING_ENTRY,
  readReferenceAnswer,
  type ReferenceRequest,
  type ReferenceSourceId,
} from '@alloy-works/domain';
import type { ModelEvent, ModelRequest } from '@alloy-works/domain';
import {
  crossrefSearch,
  crossrefWork,
  pubmedDunnart,
  pubmedSummary,
} from '@alloy-works/domain/sources-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

type Json = Record<string, unknown>;

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

const ended = (stop: 'end' | 'tool_use' = 'end'): ModelEvent => ({
  type: 'ended',
  model: 'stand-in-1',
  stop,
  usage: { in: 10, out: 5 },
});

/** A model that calls one tool, then says it is done. */
const calling =
  (name: string, input: Json) =>
  (request: ModelRequest): ModelEvent[] =>
    request.call.messages.some((message) => message.role === 'assistant')
      ? [{ type: 'text', text: 'Done.' }, ended()]
      : [{ type: 'tool_call', id: 't1', name, input }, ended('tool_use')];

/** What the fake sources answer, mapped as the connector maps them. */
function answering(request: ReferenceRequest) {
  const raw =
    request.source === 'crossref'
      ? request.op === 'search'
        ? crossrefSearch
        : crossrefWork()
      : pubmedSummary([pubmedDunnart]);
  const results = readReferenceAnswer(request.source as ReferenceSourceId, request.op, raw) ?? [];
  return {
    type: 'found' as const,
    results:
      request.op === 'search'
        ? results
        : results.filter((each) => each.identifier === request.identifier),
  };
}

const MARSH = '10.5555/marsh.2021.017';

describe("the assistant's reference tools (the XR plan, XR-I)", () => {
  let h: Harness;
  let sites: { id: string; version: string };
  let document: { id: string };

  beforeAll(async () => {
    h = await startHarness();
    h.connector.referenceFor = answering;
    const made = (
      await h.call('ada', 'POST', '/v1/model-endpoints', {
        name: 'Drafting',
        protocol: 'anthropic',
        baseUrl: 'https://models.example.test',
        model: 'stand-in-1',
        contextWindow: 200_000,
        priceIn: 3,
        priceOut: 15,
        currency: 'USD',
        boundary: 'outside',
      })
    ).json<{ endpoint: { id: string } }>().endpoint;
    await h.call('ada', 'PUT', `/v1/model-endpoints/${made.id}/key`, { key: 'an-invented-key' });
    await h.call('ada', 'PUT', '/v1/model-routes/drafting', { endpoint: made.id });
    sites = await h.component(h.general, 'Sites');
    await h.place(sites, { type: 'text', value: 'Marshes accrete. Weirs flood.', marks: [] });
    document = await h.documentReferencing([sites.id]);
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const run = async (as: string, name: string, input: Json) => {
    h.connector.modelFor = calling(name, input);
    const response = await h.call(as, 'POST', `/v1/documents/${document.id}/assistant/runs`, {
      ask: 'Cite the marsh paper.',
    });
    expect(response.statusCode, response.body).toBe(200);
    const frames = framesOf(response.body);
    return {
      result: frames.find((frame) => frame.event === 'tool_result')!.data,
      proposal: frames.find((frame) => frame.event === 'proposal')?.data,
    };
  };
  const cite = (as: string, source: string, identifier: string) =>
    run(as, 'cite_reference', {
      component: sites.id,
      block: 'p1',
      after: 'accrete.',
      source,
      identifier,
    });
  const accept = (as: string, proposal: Json | undefined) =>
    h.call(as, 'POST', `/v1/assistant/proposals/${String(proposal!.id)}/acceptance`);
  const entries = async () =>
    (await h.call('ada', 'GET', `/v1/spaces/${h.general}/bibliography-entries`)).json<{
      items: { id: string }[];
    }>().items;
  const citedIn = async () =>
    (await h.call('ada', 'GET', `/v1/components/${sites.id}`)).json<{
      content: { content: { content: Json[] }[] };
    }>();

  it('LIB-040 searches a source as the person with the terms the model gave, answering a few fields as data', async () => {
    const asked = h.connector.asked.length;
    const { result } = await run('grace', 'search_references', {
      source: 'crossref',
      query: 'salt marsh',
    });
    expect(result).toMatchObject({ ok: true, summary: '2 found' });
    expect(String(result.result)).toMatch(/^<content source="reference:crossref">/);
    expect(String(result.result)).toContain(
      'Salt Marsh Accretion Under Rising Tides. Marlow, Ada; Penhallow, Grace; Tidal Survey Group. 2021. Journal of Invented Estuaries. DOI 10.5555/marsh.2021.017',
    );
    expect(h.connector.asked.slice(asked).filter((each) => each.path === '/v1/reference')).toEqual([
      expect.objectContaining({
        body: expect.objectContaining({ op: 'search', query: 'salt marsh' }),
      }),
    ]);
  });

  it('answers the model a refusal past five searches in a run, asking the source no more', async () => {
    // A model that searches until it has six answers.
    h.connector.modelFor = (request) =>
      request.call.messages.filter((message) => message.role === 'assistant').length < 6
        ? [
            {
              type: 'tool_call',
              id: 't1',
              name: 'search_references',
              input: { source: 'crossref', query: 'salt marsh' },
            },
            ended('tool_use'),
          ]
        : [{ type: 'text', text: 'Done.' }, ended()];
    const asked = h.connector.asked.filter((each) => each.path === '/v1/reference').length;
    const response = await h.call('grace', 'POST', `/v1/documents/${document.id}/assistant/runs`, {
      ask: 'Find the marsh paper.',
    });
    expect(response.statusCode, response.body).toBe(200);
    const results = framesOf(response.body).filter((frame) => frame.event === 'tool_result');
    expect(results.map((frame) => frame.data.ok)).toEqual([true, true, true, true, true, false]);
    expect(results[5]!.data).toMatchObject({ summary: 'reference_searches_spent' });
    expect(h.connector.asked.filter((each) => each.path === '/v1/reference').length - asked).toBe(
      5,
    );
  });

  it('LIB-040 refuses a source switched off, for a search and a citation alike, asking it nothing', async () => {
    await h.call('ada', 'PUT', '/v1/reference-sources', { source: 'pubmed', enabled: false });
    try {
      const asked = h.connector.asked.filter((each) => each.path === '/v1/reference').length;
      const searched = await run('grace', 'search_references', {
        source: 'pubmed',
        query: 'dunnart',
      });
      expect(searched.result).toMatchObject({ ok: false, summary: 'reference_source_off' });
      expect(String(searched.result.result)).toBe('PubMed is switched off in this environment.');
      const cited = await cite('grace', 'pubmed', '99000001');
      expect(cited.result).toMatchObject({ ok: false, summary: 'reference_source_off' });
      expect(cited.proposal).toBeUndefined();
      expect(h.connector.asked.filter((each) => each.path === '/v1/reference').length).toBe(asked);
    } finally {
      await h.call('ada', 'PUT', '/v1/reference-sources', { source: 'pubmed', enabled: true });
    }
  });

  it('LIB-040 proposes a citation carrying the source record, and accepting it makes the entry as the person and cites it', async () => {
    const before = (await entries()).map((each) => each.id);
    const { result, proposal } = await cite('grace', 'crossref', MARSH);
    expect(result).toMatchObject({ ok: true });
    expect(proposal).toMatchObject({
      cites: {
        source: 'crossref',
        identifier: MARSH,
        title: 'Salt Marsh Accretion Under Rising Tides',
      },
    });
    expect(JSON.stringify(proposal!.proposed)).toContain(PENDING_ENTRY);
    // Nothing is made until it is accepted, and it is never kept as a suggestion.
    expect((await entries()).length).toBe(before.length);
    const kept = await h.call(
      'grace',
      'POST',
      `/v1/assistant/proposals/${String(proposal!.id)}/keeping`,
    );
    expect(kept.statusCode).toBe(409);
    expect(kept.json()).toMatchObject({ code: 'proposal_cites' });

    const accepted = await accept('grace', proposal);
    expect(accepted.statusCode, accepted.body).toBe(200);
    const made = (await entries()).filter((each) => !before.includes(each.id));
    expect(made).toHaveLength(1);
    const entry = (await h.call('grace', 'GET', `/v1/bibliography-entries/${made[0]!.id}`)).json<{
      id: string;
      entry: { obtained: { from: string } };
    }>();
    expect(entry.entry.obtained.from).toBe(`crossref:${MARSH}`);
    expect((await citedIn()).content.content[0]!.content).toEqual([
      { type: 'text', value: 'Marshes accrete.', marks: [] },
      { type: 'citation', entry: entry.id },
      { type: 'text', value: ' Weirs flood.', marks: [] },
    ]);
  });

  it('LIB-040 cites the entry already in the space when accepting matches one, making none', async () => {
    const before = await entries();
    const { proposal } = await cite('grace', 'crossref', MARSH);
    expect((await accept('grace', proposal)).statusCode).toBe(200);
    expect(await entries()).toEqual(before);
    const cited = (await citedIn()).content.content[0]!.content.filter(
      (node) => node.type === 'citation',
    );
    expect(cited).toHaveLength(2);
    expect(cited[1]!.entry).toBe(cited[0]!.entry);
  });

  it('LIB-040 refuses an accepter who may not make the entry in the space, unless one matches', async () => {
    // Alice may edit this component alone: she reads the space, and may not make an entry in it.
    await h.allow(h.ids.alice!, h.roles.Author!, { kind: 'artifact', id: sites.id });
    const before = await entries();
    const { proposal: fresh } = await cite('alice', 'pubmed', '99000001');
    const refused = await accept('alice', fresh);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'entry_not_writable' });
    expect(await entries()).toEqual(before);

    const { proposal: matching } = await cite('alice', 'crossref', MARSH);
    const accepted = await accept('alice', matching);
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(await entries()).toEqual(before);
  });

  it('LIB-040 never cites an entry matching by title, year and author alone, making one from the source', async () => {
    // Made by hand with the dunnart's title, year and authors, and none of its identifiers.
    const bare = {
      ...(readReferenceAnswer('pubmed', 'fetch', pubmedSummary([pubmedDunnart]))![0]!.csl as Json),
    };
    delete bare['PMID'];
    delete bare['DOI'];
    const byHand = await h.call('grace', 'POST', `/v1/spaces/${h.general}/bibliography-entries`, {
      entry: { csl: bare },
      despiteMatches: true,
    });
    expect(byHand.statusCode, byHand.body).toBe(200);
    const lookalike = byHand.json<{ entry: { id: string } }>().entry.id;
    const before = (await entries()).map((each) => each.id);
    const { proposal } = await cite('grace', 'pubmed', '99000001');
    const accepted = await accept('grace', proposal);
    expect(accepted.statusCode, accepted.body).toBe(200);
    const made = (await entries()).filter((each) => !before.includes(each.id));
    expect(made).toHaveLength(1);
    expect(made[0]!.id).not.toBe(lookalike);
    const entry = (await h.call('grace', 'GET', `/v1/bibliography-entries/${made[0]!.id}`)).json<{
      entry: { obtained: { from: string } };
    }>();
    expect(entry.entry.obtained.from).toBe('pubmed:99000001');
  });
});
