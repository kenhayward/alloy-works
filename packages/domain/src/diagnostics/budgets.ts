/**
 * **Every performance budget the specification states** (diagnostics.md; the DG plan, DG-J): who owns
 * it, what it is measured on, whether it is provisional, the tranche that confirms it, and how it is
 * measured in production, or why it is not. A test holds the registry to the corpus, so a budget added
 * to a requirement fails until it is registered here.
 */
import { LATENCY_BOUNDS_MS, percentileBound } from './measure.js';

/** How a budget is measured where the product runs. */
export type BudgetMeasure =
  /** An operation's requests, timed in the service as a capability of its own. */
  | { readonly kind: 'request'; readonly capability: string }
  /** A kind of job's run in the worker, not its wait in the queue. */
  | { readonly kind: 'job'; readonly capability: string }
  /** The search index's lag by meaning (`embedding_lag`), in seconds. */
  | { readonly kind: 'lag' }
  /** Met by how it is built: there is nothing to wait for. */
  | { readonly kind: 'immediate'; readonly why: string }
  /** Not measured in production, and why. */
  | { readonly kind: 'unmeasured'; readonly why: string };

export interface PerformanceBudget {
  /** The requirement, with what it times where one states two. */
  readonly id: string;
  readonly requirement: string;
  /** The design that claims it. */
  readonly owner: string;
  /** What the tests measure it on. */
  readonly reference: string;
  /** The percentile held to `withinMs`; null where the budget states none. */
  readonly percentile: number | null;
  readonly withinMs: number | null;
  /** No measured sample above this; null where the budget states none. */
  readonly neverAboveMs: number | null;
  readonly provisional: boolean;
  /** Every budget is weighed again, together, at the end of the implementation. */
  readonly confirmedBy: 'T7';
  readonly production: BudgetMeasure;
}

/** The operations a budget times, each measured as a capability of its own (DG-C). */
export const BUDGETED_OPERATIONS: Readonly<Record<string, string>> = {
  search: 'Searches',
  getArtifactRelationships: 'Relationships and impact',
  getArtifactPath: 'Relationships and impact',
  getArtifactImpact: 'Relationships and impact',
  getDocument: 'Document structure',
  editOutline: 'Document structure',
};

const CLIENT =
  'Timed in the browser, which reports nothing to the service yet: measured by the browser suite alone.';

export const PERFORMANCE_BUDGETS: readonly PerformanceBudget[] = [
  {
    id: 'API-036',
    requirement: 'API-036',
    owner: 'docs/design/realtime.md',
    reference: "The conformance suite's harness, every delivery to every entitled viewer",
    percentile: 0.95,
    withinMs: 250,
    neverAboveMs: 1000,
    provisional: true,
    confirmedBy: 'T7',
    production: {
      kind: 'unmeasured',
      why: 'A viewer does not acknowledge a change it is sent, so its arrival cannot be timed.',
    },
  },
  {
    id: 'CNT-180-open',
    requirement: 'CNT-180',
    owner: 'docs/design/document-view.md',
    reference: '400 components in 500 nodes, in the browser suite against the running service',
    percentile: 0.9,
    withinMs: 1000,
    neverAboveMs: 2000,
    provisional: true,
    confirmedBy: 'T7',
    production: { kind: 'unmeasured', why: CLIENT },
  },
  {
    id: 'CNT-180-jump',
    requirement: 'CNT-180',
    owner: 'docs/design/document-view.md',
    reference: '400 components in 500 nodes, in the browser suite against the running service',
    percentile: 0.9,
    withinMs: 250,
    neverAboveMs: 500,
    provisional: true,
    confirmedBy: 'T7',
    production: { kind: 'unmeasured', why: CLIENT },
  },
  {
    id: 'CNT-186',
    requirement: 'CNT-186',
    owner: 'docs/design/publishing.md',
    reference: 'A 300-page document, twenty saves, on the declared reference runner',
    percentile: 0.95,
    withinMs: 3000,
    neverAboveMs: 6000,
    provisional: true,
    confirmedBy: 'T7',
    production: { kind: 'job', capability: 'Preview work' },
  },
  {
    id: 'PUB-102',
    requirement: 'PUB-102',
    owner: 'docs/design/publishing.md',
    reference: 'The declared 311-page reference document, on the declared reference runner',
    percentile: 0.95,
    withinMs: 10_000,
    neverAboveMs: 30_000,
    provisional: true,
    confirmedBy: 'T7',
    production: { kind: 'job', capability: 'Publishing work' },
  },
  {
    id: 'REL-031',
    requirement: 'REL-031',
    owner: 'docs/design/relationships.md',
    reference: 'A generated tenant of a million components, by the load suite',
    percentile: 0.95,
    withinMs: 250,
    neverAboveMs: 500,
    provisional: true,
    confirmedBy: 'T7',
    production: { kind: 'request', capability: 'Relationships and impact' },
  },
  {
    id: 'REU-049',
    requirement: 'REU-049',
    owner: 'docs/design/templates.md',
    reference: "Four hundred documents from one template, on CI's reference runner",
    percentile: null,
    withinMs: 3_600_000,
    neverAboveMs: null,
    provisional: true,
    confirmedBy: 'T7',
    production: {
      kind: 'unmeasured',
      why: "A bulk generation runs as its documents' jobs, and nothing yet times it from start to end.",
    },
  },
  {
    id: 'SCH-033',
    requirement: 'SCH-033',
    owner: 'docs/design/search.md',
    reference: 'A generated tenant of a million components, three kinds of user, by the load suite',
    percentile: 0.95,
    withinMs: 250,
    neverAboveMs: 500,
    provisional: true,
    confirmedBy: 'T7',
    production: { kind: 'request', capability: 'Searches' },
  },
  {
    id: 'SCH-036',
    requirement: 'SCH-036',
    owner: 'docs/design/search.md',
    reference: 'The stand-in embedder, by the search suite',
    percentile: 0.95,
    withinMs: 150,
    neverAboveMs: 400,
    provisional: true,
    confirmedBy: 'T7',
    production: {
      kind: 'unmeasured',
      why: "A query's embedding is timed within its search, not apart from it.",
    },
  },
  {
    id: 'SCH-066',
    requirement: 'SCH-066',
    owner: 'docs/design/search.md',
    reference: 'A search in the transaction after the version is written',
    percentile: 0.95,
    withinMs: 60_000,
    neverAboveMs: 300_000,
    provisional: true,
    confirmedBy: 'T7',
    production: {
      kind: 'immediate',
      why: 'Words are indexed in the transaction that writes their version, so they are findable when it is.',
    },
  },
  {
    id: 'SCH-067',
    requirement: 'SCH-067',
    owner: 'docs/design/search.md',
    reference: "The pipeline with the stand-in embedder, not a provider's latency",
    percentile: 0.95,
    withinMs: 60_000,
    neverAboveMs: 300_000,
    provisional: true,
    confirmedBy: 'T7',
    production: { kind: 'lag' },
  },
  {
    id: 'STR-063',
    requirement: 'STR-063',
    owner: 'docs/design/structure.md',
    reference: '500 outline nodes, 400 of them component references, by the service suite',
    percentile: 0.95,
    withinMs: 250,
    neverAboveMs: 500,
    provisional: true,
    confirmedBy: 'T7',
    production: { kind: 'request', capability: 'Document structure' },
  },
  {
    id: 'STR-073',
    requirement: 'STR-073',
    owner: 'docs/design/structure.md',
    reference: '500 outline nodes, 400 of them component references, in the browser suite',
    percentile: 0.9,
    withinMs: 250,
    neverAboveMs: 500,
    provisional: true,
    confirmedBy: 'T7',
    production: { kind: 'unmeasured', why: CLIENT },
  },
  {
    id: 'VER-051',
    requirement: 'VER-051',
    owner: 'docs/design/comparison.md',
    reference:
      'Two baselines of 300 components and a component of 300 versions, by counted operations',
    percentile: null,
    withinMs: null,
    neverAboveMs: null,
    provisional: true,
    confirmedBy: 'T7',
    production: {
      kind: 'unmeasured',
      why: 'No time is stated yet: the tests hold comparison to the operations it counts.',
    },
  },
];

