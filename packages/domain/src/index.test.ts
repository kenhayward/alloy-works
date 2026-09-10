import { describe, expect, it } from 'vitest';

import * as domain from './index.js';

describe('the domain package', () => {
  it('exports the component model as its public surface', () => {
    expect(Object.keys(domain).sort()).toEqual([
      'componentSchema',
      'componentTypes',
      'createComponent',
      'parseComponent',
      'reviseComponent',
    ]);
  });
});
