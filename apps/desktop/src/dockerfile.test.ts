import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The image build's downloads (issue #181). Here with the other repository-wide checks, for the
 * reason `decisions.test.ts` gives.
 */
const dockerfile = readFileSync(
  join(process.cwd(), '..', '..', 'deploy', 'Dockerfile'),
  'utf8',
).replace(/\\\r?\n/g, ' ');

describe('the image build', () => {
  it('retries a download the release host answers with an error, rather than failing the build on it', () => {
    // Invocations only: `curl` followed by its options, not the package named to apt-get.
    const downloads = dockerfile.match(/\bcurl\s+-[^&|;]*/g) ?? [];
    expect(downloads.length).toBeGreaterThan(0);
    for (const download of downloads) {
      expect(download).toMatch(/--retry \d+/);
      expect(download).toMatch(/--retry-all-errors/);
    }
  });

  // The install sees only the manifests copied before it: a workspace an image's package depends on,
  // even for its tests alone, whose manifest is not there fails the frozen install - found when the
  // worker's suite came to import the conformance kit (the W15 plan's W15.1).
  it('copies the manifest of every workspace the packages it installs depend on before installing', () => {
    const root = join(process.cwd(), '..', '..');
    const manifest = (dir: string) =>
      JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')) as {
        name: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
    const copied = [...dockerfile.matchAll(/COPY\s+(\S+)\/package\.json\s/g)].map(
      (each) => each[1]!,
    );
    const byName = new Map(
      ['apps', 'packages', 'tests'].flatMap((group) =>
        readdirSync(join(root, group), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => `${group}/${entry.name}`)
          .filter((dir) => existsSync(join(root, dir, 'package.json')))
          .map((dir) => [manifest(dir).name, dir] as const),
      ),
    );
    const installed = [...dockerfile.matchAll(/--filter\s+"(@alloy-works\/[a-z-]+)\.\.\."/g)].map(
      (each) => each[1]!,
    );
    expect(installed.length).toBeGreaterThan(0);
    const needed = new Set<string>();
    const visit = (name: string) => {
      const dir = byName.get(name);
      if (dir === undefined || needed.has(dir)) return;
      needed.add(dir);
      const { dependencies = {}, devDependencies = {} } = manifest(dir);
      for (const [each, range] of Object.entries({ ...dependencies, ...devDependencies })) {
        if (range.startsWith('workspace:')) visit(each);
      }
    };
    installed.forEach(visit);
    expect([...needed].filter((dir) => !copied.includes(dir)).sort()).toEqual([]);
  });
});
