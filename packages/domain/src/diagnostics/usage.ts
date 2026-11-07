/**
 * **What an environment uses, counted by day** (diagnostics.md; ADR-0100; the DG plan, DG-I): declared
 * here before anything is counted (ADM-035). A count is what happened that day; a sample is what was
 * held when it was counted.
 */

import { BUDGETED_OPERATIONS } from './budgets.js';

/** Days kept: 13 months, so a year's trend has the same month a year before (ADM-033). */
export const USAGE_KEPT_DAYS = 396;
/** The last days counted again each night, so a record that lands late still counts. */
export const USAGE_RECOUNT_DAYS = 3;
/** As far back as a count reaches: every source keeps its records at least this long. */
export const USAGE_REACH_DAYS = 30;

export const USAGE_MEASURES = [
  { measure: 'databaseBytes', kind: 'sample', unit: 'bytes' },
  { measure: 'publicationBytes', kind: 'sample', unit: 'bytes' },
  { measure: 'assetBytes', kind: 'sample', unit: 'bytes' },
  { measure: 'importBytes', kind: 'sample', unit: 'bytes' },
  { measure: 'exportBytes', kind: 'sample', unit: 'bytes' },
  { measure: 'publications', kind: 'count', unit: 'count' },
  { measure: 'assets', kind: 'count', unit: 'count' },
  { measure: 'mail', kind: 'count', unit: 'count' },
  { measure: 'webhooks', kind: 'count', unit: 'count' },
  { measure: 'translationJobs', kind: 'count', unit: 'count' },
  { measure: 'referenceSearches', kind: 'count', unit: 'count' },
  { measure: 'embeddingRuns', kind: 'count', unit: 'count' },
  { measure: 'queryMs', kind: 'count', unit: 'ms' },
] as const;

export type UsageMeasure = (typeof USAGE_MEASURES)[number]['measure'];

/**
 * Operations measured as a capability of their own, beside their route's tag, since they leave no row
 * to count (ADR-0100, decision 5), and those a performance budget times.
 */
export const MEASURED_OPERATIONS: Readonly<Record<string, string>> = {
  searchReferenceSource: 'Reference searches',
  ...BUDGETED_OPERATIONS,
};

const DAY_MS = 86_400_000;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The UTC days to count before `today`: every day since `lastCounted`, the last `USAGE_RECOUNT_DAYS`
 * again, and none more than `USAGE_REACH_DAYS` back. Days are `YYYY-MM-DD`.
 */
export function daysToCount(lastCounted: string | null, today: string): string[] {
  const end = Date.parse(`${today}T00:00:00Z`);
  const reach = end - USAGE_REACH_DAYS * DAY_MS;
  const recount = end - USAGE_RECOUNT_DAYS * DAY_MS;
  const after = lastCounted === null ? reach : Date.parse(`${lastCounted}T00:00:00Z`) + DAY_MS;
  const days: string[] = [];
  for (let at = Math.max(reach, Math.min(after, recount)); at < end; at += DAY_MS)
    days.push(dayOf(at));
  return days;
}
