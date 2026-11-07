import { describe, expect, it } from 'vitest';

import {
  OBJECTIVE_DEFAULTS,
  objectiveReadings,
  objectivesFrom,
  type BackupRun,
} from './objectives.js';

const NOW = new Date('2026-11-07T12:00:00Z');
const MONTH = new Date('2026-11-01T00:00:00Z');
const MINUTES = (NOW.getTime() - MONTH.getTime()) / 60_000;
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

const run = (
  cls: BackupRun['class'],
  act: BackupRun['act'],
  succeededHoursAgo: number | null,
  lastSeconds = 600,
  lastOutcome: BackupRun['lastOutcome'] = 'succeeded',
): BackupRun => ({
  class: cls,
  act,
  lastStartedAt: hoursAgo(succeededHoursAgo ?? 1),
  lastSeconds,
  lastOutcome,
  succeededAt: succeededHoursAgo === null ? null : hoursAgo(succeededHoursAgo),
});

const kept = [
  run('databases', 'backup', 10),
  run('objects', 'backup', 9),
  run('databases', 'drill', 24 * 5, 900),
  run('objects', 'drill', 24 * 5, 1800),
];

const probed = (up: number) => ({ firstProbe: new Date('2026-10-01T00:00:00Z'), up });

describe('the objectives declared and measured (the DG plan, DG-D)', () => {
  it('declares 99.5% a month, a recovery point of 24 hours and a recovery time of 4, each an operator setting', () => {
    expect(OBJECTIVE_DEFAULTS).toEqual({
      availability: 0.995,
      recoveryPointHours: 24,
      recoveryTimeHours: 4,
    });
    expect(objectivesFrom({})).toEqual(OBJECTIVE_DEFAULTS);
    expect(
      objectivesFrom({
        OBJECTIVE_AVAILABILITY: '0.999',
        OBJECTIVE_RECOVERY_POINT_HOURS: '12',
        OBJECTIVE_RECOVERY_TIME_HOURS: '2',
      }),
    ).toEqual({ availability: 0.999, recoveryPointHours: 12, recoveryTimeHours: 2 });
    expect(() => objectivesFrom({ OBJECTIVE_AVAILABILITY: '99.5' })).toThrow(
      /OBJECTIVE_AVAILABILITY/,
    );
    expect(() => objectivesFrom({ OBJECTIVE_RECOVERY_TIME_HOURS: 'soon' })).toThrow(
      /OBJECTIVE_RECOVERY_TIME_HOURS/,
    );
  });

  it("ADM-020 reads availability as the month's minutes probed up over the minutes elapsed, a minute unrecorded counting as down", () => {
    const read = objectiveReadings(
      OBJECTIVE_DEFAULTS,
      { probes: probed(MINUTES), runs: kept },
      NOW,
    );
    expect(read.availability).toEqual({
      objective: 0.995,
      since: MONTH,
      measured: 1,
      verdict: 'met',
    });
    const short = objectiveReadings(
      OBJECTIVE_DEFAULTS,
      { probes: probed(MINUTES - 60), runs: kept },
      NOW,
    );
    expect(short.availability.verdict).toBe('missed');
    expect(short.availability.measured).toBeCloseTo(1 - 60 / MINUTES);
    // Probing began this month: counted from its first minute.
    const begun = objectiveReadings(
      OBJECTIVE_DEFAULTS,
      { probes: { firstProbe: hoursAgo(2), up: 120 }, runs: kept },
      NOW,
    );
    expect(begun.availability).toMatchObject({ since: hoursAgo(2), measured: 1 });
    const never = objectiveReadings(
      OBJECTIVE_DEFAULTS,
      { probes: { firstProbe: null, up: 0 }, runs: kept },
      NOW,
    );
    expect(never.availability).toMatchObject({ measured: null, verdict: 'unrecorded' });
  });

  it('ADM-020 reads the recovery point as the age of the oldest class’s last good backup', () => {
    const read = objectiveReadings(
      OBJECTIVE_DEFAULTS,
      { probes: probed(MINUTES), runs: kept },
      NOW,
    );
    expect(read.recoveryPoint).toEqual({ objectiveHours: 24, hours: 10, verdict: 'met' });
    const stale = objectiveReadings(
      OBJECTIVE_DEFAULTS,
      {
        probes: probed(MINUTES),
        runs: [run('databases', 'backup', 30), kept[1]!, ...kept.slice(2)],
      },
      NOW,
    );
    expect(stale.recoveryPoint).toMatchObject({ hours: 30, verdict: 'missed' });
    const missing = objectiveReadings(
      OBJECTIVE_DEFAULTS,
      { probes: probed(MINUTES), runs: [kept[0]!] },
      NOW,
    );
    expect(missing.recoveryPoint).toMatchObject({ hours: null, verdict: 'missed' });
    const none = objectiveReadings(OBJECTIVE_DEFAULTS, { probes: probed(MINUTES), runs: [] }, NOW);
    expect(none.recoveryPoint).toMatchObject({ hours: null, verdict: 'unrecorded' });
  });

  it('ADM-043 reads the recovery time from the drills, and a restore not rehearsed in the stated period as not rehearsed', () => {
    const read = objectiveReadings(
      OBJECTIVE_DEFAULTS,
      { probes: probed(MINUTES), runs: kept },
      NOW,
    );
    expect(read.recoveryTime).toEqual({
      objectiveHours: 4,
      hours: 0.75,
      drilledAt: hoursAgo(24 * 5),
      verdict: 'met',
    });
    const slow = objectiveReadings(
      OBJECTIVE_DEFAULTS,
      {
        probes: probed(MINUTES),
        runs: [...kept.slice(0, 3), run('objects', 'drill', 48, 5 * 3600)],
      },
      NOW,
    );
    expect(slow.recoveryTime).toMatchObject({ hours: 5.25, verdict: 'missed' });
    const old = objectiveReadings(
      OBJECTIVE_DEFAULTS,
      { probes: probed(MINUTES), runs: [...kept.slice(0, 3), run('objects', 'drill', 24 * 40)] },
      NOW,
    );
    expect(old.recoveryTime.verdict).toBe('unrehearsed');
    const failed = objectiveReadings(
      OBJECTIVE_DEFAULTS,
      {
        probes: probed(MINUTES),
        runs: [...kept.slice(0, 3), run('objects', 'drill', null, 60, 'failed')],
      },
      NOW,
    );
    expect(failed.recoveryTime).toMatchObject({ hours: null, verdict: 'unrehearsed' });
    const backupsAlone = objectiveReadings(
      OBJECTIVE_DEFAULTS,
      { probes: probed(MINUTES), runs: kept.slice(0, 2) },
      NOW,
    );
    expect(backupsAlone.recoveryTime.verdict).toBe('unrehearsed');
    const none = objectiveReadings(OBJECTIVE_DEFAULTS, { probes: probed(MINUTES), runs: [] }, NOW);
    expect(none.recoveryTime.verdict).toBe('unrecorded');
  });
});
