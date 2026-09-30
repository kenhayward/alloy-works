import { describe, expect, it } from 'vitest';

import type { Parameter } from './definition.js';
import { checkParameterValues, type ParameterValues } from './parameters.js';

const parameters: Parameter[] = [
  { name: 'label', type: { base: 'text' }, required: true, list: false },
  {
    name: 'site',
    type: { base: 'integer' },
    required: false,
    list: false,
    permitted: { minimum: '1', maximum: '100' },
  },
  {
    name: 'amount',
    type: { base: 'decimal', precision: 6, scale: 2 },
    required: false,
    list: false,
  },
  { name: 'since', type: { base: 'instant', fraction: 3 }, required: false, list: false },
  { name: 'local', type: { base: 'localDateTime', fraction: 0 }, required: false, list: false },
  {
    name: 'region',
    type: { base: 'text' },
    required: false,
    list: false,
    permitted: { values: ['north', 'south'] },
  },
  { name: 'ids', type: { base: 'integer' }, required: false, list: true },
  {
    name: 'sort',
    type: { base: 'text' },
    required: false,
    list: false,
    variation: [{ key: 'taken', sql: 'taken, id' }],
  },
  { name: 'active', type: { base: 'boolean' }, required: false, list: false },
];

const check = (values: ParameterValues) => checkParameterValues(parameters, values);

describe('a parameter value against its declaration', () => {
  it('takes values in their canonical form', () => {
    expect(
      check({
        label: 'North weir',
        site: '1',
        amount: '-9999.99',
        since: '2026-09-30T08:00:00.123Z',
        local: '2026-09-30T08:00:00',
        region: 'south',
        ids: ['1', '9223372036854775807'],
        sort: 'taken',
        active: false,
      }),
    ).toEqual([]);
    // An optional parameter may be left out or null; a list may be empty.
    expect(check({ label: '', site: null, ids: [] })).toEqual([]);
  });

  it('names the parameter, the rule and the value of each that fails, one case per rule', () => {
    const cases: readonly [ParameterValues, string, string, string][] = [
      [{}, 'label', 'required', ''],
      [{ label: null }, 'label', 'required', 'null'],
      [{ label: 7 as never }, 'label', 'type', '7'],
      [{ label: `a${String.fromCharCode(0)}` }, 'label', 'type', `a${String.fromCharCode(0)}`],
      [{ label: String.fromCharCode(0xd800) }, 'label', 'type', String.fromCharCode(0xd800)],
      [{ label: 'x'.repeat(1001) }, 'label', 'range', 'x'.repeat(1000)],
      [{ label: 'a', site: '1.5' }, 'site', 'type', '1.5'],
      [{ label: 'a', site: '01' }, 'site', 'type', '01'],
      [{ label: 'a', site: 1 as never }, 'site', 'type', '1'],
      [{ label: 'a', site: '101' }, 'site', 'range', '101'],
      [{ label: 'a', site: '0' }, 'site', 'range', '0'],
      [{ label: 'a', ids: ['9223372036854775808'] }, 'ids', 'range', '["9223372036854775808"]'],
      [{ label: 'a', amount: '10000' }, 'amount', 'precision', '10000'],
      [{ label: 'a', amount: '1.005' }, 'amount', 'scale', '1.005'],
      [{ label: 'a', amount: '1.50' }, 'amount', 'type', '1.50'],
      [{ label: 'a', since: '2026-09-30T08:00:00' }, 'since', 'zone', '2026-09-30T08:00:00'],
      [
        { label: 'a', since: '2026-09-30T08:00:00+01:00' },
        'since',
        'zone',
        '2026-09-30T08:00:00+01:00',
      ],
      [
        { label: 'a', since: '2026-09-30T08:00:00.1234Z' },
        'since',
        'precision',
        '2026-09-30T08:00:00.1234Z',
      ],
      [{ label: 'a', local: '2026-09-30T08:00:00Z' }, 'local', 'zone', '2026-09-30T08:00:00Z'],
      [
        { label: 'a', local: '2026-09-30T08:00:00.5' },
        'local',
        'precision',
        '2026-09-30T08:00:00.5',
      ],
      [{ label: 'a', region: 'NORTH' }, 'region', 'permitted', 'NORTH'],
      [{ label: 'a', ids: '1' }, 'ids', 'list', '1'],
      [{ label: 'a', site: ['1'] }, 'site', 'list', '["1"]'],
      [{ label: 'a', ids: [null] }, 'ids', 'list', '[null]'],
      [{ label: 'a', ids: [['1']] as never }, 'ids', 'list', '[["1"]]'],
      [
        { label: 'a', ids: Array.from({ length: 51 }, (_, i) => String(i)) },
        'ids',
        'list',
        JSON.stringify(Array.from({ length: 51 }, (_, i) => String(i))),
      ],
      [{ label: 'a', sort: 'label' }, 'sort', 'variation', 'label'],
      [{ label: 'a', sort: '__proto__' }, 'sort', 'variation', '__proto__'],
      [{ label: 'a', sort: 'constructor' }, 'sort', 'variation', 'constructor'],
      [{ label: 'a', active: 'true' as never }, 'active', 'type', 'true'],
      [{ label: 'a', undeclared: '1' }, 'undeclared', 'type', '1'],
    ];
    for (const [values, parameter, rule, value] of cases) {
      expect(check(values), `${parameter} ${rule} ${value.slice(0, 40)}`).toEqual([
        { parameter, rule, value },
      ]);
    }
  });
});
