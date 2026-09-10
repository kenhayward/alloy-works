import { describe, expect, it } from 'vitest';

import { boundTable, cellFootnote, paragraph, text } from '../document.js';
import { assertPublishable, resolveBoundTable } from '../binding.js';

/**
 * Case 3 of the content model spike - a GATE.
 * See docs/specification/Content_Model_Spike.md.
 *
 * A table is produced by a block binding. A footnote is anchored to one cell. Then the parameter
 * set changes and the row that cell belonged to is no longer returned.
 *
 * Passing means: the anchor is expressed against something stable - never a positional index -
 * and the vanished-row case produces a named, surfaced condition rather than a silently dropped
 * footnote or a crash.
 */

const emissionsTable = () =>
  boundTable({
    id: 'tbl-1',
    query: { id: 'q.site-emissions', parameters: { year: '2025' } },
    keyColumn: 'site',
    columns: ['site', 'emissions'],
    footnotes: [
      cellFootnote({
        id: 'fn-1',
        anchor: { rowKey: 'SITE-042', column: 'emissions' },
        content: [paragraph([text('Measured under the revised method.')])],
      }),
    ],
  });

const threeSites = {
  columns: ['site', 'emissions'],
  rows: [
    { site: 'SITE-011', emissions: '12.4' },
    { site: 'SITE-042', emissions: '31.9' },
    { site: 'SITE-088', emissions: '7.2' },
  ],
};

// The same data, reordered - which is what a query does the moment somebody adds an ORDER BY.
const threeSitesReordered = {
  columns: ['site', 'emissions'],
  rows: [
    { site: 'SITE-088', emissions: '7.2' },
    { site: 'SITE-042', emissions: '31.9' },
    { site: 'SITE-011', emissions: '12.4' },
  ],
};

const withoutSite042 = {
  columns: ['site', 'emissions'],
  rows: [
    { site: 'SITE-011', emissions: '12.4' },
    { site: 'SITE-088', emissions: '7.2' },
  ],
};

const cellFootnotes = (
  resolved: ReturnType<typeof resolveBoundTable>,
  rowKey: string,
  column: string,
) =>
  resolved.rows.find((row) => row.key === rowKey)?.cells.find((cell) => cell.column === column)
    ?.footnoteIds;

describe('case 3 - a cell-anchored footnote in a bound table', () => {
  it('refuses an anchor expressed as a position', () => {
    expect(() =>
      cellFootnote({
        id: 'fn-bad',
        // A row index is meaningless against generated content: the next query run reorders it.
        anchor: { rowIndex: 1, column: 'emissions' } as unknown as {
          rowKey: string;
          column: string;
        },
        content: [paragraph([text('Nope.')])],
      }),
    ).toThrow();
  });

  it('places the footnote on the cell its key identifies', () => {
    const resolved = resolveBoundTable(emissionsTable(), threeSites);

    expect(cellFootnotes(resolved, 'SITE-042', 'emissions')).toEqual(['fn-1']);
    expect(cellFootnotes(resolved, 'SITE-011', 'emissions')).toEqual([]);
    expect(resolved.diagnostics).toEqual([]);
  });

  /**
   * The property the whole design turns on. Reordering the result set must not move the footnote,
   * because the anchor names the data rather than the position - and a query gaining an ORDER BY
   * is not an edit to the document.
   */
  it('keeps the footnote on the same data when the rows are reordered', () => {
    const resolved = resolveBoundTable(emissionsTable(), threeSitesReordered);

    expect(cellFootnotes(resolved, 'SITE-042', 'emissions')).toEqual(['fn-1']);
    expect(resolved.rows.map((row) => row.key)).toEqual(['SITE-088', 'SITE-042', 'SITE-011']);
  });

  describe('when the anchored row is no longer returned', () => {
    it('reports a named diagnostic rather than dropping the footnote silently', () => {
      const resolved = resolveBoundTable(emissionsTable(), withoutSite042);

      expect(resolved.diagnostics).toEqual([
        {
          code: 'footnote-anchor-missing',
          footnoteId: 'fn-1',
          rowKey: 'SITE-042',
          column: 'emissions',
          message:
            'Footnote fn-1 is anchored to site SITE-042, which query q.site-emissions did not return',
        },
      ]);
    });

    it('still resolves the rows it did get, rather than failing the whole table', () => {
      const resolved = resolveBoundTable(emissionsTable(), withoutSite042);

      expect(resolved.rows.map((row) => row.key)).toEqual(['SITE-011', 'SITE-088']);
    });

    it('fails the publish loudly, naming the footnote', () => {
      const resolved = resolveBoundTable(emissionsTable(), withoutSite042);

      expect(() => assertPublishable(resolved)).toThrow(/fn-1/);
    });
  });

  it('reports a declared column the query did not return', () => {
    const resolved = resolveBoundTable(emissionsTable(), {
      columns: ['site'],
      rows: [{ site: 'SITE-042' }],
    });

    expect(resolved.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'column-not-returned',
    );
    expect(() => assertPublishable(resolved)).toThrow(/emissions/);
  });
});
