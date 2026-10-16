import { describe, expect, it } from 'vitest';

import { DEFINITION_SCHEMA_VERSION } from '../metadata/definition.js';
import { checkTemplateParameters, templateParameterSchema } from '../template/parameters.js';

import { resolveVariable, variableDefinitionSchema, type VariableContext } from './variables.js';

const FIELD = '00000000-0000-4000-8000-00000000f001';
const DEPTHS = '00000000-0000-4000-8000-00000000d001';
const variable = (sources: Record<string, unknown>, key = 'site') =>
  variableDefinitionSchema.parse({
    schemaVersion: DEFINITION_SCHEMA_VERSION,
    id: '00000000-0000-4000-8000-00000000a001',
    name: 'Site',
    key,
    type: { base: 'text' },
    sources,
  });
const result = (rows: string[][]) => ({
  result: { columns: [['site', 'text'] as const, ['depth', 'text'] as const], rows },
});
const context = (over: Partial<VariableContext> = {}): VariableContext => ({
  parameters: {},
  values: {},
  ...over,
});

describe('where a variable takes its value from (the R10 plan, R10-A to R10-C)', () => {
  it('REU-016 REU-038 takes the parameter, then the metadata, then the query result, and says which supplied it', () => {
    const site = variable({
      parameter: 'site',
      field: FIELD,
      query: { definition: DEPTHS, column: 'site' },
    });
    const all = context({
      parameters: { site: 'North Quay' },
      values: { [FIELD]: 'South Quay' },
      results: new Map([[DEPTHS, [result([['East Quay', '4']])]]]),
    });
    expect(resolveVariable(site, all)).toEqual({ value: 'North Quay', source: 'parameter' });
    expect(resolveVariable(site, { ...all, parameters: {} })).toEqual({
      value: 'South Quay',
      source: 'metadata',
    });
    expect(resolveVariable(site, { ...all, parameters: {}, values: {} })).toEqual({
      value: 'East Quay',
      source: 'query',
    });
  });

  it('REU-016 takes a query result only where the document holds one, of one row, that every holding agrees on', () => {
    const site = variable({ query: { definition: DEPTHS, column: 'site' } });
    expect(resolveVariable(site, context())).toBeUndefined();
    expect(
      resolveVariable(
        site,
        context({
          results: new Map([
            [
              DEPTHS,
              [
                result([
                  ['A', '1'],
                  ['B', '2'],
                ]),
              ],
            ],
          ]),
        }),
      ),
    ).toBeUndefined();
    expect(
      resolveVariable(
        site,
        context({ results: new Map([[DEPTHS, [result([['A', '1']]), result([['B', '1']])]]]) }),
      ),
    ).toBeUndefined();
    expect(
      resolveVariable(
        site,
        context({ results: new Map([[DEPTHS, [result([['A', '1']]), result([['A', '2']])]]]) }),
      ),
    ).toEqual({ value: 'A', source: 'query' });
  });

  it('TPL-067 TPL-069 takes its parameter from the one the template says feeds it, over the name the variable gives', () => {
    const site = variable({ parameter: 'site' });
    const fed = context({
      parameters: { site: 'Named', location: 'Mapped' },
      feeds: new Map([['site', 'location']]),
    });
    expect(resolveVariable(site, fed)).toEqual({ value: 'Mapped', source: 'parameter' });
    // Where the template feeds this key from no parameter, the variable's own name is read.
    expect(resolveVariable(site, { ...fed, feeds: new Map() })).toEqual({
      value: 'Named',
      source: 'parameter',
    });
  });

  it('TPL-069 refuses a template parameter feeding a variable not declared, or of a type it does not take, and counts feeding one as a use', () => {
    const parameter = (name: string, base: string, variables: string[]) =>
      templateParameterSchema.parse({
        name,
        type: { base },
        required: false,
        list: false,
        changeable: true,
        feeds: { arguments: false, variables },
      });
    const declared = new Map([['site', variable({ parameter: 'site' })]]);
    expect(
      checkTemplateParameters([parameter('location', 'text', ['site'])], [], declared),
    ).toEqual([]);
    expect(
      checkTemplateParameters(
        [parameter('count', 'integer', ['site']), parameter('where', 'text', ['nowhere'])],
        [],
        declared,
      ).map((each) => [each.code, each.parameter]),
    ).toEqual([
      ['parameter_variable', 'count'],
      ['parameter_variable', 'where'],
    ]);
    // Two parameters feeding one variable would race: each is named.
    expect(
      checkTemplateParameters(
        [parameter('a', 'text', ['site']), parameter('b', 'text', ['site'])],
        [],
        declared,
      ).map((each) => [each.code, each.parameter]),
    ).toEqual([
      ['parameter_variable', 'a'],
      ['parameter_variable', 'b'],
    ]);
  });
});
