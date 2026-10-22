import { auditEvents, newestEvent } from '@alloy-works/db/testing';
import {
  readReferenceAnswer,
  type ReferenceRequest,
  type ReferenceSourceId,
} from '@alloy-works/domain';
import {
  crossrefSearch,
  crossrefWork,
  pubmedDunnart,
  pubmedSummary,
} from '@alloy-works/domain/sources-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test/bindings-harness.js';

interface Result {
  identifier: string;
  csl: Record<string, unknown>;
  matches: { by: string; entry: { id: string; key: string } }[];
}

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

describe('reference sources through the API (the XR plan, XR-C, XR-D)', () => {
  let h: Harness;
  const space = () => `space:${h.general}`;

  beforeAll(async () => {
    h = await startHarness();
    h.connector.referenceFor = answering;
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  const search = (as: string, source: string, terms = 'salt marsh', within = space()) =>
    h.call(as, 'POST', `/v1/reference-sources/${source}/search`, { space: within, terms });
  const fromSource = (as: string, body: Record<string, unknown>) =>
    h.call(as, 'POST', `/v1/spaces/${h.general}/bibliography-entries/from-source`, body);

  it('LIB-032 lists the declared sources, each on until an administrator switches it off, recorded by name', async () => {
    const listed = await h.call('alice', 'GET', '/v1/reference-sources');
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({
      items: [
        {
          id: 'crossref',
          name: 'Crossref',
          host: 'api.crossref.org',
          identifier: 'DOI',
          enabled: true,
        },
        {
          id: 'pubmed',
          name: 'PubMed',
          host: 'eutils.ncbi.nlm.nih.gov',
          identifier: 'PMID',
          enabled: true,
        },
      ],
    });
    expect(
      (await h.call('grace', 'PUT', '/v1/reference-sources', { source: 'pubmed', enabled: false }))
        .statusCode,
    ).toBe(403);
    const before = await h.tenantDb.withTenant(h.tenant, newestEvent);
    const off = await h.call('ada', 'PUT', '/v1/reference-sources', {
      source: 'pubmed',
      enabled: false,
    });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json()).toMatchObject({ id: 'pubmed', enabled: false });
    const events = await h.tenantDb.withTenant(h.tenant, (trx) => auditEvents(trx, before));
    expect(events.map((each) => [each.kind, each.actor, each.detail])).toEqual([
      ['settings.changed', h.ids.ada, { settings: ['referenceSources.pubmed'] }],
    ]);

    // Off, it is neither searched nor made an entry from, and the connector is never asked.
    const asked = h.connector.asked.length;
    const refused = await search('grace', 'pubmed', 'dunnart');
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ code: string }>().code).toBe('reference_source_off');
    expect(
      (await fromSource('grace', { source: 'pubmed', identifier: '99000001' })).statusCode,
    ).toBe(409);
    expect(h.connector.asked.length).toBe(asked);
    expect(
      (await h.call('ada', 'PUT', '/v1/reference-sources', { source: 'pubmed', enabled: true }))
        .statusCode,
    ).toBe(200);
  });

  it('LIB-031 searches a source as a reader of the space, by its id and the terms alone, each result CSL', async () => {
    const found = await search('alice', 'crossref', 'salt & marsh');
    expect(found.statusCode, found.body).toBe(200);
    const answer = found.json<{ results: Result[]; mayCreate: boolean }>();
    expect(answer.mayCreate).toBe(false);
    expect(answer.results.map((each) => [each.identifier, each.csl.type, each.matches])).toEqual([
      ['10.5555/marsh.2021.017', 'article-journal', []],
      ['10.5555/quolls.ch4', 'chapter', []],
    ]);
    expect(h.connector.asked.at(-1)).toMatchObject({
      path: '/v1/reference',
      body: { source: 'crossref', op: 'search', query: 'salt & marsh' },
    });
    expect(h.connector.asked.at(-1)?.body).not.toHaveProperty('url');
    expect((await search('grace', 'crossref')).json()).toMatchObject({ mayCreate: true });
    // Ivy reads nothing in the space.
    expect((await search('ivy', 'crossref')).statusCode).toBe(404);
  });

  it('LIB-031 makes an entry from a result, where and when obtained, then offers it to the next search and the next making', async () => {
    const made = await fromSource('grace', {
      source: 'crossref',
      identifier: '10.5555/marsh.2021.017',
    });
    expect(made.statusCode, made.body).toBe(200);
    const view = made.json<{
      entry: { id: string; entry: { key: string; obtained: { from: string; at: string } } };
      dropped: string[];
    }>();
    expect(view.entry.entry.key).toBe('marlow2021');
    expect(view.entry.entry.obtained.from).toBe('crossref:10.5555/marsh.2021.017');
    expect(Date.parse(view.entry.entry.obtained.at)).toBeGreaterThan(Date.now() - 60_000);
    expect(view.dropped).toEqual([]);
    expect(h.connector.asked.at(-1)).toMatchObject({
      body: { source: 'crossref', op: 'fetch', identifier: '10.5555/marsh.2021.017' },
    });

    // A reader's next search finds it in the bibliography, citable without making anything.
    const results = (await search('alice', 'crossref')).json<{ results: Result[] }>().results;
    expect(results[0]?.matches).toEqual([
      expect.objectContaining({ by: 'doi', entry: expect.objectContaining({ id: view.entry.id }) }),
    ]);
    // Made again, the match is offered rather than a second entry.
    const again = await fromSource('grace', {
      source: 'crossref',
      identifier: '10.5555/marsh.2021.017',
    });
    expect(again.json()).toMatchObject({
      entry: null,
      matches: [{ entry: { id: view.entry.id } }],
    });
    // A reader may not make one.
    expect(
      (await fromSource('alice', { source: 'crossref', identifier: '10.5555/quolls.ch4' }))
        .statusCode,
    ).toBe(403);
  });

  it('answers a record the source does not hold, an identifier it does not use, and a source that fails, as the source’s', async () => {
    const missing = await fromSource('grace', { source: 'crossref', identifier: '10.5555/none' });
    expect(missing.statusCode).toBe(422);
    expect(missing.json<{ code: string }>().code).toBe('reference_missing');
    expect(
      (await fromSource('grace', { source: 'pubmed', identifier: '10.5555/none' })).statusCode,
    ).toBe(400);
    h.connector.referenceFor = (request) => ({
      type: 'failed',
      code: 'reference_unavailable',
      source: request.source,
      reason: 'timeout',
    });
    try {
      const failed = await search('grace', 'pubmed', 'dunnart');
      expect(failed.statusCode).toBe(502);
      expect(failed.json()).toMatchObject({
        code: 'reference_unavailable',
        message: expect.stringContaining('PubMed'),
      });
    } finally {
      h.connector.referenceFor = answering;
    }
  });
});
