import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { connectorSettings, environmentSecrets, serviceSealingKey } from './secrets.js';

describe('the environment secret store', () => {
  it('reads a named secret from SECRET_ and the name in capitals', () => {
    const secrets = environmentSecrets({ SECRET_SIGN_IN_STATE: 'a-development-state-key' });
    expect(secrets.get('sign_in_state')).toBe('a-development-state-key');
  });

  it('has nothing for a name it was not given', () => {
    expect(environmentSecrets({}).get('sign_in_state')).toBeUndefined();
  });

  it('reads the sealing key, and refuses one missing or the wrong length by the variable, never its value', () => {
    const key = randomBytes(32);
    expect(
      serviceSealingKey(environmentSecrets({ SECRET_OBJECT_STORE_KEY: key.toString('base64') })),
    ).toEqual(key);
    const short = randomBytes(16).toString('base64');
    for (const env of [{}, { SECRET_OBJECT_STORE_KEY: short }]) {
      let message = '';
      try {
        serviceSealingKey(environmentSecrets(env));
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/SECRET_OBJECT_STORE_KEY must be 32 bytes of base64/);
      expect(message).not.toContain(short);
    }
  });

  it("reads the connector's address and key together or neither, naming the variable and never the key", () => {
    const key = randomBytes(32).toString('base64');
    expect(connectorSettings(undefined, environmentSecrets({}))).toBeUndefined();
    expect(
      connectorSettings('http://connector:8090', environmentSecrets({ SECRET_CONNECTOR_KEY: key })),
    ).toEqual({ url: 'http://connector:8090', key });
    const short = randomBytes(16).toString('base64');
    const refusals: [string | undefined, Record<string, string>, RegExp][] = [
      ['http://connector:8090', {}, /CONNECTOR_URL and SECRET_CONNECTOR_KEY must be set together/],
      [undefined, { SECRET_CONNECTOR_KEY: key }, /must be set together/],
      [
        'http://connector:8090',
        { SECRET_CONNECTOR_KEY: short },
        /SECRET_CONNECTOR_KEY must be 32 bytes of base64/,
      ],
    ];
    for (const [url, env, expected] of refusals) {
      let message = '';
      try {
        connectorSettings(url, environmentSecrets(env));
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(expected);
      expect(message).not.toContain(key);
      expect(message).not.toContain(short);
    }
  });
});
