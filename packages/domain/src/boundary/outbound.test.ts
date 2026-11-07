import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { OUTBOUND, OUTBOUND_EXCLUSIONS, OUTBOUND_WAYS } from './outbound.js';

const root = new URL('../../../../', import.meta.url);

/** Every module of the deployables, but tests and their stand-ins. */
function modules(folder: string): string[] {
  const found: string[] = [];
  const walk = (relative: string) => {
    for (const name of readdirSync(new URL(relative, root))) {
      const path = `${relative}/${name}`;
      if (statSync(new URL(path, root)).isDirectory()) {
        if (name !== 'testing' && name !== 'test') walk(path);
      } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
        found.push(path);
      }
    }
  };
  walk(folder);
  return found;
}

/**
 * Whether a module opens a way out itself: a socket, an HTTP request, an SMTP transport, a database
 * client, a `fetch`, or the connector's own guarded exchange, which every caller of it is named for.
 */
const SENDS = [
  /import\s*\{[^}]*\brequest\b[^}]*\}\s*from\s*'node:https?'/,
  /import\s*\{[^}]*\bconnect\b[^}]*\}\s*from\s*'node:(net|tls)'/,
  /from\s*'nodemailer'/,
  /new pg\.(Client|Pool)\b|extends pg\.(Client|Pool)\b/,
  /import\s*\{[^}]*\b(exchange|stream|deliver)\b[^}]*\}\s*from\s*'\.\/https\.js'/,
  /\?\?\s*(globalThis\.)?fetch\b/,
  /(?<![.\w$])fetch\s*\(/,
];

function senders(): string[] {
  return ['apps/connector/src', 'apps/service/src', 'apps/worker/src']
    .flatMap(modules)
    .filter((path) => {
      // Its code alone: a comment naming a fetch sends nothing.
      const text = readFileSync(new URL(path, root), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // A local `fetch` (a source's own read, say) is not the global one.
      const own = /\b(const|let|var)\s+fetch\b/.test(text);
      return SENDS.some((pattern, at) =>
        at === SENDS.length - 1 && own ? false : pattern.test(text),
      );
    })
    .sort();
}

describe('everything that can leave a tenant (the SA plan, SA-J)', () => {
  it('ADM-041 declares each way out: what may leave, whether on by default, who changes it and any residency', () => {
    expect(OUTBOUND.map((each) => each.way)).toEqual([...OUTBOUND_WAYS]);
    for (const each of OUTBOUND) {
      expect(each.what.length, each.way).toBeGreaterThan(20);
      expect(typeof each.onByDefault, each.way).toBe('boolean');
      if (each.absent === undefined) {
        expect(each.changedBy, each.way).not.toBeNull();
      } else {
        expect(each.changedBy, each.way).toBeNull();
        expect(each.senders, each.way).toEqual([]);
      }
      expect(['endpoint', 'not_declared']).toContain(each.residency);
    }
    // ADM-Q01 is open: a residency is stated only where an endpoint declares its boundary.
    expect(
      OUTBOUND.filter((each) => each.residency === 'endpoint').map((each) => each.way),
    ).toEqual(['model_endpoint', 'embedding', 'translation']);
  });

  it('ADM-041 names every way the requirement lists, malware scanning as absent (AST-Q03)', () => {
    expect(OUTBOUND_WAYS).toEqual(
      expect.arrayContaining([
        'model_endpoint',
        'embedding',
        'reference_source',
        'translation',
        'malware_scanning',
        'data_connection',
        'webhook',
        'mail',
      ]),
    );
    const scanning = OUTBOUND.find((each) => each.way === 'malware_scanning')!;
    expect(scanning.absent).toMatch(/AST-Q03/);
    expect(scanning.onByDefault).toBe(false);
  });

  it('ADM-041 holds a row to every module of the service, worker and connector that sends out, or names why not', () => {
    const found = senders();
    // The scan finds what it should, so an empty one cannot pass.
    expect(found).toContain('apps/connector/src/mail.ts');
    expect(found).toContain('apps/connector/src/model.ts');
    expect(found).toContain('apps/worker/src/deliverer.ts');
    const named = new Set([
      ...OUTBOUND.flatMap((each) => each.senders),
      ...OUTBOUND_EXCLUSIONS.flatMap((each) => each.modules),
    ]);
    expect(found.filter((path) => !named.has(path))).toEqual([]);
    expect([...named].filter((path) => !found.includes(path)).sort()).toEqual([]);
    for (const each of OUTBOUND_EXCLUSIONS) expect(each.why.length, each.what).toBeGreaterThan(20);
  });
});
