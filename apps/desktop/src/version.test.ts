import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Workspace packages are deliberately unversioned at 0.0.0 - except this one. electron-builder
 * reads `version` from the desktop package.json and stamps it into the installer, the executable's
 * file properties and the Windows uninstall entry, so from here it is a mirror of version.json and
 * has to be bumped in lockstep. This test is the thing that fails when someone forgets.
 *
 * When another surface starts reading a version, add it here in the same PR that introduces it.
 */
const repoRoot = join(process.cwd(), '..', '..');

const read = (...parts: string[]): { version?: string } =>
  JSON.parse(readFileSync(join(repoRoot, ...parts), 'utf8')) as { version?: string };

const canonical = read('version.json').version;

describe('the version mirrors', () => {
  it('has a canonical version to mirror', () => {
    expect(canonical).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is mirrored by the root package.json', () => {
    expect(read('package.json').version).toBe(canonical);
  });

  it('is mirrored by the desktop package.json, which electron-builder reads', () => {
    expect(read('apps', 'desktop', 'package.json').version).toBe(canonical);
  });

  it('leaves the packages nothing publishes at 0.0.0', () => {
    expect(read('apps', 'web', 'package.json').version).toBe('0.0.0');
    expect(read('packages', 'domain', 'package.json').version).toBe('0.0.0');
  });

  it('matches the newest changelog entry', () => {
    const changelog = readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8');
    const newest = /^## (\d+\.\d+\.\d+)/m.exec(changelog);

    expect(newest?.[1]).toBe(canonical);
  });
});