export type BudgetVerdict = 'met' | 'missed' | 'nothing' | 'immediate' | 'unmeasured';

export interface BudgetReading {
  readonly verdict: BudgetVerdict;
  /** The budget's percentile, as measured; for buckets, the bound holding it. */
  readonly atMs?: number;
  /** The largest sample; for buckets, the bound of the last bucket holding one. */
  readonly largestMs?: number;
}

export interface Measured {
  /** A capability's buckets over the period read. */
  readonly buckets?: readonly number[];
  readonly lag?: { readonly p95Seconds: number | null; readonly maxSeconds: number | null };
}

/** The upper bound of the last bucket holding a sample; `Infinity` past every bound. */
function largestBound(buckets: readonly number[]): number {
  const last = buckets.findLastIndex((count) => count > 0);
  return LATENCY_BOUNDS_MS[last] ?? Infinity;
}

const within = (budget: PerformanceBudget, atMs: number, largestMs: number): BudgetVerdict =>
  (budget.withinMs === null || atMs <= budget.withinMs) &&
  (budget.neverAboveMs === null || largestMs <= budget.neverAboveMs)
    ? 'met'
    : 'missed';

/**
 * Whether a budget is being met, from what production measured. A sample's bucket is held against the
 * ceiling by its upper bound, so a ceiling between two bounds is held to the one below it: the reading
 * may miss a budget that was met, never the reverse.
 */
export function budgetVerdict(budget: PerformanceBudget, measured: Measured): BudgetReading {
  const { production } = budget;
  if (production.kind === 'unmeasured') return { verdict: 'unmeasured' };
  if (production.kind === 'immediate') return { verdict: 'immediate' };
  if (production.kind === 'lag') {
    const p95 = measured.lag?.p95Seconds ?? null;
    if (p95 === null) return { verdict: 'nothing' };
    const atMs = p95 * 1000;
    const largestMs = (measured.lag?.maxSeconds ?? p95) * 1000;
    return { verdict: within(budget, atMs, largestMs), atMs, largestMs };
  }
  const buckets = measured.buckets ?? [];
  const atMs = percentileBound(buckets, budget.percentile ?? 0.95);
  if (atMs === null) return { verdict: 'nothing' };
  const largestMs = largestBound(buckets);
  return { verdict: within(budget, atMs, largestMs), atMs, largestMs };
}
