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

/**
 * What reaches the network, or loads an address, other than through the generated client and the
 * stream reader: named so a finding says which.
 */
const NETWORK = new Set([
  'fetch',
  'sendBeacon',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'Worker',
  'SharedWorker',
  'Image',
]);

interface Found {
  readonly file: string;
  readonly line: number;
  readonly what: string;
}

/**
 * Where an identifier only names something - a property being declared or assigned, a member of a
 * pattern - rather than reaching the value it names.
 */
function namesOnly(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    ((ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isVariableDeclaration(parent)) &&
      parent.name === node) ||
    (ts.isBindingElement(parent) && parent.propertyName === node && !fromTheGlobal(parent)) ||
    (ts.isBindingElement(parent) && parent.name === node && !fromTheGlobal(parent)) ||
    ts.isImportSpecifier(parent) ||
    ts.isJsxAttribute(parent)
  );
}

/** The objects the environment's own network lives on. */
const GLOBALS = new Set(['globalThis', 'window', 'self']);

/** Whether a destructuring reads the environment itself: `const { fetch: f } = globalThis`. */
function fromTheGlobal(element: ts.BindingElement): boolean {
  const pattern = element.parent;
  const declaration = pattern.parent;
  return (
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer !== undefined &&
    ts.isIdentifier(declaration.initializer) &&
    GLOBALS.has(declaration.initializer.text)
  );
}

/** A template as a pattern: each substitution one path segment, anything from a `?` on dropped. */
function templatePattern(node: ts.TemplateExpression): RegExp {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let pattern = '';
  const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
  for (const [index, text] of parts.entries()) {
    const cut = text.indexOf('?');
    pattern += escape(cut === -1 ? text : text.slice(0, cut));
    if (cut !== -1) break;
    if (index < parts.length - 1) pattern += '[^/]+';
  }
  return new RegExp(`^${pattern}$`);
}

/**
 * Every reach for the network in a file - a call, a construction, a property or an element named for
 * one, however it is reached, and an `import()` of anything but a literal - and every address under
 * `/v1` it names, whole: a string, or a template matched as a pattern. Read through the TypeScript
 * parser, so a comment and a type are never mistaken for code. It reads the code, not every way code
 * can be written: an address assembled from a variable's value, a name computed at run time, and a
 * script element given a source are a review's to catch. It fails closed: a function of the renderer's
 * own named `Image`, or a method named `fetch`, is flagged too, and has to be renamed.
 */
function scan(
  path: string,
  paths: readonly string[],
): { reaches: Found[]; undeclared: Found[]; declared: Found[] } {
  const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const at = (node: ts.Node, what: string) => ({
    file: relative(SOURCE, path),
    line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
    what,
  });
  const reaches: Found[] = [];
  const undeclared: Found[] = [];
  const declared: Found[] = [];
  const route = (address: string) => paths.includes(address.split('?')[0]!);
  // The names the file declares itself, so a function of its own is not taken for the window's.
  const ownNames = new Set<string>();
  const declare = (node: ts.Node) => {
    if (
      (ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isParameter(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name)
    ) {
      ownNames.add(node.name.text);
    }
    ts.forEachChild(node, declare);
  };
  declare(file);
  const visit = (node: ts.Node) => {
    // A type says nothing about what runs.
    if (ts.isTypeNode(node)) return;
    if (ts.isIdentifier(node) && NETWORK.has(node.text) && !namesOnly(node)) {
      reaches.push(at(node, node.text));
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      NETWORK.has(node.argumentExpression.text)
    ) {
      reaches.push(at(node, node.argumentExpression.text));
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      GLOBALS.has(node.expression.text) &&
      node.name.text === 'open'
    ) {
      reaches.push(at(node, `${node.expression.text}.open`));
    }
    // A bare `open` is the window's, unless the file declares one of its own.
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'open' &&
      !ownNames.has('open')
    ) {
      reaches.push(at(node, 'open'));
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [what] = node.arguments;
      if (
        !what ||
        !ts.isStringLiteralLike(what) ||
        /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(what.text)
      ) {
        reaches.push(at(node, 'import()'));
      }
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (node.text.startsWith('/v1')) {
        if (route(node.text)) declared.push(at(node, node.text));
        else undeclared.push(at(node, node.text));
      } else if (node.text.includes('/v1/') || node.text.startsWith('v1/')) {
        undeclared.push(at(node, node.text));
      }
    }
    if (ts.isTemplateExpression(node) && node.head.text.startsWith('/v1')) {
      const pattern = templatePattern(node);
      if (paths.some((path) => pattern.test(path))) declared.push(at(node, node.getText()));
      else undeclared.push(at(node, node.getText()));
      // Its parts are the address's, judged as one above.
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      ((ts.isStringLiteralLike(node.left) && node.left.text.startsWith('/v1')) ||
        (ts.isTemplateExpression(node.left) && node.left.head.text.startsWith('/v1')))
    ) {
      undeclared.push(at(node, node.getText()));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { reaches, undeclared, declared };
}

describe('the interface and the API', () => {
  it('API-061 reads and changes stored state only through the API: no network call but the generated client, and no address the contract does not declare', () => {
    const paths = Object.keys(
      (JSON.parse(readFileSync(CONTRACT, 'utf8')) as { paths: Record<string, unknown> }).paths,
    );
    expect(paths.length).toBeGreaterThan(0);
    const files = sources(SOURCE);
    expect(files.length).toBeGreaterThan(0);
    const found = files.map((path) => scan(path, paths));

    // Nothing in the renderer reaches the network itself: the client and the stream reader, from
    // @alloy-works/api-client, call `fetch`, and the renderer only ever hands them a stand-in for it.
    expect(found.flatMap((each) => each.reaches)).toEqual([]);

    // And every address the renderer names - the client's typed paths, a link to sign in - is a
    // route the contract declares, whole. The scan does read them: dozens are found and declared.
    expect(found.flatMap((each) => each.undeclared)).toEqual([]);
    expect(found.flatMap((each) => each.declared).length).toBeGreaterThan(20);
  });
});
