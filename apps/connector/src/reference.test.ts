import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import type { ChildReferenceRequest, ReferenceRequest } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConnectorConfig, PRIVATE_RANGES } from './config.js';
import { answerReference } from './reference.js';
import { createConnectorServer } from './server.js';
import { childSpawn, createSupervisor, type Supervisor } from './supervisor.js';
import { DEV_CA } from './testing/http.js';
import { startFakeReferences, type FakeReferences } from './testing/references.js';
import { SEALING_KEY, TENANT, suiteChild, suiteDeny, suiteIsolation } from './testing/source.js';

let fake: FakeReferences;
let supervisor: Supervisor;
const CONTACT = 'desk@example.test';

beforeAll(async () => {
  fake = await startFakeReferences();
  supervisor = createSupervisor({
    sealingKey: SEALING_KEY,
    deny: suiteDeny,
    maxChildren: 4,
    spec: childSpawn(suiteChild, suiteIsolation),
    ca: DEV_CA,
    referenceContact: CONTACT,
    referenceOrigins: {
      crossref: { host: '127.0.0.1', port: fake.port },
      pubmed: { host: '127.0.0.1', port: fake.port },
    },
  });
});
afterAll(async () => {
  await fake.close();
});

const ask = (request: Omit<ReferenceRequest, 'requestId' | 'tenant'>, by = supervisor) => {
  const call = by.reference({ requestId: randomUUID(), tenant: TENANT, ...request });
  if (call === 'busy') throw new Error('busy');
  return call;
};

