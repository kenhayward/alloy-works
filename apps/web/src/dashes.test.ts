import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// The package's own directory, as icons.test.ts finds it: every suite runs from there.
const SOURCE = join(process.cwd(), 'src');

/** Every renderer source file a person's screen is built from: not tests, not the test setup. */
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'test' ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/**
 * The text a file can put in front of a person: string literals, template text and JSX text. Read
 * through the TypeScript parser, so a dash in a comment - which CLAUDE.md exempts - is never looked at.
 */
function visibleText(path: string): { text: string; line: number }[] {
  const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const found: { text: string; line: number }[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      found.push({
        text: node.text,
        line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe('text the renderer shows', () => {
  it('uses a plain hyphen, never an en or em dash', () => {
    const files = sources(SOURCE);
    expect(files.length).toBeGreaterThan(0);
    const dashed = files.flatMap((path) =>
      visibleText(path)
        .filter(({ text }) => /[–—]/.test(text))
        .map(({ line }) => `${relative(SOURCE, path)}:${line}`),
    );
    expect(dashed).toEqual([]);
  });

  it('finds a dash in a string and ignores one in a comment', () => {
    const path = join(SOURCE, 'test', 'dashed.fixture.tsx');
    expect(visibleText(path).map(({ text }) => /[–—]/.test(text))).toEqual([true, false]);
  });
});
