import { describe, expect, it } from 'vitest';

import { migrateStored, type MigrationChain } from './migrate.js';

const chain: MigrationChain = {
  subject: 'widget',
  current: 3,
  migrations: {
    1: (value) => ({ ...value, steps: ['1to2'] }),
    2: (value) => ({ ...value, steps: [...(value.steps as string[]), '2to3'] }),
  },
};

describe('the migration chain every stored payload takes', () => {
  it('CNT-012 applies every step from the recorded version to the current one, in order', () => {
    expect(migrateStored({ schemaVersion: 1 }, chain)).toEqual({
      schemaVersion: 3,
      steps: ['1to2', '2to3'],
    });
  });

  it('CNT-012 applies no step to a payload already at the current version', () => {
    expect(migrateStored({ schemaVersion: 3, steps: [] }, chain)).toEqual({
      schemaVersion: 3,
      steps: [],
    });
  });

  it('CNT-012 projects rather than rewrites, so the stored value is untouched', () => {
    const stored = { schemaVersion: 1 };
    migrateStored(stored, chain);
    expect(stored).toEqual({ schemaVersion: 1 });
  });

  it('CNT-012 names the step that is missing', () => {
    expect(() =>
      migrateStored({ schemaVersion: 1 }, { ...chain, migrations: { 1: chain.migrations[1]! } }),
    ).toThrow(/widget from schema version 2 to 3/);
  });

  it('CNT-011 refuses a payload that records no schema version, naming its subject', () => {
    expect(() => migrateStored({}, chain)).toThrow(/widget records no schema version/);
  });

  it('CNT-012 refuses a version newer than this build, by number', () => {
    expect(() => migrateStored({ schemaVersion: 4 }, chain)).toThrow(/4/);
  });
});
