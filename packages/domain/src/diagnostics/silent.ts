/**
 * **Silent failures** (diagnostics.md, "Who else is told"; the DG plan, pre-flight 7, DGe4): what a
 * person would take for "nothing happened", kind by kind, how the person waiting is told, or why
 * nobody waits, and how administrators are. Each `holds` is found in its `file` by a test.
 */
import { PERFORMANCE_BUDGETS } from './budgets.js';
import type { Health, WorkHealth } from './health.js';
import type { SecretKind } from '../secrets/consumers.js';

export type SilentFailureKind =
  | 'query_timeout'
  | 'source_down'
  | 'job_failed'
  | 'webhook_failing'
  | 'mail_failing'
  | 'index_lagging'
  | 'work_failing'
  | 'capability_failing'
  | 'integrity_failing'
  | 'secret_failing';

/** The kinds administrators are told of by inbox: the rest are shown in Diagnostics or tell their own. */
export type SilentFailureToldKind = Exclude<
  SilentFailureKind,
  'query_timeout' | 'webhook_failing' | 'mail_failing'
>;

/** Where a telling is, as a file and text found in it. */
interface Cited {
  readonly file: string;
  readonly holds: string;
}

export interface SilentFailure {
  readonly kind: SilentFailureKind;
  readonly what: string;
  readonly waiting:
    | ({ readonly told: true; readonly how: string } & Cited)
    | { readonly told: false; readonly why: string };
  /**
   * `inbox`: told by the silent failures sweep, once until it clears; `own`: told by its own
   * notification, so never twice; `diagnostics`: shown there alone, each person told at once.
   */
  readonly administrators:
    { readonly by: 'inbox' } | ({ readonly by: 'own' } & Cited) | { readonly by: 'diagnostics' };
}

export const SILENT_FAILURES: readonly SilentFailure[] = [
  {
    kind: 'query_timeout',
    what: 'A query a source did not answer in time',
    waiting: {
      told: true,
      how: 'The person running it, at once, by its code, `timeout`',
      file: 'apps/service/src/data/failure-words.ts',
      holds: "timeout: 'The source did not answer in time.'",
    },
    administrators: { by: 'diagnostics' },
  },
  {
    kind: 'source_down',
    what: 'A data source whose latest run failed',
    waiting: {
      told: true,
      how: 'The person running a query on it, at once, by its reason',
      file: 'apps/web/src/data/query-definitions.test.tsx',
      holds: 'shows the result or the one reason it failed',
    },
    administrators: { by: 'inbox' },
  },
  {
    kind: 'job_failed',
    what: 'A job that failed in the last day',
    waiting: {
      told: true,
      how: 'Its submitter, on their job',
      file: 'apps/web/src/publishing/Publishing.test.tsx',
      holds:
        'says a failure of the engine or the store is nothing in the document, and to publish again',
    },
    administrators: { by: 'inbox' },
  },
  {
    kind: 'webhook_failing',
    what: 'A webhook failing to deliver',
    waiting: {
      told: true,
      how: 'Its maker, in their inbox when it is turned off (WB)',
      file: 'packages/db/src/webhooks.ts',
      holds: "values (${maker}, 'webhook'",
    },
    administrators: {
      by: 'own',
      file: 'packages/db/src/webhooks.ts',
      holds: "values (${maker}, 'webhook'",
    },
  },
  {
    kind: 'mail_failing',
    what: "The environment's mail failing",
    waiting: {
      told: true,
      how: 'Those who configure services, in their inbox, once until it clears (EM-N)',
      file: 'packages/db/src/mail.ts',
      holds: "values (${id}, 'mail')",
    },
    administrators: { by: 'own', file: 'packages/db/src/mail.ts', holds: "values (${id}, 'mail')" },
  },
  {
    kind: 'index_lagging',
    what: 'New versions waiting past the ceiling to be findable by meaning',
    waiting: {
      told: true,
      how: 'Whoever searches by meaning meanwhile, beside the results',
      file: 'apps/web/src/search/SearchPage.tsx',
      holds: "words('search.new-content-may-not-be')",
    },
    administrators: { by: 'inbox' },
  },
  {
    kind: 'work_failing',
    what: 'Background work failing or late',
    waiting: { told: false, why: 'Nobody waits on a sweep or a loop: each runs on its own' },
    administrators: { by: 'inbox' },
  },
  {
    kind: 'capability_failing',
    what: 'A capability failing most of what it answers',
    waiting: {
      told: true,
      how: 'The person whose request failed, at once, by its code',
      file: 'apps/service/src/http.test.ts',
      holds: 'turns an unexpected failure into a generic 500 and logs the detail instead',
    },
    administrators: { by: 'inbox' },
  },
  {
    kind: 'integrity_failing',
    what: 'A stored item failing its re-verification',
    waiting: {
      told: false,
      why: 'Nobody asked for it: re-verification is the product checking its own store',
    },
    administrators: { by: 'inbox' },
  },
  {
    kind: 'secret_failing',
    what: 'Something using a secret failing to authenticate since it was replaced',
    waiting: {
      told: true,
      how: 'The person whose act failed, at once, by its own failure',
      file: 'apps/service/src/data/failure-words.ts',
      holds: 'connection_failed',
    },
    administrators: { by: 'inbox' },
  },
];

