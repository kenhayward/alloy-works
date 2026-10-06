import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadConnectorConfig, takeConnectorConfig } from './config.js';

const KEY = Buffer.alloc(32, 1).toString('base64');
const SEALING = Buffer.alloc(32, 2).toString('base64');
const base = { CONNECTOR_KEY: KEY, CONNECTOR_SEALING_KEY: SEALING, CONNECTOR_DENY: 'none' };

/** The message a configuration is refused with. */
function refusal(env: Record<string, string | undefined>): string {
  try {
    loadConnectorConfig(env);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('Expected a refusal');
}

describe("the connector's configuration", () => {
  it('takes the defaults the plan sets, and what it is told', () => {
    const config = loadConnectorConfig(base);
    expect(config).toMatchObject({
      port: 8090,
      host: '0.0.0.0',
      deny: [],
      maxChildren: 8,
      logLevel: 'info',
    });
    expect(config.sealingKey.equals(Buffer.alloc(32, 2))).toBe(true);
    expect(
      loadConnectorConfig({
        ...base,
        CONNECTOR_PORT: '9000',
        CONNECTOR_HOST: '127.0.0.1',
        CONNECTOR_DENY: '172.31.10.0/24, fd00::/8',
        CONNECTOR_MAX_CHILDREN: '2',
        LOG_LEVEL: 'silent',
      }),
    ).toMatchObject({
      port: 9000,
      host: '127.0.0.1',
      deny: ['172.31.10.0/24', 'fd00::/8'],
      maxChildren: 2,
      logLevel: 'silent',
    });
  });

  it('reads its two keys once and deletes them from the environment it read them from', () => {
    const env: Record<string, string | undefined> = { ...base, LOG_LEVEL: 'error' };
    const config = takeConnectorConfig(env);
    expect(config.logLevel).toBe('error');
    expect(env).toEqual({ CONNECTOR_DENY: 'none', LOG_LEVEL: 'error' });
    // Refused, it still deletes them: nothing is left to a crash report either way.
    const refused: Record<string, string | undefined> = { ...base, CONNECTOR_DENY: undefined };
    expect(() => takeConnectorConfig(refused)).toThrow(/CONNECTOR_DENY/);
    expect(refused).not.toHaveProperty('CONNECTOR_KEY');
    expect(refused).not.toHaveProperty('CONNECTOR_SEALING_KEY');
  });

  it("reads a development source's certificate authority from a file, and none by default", () => {
    const pem = readFileSync(
      fileURLToPath(new URL('../../../deploy/sources/http/ca.pem', import.meta.url)),
      'utf8',
    );
    expect(loadConnectorConfig(base).ca).toBeUndefined();
    const read = (path: string) => {
      if (path === '/run/ca.pem') return pem;
      if (path === '/run/junk.pem') return 'not a certificate';
      throw new Error('ENOENT');
    };
    expect(loadConnectorConfig({ ...base, CONNECTOR_CA_FILE: '/run/ca.pem' }, read).ca).toBe(pem);
    for (const path of ['/run/junk.pem', '/run/missing.pem']) {
      const message = (() => {
        try {
          loadConnectorConfig({ ...base, CONNECTOR_CA_FILE: path }, read);
        } catch (error) {
          return (error as Error).message;
        }
        return '';
      })();
      expect(message, path).toBe('CONNECTOR_CA_FILE must name a readable file of PEM certificates');
    }
  });

  it('refuses to start without its keys or its deny list, naming the variable and never its value', () => {
    const cases: [Record<string, string | undefined>, string][] = [
      [{ ...base, CONNECTOR_KEY: undefined }, 'CONNECTOR_KEY'],
      [{ ...base, CONNECTOR_KEY: 'c2hvcnQta2V5LXRoYXQtaXMtbm90LTMy' }, 'CONNECTOR_KEY'],
      [{ ...base, CONNECTOR_SEALING_KEY: undefined }, 'CONNECTOR_SEALING_KEY'],
      [{ ...base, CONNECTOR_SEALING_KEY: 'bm90LWEta2V5' }, 'CONNECTOR_SEALING_KEY'],
      [{ ...base, CONNECTOR_SEALING_KEY: KEY }, 'CONNECTOR_SEALING_KEY'],
      [{ ...base, CONNECTOR_DENY: undefined }, 'CONNECTOR_DENY'],
      [{ ...base, CONNECTOR_DENY: '' }, 'CONNECTOR_DENY'],
      [{ ...base, CONNECTOR_DENY: '172.31.10.0/33' }, 'CONNECTOR_DENY'],
      [{ ...base, CONNECTOR_DENY: 'platform.example.test' }, 'CONNECTOR_DENY'],
      [{ ...base, CONNECTOR_PORT: '0' }, 'CONNECTOR_PORT'],
      [{ ...base, CONNECTOR_MAX_CHILDREN: '0' }, 'CONNECTOR_MAX_CHILDREN'],
      [{ ...base, LOG_LEVEL: 'everything' }, 'LOG_LEVEL'],
    ];
    for (const [env, variable] of cases) {
      const message = refusal(env);
      expect(message, variable).toContain(variable);
      for (const value of Object.values(env)) {
        if (value && value.length > 4 && value !== 'none')
          expect(message, variable).not.toContain(value);
      }
    }
  });
});
