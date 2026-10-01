import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = fileURLToPath(new URL('.', import.meta.url));
const worker = fileURLToPath(new URL('../../worker/src/', import.meta.url));

/** Every TypeScript source under a directory, tests and all, by its path from that directory. */
function sources(root: string): string[] {
  const walk = (at: string): string[] =>
    readdirSync(at).flatMap((name) => {
      const path = join(at, name);
      if (statSync(path).isDirectory()) return walk(path);
      return /\.tsx?$/.test(name) ? [path] : [];
    });
  return walk(root).map((path) => relative(root, path).split(sep).join('/'));
}

/** Every module a source imports, as its import statements spell them. */
function importsOf(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  return [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((match) => match[1]!);
}

describe("the connector's one caller", () => {
  it('DAT-089 calls the connector only from a route a person calls: nothing but the connection routes imports its client, and the worker has no address for it', () => {
    // In the service, the client is imported by the connection routes alone (and its own test).
    const importers = sources(here).filter((file) =>
      importsOf(join(here, file)).some((spec) => /(^|\/)connector\.js$/.test(spec)),
    );
    expect(importers.sort()).toEqual(['data/connections.ts', 'data/connector.test.ts']);
    // And those routes are the connection routes, each a person's request: nothing the service runs
    // on its own - no job, no timer, no stream - reaches them.
    const scheduled = sources(here).filter((file) =>
      /setInterval|enqueueJob\([^)]*connect/.test(readFileSync(join(here, file), 'utf8')),
    );
    for (const file of scheduled) {
      expect(importsOf(join(here, file)), file).not.toContain('./data/connections.js');
    }
    // Of those routes, the ones that ask the connector are the four a person calls to act on a
    // source: setting a credential, a test, a describe - of the tables or of a statement - and a
    // sample run. Listing uses, reading and versioning a connection ask it nothing.
    const routesText = readFileSync(join(here, 'data/connections.ts'), 'utf8');
    const handlers = routesText.split(/\n {4}(?=\w+: async \()/).slice(1);
    const asking = handlers
      .filter((body) => /\bconnected\(\)/.test(body))
      .map((body) => body.slice(0, body.indexOf(':')));
    expect(asking.sort()).toEqual([
      'describeConnection',
      'sampleConnection',
      'setConnectionCredential',
      'testConnection',
    ]);

    // The worker imports nothing of the connector's, names no connector in its configuration, and
    // is given no address for one.
    for (const file of sources(worker)) {
      const text = readFileSync(join(worker, file), 'utf8');
      expect(
        importsOf(join(worker, file)).filter((spec) => /connector/i.test(spec)),
        file,
      ).toEqual([]);
      if (!file.endsWith('.test.ts')) expect(text, file).not.toMatch(/CONNECTOR_/);
    }
    expect(readFileSync(join(worker, 'config.ts'), 'utf8')).not.toMatch(/connector/i);
  });
});
