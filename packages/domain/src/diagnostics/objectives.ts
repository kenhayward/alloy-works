/**
 * **What the product promises, and whether it keeps it** (diagnostics.md; the DG plan, DG-D; ADR-0101):
 * availability a month, a recovery point and a recovery time, each an operator's setting with a declared
 * default, read against what the worker's probes and the backups' own records say.
 */

export interface Objectives {
  /** The fraction of a month's minutes the service answers. */
  readonly availability: number;
  /** The most work a restore may lose: the age of the oldest class's last good backup. */
  readonly recoveryPointHours: number;
  /** The longest a restore of every class may take, as a drill measures it. */
  readonly recoveryTimeHours: number;
}

export const OBJECTIVE_DEFAULTS: Objectives = {
  availability: 0.995,
  recoveryPointHours: 24,
  recoveryTimeHours: 4,
};

/** Each class backed up, and drilled, on its own (ADM-043). */
export const BACKUP_CLASSES = ['databases', 'objects'] as const;

/**
 * A drill runs monthly (`alloy-drill.timer`); a class whose restore has not succeeded within this many
 * days is not rehearsed, and its recovery time is not presented as one (ADM-043).
 */
export const REHEARSED_WITHIN_DAYS = 35;

/** The objectives an operator set, or the defaults; a value that is not one throws, naming it. */
export function objectivesFrom(env: Readonly<Record<string, string | undefined>>): Objectives {
  const read = (name: string, fallback: number, valid: (value: number) => boolean) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || !valid(value)) throw new Error(`${name} is not valid: ${raw}`);
    return value;
  };
  return {
    availability: read(
      'OBJECTIVE_AVAILABILITY',
      OBJECTIVE_DEFAULTS.availability,
      (v) => v > 0 && v < 1,
    ),
    recoveryPointHours: read(
      'OBJECTIVE_RECOVERY_POINT_HOURS',
      OBJECTIVE_DEFAULTS.recoveryPointHours,
      (v) => v > 0,
    ),
    recoveryTimeHours: read(
      'OBJECTIVE_RECOVERY_TIME_HOURS',
      OBJECTIVE_DEFAULTS.recoveryTimeHours,
      (v) => v > 0,
    ),
  };
}

export interface BackupRun {
  readonly class: (typeof BACKUP_CLASSES)[number];
  readonly act: 'backup' | 'drill';
  readonly lastStartedAt: Date;
  readonly lastSeconds: number;
  readonly lastOutcome: 'succeeded' | 'failed';
  readonly succeededAt: Date | null;
}

export interface ObjectiveMeasures {
  /** The first minute ever probed, and the minutes probed up since the month began. */
  readonly probes: { readonly firstProbe: Date | null; readonly up: number };
  /** The latest run of each class and act; none where nothing records backups. */
  readonly runs: readonly BackupRun[];
}

/** Recorded nowhere here; or, for a recovery time, not rehearsed in the stated period. */
export type ObjectiveVerdict = 'met' | 'missed' | 'unrecorded' | 'unrehearsed';

export interface ObjectiveReadings {
  readonly availability: {
    readonly objective: number;
    readonly since: Date;
    readonly measured: number | null;
    readonly verdict: ObjectiveVerdict;
  };
  readonly recoveryPoint: {
    readonly objectiveHours: number;
    readonly hours: number | null;
    readonly verdict: ObjectiveVerdict;
  };
  readonly recoveryTime: {
    readonly objectiveHours: number;
    readonly hours: number | null;
    /** The oldest class's last good drill. */
    readonly drilledAt: Date | null;
    readonly verdict: ObjectiveVerdict;
  };
}

const HOUR = 3_600_000;
const MINUTE = 60_000;

/** Each objective against what was measured, at `now`. */
export function objectiveReadings(
  objectives: Objectives,
  measured: ObjectiveMeasures,
  now: Date,
): ObjectiveReadings {
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const first = measured.probes.firstProbe;
  const since = first === null || first < month ? month : first;
  const minutes = Math.floor((now.getTime() - since.getTime()) / MINUTE);
  const availability =
    first === null || minutes <= 0 ? null : Math.min(measured.probes.up, minutes) / minutes;

  const ofAct = (act: BackupRun['act']) =>
    BACKUP_CLASSES.map((cls) => measured.runs.find((run) => run.class === cls && run.act === act));
  const recorded = measured.runs.length > 0;

  const backups = ofAct('backup');
  const backedUp = backups.every((run) => run?.succeededAt != null)
    ? Math.max(...backups.map((run) => (now.getTime() - run!.succeededAt!.getTime()) / HOUR))
    : null;

  const drills = ofAct('drill');
  const rehearsed = drills.every(
    (run) =>
      run !== undefined &&
      run.lastOutcome === 'succeeded' &&
      run.succeededAt !== null &&
      now.getTime() - run.succeededAt.getTime() <= REHEARSED_WITHIN_DAYS * 24 * HOUR,
  );
  // The classes restore one after another, so a whole restore takes their sum.
  const drillHours = rehearsed
    ? drills.reduce((sum, run) => sum + run!.lastSeconds, 0) / 3600
    : null;
  const drilledAt = rehearsed
    ? new Date(Math.min(...drills.map((run) => run!.succeededAt!.getTime())))
    : null;

  return {
    availability: {
      objective: objectives.availability,
      since,
      measured: availability,
      verdict:
        availability === null
          ? 'unrecorded'
          : availability >= objectives.availability
            ? 'met'
            : 'missed',
    },
    recoveryPoint: {
      objectiveHours: objectives.recoveryPointHours,
      hours: backedUp,
      verdict: !recorded
        ? 'unrecorded'
        : backedUp !== null && backedUp <= objectives.recoveryPointHours
          ? 'met'
          : 'missed',
    },
    recoveryTime: {
      objectiveHours: objectives.recoveryTimeHours,
      hours: drillHours,
      drilledAt,
      verdict: !recorded
        ? 'unrecorded'
        : drillHours === null
          ? 'unrehearsed'
          : drillHours <= objectives.recoveryTimeHours
            ? 'met'
            : 'missed',
    },
  };
}
