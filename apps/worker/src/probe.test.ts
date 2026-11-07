import { describe, expect, it } from 'vitest';
import { loadWorkerConfig } from './config.js';
import { probeService } from './probe.js';

const URL = 'http://service:8088/health';
const AT = new Date('2026-11-07T12:00:20Z');

function recorder() {
  const recorded: [Date, boolean][] = [];
  return { recorded, record: async (at: Date, up: boolean) => void recorded.push([at, up]) };
}

describe('the worker probing the service each minute (the DG plan, pre-flight 1; ADR-0101)', () => {
  it('records the minute up when the service answers its health 200, and down otherwise', async () => {
    const { recorded, record } = recorder();
    const answers = [
      async () => new Response('{"status":"ok"}', { status: 200 }),
      async () => new Response('{"status":"unavailable"}', { status: 503 }),
      async () => {
        throw new TypeError('fetch failed');
      },
    ];
    for (const answer of answers) {
      await probeService({ url: URL, fetch: answer as typeof fetch, record, now: () => AT });
    }
    expect(recorded).toEqual([
      [AT, true],
      [AT, false],
      [AT, false],
    ]);
  });

  it('gives up on a service that does not answer within its time, as down', async () => {
    const { recorded, record } = recorder();
    const hangs = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
      )) as typeof fetch;
    await probeService({ url: URL, fetch: hangs, record, now: () => AT, timeoutMs: 20 });
    expect(recorded).toEqual([[AT, false]]);
  });

  it('probes where it is told, and nowhere when told nowhere', () => {
    const env = {
      DATABASE_URL: 'postgres://aw_worker:pw@127.0.0.1:5432/alloy_dev',
      OBJECT_STORE_ENDPOINT: 'http://127.0.0.1:8333',
      OBJECT_STORE_BUCKET: 'alloy-dev',
      SECRET_OBJECT_STORE_KEY: Buffer.alloc(32).toString('base64'),
    };
    expect(loadWorkerConfig(env).serviceHealthUrl).toBeUndefined();
    expect(loadWorkerConfig({ ...env, SERVICE_HEALTH_URL: URL }).serviceHealthUrl).toBe(URL);
  });
});
