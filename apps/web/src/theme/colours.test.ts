import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { applyTheme, THEMES } from './themes.js';

// The package's own directory, as dashes.test.ts finds it: every suite runs from there.
const WEB = process.cwd();
const TOKENS = join(WEB, 'src', 'theme', 'tokens.css');
const EDITOR = join(WEB, '..', '..', 'packages', 'editor');

const HEX = /(?:^|[^\w&/])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/;
const NAMED =
  /\b(?:black|white|red|green|blue|yellow|orange|purple|pink|gr[ae]y|navy|teal|silver|maroon|olive|lime|aqua|fuchsia|brown|cyan|magenta|gold|indigo|violet)\b/i;

/**
 * Every source a screen is styled or built from: not tests, not their fixtures - a theme a test is set
 * in is data, whose colours are the theme's - not the test setup, not a build.
 */
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ['test', 'node_modules', 'dist'].includes(entry.name) ? [] : sources(path);
    }
    return /\.(?:css|tsx?)$/.test(entry.name) && !/\.(?:test|fixture)\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

/** The lines of a stylesheet whose declared value writes a colour; comments are never read. */
function coloursInCss(text: string): number[] {
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  const found: number[] = [];
  for (const declaration of bare.matchAll(/[\w-]+\s*:\s*([^;{}]+)/g)) {
    const value = declaration[1] ?? '';
    if (HEX.test(value) || FUNCTION.test(value) || NAMED.test(value)) {
      found.push(bare.slice(0, declaration.index).split('\n').length);
    }
  }
  return found;
}

