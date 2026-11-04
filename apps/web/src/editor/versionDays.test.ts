import { describe, expect, it } from 'vitest';

import { changeCounts, dayLabel, daysOf, timelineRows } from './versionDays.js';

const local = (year: number, month: number, day: number, hour = 12) =>
  new Date(year, month - 1, day, hour);
const NOW = local(2026, 11, 4);

const version = (at: Date, number: string) => ({ at, id: number });

describe('the versions timeline, by day', () => {
  it('names a day by how near it is, in the reader’s own zone, adding the year past this one', () => {
    expect(dayLabel(local(2026, 11, 4, 0), NOW)).toBe('Today · 4 Nov');
    expect(dayLabel(local(2026, 11, 3, 23), NOW)).toBe('Yesterday · 3 Nov');
    expect(dayLabel(local(2026, 11, 2), NOW)).toBe('Mon · 2 Nov');
    expect(dayLabel(local(2025, 11, 2), NOW)).toBe('Sun · 2 Nov 2025');
  });

  it('groups rows by the day they fall in, newest first, keeping each day’s order', () => {
    const rows = [
      version(local(2026, 11, 4, 9), '3'),
      version(local(2026, 11, 3, 18), '2'),
      version(local(2026, 11, 3, 8), '1'),
    ];
    expect(daysOf(rows).map((day) => [day.key, day.rows.map((each) => each.id)])).toEqual([
      ['2026-11-04', ['3']],
      ['2026-11-03', ['2', '1']],
    ]);
  });

  it('VER-060 merges baselines and publications where they fall among the versions', () => {
    const rows = timelineRows({
      versions: [version(local(2026, 11, 4), 'v2'), version(local(2026, 11, 1), 'v1')],
      baselines: [{ at: local(2026, 11, 3), id: 'b1' }],
      publications: [{ at: local(2026, 11, 2), id: 'p1' }],
      olderVersions: false,
      olderPublications: false,
    });
    expect(rows.map((row) => row.id)).toEqual(['v2', 'b1', 'p1', 'v1']);
    expect(rows.map((row) => row.kind)).toEqual(['version', 'baseline', 'publication', 'version']);
  });

  it('shows a row only down to the older of the two paged streams, so none appears out of order', () => {
    const shown = (olderVersions: boolean, olderPublications: boolean) =>
      timelineRows({
        versions: [version(local(2026, 11, 4), 'v2'), version(local(2026, 11, 2), 'v1')],
        // The baselines are read whole, and may reach further back than either.
        baselines: [
          { at: local(2026, 11, 3), id: 'b2' },
          { at: local(2026, 10, 1), id: 'b1' },
        ],
        publications: [{ at: local(2026, 11, 3), id: 'p1' }],
        olderVersions,
        olderPublications,
      }).map((row) => row.id);

    expect(shown(false, false)).toEqual(['v2', 'b2', 'p1', 'v1', 'b1']);
    expect(shown(true, false)).toEqual(['v2', 'b2', 'p1', 'v1']);
    // More publications still to read: nothing older than the last read shows yet.
    expect(shown(false, true)).toEqual(['v2', 'b2', 'p1']);
  });

  it('counts what changed: moved and edited units, those added and those removed', () => {
    const matched = (over: object) => ({
      change: 'matched' as const,
      older: 'a',
      newer: 'a',
      type: 'paragraph',
      parent: 'root',
      matched: 'identity' as const,
      moved: null,
      edited: null,
      changed: [],
      split: null,
      joined: null,
      ...over,
    });
    expect(
      changeCounts([
        { change: 'inserted', newer: 'b', type: 'paragraph', parent: 'root', after: null },
        { change: 'deleted', older: 'c', type: 'paragraph', parent: 'root' },
        matched({}),
        matched({ moved: { after: 'b' } }),
        matched({ changed: ['style'] }),
      ]),
    ).toEqual({ changed: 2, added: 1, removed: 1 });
  });
});
