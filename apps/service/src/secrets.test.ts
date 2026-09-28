import { describe, expect, it } from 'vitest';
import { environmentSecrets } from './secrets.js';

describe('the environment secret store', () => {
  it('reads a named secret from SECRET_ and the name in capitals', () => {
    const secrets = environmentSecrets({ SECRET_SIGN_IN_STATE: 'a-development-state-key' });
    expect(secrets.get('sign_in_state')).toBe('a-development-state-key');
  });

  it('has nothing for a name it was not given', () => {
    expect(environmentSecrets({}).get('sign_in_state')).toBeUndefined();
  });
});
