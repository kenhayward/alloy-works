import { describe, expect, it } from 'vitest';

import type { Binding } from './binding.js';
import { questionUnchanged } from './question.js';

/**
 * `questionUnchanged` (the B2 plan, B2-E): whether a binding asks the question its held result
 * answers - the definition, the parameters, and the version it resolves to - so Keep may hold it.
 */

const QUERY = '00000000-0000-4000-8000-00000000d001';
const OTHER = '00000000-0000-4000-8000-00000000d002';
const V1 = '00000000-0000-4000-8000-00000000e001';
const V2 = '00000000-0000-4000-8000-00000000e002';

const binding = (over: Partial<Binding> = {}): Binding => ({
  type: 'binding',
  id: 'k1',
  query: QUERY,
  parameters: { site: { literal: 'north' }, depth: { literal: null } },
  mode: 'checked',
  take: { column: 'depth' },
  ...over,
});

const held = {
  queryDefinition: { artifact: QUERY, version: V1 },
  parameters: { site: 'north' },
};

describe('whether a changed binding still asks the question its held result answers', () => {
  it('is unchanged where only the take or the mode changed', () => {
    expect(questionUnchanged(binding(), held, V1)).toBe(true);
    expect(questionUnchanged(binding({ take: { column: 'site' } }), held, V1)).toBe(true);
    expect(questionUnchanged(binding({ mode: 'pinned' }), held, V1)).toBe(true);
    expect(questionUnchanged(binding({ version: V1 }), held, V2)).toBe(true);
  });

  it('is changed by another definition, other parameters, another pin, or a definition moved on', () => {
    expect(questionUnchanged(binding({ query: OTHER }), held, V1)).toBe(false);
    expect(
      questionUnchanged(binding({ parameters: { site: { literal: 'south' } } }), held, V1),
    ).toBe(false);
    expect(questionUnchanged(binding({ parameters: {} }), held, V1)).toBe(false);
    expect(questionUnchanged(binding({ version: V2 }), held, V1)).toBe(false);
    expect(questionUnchanged(binding(), held, V2)).toBe(false);
    expect(
      questionUnchanged(binding({ parameters: { site: { document: 'site' } } }), held, V1),
    ).toBe(false);
  });
});
