import {
  bindingDigestInput,
  parseContentDocument,
  type BoundTableNode,
  type CanonicalResult,
  type TableColumn,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { boundTablesShown, PAGE_ROWS, type BindingContext, type TableHeld } from './bindings.js';
import { toEditor } from './mapping.js';

/**
 * A bound table's page budget (the TB2 plan, task 3): 2,000 rows sorted and the first 50 laid out. It
 * binds only off a shared runner, so CI does not run it (packages/editor/vitest.config.ts).
 */

const tableBinding = {
  type: 'binding' as const,
  id: 'k1',
  query: '00000000-0000-4000-8000-00000000d001',
  parameters: {},
  mode: 'checked' as const,
};

const boundTable = (over: Partial<BoundTableNode>): BoundTableNode => ({
  type: 'boundTable',
  id: 't1',
  style: 'table',
  binding: tableBinding,
  caption: [{ type: 'text', value: 'Readings', marks: [] }],
  columns: [{ column: 'site', header: 'Site' }],
  headerColumn: false,
  ...over,
});

const documentOf = (table: BoundTableNode) =>
  parseContentDocument({
    schemaVersion: 1,
    title: 'Sites',
    language: 'en-GB',
    direction: 'ltr',
    content: [table],
  });

const opened = (document: ReturnType<typeof documentOf>) => {
  const editor = toEditor(document);
  if (!editor.editable) throw new Error(editor.unsupported.join(', '));
  return editor.doc;
};

const inDocument = (table: TableHeld): BindingContext => ({
  kind: 'document',
  held: new Map([
    [tableBinding.id, { binding: bindingDigestInput(tableBinding), shown: { table } }],
  ]),
});

describe('a bound table of 2,000 rows on the page (the TB2 plan, task 3)', () => {
  it('sorts 2,000 rows of 8 columns and lays out the first 50 in under 50 ms', () => {
    const names = ['site', 'depth', 'on', 'at', 'count', 'open', 'note', 'ratio'];
    const columns: TableColumn[] = [
      { name: 'site', type: { base: 'text' } },
      { name: 'depth', type: { base: 'decimal', precision: 12, scale: 3 } },
      { name: 'on', type: { base: 'date' } },
      { name: 'at', type: { base: 'time', fraction: 0 } },
      { name: 'count', type: { base: 'integer' } },
      { name: 'open', type: { base: 'boolean' } },
      { name: 'note', type: { base: 'text' } },
      { name: 'ratio', type: { base: 'decimal', precision: 12, scale: 4 } },
    ];
    const result: CanonicalResult = {
      columns: columns.map((each) => [each.name, each.type.base]) as CanonicalResult['columns'],
      rows: Array.from({ length: 2_000 }, (_, at) => [
        `Site ${(at * 7919) % 2_000}`,
        `${(at * 37) % 1_000}.${at % 1_000}`,
        `2026-${String((at % 12) + 1).padStart(2, '0')}-${String((at % 28) + 1).padStart(2, '0')}`,
        `${String(at % 24).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}:00`,
        String(at * 13),
        at % 2 === 0,
        at % 5 === 0 ? null : `Note ${at}`,
        `-0.${String(at).padStart(4, '0')}`,
      ]),
    };
    const document = documentOf(
      boundTable({
        columns: names.map((name) => ({ column: name, header: name })),
        sort: [
          { column: 'depth', direction: 'descending', nulls: 'last' },
          { column: 'site', direction: 'ascending', nulls: 'first' },
        ],
      }),
    );
    const doc = opened(document);
    const timings: number[] = [];
    for (let run = 0; run < 7; run += 1) {
      // A fresh result object each run, so the memo never answers for the layout.
      const rows = { ...result };
      const context = inDocument({ columns, rowCount: 2_000, rows });
      const started = performance.now();
      const [shown] = boundTablesShown(doc, context);
      timings.push(performance.now() - started);
      expect(shown!.shown.rows).toHaveLength(PAGE_ROWS);
      expect(shown!.shown.more).toBe(1_950);
    }
    const median = [...timings].sort((a, b) => a - b)[3]!;
    expect(median).toBeLessThan(50);
  });
});
