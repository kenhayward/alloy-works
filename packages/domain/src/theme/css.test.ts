import { describe, expect, it } from 'vitest';

import { projectCss } from './css.js';
import { resolved } from './theme.fixture.js';

/** The editor's projection. It translates resolved styles and decides nothing. */
const css = projectCss(resolved());

describe('projectCss', () => {
  it('writes every property it projects of a paragraph style at its resolved value', () => {
    expect(css).toContain(
      '.aw-p-heading-1 { margin: 0 0 -1.581pt 0; font-family: "Liberation Serif"; font-size: 16pt; ' +
        'font-weight: 700; font-style: normal; color: #000000; text-indent: 0pt; ' +
        'padding-top: 11.911pt; padding-bottom: 4.57pt; line-height: 20.88pt; }',
    );
  });

  it('spaces blocks with padding, which adds, never with collapsing margins (STY-050)', () => {
    // A table's note: no space before, its half-leading, (13.05 - 1.107 x 10) / 2 = 0.988pt, above
    // that, and its 2.97pt after below.
    expect(css).toMatch(/\.aw-p-table-note \{[^}]*padding-top: 0\.988pt; padding-bottom: 2\.97pt;/);
  });

  it("moves each line's extra space above it, as Word does, by cancelling CSS's split (STY-051)", () => {
    // CSS puts half of a line's extra space above and half below. Word puts all of it above.
    // Half-leading = (line spacing - (ascent + descent) x size) / 2: 1.084pt for body at 11pt on
    // 14.35pt. Adding it above and taking it back below as a margin - which can go negative where
    // padding cannot - leaves it all above.
    expect(css).toMatch(/\.aw-p-body \{ margin: 0 0 -1\.084pt 0;[^}]*padding-top: 1\.084pt;/);
  });

  it('writes nothing that depends on pagination - preview shows those (STY-037)', () => {
    expect(css).not.toMatch(/keep|break|orphans|widows|hyphen/);
  });

  it("puts the canvas on the theme's paper, in the ink of the text's own style", () => {
    expect(css).toContain('.aw-canvas { background: #ffffff; color: #000000; }');
  });

  it('renders a mark by the weight and posture its character style states, and only those', () => {
    expect(css).toContain('.aw-mark-strong { font-weight: 700; }');
    expect(css).toContain('.aw-mark-emphasis { font-style: italic; }');
    // Not projected yet: the theme in the editor finishes them (TH-F).
    expect(css).not.toContain('.aw-mark-underline');
    expect(css).not.toContain('.aw-mark-inlineCode');
  });
});
