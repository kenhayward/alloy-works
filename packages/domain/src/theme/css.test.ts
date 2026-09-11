import { describe, expect, it } from 'vitest';

import { projectCss } from './css.js';
import { exampleTheme } from './example.js';
import { resolveTheme } from './resolve.js';

/** The editor's projection. It translates resolved styles and decides nothing. */
const css = projectCss(resolveTheme(exampleTheme()));

describe('projectCss', () => {
  it('writes every stated property of a paragraph style at its resolved value', () => {
    expect(css).toContain(
      '.aw-p-heading { margin: 0 0 -2.037pt 0; font-family: "Liberation Serif"; font-size: 18pt; ' +
        'font-weight: 700; font-style: normal; color: #1a1a1a; text-indent: 0pt; ' +
        'padding-top: 14.037pt; padding-bottom: 6pt; line-height: 24pt; }',
    );
  });

  it('spaces blocks with padding, which adds, never with collapsing margins (STY-050)', () => {
    expect(css).toMatch(/\.aw-p-quote \{[^}]*padding-top: 12\.912pt; padding-bottom: 12pt;/);
  });

  it("moves each line's extra space above it, as Word does, by cancelling CSS's split (STY-051)", () => {
    // CSS puts half of a line's extra space above and half below. Word puts all of it above.
    // Half-leading = (line spacing - (ascent + descent) x size) / 2: 0.912pt for body at 11pt on
    // 14pt. Adding it above and taking it back below as a margin - which can go negative where
    // padding cannot - leaves it all above.
    expect(css).toMatch(/\.aw-p-body \{ margin: 0 0 -0\.912pt 0;[^}]*padding-top: 0\.912pt;/);
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