/** The lines of a TypeScript file whose strings write a colour, read through the parser. */
function coloursInScript(path: string, text: string): number[] {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const found: number[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      if (HEX.test(node.text) || FUNCTION.test(node.text)) {
        found.push(file.getLineAndCharacterOfPosition(node.getStart()).line + 1);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function coloursIn(path: string, text: string): number[] {
  return path.endsWith('.css') ? coloursInCss(text) : coloursInScript(path, text);
}

/** Each block of tokens.css: its selector, and the tokens it declares with their values. */
function blocks(): { selector: string; tokens: Map<string, string> }[] {
  const css = readFileSync(TOKENS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((block) => ({
    selector: (block[1] ?? '').trim(),
    tokens: new Map(
      [...(block[2] ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((one) => [
        one[1] ?? '',
        (one[2] ?? '').trim(),
      ]),
    ),
  }));
}

function themeOf(selector: string): string | undefined {
  return /\[data-theme='([\w-]+)'\]/.exec(selector)?.[1];
}

/** One theme's tokens, with the shared aliases every theme declares, each `var()` followed home. */
function palette(theme: string): (name: string) => string {
  const all = blocks();
  const tokens = new Map([
    ...all
      .filter((block) => themeOf(block.selector) === undefined)
      .flatMap((block) => [...block.tokens]),
    ...(all.find((block) => themeOf(block.selector) === theme)?.tokens ?? []),
  ]);
  return (name) => {
    let value = tokens.get(name);
    for (let hop = 0; value?.startsWith('var(') && hop < 5; hop += 1) {
      value = tokens.get(/var\((--[\w-]+)\)/.exec(value)?.[1] ?? '');
    }
    if (value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) {
      throw new Error(`${name} in ${theme} is not a six-digit colour: ${String(value)}`);
    }
    return value;
  };
}

/** WCAG's contrast ratio between two six-digit colours. */
function contrast(one: string, two: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((at) => {
      const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(one), luminance(two)].sort((a, b) => b - a) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** Every text colour on every ground it is set on, by token. */
const TEXT_ON: readonly (readonly [string, string])[] = [
  ['--text', '--bg'],
  ['--text', '--chrome'],
  ['--text', '--surface'],
  ['--text', '--sunken'],
  ['--text', '--accent-weak'],
  ['--muted', '--bg'],
  ['--muted', '--chrome'],
  ['--muted', '--surface'],
  ['--muted', '--sunken'],
  ['--muted', '--accent-weak'],
  ['--accent-text', '--surface'],
  ['--accent-text', '--accent-weak'],
  ['--on-accent', '--accent'],
  ['--warn', '--surface'],
  ['--warn', '--warn-bg'],
  ['--ok', '--surface'],
  ['--ok', '--ok-bg'],
  ['--danger', '--surface'],
  ['--danger', '--danger-bg'],
  // A removal's filled button, Administration's one colour (ADR-0049).
  ['--on-danger', '--danger'],
  ['--info', '--surface'],
  ['--info', '--info-bg'],
];

describe('colour, which only tokens.css writes', () => {
  it('finds a colour written in CSS or in a string, and ignores one in a comment', () => {
    expect(coloursIn('a.css', '/* #fff */\na { color: #fff; }')).toEqual([2]);
    expect(coloursIn('a.css', 'a { border: 1px solid rgba(0, 0, 0, 0.1); }')).toEqual([1]);
    expect(coloursIn('a.css', 'a { background: white; }')).toEqual([1]);
    expect(coloursIn('a.css', 'a { color: var(--text); }\n#root { margin: 0; }')).toEqual([]);
    expect(coloursIn('a.ts', "// #fff\nconst c = '#1c2024';")).toEqual([2]);
    expect(coloursIn('a.ts', "const link = '#/components'; // issue #158")).toEqual([]);
  });

  it('writes no colour outside tokens.css', () => {
    const files = [...sources(join(WEB, 'src')), ...sources(EDITOR)].filter(
      (path) => path !== TOKENS,
    );
    expect(files.length).toBeGreaterThan(0);
    const coloured = files.flatMap((path) =>
      coloursIn(path, readFileSync(path, 'utf8')).map((line) => `${relative(WEB, path)}:${line}`),
    );
    expect(coloured).toEqual([]);
  });

  it('keeps every colour but the document palette inside a theme', () => {
    const invariant = blocks().filter((block) => themeOf(block.selector) === undefined);
    const stray = invariant.flatMap((block) =>
      [...block.tokens]
        .filter(
          ([name, value]) => !name.startsWith('--doc-') && coloursInCss(`a{b:${value}}`).length,
        )
        .map(([name]) => name),
    );
    expect(invariant.length).toBeGreaterThan(0);
    expect(stray).toEqual([]);
  });

  it('every theme defines the same colour tokens as light', () => {
    const themes = blocks().filter((block) => themeOf(block.selector) !== undefined);
    expect(themes.map((block) => themeOf(block.selector))).toEqual([...THEMES]);
    const light = [
      ...(themes.find((block) => themeOf(block.selector) === 'light')?.tokens.keys() ?? []),
    ];
    expect(light.length).toBeGreaterThan(0);
    for (const theme of themes) expect([...theme.tokens.keys()].sort()).toEqual([...light].sort());
  });

  it('sets every text colour at 4.5:1 or more on each ground it stands on, in every theme', () => {
    const short = THEMES.flatMap((theme) => {
      const colour = palette(theme);
      return TEXT_ON.map(([text, ground]) => ({
        pair: `${theme}: ${text} on ${ground}`,
        ratio: contrast(colour(text), colour(ground)),
      })).filter(({ ratio }) => ratio < 4.5);
    });
    expect(short).toEqual([]);
  });

  it('draws the focus ring in the accent, 3:1 or more against every ground, in every theme', () => {
    for (const theme of THEMES) {
      const colour = palette(theme);
      for (const ground of ['--bg', '--chrome', '--surface', '--sunken']) {
        expect(
          contrast(colour('--accent'), colour(ground)),
          `${theme}: the ring, --accent, on ${ground}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('applies a theme as data-theme on the root element', () => {
    const root = document.createElement('html');
    applyTheme('light', root);
    expect(root.dataset['theme']).toBe('light');
  });
});
