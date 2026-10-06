import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const repository = join(root, '..', '..');

interface Manifest {
  readonly name: string;
  readonly dependencies?: Record<string, string>;
}

const manifestOf = (directory: string) =>
  JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as Manifest;

/** Every workspace package, by name, and where it is. */
function workspaces(): Map<string, string> {
  const found = new Map<string, string>();
  for (const group of ['apps', 'packages']) {
    for (const entry of readdirSync(join(repository, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = join(repository, group, entry.name);
      try {
        found.set(manifestOf(directory).name, directory);
      } catch {
        // Not a package.
      }
    }
  }
  return found;
}

/** Every module a source file imports, by its specifier. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [
    ...text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+'([^']+)'|import\('([^']+)'\)/g),
  ].map((match) => match[1] ?? match[2]!);
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'testing' ? [] : sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe("the connector's package", () => {
  it("DAT-056 has no dependency that reaches the platform: no database library of the platform's, no object store, no service", () => {
    const manifest = manifestOf(root);
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(
      [
        '@alloy-works/domain',
        '@alloy-works/sealing',
        // The S3 source's signer and the CSV reader (the D6 plan, D6-C and D6-H).
        '@smithy/signature-v4',
        'csv-parse',
        'pg',
        'zod',
      ].sort(),
    );

    // Nothing the connector ships imports anything but Node's own modules, its own files and the six,
    // or an entry point one of them exports, such as `csv-parse/sync`.
    const allowed = new Set(Object.keys(manifest.dependencies ?? {}));
    const files = sourceFiles(join(root, 'src'));
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      for (const specifier of importsOf(file)) {
        // Its own files: relative, and inside its source, a reader in a folder of its own among them.
        const own =
          (specifier.startsWith('./') || specifier.startsWith('../')) &&
          resolve(dirname(file), specifier).startsWith(join(root, 'src'));
        const known =
          own ||
          specifier.startsWith('node:') ||
          builtinModules.includes(specifier) ||
          allowed.has(specifier) ||
          allowed.has(specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/'));
        expect(known, `${file} imports ${specifier}`).toBe(true);
      }
    }

    // And the workspace packages it depends on reach none of the platform's, however deep.
    const where = workspaces();
    const platform = ['@alloy-works/db', '@alloy-works/objects', '@alloy-works/service'];
    const reached = new Set<string>();
    const walk = (name: string) => {
      if (reached.has(name)) return;
      reached.add(name);
      const directory = where.get(name);
      if (!directory) return;
      for (const dependency of Object.keys(manifestOf(directory).dependencies ?? {}))
        walk(dependency);
    };
    walk(manifest.name);
    for (const name of platform) expect(reached.has(name), name).toBe(false);
    expect(reached.has('@alloy-works/sealing')).toBe(true);
  });
});
