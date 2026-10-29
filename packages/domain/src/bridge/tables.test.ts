import type { ExtractionProvenance } from '@kenhayward/bridge-contract';
import { describe, expect, it } from 'vitest';

import { planTables, type PackageData, type TablePlan } from './tables.js';

const provenance: ExtractionProvenance = {
  sourceSha256: 'abc123',
  sourceFilename: 'Report.pdf',
  jobId: 'job-1',
  recipeId: 'Rate Card',
  recipeVersion: 3,
  approver: { id: 'u1', name: 'Pat', email: null },
  extractedAt: null,
  publishedAt: '2026-10-29T10:00:00.000Z',
};

const PROVENANCE_COLUMNS = [
  'ct_source_sha256',
  'ct_source_filename',
  'ct_job_id',
  'ct_recipe_id',
  'ct_recipe_version',
  'ct_approved_by',
  'ct_published_at',
  'ct_row',
];

const table = (
  id: string,
  columns: [string, string][] = [['a', 'text']],
  rows: Record<string, unknown>[] = [],
) => ({
  id,
  title: null,
  columns: columns.map(([columnId, type]) => ({ id: columnId, title: null, type })),
  rows,
});

const data = (tables: PackageData['tables'], fields: PackageData['fields'] = []): PackageData => ({
  tables,
  fields,
});

const plans = (result: ReturnType<typeof planTables>): TablePlan[] => {
  if (!Array.isArray(result)) throw new Error(`refused: ${result.detail}`);
  return result;
};

describe('data tables planned as Postgres tables', () => {
  it('tableSet defaults to the recipe id', () => {
    const named = plans(planTables(data([table('Prices')]), provenance, undefined));
    expect(named.map((plan) => plan.name)).toEqual(['rate_card_prices', 'rate_card_fields']);
    const empty = plans(planTables(data([table('Prices')]), provenance, ''));
    expect(empty.map((plan) => plan.name)).toEqual(['rate_card_prices', 'rate_card_fields']);
    const given = plans(planTables(data([table('Prices')]), provenance, 'Costs'));
    expect(given.map((plan) => plan.name)).toEqual(['costs_prices', 'costs_fields']);
  });

  it('types columns from the CT Studio column type and appends provenance in order', () => {
    const [plan] = plans(
      planTables(
        data([
          table('t', [
            ['n', 'number'],
            ['i', 'integer'],
            ['d', 'date'],
            ['dt', 'date-time'],
            ['b', 'boolean'],
            ['s', 'string'],
            ['o', 'whatever'],
          ]),
        ]),
        provenance,
        'x',
      ),
    );
    expect(plan?.columns.map((column) => [column.name, column.type])).toEqual([
      ['n', 'numeric'],
      ['i', 'bigint'],
      ['d', 'date'],
      ['dt', 'timestamptz'],
      ['b', 'boolean'],
      ['s', 'text'],
      ['o', 'text'],
      ['ct_source_sha256', 'text'],
      ['ct_source_filename', 'text'],
      ['ct_job_id', 'text'],
      ['ct_recipe_id', 'text'],
      ['ct_recipe_version', 'bigint'],
      ['ct_approved_by', 'text'],
      ['ct_published_at', 'timestamptz'],
      ['ct_row', 'bigint'],
    ]);
  });

  it('writes rows as text with nulls, then the provenance values and a 1-based row', () => {
    const [plan] = plans(
      planTables(
        data([
          table(
            't',
            [
              ['a', 'number'],
              ['b', 'text'],
            ],
            [{ a: 1.5, b: 'x' }, { a: null }],
          ),
        ]),
        provenance,
        'x',
      ),
    );
    const own = ['abc123', 'Report.pdf', 'job-1', 'Rate Card', '3', 'Pat', provenance.publishedAt];
    expect(plan?.rows).toEqual([
      ['1.5', 'x', ...own, '1'],
      [null, null, ...own, '2'],
    ]);
  });

  it('plans a fields table of id, title, type, value and unit', () => {
    const result = plans(
      planTables(
        data(
          [],
          [
            { id: 'total', title: 'Total', type: 'number', value: 12, unit: 'kg' },
            { id: 'note', title: null, type: 'string', value: null, unit: null },
          ],
        ),
        provenance,
        'x',
      ),
    );
    const fields = result.find((plan) => plan.name === 'x_fields');
    expect(fields?.columns.map((column) => column.name)).toEqual([
      'id',
      'title',
      'type',
      'value',
      'unit',
      ...PROVENANCE_COLUMNS,
    ]);
    expect(fields?.rows[0]?.slice(0, 5)).toEqual(['total', 'Total', 'number', '12', 'kg']);
    expect(fields?.rows[1]?.slice(0, 5)).toEqual(['note', null, 'string', null, null]);
  });

  it('makes names safe: lower case, [a-z0-9_], at most 63 bytes', () => {
    const result = plans(
      planTables(
        data([
          table('Q1 Sales (GBP)', [
            ['Net Price', 'text'],
            ['1st', 'text'],
          ]),
        ]),
        provenance,
        'My Set',
      ),
    );
    expect(result[0]?.name).toBe('my_set_q1_sales__gbp_');
    expect(result[0]?.columns.slice(0, 2).map((column) => column.name)).toEqual([
      'net_price',
      '_1st',
    ]);
    const long = plans(planTables(data([table('t'.repeat(100))]), provenance, 'x'));
    expect(long[0]?.name).toHaveLength(63);
    expect(long[0]?.name).toMatch(/^[a-z0-9_]+$/);
  });

  it('API-072 two tables becoming one name refuse with name_conflict on tableSet', () => {
    const result = planTables(data([table('Net Price'), table('net-price')]), provenance, 'x');
    expect(result).toMatchObject({ refused: 'name_conflict' });
    expect((result as { detail: string }).detail).toContain('tableSet');
  });

  it('API-072 truncation that makes two names equal is a name_conflict, not a suffix', () => {
    const result = planTables(
      data([table('a'.repeat(70) + '1'), table('a'.repeat(70) + '2')]),
      provenance,
      'x',
    );
    expect(result).toMatchObject({ refused: 'name_conflict' });
  });

  it('API-072 a table named fields conflicts with the fields table', () => {
    expect(planTables(data([table('fields')]), provenance, 'x')).toMatchObject({
      refused: 'name_conflict',
    });
  });

  it('a column pair becoming one name is a name_conflict', () => {
    const result = planTables(
      data([
        table('t', [
          ['A b', 'text'],
          ['a_b', 'text'],
        ]),
      ]),
      provenance,
      'x',
    );
    expect(result).toMatchObject({ refused: 'name_conflict' });
  });

  it('API-072 a column id starting ct_ is refused', () => {
    expect(planTables(data([table('t', [['ct_row', 'text']])]), provenance, 'x')).toMatchObject({
      refused: 'reserved_column',
    });
    expect(planTables(data([table('t', [['CT_Extra', 'text']])]), provenance, 'x')).toMatchObject({
      refused: 'reserved_column',
    });
  });
});
