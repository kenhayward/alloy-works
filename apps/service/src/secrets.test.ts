import { describe, expect, it } from 'vitest';
import { environmentSecrets } from './secrets.js';

describe('the environment secret store', () => {
  it('reads a named secret from SECRET_ and the name in capitals', () => {
    const secrets = environmentSecrets({ SECRET_STAND_IN: 'stand-in-dev-secret' });
    expect(secrets.get('stand_in')).toBe('stand-in-dev-secret');
  });

  it('has nothing for a name it was not given', () => {
    expect(environmentSecrets({}).get('stand_in')).toBeUndefined();
  });
});
