import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { environmentSecrets, serviceSealingKey } from './secrets.js';

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
});
