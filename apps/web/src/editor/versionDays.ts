import type { UnitChange } from '@alloy-works/domain';

import { words } from '../words/words.js';

/** Anything the timeline places by when it happened. */
export interface Timed {
  readonly at: Date;
  readonly id: string;
}

export interface Day<Row> {
  /** The reader's own calendar day (LIF-062), never the service's. */
  readonly key: string;
  readonly at: Date;
  readonly rows: readonly Row[];
}

const pad = (value: number) => String(value).padStart(2, '0');
export const dayKey = (at: Date) =>
  `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;

/** How a day's header names it: near days by their nearness, the year only past this one. */
export function dayLabel(at: Date, now: Date = new Date()): string {
  const date = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(at);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(at) === dayKey(now)) return words('editor.today-date', { date });
  if (dayKey(at) === dayKey(yesterday)) return words('editor.yesterday-date', { date });
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(at);
  return words('editor.weekday-date', { weekday, date });
}

/** Rows newest first into their days, each day's order kept. */
export function daysOf<Row extends Timed>(rows: readonly Row[]): readonly Day<Row>[] {
  const days = new Map<string, Row[]>();
  for (const row of rows) {
    const key = dayKey(row.at);
    days.set(key, [...(days.get(key) ?? []), row]);
  }
  return [...days].map(([key, held]) => ({ key, at: held[0]!.at, rows: held }));
}

export type TimelineRow<V extends Timed, B extends Timed, P extends Timed> =
  | (V & { readonly kind: 'version' })
  | (B & { readonly kind: 'baseline' })
  | (P & { readonly kind: 'publication' });

/**
 * Versions, baselines and publications where they fall, newest first (VER-060; the plan, D11). Versions
 * and publications page apart, so a row shows only down to the older of the two streams' last rows, or
 * one would appear out of order and then gain neighbours.
 */
export function timelineRows<V extends Timed, B extends Timed, P extends Timed>({
  versions,
  baselines,
  publications,
  olderVersions,
  olderPublications,
}: {
  readonly versions: readonly V[];
  readonly baselines: readonly B[];
  readonly publications: readonly P[];
  readonly olderVersions: boolean;
  readonly olderPublications: boolean;
}): readonly TimelineRow<V, B, P>[] {
  const lastOf = (rows: readonly Timed[]) => rows[rows.length - 1]?.at.getTime();
  const floors = [
    ...(olderVersions ? [lastOf(versions) ?? Infinity] : []),
    ...(olderPublications ? [lastOf(publications) ?? Infinity] : []),
  ];
  const floor = floors.length === 0 ? -Infinity : Math.max(...floors);
  const rows: TimelineRow<V, B, P>[] = [
    ...versions.map((each) => ({ ...each, kind: 'version' as const })),
    ...baselines.map((each) => ({ ...each, kind: 'baseline' as const })),
    ...publications.map((each) => ({ ...each, kind: 'publication' as const })),
  ];
  return rows
    .filter((row) => row.at.getTime() >= floor)
    .sort((one, other) => other.at.getTime() - one.at.getTime());
}

export interface ChangeCounts {
  readonly changed: number;
  readonly added: number;
  readonly removed: number;
}

/** What a comparison changed, counted: a matched unit counts only where it moved or differs. */
export function changeCounts(changes: readonly UnitChange[]): ChangeCounts {
  let changed = 0;
  let added = 0;
  let removed = 0;
  for (const each of changes) {
    if (each.change === 'inserted') added += 1;
    else if (each.change === 'deleted') removed += 1;
    else if (
      each.moved !== null ||
      each.edited !== null ||
      each.changed.length > 0 ||
      each.split !== null ||
      each.joined !== null
    ) {
      changed += 1;
    }
  }
  return { changed, added, removed };
}
