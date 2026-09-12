import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { followStream } from './stream.js';

describe("following an environment's stream", () => {
  let server: Server;
  let address = '';
  let connections = 0;

  beforeAll(async () => {
    server = createServer((request, response) => {
      connections += 1;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('retry: 20\n\n');
      response.write(': alive\n\n');
      response.write(
        `event: snapshot\ndata: ${JSON.stringify({ samples: [{ id: 'a', state: 'queued' }] })}\n\n`,
      );
      response.write(
        `event: sample\ndata: ${JSON.stringify({ kind: 'sample', id: 'a', state: 'done' })}\n\n`,
      );
      // The first connection is dropped, so a following one proves it comes back.
      if (connections === 1) setTimeout(() => response.destroy(), 30);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('reads the snapshot and what follows, and comes back after a drop', async () => {
    const snapshots: unknown[] = [];
    const samples: unknown[] = [];
    const stop = followStream({
      url: `${address}/v1/stream`,
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      onSample: (sample) => samples.push(sample),
      retryMs: 10,
    });
    try {
      await vi.waitFor(() => expect(snapshots.length).toBeGreaterThan(1), { timeout: 3000 });
      expect(snapshots[0]).toEqual({ samples: [{ id: 'a', state: 'queued' }] });
      expect(samples[0]).toEqual({ kind: 'sample', id: 'a', state: 'done' });
    } finally {
      stop();
    }
  });

  it('stops when it is told to, and asks for nothing more', async () => {
    const before = connections;
    const stop = followStream({
      url: `${address}/v1/stream`,
      onSnapshot: () => {},
      onSample: () => {},
      retryMs: 10,
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    stop();
    const after = connections;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(connections).toBe(after);
    expect(after).toBeGreaterThan(before);
  });
});
