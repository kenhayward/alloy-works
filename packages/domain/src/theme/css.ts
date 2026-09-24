import type { ResolvedTheme } from './read.js';
import { STYLED_MARKS } from './schema.js';

/**
 * The editor's projection: resolved styles as CSS classes (docs/design/themes.md).
 *
 * - Block spacing is padding, which adds between siblings, never margin, which collapses - so the
 *   gap between two blocks is the space after plus the space before, as in the output (STY-050).
 * - Line spacing is a line-height in points: the baseline distance the theme declares (STY-051).
 * - CSS splits a line's extra space half above and half below; Word puts it all above. So each
 *   block adds its half-leading above as padding and takes it back below as a negative margin -
 *   margin, because padding cannot go negative, and a single negative margin collapsing against
 *   the next block's zero leaves exactly that amount. Measured against Word's model in
 *   spikes/theme-conformance, where without this the editor drifted a point at every change of
 *   line spacing.
 * - Nothing that depends on pagination is written - keep-with-next, keep-together, widow control,
 *   hyphenation; preview shows those (STY-037).
 *
 * **What it projects is what the prototype projected, no more** (themes 1, ruling R1): a paragraph's
 * face, size, weight, posture, colour, first-line indent, spacing and line spacing, and a mark's weight
 * and posture. **Not yet projected**, until the theme reaches the editor (TH-F, STY-058): a paragraph's
 * `background`, `padding`, `alignment`, `startIndent` and `endIndent`, and a mark's `underline`,
 * `colour`, `typeface`, `position` and `scale`.
 *
 * Safe to generate from tenant data because the schema already restricts every string that
 * reaches it: identifiers are class-safe and family names cannot contain a quote (STY-N03).
 */
export function projectCss(theme: ResolvedTheme): string {
  const ink = theme.paragraphStyles.get(theme.places.text)?.properties.colour;
  const rules = [`.aw-canvas { background: ${theme.paper}; color: ${ink}; }`];

  for (const style of theme.paragraphStyles.values()) {
    const p = style.properties;
    const face = style.typeface;
    const halfLeading = (p.lineSpacing - (face.ascent + face.descent) * p.size) / 2;
    rules.push(
      `.aw-p-${style.id} { margin: 0 0 ${pt(-halfLeading)} 0; font-family: "${face.family}"; ` +
        `font-size: ${pt(p.size)}; font-weight: ${p.bold ? 700 : 400}; ` +
        `font-style: ${p.italic ? 'italic' : 'normal'}; color: ${p.colour}; ` +
        `text-indent: ${pt(p.firstLineIndent)}; padding-top: ${pt(p.spaceBefore + halfLeading)}; ` +
        `padding-bottom: ${pt(p.spaceAfter)}; line-height: ${pt(p.lineSpacing)}; }`,
    );
  }

  for (const mark of STYLED_MARKS) {
    const { properties } = theme.characterStyles[mark];
    const declarations: string[] = [];
    if (properties.bold !== undefined) {
      declarations.push(`font-weight: ${properties.bold ? 700 : 400}`);
    }
    if (properties.italic !== undefined) {
      declarations.push(`font-style: ${properties.italic ? 'italic' : 'normal'}`);
    }
    if (declarations.length > 0) rules.push(`.aw-mark-${mark} { ${declarations.join('; ')}; }`);
  }

  return rules.join('\n') + '\n';
}

function pt(value: number): string {
  return `${Number(value.toFixed(3))}pt`;
}