describe('a reference source asked through the connector (the XR plan, XR-B)', () => {
  it('LIB-031 searches Crossref, the terms an encoded query parameter and the contact its mailto, and answers CSL', async () => {
    const answer = await ask({ source: 'crossref', op: 'search', query: 'salt & marsh' });
    expect(answer).toMatchObject({
      type: 'found',
      results: [
        { identifier: '10.5555/marsh.2021.017', csl: { type: 'article-journal' } },
        { identifier: '10.5555/quolls.ch4', csl: { type: 'chapter' } },
      ],
    });
    expect(fake.seen.at(-1)).toBe('/works?query=salt+%26+marsh&rows=20&mailto=desk%40example.test');
  });

  it('LIB-031 searches PubMed, its PMIDs and then their summaries, with its tool and email', async () => {
    const before = fake.seen.length;
    const answer = await ask({ source: 'pubmed', op: 'search', query: 'dunnart' });
    expect(answer).toMatchObject({
      type: 'found',
      results: [
        { identifier: '99000001', csl: { PMID: '99000001', DOI: '10.5555/dunnart.2020.12' } },
        { identifier: '99000002', csl: { PMID: '99000002' } },
      ],
    });
    expect(fake.seen.slice(before)).toEqual([
      '/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=20&term=dunnart&tool=alloy-works&email=desk%40example.test',
      '/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=99000001%2C99000002&tool=alloy-works&email=desk%40example.test',
    ]);
  });

  it('fetches by identifier, and answers none for one the source does not hold', async () => {
    expect(
      await ask({ source: 'crossref', op: 'fetch', identifier: '10.5555/quolls.ch4' }),
    ).toMatchObject({ type: 'found', results: [{ identifier: '10.5555/quolls.ch4' }] });
    expect(fake.seen.at(-1)).toBe('/works/10.5555%2Fquolls.ch4?mailto=desk%40example.test');
    expect(await ask({ source: 'crossref', op: 'check', identifier: '10.5555/gone' })).toEqual({
      type: 'found',
      results: [],
    });
    expect(await ask({ source: 'pubmed', op: 'fetch', identifier: '99000002' })).toMatchObject({
      type: 'found',
      results: [{ identifier: '99000002' }],
    });
  });

  it('LIB-036 checks a Crossref work, its notices read from the works updating it', async () => {
    const before = fake.seen.length;
    const answer = await ask({
      source: 'crossref',
      op: 'check',
      identifier: '10.5555/marsh.2021.017',
    });
    expect(answer).toMatchObject({
      type: 'found',
      results: [
        {
          identifier: '10.5555/marsh.2021.017',
          notices: [
            {
              kind: 'retraction',
              identifier: '10.5555/marsh.2021.017.retraction',
              date: '2026-04-22',
            },
          ],
        },
      ],
    });
    expect(fake.seen.slice(before)).toEqual([
      '/works/10.5555%2Fmarsh.2021.017?mailto=desk%40example.test',
      '/works?filter=updates%3A10.5555%2Fmarsh.2021.017&rows=20&mailto=desk%40example.test',
    ]);
    // A fetch asks for no notices.
    expect(
      await ask({ source: 'crossref', op: 'fetch', identifier: '10.5555/quolls.ch4' }),
    ).not.toHaveProperty('results.0.notices');
  });

  it('LIB-036 checks a PubMed record, its retraction and its erratum read from its summary', async () => {
    expect(await ask({ source: 'pubmed', op: 'check', identifier: '99000002' })).toMatchObject({
      type: 'found',
      results: [{ identifier: '99000002', notices: [{ kind: 'retraction' }] }],
    });
    expect(await ask({ source: 'pubmed', op: 'check', identifier: '99000004' })).toMatchObject({
      type: 'found',
      results: [{ notices: [{ kind: 'correction', identifier: '99000005' }] }],
    });
    expect(await ask({ source: 'pubmed', op: 'check', identifier: '99000009' })).toEqual({
      type: 'found',
      results: [],
    });
  });

  it('sends no contact where the deployment names none', async () => {
    const plain = createSupervisor({
      sealingKey: SEALING_KEY,
      deny: suiteDeny,
      maxChildren: 1,
      spec: childSpawn(suiteChild, suiteIsolation),
      ca: DEV_CA,
      referenceOrigins: { crossref: { host: '127.0.0.1', port: fake.port } },
    });
    await ask({ source: 'crossref', op: 'search', query: 'marsh' }, plain);
    expect(fake.seen.at(-1)).toBe('/works?query=marsh&rows=20');
  });

  it('refuses a redirect, an answer past its cap and JSON nested past its bound, as the source’s', async () => {
    const failed = (reason: string, source = 'crossref') => ({
      type: 'failed',
      code: 'reference_unavailable',
      source,
      reason,
    });
    expect(await ask({ source: 'crossref', op: 'search', query: 'redirect' })).toEqual(
      failed('refused'),
    );
    expect(await ask({ source: 'crossref', op: 'search', query: 'oversized' })).toEqual(
      failed('too_large'),
    );
    expect(await ask({ source: 'pubmed', op: 'search', query: 'deep' })).toEqual(
      failed('unreadable', 'pubmed'),
    );
  });

  it("reaches the host domain's list declares, the private ranges always among the guard's", async () => {
    const written: ChildReferenceRequest[] = [];
    const capturing = createSupervisor({
      sealingKey: SEALING_KEY,
      deny: suiteDeny,
      maxChildren: 1,
      streamSpawn: (_spec, input) => {
        written.push(JSON.parse(input) as ChildReferenceRequest);
        return Promise.resolve({ kind: 'ended', pid: 0 });
      },
    });
    await ask({ source: 'pubmed', op: 'fetch', identifier: '99000001' }, capturing);
    expect(written[0]).toMatchObject({ host: 'eutils.ncbi.nlm.nih.gov', port: 443 });
    // The suite's deny list holds no private range, so only the supervisor supplies them.
    expect(suiteDeny).not.toContain('10.0.0.0/8');
    expect(written[0]?.deny).toEqual(expect.arrayContaining([...PRIVATE_RANGES]));
  });

  it('refuses a source whose name resolves to a private address', async () => {
    const answer = await answerReference(
      {
        kind: 'reference',
        request: {
          requestId: randomUUID(),
          tenant: TENANT,
          source: 'crossref',
          op: 'search',
          query: 'marsh',
        },
        host: 'api.crossref.org',
        port: 443,
        deny: [...PRIVATE_RANGES],
        connectTimeoutMs: 1000,
      },
      { lookup: () => Promise.resolve([{ address: '10.20.30.40', family: 4 }]) },
    );
    expect(answer).toEqual({
      type: 'failed',
      code: 'reference_unavailable',
      source: 'crossref',
      reason: 'refused',
    });
  });
});

