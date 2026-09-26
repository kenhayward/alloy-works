import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// The package's own directory, as icons.test.ts finds it: every suite runs from there.
const SOURCE = join(process.cwd(), 'src');
/** The contract as committed, which the client's types are generated from and CI holds to the code. */
const CONTRACT = join(process.cwd(), '..', '..', 'packages', 'api-contract', 'openapi.json');

/** Every renderer source file: not tests, not the test setup. */
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'test' ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** What reaches the network other than through the generated client: named so a finding says which. */
const OUTSIDE_THE_CLIENT = ['XMLHttpRequest', 'WebSocket', 'EventSource'];

interface Found {
  readonly file: string;
  readonly line: number;
  readonly what: string;
  /** A template's text before a substitution, which names the start of an address, not the whole. */
  readonly partial?: boolean;
}

/**
 * Every call of `fetch`, every construction of another network object and every `sendBeacon` in a
 * file, and every address under `/v1/` it names - a string, or a template's text up to its first
 * substitution. Read through the TypeScript parser, so a comment is never mistaken for code.
 */
function scan(path: string): { calls: Found[]; addresses: Found[] } {
  const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const at = (node: ts.Node) => ({
    file: relative(SOURCE, path),
    line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
  });
  const calls: Found[] = [];
  const addresses: Found[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : '';
      if (name === 'fetch' || name === 'sendBeacon') calls.push({ ...at(node), what: name });
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      if (OUTSIDE_THE_CLIENT.includes(node.expression.text)) {
        calls.push({ ...at(node), what: node.expression.text });
      }
    }
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node)) &&
      node.text.startsWith('/v1/')
    ) {
      addresses.push({ ...at(node), what: node.text, partial: ts.isTemplateHead(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { calls, addresses };
}

/**
 * Whether an address the renderer names is a route the contract declares: the whole route for a string,
 * and the start of one for a template's text before its first substitution. A query is not the route's.
 */
function declared(found: Found, paths: readonly string[]): boolean {
  const bare = found.what.split('?')[0]!;
  return paths.some((path) => (found.partial ? path.startsWith(bare) : path === bare));
}

describe('the interface and the API', () => {
  it('API-061 reads and changes stored state only through the API: no network call but the generated client, and no address the contract does not declare', () => {
    const paths = Object.keys(
      (JSON.parse(readFileSync(CONTRACT, 'utf8')) as { paths: Record<string, unknown> }).paths,
    );
    expect(paths.length).toBeGreaterThan(0);
    const files = sources(SOURCE);
    expect(files.length).toBeGreaterThan(0);
    const found = files.map(scan);

    // Nothing in the renderer reaches the network itself: the client and the stream reader, from
    // @alloy-works/api-client, are handed `fetch` and are the only things that call it.
    expect(found.flatMap((each) => each.calls)).toEqual([]);

    // And every address the renderer names - the client's typed paths, a link to sign in - is a
    // route the contract declares.
    const addresses = found.flatMap((each) => each.addresses);
    expect(addresses.length).toBeGreaterThan(0);
    expect(addresses.filter((each) => !declared(each, paths))).toEqual([]);
  });
});
