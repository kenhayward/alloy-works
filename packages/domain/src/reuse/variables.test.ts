import { describe, expect, it } from 'vitest';

import type { ContentDocument } from '../content/model/document.js';
import { DEFAULT_VALUE_FORMATS } from '../theme/default.js';
import {
  printVariables,
  printTitleVariables,
  resolveVariable,
  variableDefinitionSchema,
  type VariableDefinition,
} from './variables.js';

const FIELD = '00000000-0000-4000-8000-00000000f001';
const reviewed: VariableDefinition = variableDefinitionSchema.parse({
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-00000000a001',
  name: 'Review date',
  key: 'review_date',
  type: { base: 'date' },
  sources: { parameter: 'review', field: FIELD },
  forms: {
    title: { date: { order: 'ymd', separator: '-', pad: true } },
    text: { date: { order: 'dmy', separator: '/', pad: false } },
  },
});
const text = (value: string) => ({ type: 'text' as const, value, marks: [] });

describe('variables (the R5 plan, R5-A to R5-E)', () => {
  it('REU-018 is declared: a key, a value type and its sources, at least one', () => {
    expect(reviewed.key).toBe('review_date');
    expect(variableDefinitionSchema.safeParse({ ...reviewed, key: 'Review Date' }).success).toBe(
      false,
    );
    expect(variableDefinitionSchema.safeParse({ ...reviewed, sources: {} }).success).toBe(false);
  });

  it('takes the parameter set before the metadata, and says which supplied it', () => {
    expect(
      resolveVariable(reviewed, {
        parameters: { review: '2026-11-03' },
        values: { [FIELD]: '2026-12-01' },
      }),
    ).toEqual({ value: '2026-11-03', source: 'parameter' });
    expect(
      resolveVariable(reviewed, { parameters: {}, values: { [FIELD]: '2026-12-01' } }),
    ).toEqual({
      value: '2026-12-01',
      source: 'metadata',
    });
    // Nothing, or a value its type refuses: unresolved.
    expect(resolveVariable(reviewed, { parameters: {}, values: {} })).toBeUndefined();
    expect(
      resolveVariable(reviewed, { parameters: { review: 'soon' }, values: {} }),
    ).toBeUndefined();
  });

  it('REU-019 REU-017 prints by context, records where each came from, and fails by name rather than print a name or nothing', () => {
    const content = {
      schemaVersion: 1,
      title: 'Review',
      language: 'en-GB',
      direction: 'ltr',
      content: [
        {
          type: 'paragraph',
          id: 'p1',
          style: 'body',
          content: [text('Next review: '), { type: 'variable', name: 'review_date' }, text('.')],
        },
        {
          type: 'paragraph',
          id: 'p2',
          style: 'body',
          content: [{ type: 'variable', name: 'site' }],
        },
      ],
    } as unknown as ContentDocument;
    const definitions = new Map([[reviewed.key, reviewed]]);
    const context = { parameters: { review: '2026-11-03' }, values: {} };
    const printed = printVariables('n1', content, definitions, context, DEFAULT_VALUE_FORMATS);
    expect(printed.content.content[0]).toMatchObject({
      content: [text('Next review: '), text('3/11/2026'), text('.')],
    });
    expect(printed.printed).toEqual([
      {
        node: 'n1',
        block: 'p1',
        key: 'review_date',
        source: 'parameter',
        value: '2026-11-03',
        printed: '3/11/2026',
      },
    ]);
    expect(printed.failures).toEqual([
      { stage: 'bind', code: 'variable_unresolved', node: 'n1', block: 'p2', detail: 'site' },
    ]);

    const title = printTitleVariables(
      's1',
      [text('Review of '), { type: 'variable', name: 'review_date' }] as never,
      definitions,
      context,
      DEFAULT_VALUE_FORMATS,
    );
    expect(title.title).toEqual([text('Review of '), text('2026-11-03')]);
  });
});