describe("the connector's /v1/reference", () => {
  const KEY = Buffer.alloc(32, 3).toString('base64');
  const config = loadConnectorConfig({
    CONNECTOR_KEY: KEY,
    CONNECTOR_SEALING_KEY: SEALING_KEY.toString('base64'),
    CONNECTOR_DENY: 'none',
    CONNECTOR_HOST: '127.0.0.1',
  });

  it('takes a source and an operation, never a URL or a host', async () => {
    const asked: unknown[] = [];
    const recording = {
      reference: (request: unknown) => {
        asked.push(request);
        return Promise.resolve({ type: 'found', results: [] });
      },
    } as unknown as Supervisor;
    const server = createConnectorServer({ config, supervisor: recording, log: () => {} });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const post = (body: unknown) =>
      fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/reference`, {
        method: 'POST',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    try {
      const request = {
        requestId: randomUUID(),
        tenant: TENANT,
        source: 'crossref',
        op: 'search',
        query: 'marsh',
      };
      const answered = await post(request);
      expect(answered.status).toBe(200);
      expect(await answered.json()).toEqual({ type: 'found', results: [] });
      expect(asked).toEqual([request]);
      for (const extra of [{ url: 'https://10.0.0.1/works' }, { host: '10.0.0.1' }]) {
        const refused = await post({ ...request, ...extra });
        expect(refused.status).toBe(400);
      }
      expect(asked).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("the connector's reference key (the XR plan, XR-E)", () => {
  const SERVICE_KEY = Buffer.alloc(32, 1).toString('base64');
  const DELIVER_KEY = Buffer.alloc(32, 5).toString('base64');
  const REFERENCE_KEY = Buffer.alloc(32, 6).toString('base64');
  let url = '';
  let close = () => Promise.resolve();

  beforeAll(async () => {
    const server = createConnectorServer({
      config: loadConnectorConfig({
        CONNECTOR_KEY: SERVICE_KEY,
        CONNECTOR_SEALING_KEY: SEALING_KEY.toString('base64'),
        CONNECTOR_DELIVER_KEY: DELIVER_KEY,
        CONNECTOR_REFERENCE_KEY: REFERENCE_KEY,
        CONNECTOR_DENY: 'none',
        LOG_LEVEL: 'silent',
      }),
      supervisor,
      log: () => {},
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
    close = () => new Promise((resolve) => server.close(() => resolve()));
  });
  afterAll(() => close());

  const post = (path: string, body: unknown, key: string) =>
    fetch(`${url}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const check = {
    requestId: randomUUID(),
    tenant: TENANT,
    source: 'pubmed',
    op: 'check',
    identifier: '99000002',
  };

  it('opens a check alone to the reference key, which no other path takes', async () => {
    const checked = await post('/v1/reference', check, REFERENCE_KEY);
    expect(checked.status).toBe(200);
    expect(await checked.json()).toMatchObject({ type: 'found' });
    // A search sends terms, which the sweep never does.
    expect(
      (
        await post(
          '/v1/reference',
          { ...check, op: 'search', identifier: undefined, query: 'dunnart' },
          REFERENCE_KEY,
        )
      ).status,
    ).toBe(403);
    expect((await post('/v1/reference', check, DELIVER_KEY)).status).toBe(401);
    for (const path of ['/v1/embed', '/v1/deliver', '/v1/seal', '/v1/run', '/v1/manifest']) {
      expect((await post(path, { tenant: TENANT }, REFERENCE_KEY)).status, path).toBe(401);
    }
  });

  it('refuses a reference key that is one of the others', () => {
    expect(() =>
      loadConnectorConfig({
        CONNECTOR_KEY: SERVICE_KEY,
        CONNECTOR_SEALING_KEY: SEALING_KEY.toString('base64'),
        CONNECTOR_DELIVER_KEY: DELIVER_KEY,
        CONNECTOR_REFERENCE_KEY: DELIVER_KEY,
        CONNECTOR_DENY: 'none',
      }),
    ).toThrow(/CONNECTOR_REFERENCE_KEY/);
  });
});
