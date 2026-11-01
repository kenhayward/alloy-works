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
  it('DAT-089 calls the connector only from a route a person calls: nothing but the connection, model endpoint and assistant routes imports its client, and the worker reaches it to embed and to deliver webhooks alone', () => {
    // In the service, the client is imported by the connection routes, the model endpoint routes and
    // the assistant's run and a prompt's, each a person's ask (and its own test; the G1 plan, G1-L;
    // the G2 plan; the G4 plan).
    const importers = sources(here).filter((file) =>
      importsOf(join(here, file)).some((spec) => /(^|\/)connector\.js$/.test(spec)),
    );
    expect(importers.sort()).toEqual([
      // A reference source searched, or a result made an entry, as a person asks (the XR plan, XR-B).
      'bibliography/sources.ts',
      // The delivery connection's password sealed as an administrator turns data delivery on (API-072).
      'bridge/settings.ts',
      'data/connections.ts',
      'data/connector.test.ts',
      // An extension's manifest fetched as an administrator previews, installs or updates it (EX-B).
      'extensions.ts',
      'generation/assistant.ts',
      // An embedding model's sample, as an administrator confirms it (the G7 plan, G7-J).
      'generation/embedding.ts',
      // A search's words embedded as the person searches (the G7 plan, G7-G).
      // A machine draft of a translation, as its translator asks for it (the XL plan, XL-H).
      'generation/machine-drafts.ts',
      'generation/meaning.ts',
      'generation/models.ts',
      'generation/prompt-runs.ts',
      // The loop both runs share, which a route hands the client (the G5 plan, G5-A).
      'generation/run-loop.ts',
      // A webhook's signing secret sealed as an administrator makes or rotates it (the WB plan, WB-G).
      'webhooks.ts',
    ]);
    // And those routes are the connection routes, each a person's request: nothing the service runs
    // on its own - no job, no timer, no stream - reaches them.
    const scheduled = sources(here).filter((file) =>
      /setInterval|enqueueJob\([^)]*connect/.test(readFileSync(join(here, file), 'utf8')),
    );
    for (const file of scheduled) {
      expect(importsOf(join(here, file)), file).not.toContain('./data/connections.js');
    }
    // Of those routes, the ones that ask the connector are the six a person calls to act on a
    // source: setting a credential, a test, a describe - of the tables or of a statement - a sample
    // run, and resolving and checking a document's bindings (D3). Listing uses, reading and
    // versioning a connection ask it nothing, and neither do reading, accepting or naming a result,
    // whose module, `bindings.ts`, imports nothing of the connector's: it is lent the run.
    const routesText = readFileSync(join(here, 'data/connections.ts'), 'utf8');
    const handlers = routesText.split(/\n {4}(?=\w+: async \()/).slice(1);
    const asking = handlers
      .filter((body) => /\bconnected\(\)/.test(body))
      .map((body) => body.slice(0, body.indexOf(':')));
    expect(asking.sort()).toEqual([
      'checkBindings',
      'describeConnection',
      'resolveBindings',
      'sampleConnection',
      'setConnectionCredential',
      'testConnection',
      // And a vocabulary's source, fetched for a refresh an administrator asks for (VO-J).
      'vocabularySource',
    ]);
    // Of the model endpoint routes, setting a key and a test: listing, making, changing, retiring and
    // routing ask it nothing.
    const modelsText = readFileSync(join(here, 'generation/models.ts'), 'utf8');
    const modelHandlers = modelsText.split(/\n {4}(?=\w+: async \()/).slice(1);
    expect(
      modelHandlers
        .filter((body) => /\bconnected\(\)/.test(body))
        .map((body) => body.slice(0, body.indexOf(':')))
        .sort(),
    ).toEqual(['setModelEndpointKey', 'testModelEndpoint']);

    // The worker imports nothing of the connector's. Two modules of its own reach it: `embedder.ts`
    // at `/v1/embed` (the G7 plan, G7-E) and `deliverer.ts` at `/v1/deliver` (the WB plan, WB-F), each
    // with the key that opens that route alone; its configuration names the connector's address and
    // those keys, and nothing more of it.
    for (const file of sources(worker)) {
      const text = readFileSync(join(worker, file), 'utf8');
      expect(
        importsOf(join(worker, file)).filter((spec) => /connector/i.test(spec)),
        file,
      ).toEqual([]);
      if (!file.endsWith('.test.ts') && file !== 'config.ts') {
        expect(text, file).not.toMatch(/CONNECTOR_/);
      }
      if (
        !file.endsWith('.test.ts') &&
        !['embedder.ts', 'deliverer.ts', 'referencer.ts'].includes(file)
      ) {
        expect(text, file).not.toMatch(/\/v1\/(?!embed\b|deliver\b|reference\b)\w+/);
      }
    }
    const embedder = readFileSync(join(worker, 'embedder.ts'), 'utf8');
    expect([...new Set([...embedder.matchAll(/\/v1\/\w+/g)].map((match) => match[0]))]).toEqual([
      '/v1/embed',
    ]);
    const deliverer = readFileSync(join(worker, 'deliverer.ts'), 'utf8');
    expect([...new Set([...deliverer.matchAll(/\/v1\/\w+/g)].map((match) => match[0]))]).toEqual([
      '/v1/deliver',
    ]);
    const referencer = readFileSync(join(worker, 'referencer.ts'), 'utf8');
    expect([...new Set([...referencer.matchAll(/\/v1\/\w+/g)].map((match) => match[0]))]).toEqual([
      '/v1/reference',
    ]);
    expect(
      [...readFileSync(join(worker, 'config.ts'), 'utf8').matchAll(/\b(?:SECRET_)?CONNECTOR_\w+/g)]
        .map((match) => match[0])
        .filter((name, at, all) => all.indexOf(name) === at)
        .sort(),
    ).toEqual([
      'CONNECTOR_URL',
      'SECRET_CONNECTOR_DELIVER_KEY',
      'SECRET_CONNECTOR_EMBED_KEY',
      'SECRET_CONNECTOR_REFERENCE_KEY',
    ]);
  });
});
