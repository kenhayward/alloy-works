/**
 * **How healthy a capability and a kind of background work are** (diagnostics.md; the DG plan, DG-F):
 * read from what was measured, over the last 15 minutes. Health reads server errors alone, so a caller's
 * own mistakes cannot spoil it, and a request the environment's state refused is kept out of it.
 */
import { LATENCY_BOUNDS_MS, percentileBound } from './measure.js';

export type Health = 'healthy' | 'degraded' | 'failing' | 'idle';
export type WorkHealth = 'healthy' | 'failing' | 'paused';

/** The window health is read over. */
export const HEALTH_WINDOW_MS = 15 * 60_000;
/** A server error rate at or past this is degraded; past `FAILING_RATE`, failing. */
export const DEGRADED_RATE = 0.05;
export const FAILING_RATE = 0.5;

export interface CapabilityCounts {
  readonly requests: number;
  readonly clientErrors: number;
  readonly serverErrors: number;
  readonly refused: number;
  readonly buckets: readonly number[];
}

export interface CapabilityHealth {
  readonly health: Health;
  readonly requests: number;
  /** Server errors over the requests the environment answered; null with none. */
  readonly errorRate: number | null;
  /** The 95th percentile's bound; the last bound when it is past them all; null with none. */
  readonly p95Ms: number | null;
}

/**
 * A capability's health from its counts: failing when most answered requests failed, degraded when
 * enough did or the 95th percentile is past `budgetMs`, idle with nothing answered.
 */
export function capabilityHealth(counts: CapabilityCounts, budgetMs?: number): CapabilityHealth {
  const answered = counts.requests - counts.refused;
  const bound = percentileBound(counts.buckets, 0.95);
  const p95Ms = bound === null ? null : Number.isFinite(bound) ? bound : LATENCY_BOUNDS_MS.at(-1)!;
  if (answered <= 0) return { health: 'idle', requests: counts.requests, errorRate: null, p95Ms };
  const errorRate = counts.serverErrors / answered;
  const health: Health =
    errorRate >= FAILING_RATE
      ? 'failing'
      : errorRate >= DEGRADED_RATE ||
          (budgetMs !== undefined && (bound === null ? false : bound > budgetMs))
        ? 'degraded'
        : 'healthy';
  return { health, requests: counts.requests, errorRate, p95Ms };
}

export interface WorkRun {
  readonly outcome: 'succeeded' | 'failed' | 'paused';
  readonly lastStartedAt: Date;
  readonly nextDueAt: Date | null;
}

/**
 * A kind of background work's health in one environment: failing when its last run failed or it has
 * not run for twice its own cadence; paused when the environment's state holds it, never failing.
 */
export function workHealth(run: WorkRun, now: Date): WorkHealth {
  if (run.outcome === 'paused') return 'paused';
  if (run.outcome === 'failed') return 'failing';
  if (run.nextDueAt === null) return 'healthy';
  const cadence = run.nextDueAt.getTime() - run.lastStartedAt.getTime();
  return now.getTime() - run.lastStartedAt.getTime() >= 2 * cadence ? 'failing' : 'healthy';
}
