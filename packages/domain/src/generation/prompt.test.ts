import { describe, expect, it } from 'vitest';

import {
  parsePrompt,
  parsePromptForWrite,
  placeParameters,
  PromptRefused,
  type Prompt,
} from './prompt.js';

const TYPE = '0b6f6a4e-8f4e-4c2b-9a51-3a3b1d1f2c01';
const FIELD = '0b6f6a4e-8f4e-4c2b-9a51-3a3b1d1f2c02';

const prompt = (over: Partial<Prompt> = {}): Prompt => ({
  schemaVersion: 1,
  title: 'Summarise the section',
  description: '',
  instructions: 'Summarise for {{audience}}.',
  context: [
    { source: 'outline', scope: 'section' },
    { source: 'parameters', names: ['audience'] },
  ],
  output: { componentType: null },
  models: { purpose: 'drafting', accepts: ['claude-sonnet-5-5'] },
  ...over,
});

const problems = (value: unknown) => {
  try {
    parsePromptForWrite(value);
  } catch (error) {
    if (error instanceof PromptRefused) return error.problems.map((each) => each.path);
    throw error;
  }
  return [];
};

describe('a prompt version', () => {
  it('GEN-056 declares its context by outline position, relationship, metadata match and parameters', () => {
    const value = prompt({
      context: [
        { source: 'outline', scope: 'part' },
        { source: 'related', type: TYPE, direction: 'out' },
        { source: 'field', field: FIELD, value: 'Ready' },
        { source: 'parameters', names: ['audience'] },
      ],
    });
    expect(parsePromptForWrite(value)).toEqual(value);
  });

  it('is refused with no context, no model or an embedding purpose', () => {
    expect(problems(prompt({ context: [] }))).toEqual(['context']);
    expect(problems(prompt({ models: { purpose: 'drafting', accepts: [] } }))).toEqual([
      'models.accepts',
    ]);
    expect(problems({ ...prompt(), models: { purpose: 'embedding', accepts: ['a'] } })).toEqual([
      'models.purpose',
    ]);
  });

  it('is refused placing a parameter its context does not declare', () => {
    expect(problems(prompt({ instructions: 'For {{audience}} in {{region}}.' }))).toEqual([
      'instructions',
    ]);
  });

  it('is refused declaring a source or parameter twice, or two outline sources', () => {
    expect(
      problems(
        prompt({
          context: [
            { source: 'parameters', names: ['audience'] },
            { source: 'parameters', names: ['audience'] },
          ],
        }),
      ),
    ).toEqual(['context']);
    expect(
      problems(
        prompt({
          context: [
            { source: 'outline', scope: 'part' },
            { source: 'outline', scope: 'document' },
            { source: 'parameters', names: ['audience'] },
          ],
        }),
      ),
    ).toEqual(['context']);
  });

  it('reads a stored version by its shape alone', () => {
    const stored = prompt({ instructions: 'For {{region}}.' });
    expect(parsePrompt(stored)).toEqual(stored);
    expect(() => parsePrompt({ ...stored, extra: true })).toThrow(PromptRefused);
  });
});

describe('placeParameters', () => {
  it('fills each place with its value, a list joined, an absent one empty', () => {
    expect(
      placeParameters('For {{ audience }} in {{regions}}{{missing}}.', {
        audience: 'engineers',
        regions: ['north', 'south'],
      }),
    ).toBe('For engineers in north, south.');
  });
});
