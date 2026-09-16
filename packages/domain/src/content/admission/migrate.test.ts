import { describe, expect, it } from 'vitest';

import type { MigrationChain } from '../../stored/migrate.js';

import { migrateCandidate } from './migrate.js';
import { createReport } from './report.js';

/** A second schema version that renames a paragraph's `style` to `role`, standing in for the first real one. */
const twoVersions: MigrationChain = {
  subject: 'content',
  current: 2,
  migrations: {
    1: (value) => ({
      ...value,
      content: (value.content as Record<string, unknown>[]).map(({ style, ...block }) => ({
        ...block,
        role: style,
      })),
    }),
  },
};

const entriesOf = (report: ReturnType<typeof createReport>) =>
  report.entries.map(({ message: _, ...entry }) => entry);

describe('the migrate stage', () => {
  it('CNT-134 brings content written against an earlier schema version to the current one, and says so', () => {
    const report = createReport();
    const arrived = {
      schemaVersion: 1,
      content: [{ type: 'paragraph', style: 'body', content: [] }],
    };

    expect(migrateCandidate(arrived, report, twoVersions)).toEqual({
      ok: true,
      value: { schemaVersion: 2, content: [{ type: 'paragraph', role: 'body', content: [] }] },
    });
    expect(entriesOf(report)).toEqual([
      { stage: 'migrate', action: 'rewritten', subject: 'schemaVersion', detail: '1' },
    ]);
    expect(arrived.schemaVersion).toBe(1);
  });

  it('passes content already at the current version through, and reports nothing', () => {
    const report = createReport();
    const arrived = { schemaVersion: 1, content: [] };
    expect(migrateCandidate(arrived, report)).toEqual({ ok: true, value: arrived });
    expect(report.entries).toEqual([]);
  });

  it('CNT-134 refuses content from a schema version this build has no path from, by name', () => {
    const report = createReport();
    const outcome = migrateCandidate({ schemaVersion: 99, content: [] }, report);
    expect(outcome).toEqual({
      ok: false,
      failure:
        "Stored content was written against schema version 99, which is newer than this build's 1",
    });
    expect(entriesOf(report)).toEqual([
      { stage: 'migrate', action: 'refused', subject: 'schemaVersion' },
    ]);
  });

  it('refuses content that records no schema version', () => {
    const report = createReport();
    const outcome = migrateCandidate({ content: [] }, report);
    expect(outcome.ok).toBe(false);
    expect(entriesOf(report)).toEqual([
      { stage: 'migrate', action: 'refused', subject: 'schemaVersion' },
    ]);
  });
});
