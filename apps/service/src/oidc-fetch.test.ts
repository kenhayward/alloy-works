import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { customFetch, discovery } from 'openid-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  guardedProviderAddress,
  guardedProviderFetch,
  ProviderAddressRefused,
  refusedProviderAddress,
} from './oidc-fetch.js';

/** The name the development certificate has (deploy/sources/http). */
const NAME = 'localhost';

describe('where an identity provider may be reached', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
    '::7f00:1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::',
    'not an address',
  ])('refuses %s', (address) => {
    expect(refusedProviderAddress(address)).toBe(true);
  });

  it.each(['142.250.0.1', '8.8.8.8', '2606:4700::1111'])('allows %s', (address) => {
    expect(refusedProviderAddress(address)).toBe(false);
  });

  it('refuses a name with any address refused, and one with none', async () => {
    const answers =
      (...addresses: string[]) =>
      async () =>
        addresses.map((address) => ({ address, family: 4 }));
    await expect(
      guardedProviderAddress('idp.example', answers('8.8.8.8', '10.0.0.1')),
    ).rejects.toBeInstanceOf(ProviderAddressRefused);
    await expect(guardedProviderAddress('idp.example', answers())).rejects.toBeInstanceOf(
      ProviderAddressRefused,
    );
    expect(await guardedProviderAddress('idp.example', answers('8.8.8.8'))).toEqual({
      address: '8.8.8.8',
      family: 4,
    });
  });

  it('refuses a literal address, however it is spelt, and a host in brackets', async () => {
    const nobody = async () => {
      throw new Error('nothing to look up');
    };
    const fetcher = guardedProviderFetch({ lookup: nobody });
    for (const url of [
      'https://127.0.0.1/.well-known/openid-configuration',
      'https://0x7f.0.0.1/',
      'https://2130706433/',
      'https://[::1]/',
      'https://[::ffff:a9fe:a9fe]/latest/meta-data',
    ]) {
      await expect(fetcher(url)).rejects.toBeInstanceOf(ProviderAddressRefused);
    }
  });

  it('refuses anything but HTTPS before looking the host up', async () => {
    const fetcher = guardedProviderFetch({
      lookup: async () => {
        throw new Error('looked up');
      },
    });
    await expect(fetcher('http://idp.example/')).rejects.toBeInstanceOf(ProviderAddressRefused);
  });

  describe('the exchange it makes', () => {
    const certs = new URL('../../../deploy/sources/http/', import.meta.url);
    const read = (name: string) => readFileSync(fileURLToPath(new URL(name, certs)));
    let server: Server;
    let port: number;
    const seen: { method: string; body: string; host: string }[] = [];

    beforeAll(async () => {
      server = createServer(
        { key: read('server-key.pem'), cert: read('server.pem') },
        (ask, say) => {
          let body = '';
          ask.on('data', (part: Buffer) => (body += part.toString()));
          ask.on('end', () => {
            seen.push({ method: ask.method!, body, host: ask.headers.host! });
            if (ask.url === '/moved') {
              say.writeHead(302, { location: 'https://169.254.169.254/' });
              say.end();
              return;
            }
            say.writeHead(200, { 'content-type': 'application/json' });
            say.end(
              JSON.stringify(
                ask.url === '/issuer/.well-known/openid-configuration'
                  ? { issuer: at('/issuer'), token_endpoint: at('/token') }
                  : { issuer: 'theirs' },
              ),
            );
          });
        },
      );
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = (server.address() as AddressInfo).port;
    });

    afterAll(() => new Promise((resolve) => server.close(resolve)));

    /** Allows the test's own server, and only by the name its certificate has. */
    const fetcher = (answer = '127.0.0.1') =>
      guardedProviderFetch({
        ca: read('ca.pem'),
        lookup: async () => [{ address: answer, family: 4 }],
        refuses: (address) => address !== '127.0.0.1',
      });
    const at = (path: string) => `https://${NAME}:${port}${path}`;

    it('reads a provider over TLS by the name it checked, and sends a form', async () => {
      const answer = await fetcher()(at('/.well-known/openid-configuration'));
      expect(answer.status).toBe(200);
      expect(await answer.json()).toEqual({ issuer: 'theirs' });
      const posted = await fetcher()(at('/token'), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: 'a-code' }),
      });
      expect(posted.status).toBe(200);
      expect(seen.at(-1)).toMatchObject({ method: 'POST', body: 'code=a-code' });
    });

    it('carries openid-client through a discovery, as every provider in production is reached', async () => {
      const found = await discovery(new URL(at('/issuer')), 'alloy', undefined, undefined, {
        [customFetch]: fetcher(),
      });
      expect(found.serverMetadata().token_endpoint).toBe(at('/token'));
    });

    it('follows no redirect, so a provider cannot send it somewhere refused', async () => {
      const answer = await fetcher()(at('/moved'));
      expect(answer.status).toBe(302);
      expect(answer.headers.get('location')).toBe('https://169.254.169.254/');
    });

    it('dials nothing where the name answers an address refused', async () => {
      const before = seen.length;
      await expect(fetcher('10.0.0.1')(at('/'))).rejects.toBeInstanceOf(ProviderAddressRefused);
      expect(seen.length).toBe(before);
    });
  });
});
