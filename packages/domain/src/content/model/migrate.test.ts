import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CURRENT_SCHEMA_VERSION, parseContentDocument } from './document.js';
import { markTypes } from './marks.js';
import { migrate, readContent } from './migrate.js';

const fixtures = join(import.meta.dirname, 'fixtures');

describe('schema versions and migration', () => {
  it('CNT-012 migrates every fixture of every schema version to the current one', () => {
    const versions = readdirSync(fixtures);
    expect(versions.length).toBeGreaterThan(0);
    for (const version of versions) {
      for (const name of readdirSync(join(fixtures, version))) {
        const stored = JSON.parse(readFileSync(join(fixtures, version, name), 'utf8'));
        const migrated = migrate(stored);
        expect(() => parseContentDocument(migrated), `${version}/${name}`).not.toThrow();
        expect((migrated as { schemaVersion: number }).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      }
    }
  });

  it('CNT-012 keeps a fixture carrying every construct, so a migration cannot drop one unnoticed', () => {
    // The every-node fixture only earns its name while something checks it. Without this, a node
    // added to the schema and forgotten here leaves the next migration untested against it - and by
    // then there is stored content in that shape, which CNT-012 says stays readable for decades.
    const found = new Set<string>();
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const member of value) collect(member);
        return;
      }
      if (typeof value !== 'object' || value === null) return;
      const record = value as Record<string, unknown>;
      if (typeof record.type === 'string') found.add(record.type);
      for (const member of Object.values(record)) collect(member);
    };
    collect(JSON.parse(readFileSync(join(fixtures, 'v1', 'every-node.json'), 'utf8')));

    const missing = [
      'paragraph',
      'list',
      'table',
      'figure',
      'preformatted',
      'blockquote',
      'equation',
      'text',
      'footnote',
      'crossReference',
      'citation',
      'variable',
      'binding',
      'image',
      ...markTypes,
    ].filter((type) => !found.has(type));
    expect(missing).toEqual([]);
  });

  it('CNT-012 refuses a schema version it has no path from, by name', () => {
    expect(() =>
      migrate({ schemaVersion: 99, title: 'x', language: 'en-GB', direction: 'ltr', content: [] }),
    ).toThrow(/99/);
  });

  it('CNT-012 refuses content that records no schema version at all', () => {
    expect(() => migrate({ title: 'x', language: 'en-GB', direction: 'ltr', content: [] })).toThrow(
      /schema version/i,
    );
  });

  it('CNT-013 quarantines content that fails validation on read-back, naming what failed', () => {
    const outcome = readContent(
      { schemaVersion: 1, title: '', language: 'en-GB', direction: 'ltr', content: [] },
      {
        artifact: 'component-7',
        version: '3.14',
      },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected a quarantine');
    expect(outcome.artifact).toBe('component-7');
    expect(outcome.version).toBe('3.14');
    expect(outcome.failure).toMatch(/title/);
  });

  it('CNT-013 yields no partial content from a failed read', () => {
    const outcome = readContent(
      {
        schemaVersion: 1,
        title: 'x',
        language: 'en-GB',
        direction: 'ltr',
        content: [{ type: 'paragraph' }],
      },
      {
        artifact: 'component-8',
        version: '1.0',
      },
    );
    expect(outcome).not.toHaveProperty('document');
  });

  it('CNT-013 returns the document when it reads back cleanly', () => {
    const stored = JSON.parse(readFileSync(join(fixtures, 'v1', 'minimal.json'), 'utf8'));
    const outcome = readContent(stored, { artifact: 'component-9', version: '1.0' });
    expect(outcome.ok).toBe(true);
  });
});
