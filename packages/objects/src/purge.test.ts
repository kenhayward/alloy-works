import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteTenantObjects } from './provision.js';

const TENANT = { id: 'acme', schema: 't_acme', role: 't_acme' };

describe('deleting a tenant from a store that refuses (the TL plan, TLc)', () => {
  let server: Server;
  let deletes = 0;

  beforeAll(async () => {
    // The answer S3 gives with a 200: the request worked, and each key says for itself.
    server = createServer((request, response) => {
      request.resume();
      request.on('end', () => {
        response.setHeader('content-type', 'application/xml');
        if (request.method === 'POST') {
          deletes += 1;
          response.end(
            '<DeleteResult><Error><Key>t_acme/a</Key><Code>AccessDenied</Code><Message>No</Message></Error></DeleteResult>',
          );
        } else {
          response.end(
            '<ListBucketResult><KeyCount>1</KeyCount><Contents><Key>t_acme/a</Key></Contents></ListBucketResult>',
          );
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it('IAM-086 stops and says so when a key would not go, rather than asking for ever', async () => {
    const { port } = server.address() as AddressInfo;
    await expect(
      deleteTenantObjects(
        { endpoint: `http://127.0.0.1:${port}`, region: 'us-east-1', bucket: 'b' },
        { accessKeyId: 'k', secretAccessKey: 's' },
        TENANT,
      ),
    ).rejects.toThrow(/would not go/);
    expect(deletes).toBe(1);
  }, 10_000);
});