/** The index's ceiling (SCH-067): a version waits no longer than this to be findable by meaning. */
export const INDEX_LAG_CEILING_SECONDS =
  (PERFORMANCE_BUDGETS.find((each) => each.production.kind === 'lag')?.neverAboveMs ?? 300_000) /
  1000;

/** Whether the index lags past its ceiling, from how long the oldest version has waited. */
export const indexLagging = (waitSeconds: number | null) =>
  waitSeconds !== null && waitSeconds > INDEX_LAG_CEILING_SECONDS;

/** What Diagnostics reads, as far as telling needs it. */
export interface SilentReadings {
  readonly capabilities: readonly { readonly capability: string; readonly health: Health }[];
  readonly work: readonly { readonly work: string; readonly health: WorkHealth }[];
  /** The last day's jobs by kind and state. */
  readonly jobs: readonly { readonly kind: string; readonly state: string }[];
  readonly connections: readonly { readonly connection: string; readonly down: boolean }[];
  /** How long the oldest version waiting to be findable by meaning has waited; null with none. */
  readonly indexWaitSeconds: number | null;
  readonly integrity: readonly { readonly class: string; readonly failing: number }[];
  /**
   * Each secret replaced, by its key and replacement (`kind:id:ms`), with whether a consumer has failed
   * to authenticate since (ADM-047), what it is and every consumer by name.
   */
  readonly secrets?: readonly {
    readonly key: string;
    readonly failing: boolean;
    readonly secret: SecretFailing;
  }[];
}

/** A secret a consumer failed to authenticate with since its replacement, named with every consumer. */
export interface SecretFailing {
  readonly kind: SecretKind;
  readonly name: string | null;
  readonly consumers: readonly string[];
}

/** One failure now: its kind and what it is of (a capability, work, job kind, source or class). */
export interface SilentFailureNow {
  readonly kind: SilentFailureToldKind;
  readonly subject: string;
  /** A failing secret's, told against it (ADM-047). */
  readonly secret?: SecretFailing;
}

export const silentFailureKey = (failure: SilentFailureNow) => `${failure.kind}:${failure.subject}`;

/** The failures administrators are told of by inbox, read now; webhooks and mail tell their own. */
export function silentFailuresNow(readings: SilentReadings): SilentFailureNow[] {
  const failing = (kind: SilentFailureToldKind, subjects: readonly string[]) =>
    [...new Set(subjects)].map((subject) => ({ kind, subject }));
  return [
    ...failing(
      'capability_failing',
      readings.capabilities
        .filter((each) => each.health === 'failing')
        .map((each) => each.capability),
    ),
    ...failing(
      'work_failing',
      readings.work.filter((each) => each.health === 'failing').map((each) => each.work),
    ),
    ...failing(
      'job_failed',
      readings.jobs.filter((each) => each.state === 'failed').map((each) => each.kind),
    ),
    ...failing(
      'source_down',
      readings.connections.filter((each) => each.down).map((each) => each.connection),
    ),
    ...(indexLagging(readings.indexWaitSeconds) ? failing('index_lagging', ['']) : []),
    ...failing(
      'integrity_failing',
      readings.integrity.filter((each) => each.failing > 0).map((each) => each.class),
    ),
    // Its key holds the replacement, so the next replacement's break is told again (ADM-047).
    ...(readings.secrets ?? [])
      .filter((each) => each.failing)
      .map((each) => ({
        kind: 'secret_failing' as const,
        subject: each.key,
        secret: each.secret,
      })),
  ];
}

/** Those not yet told, and the keys told of failures since cleared, forgotten so a return tells again. */
export function silentFailuresToTell(
  now: readonly SilentFailureNow[],
  told: readonly string[],
): { readonly tell: SilentFailureNow[]; readonly forget: string[] } {
  const keys = new Set(now.map(silentFailureKey));
  const already = new Set(told);
  return {
    tell: now.filter((each) => !already.has(silentFailureKey(each))),
    forget: told.filter((key) => !keys.has(key)),
  };
}
