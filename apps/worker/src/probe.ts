/**
 * **The service probed each minute** (diagnostics.md; the DG plan, pre-flight 1; ADR-0101): its `/health`,
 * which reads the database, answered 200 within the time is up; anything else is down. The worker records
 * the minute; a minute nobody records counts as down.
 */

/** A probe waits no longer than this for an answer. */
export const PROBE_TIMEOUT_MS = 10_000;
export const PROBE_INTERVAL_MS = 60_000;

export interface Probe {
  readonly url: string;
  readonly fetch: typeof fetch;
  readonly record: (at: Date, up: boolean) => Promise<void>;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}

/** Probes the service once and records what it found. */
export async function probeService(probe: Probe): Promise<boolean> {
  const at = (probe.now ?? (() => new Date()))();
  const up = await probe
    .fetch(probe.url, { signal: AbortSignal.timeout(probe.timeoutMs ?? PROBE_TIMEOUT_MS) })
    .then((response) => response.status === 200)
    .catch(() => false);
  await probe.record(at, up);
  return up;
}
