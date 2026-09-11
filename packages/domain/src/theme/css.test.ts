import { describe, expect, it } from 'vitest';

import { projectCss } from './css.js';
import { exampleTheme } from './example.js';
import { resolveTheme } from './resolve.js';

/** The editor's projection. It translates resolved styles and decides nothing. */
const css = projectCss(resolveTheme(exampleTheme()));

describe('projectCss', () => {
  it('writes every stated property of a paragraph style at its resolved value', () => {
    expect(css).toContain(
      '.aw-p-heading { margin: 0; font-family: "Liberation Serif"; font-size: 18pt; ' +
        'font-weight: 700; font-style: normal; color: #1a1a1a; text-indent: 0pt; ' +
        'padding-top: 12pt; padding-bottom: 6pt; line-height: 24pt; }',
    );
  });

  it('spaces blocks with padding, which adds, never with margin, which collapses (STY-050)', () => {
    expect(css).not.toMatch(/margin-(top|bottom)/);
    expect(css).toContain('.aw-p-quote { margin: 0;');
    expect(css).toMatch(/\.aw-p-quote \{[^}]*padding-top: 12pt; padding-bottom: 12pt;/);
  });

  it('writes nothing that depends on pagination - preview shows those (STY-037)', () => {
    expect(css).not.toMatch(/keep|break|orphans|widows/);
  });

  it('puts the canvas on the theme paper', () => {
    expect(css).toContain('.aw-canvas { background: #ffffff; color: #1a1a1a; }');
  });

  it('renders a mark by what its character style states, and only that', () => {
    expect(css).toContain('.aw-mark-strong { font-weight: 700; }');
    expect(css).toContain('.aw-mark-emphasis { font-style: italic; }');
  });
});
