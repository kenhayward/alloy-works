import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

/**
 * The service's port is written in several places that have to agree: the service's own default,
 * the settings for running it from source, the renderer's dev proxy, the stand-in provider's
 * redirect addresses, the compose stack's default and the end-to-end suite's default. A sign-in
 * redirect carries the address that made it, so one of them drifting is a sign-in that goes nowhere.
 */
const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8');

const port = loadConfig({ DATABASE_URL: 'postgres://aw_service:pw@127.0.0.1:5432/alloy_dev' }).port;

describe('the service port', () => {
  it('defaults to 8088', () => {
    expect(port).toBe(8088);
  });

  it('is the same default everywhere the service is addressed', () => {
    const env = read('deploy/service.env.example');
    expect(env).toMatch(new RegExp(`^PORT=${port}$`, 'm'));
    expect(env).toMatch(new RegExp(`^SIGN_IN_HOST=signin\\.localhost:${port}$`, 'm'));

    expect(read('apps/web/vite.config.ts')).toContain(`target: 'http://127.0.0.1:${port}'`);

    const standIn = [
      ...read('packages/stand-in-idp/src/main.ts').matchAll(/https?:\/\/[a-z.]*localhost:(\d+)/g),
    ].map((address) => address[1]);
    expect(standIn.length).toBeGreaterThan(0);
    for (const each of standIn) expect(each).toBe(String(port));

    expect(read('tests/e2e/src/stack.test.ts')).toContain(`'http://127.0.0.1:${port}'`);
  });

  it('comes from deploy/.env in the compose stack, defaulting to the same port', () => {
    const compose = read('deploy/compose.yaml');
    expect(compose).toContain(`\${SERVICE_PORT:-${port}}`);
    expect(read('deploy/.env.example')).toMatch(new RegExp(`^SERVICE_PORT=${port}$`, 'm'));
  });
});

describe('the compose stack', () => {
  it('publishes every port from a variable, never a fixed number', () => {
    const compose = read('deploy/compose.yaml');
    const published = [...compose.matchAll(/^\s+- '127\.0\.0\.1:([^']+)'$/gm)].map((m) => m[1]);
    expect(published.length).toBeGreaterThan(0);
    for (const mapping of published) {
      expect(mapping).toMatch(/^\$\{[A-Z_]+:-\d+\}:/);
    }
  });

  it('names every variable it reads in deploy/.env.example, with the same default', () => {
    const compose = read('deploy/compose.yaml');
    const example = read('deploy/.env.example');
    const defaults = new Map<string, string>();
    for (const match of compose.matchAll(/\$\{([A-Z_]+):-(\d+)\}/g)) {
      const [, name, value] = match;
      if (name === undefined || value === undefined) continue;
      expect(defaults.get(name) ?? value, `${name} has two defaults`).toBe(value);
      defaults.set(name, value);
    }
    expect(defaults.size).toBeGreaterThan(0);
    for (const [name, value] of defaults) {
      expect(example).toMatch(new RegExp(`^${name}=${value}$`, 'm'));
    }
  });
});
