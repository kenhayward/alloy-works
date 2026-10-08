import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INTERFACE_FONT_FILES } from '@alloy-works/fonts';
import { describe, expect, it } from 'vitest';

import { INTERFACE_FACES_CSS, installInterfaceFaces } from './interface-faces.js';

const TOKENS = readFileSync(join(process.cwd(), 'src', 'theme', 'tokens.css'), 'utf8');

/** A token's declared value in tokens.css's invariant block. */
const token = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(TOKENS)?.[1]?.trim();

describe("the interface's faces (ADR-0046)", () => {
  it('declares each pinned face from the file the renderer bundles, never from the network', () => {
    const rules = INTERFACE_FACES_CSS.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    expect(rules).toHaveLength(INTERFACE_FONT_FILES.length);
    INTERFACE_FONT_FILES.forEach((face, at) => {
      const rule = rules[at] ?? '';
      expect(rule).toContain(`font-family: '${face.family}'`);
      expect(rule).toContain(`font-weight: ${face.weight}`);
      expect(rule).toContain(`font-style: ${face.style}`);
      expect(rule).toContain('font-display: swap');
      const source = /url\('([^']+)'\) format\('woff2'\)/.exec(rule)?.[1] ?? '';
      expect(source).toContain(face.file.replace(/\.woff2$/, ''));
      expect(source).not.toMatch(/^(?:https?:)?\/\//);
    });
    expect(INTERFACE_FACES_CSS).not.toMatch(/https?:|local\(/);
  });

  it('installs them once, however often it is asked', () => {
    installInterfaceFaces(document);
    installInterfaceFaces(document);
    const styles = [...document.head.querySelectorAll('style')].filter(
      (style) => style.textContent === INTERFACE_FACES_CSS,
    );
    expect(styles).toHaveLength(1);
  });

  it('sets the interface in Plex, and leaves the document faces as they are', () => {
    expect(token('--sans')).toMatch(/^'IBM Plex Sans', /);
    expect(token('--mono')).toMatch(/^'IBM Plex Mono', /);
    expect(token('--document')).toBe("Calibri, 'Segoe UI', Arial, sans-serif");
  });
});
