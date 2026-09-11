import type { ResolvedTheme } from './resolve.js';
import { markNames } from './schema.js';

/**
 * The editor's projection: resolved styles as CSS classes (docs/design/themes.md).
 *
 * - Block spacing is padding, which adds between siblings, never margin, which collapses - so the
 *   gap between two blocks is the space after plus the space before, as in the output (STY-050).
 * - Line spacing is a line-height in points: the baseline distance the theme declares (STY-051).
 * - Nothing that depends on pagination is written; preview shows those (STY-037).
 *
 * Safe to generate from tenant data because the schema already restricts every string that
 * reaches it: identifiers are class-safe and family names cannot contain a quote (STY-N03).
 */
export function projectCss(theme: ResolvedTheme): string {
  const rules = [`.aw-canvas { background: ${theme.paper}; color: ${theme.defaults.colour}; }`];

  for (const style of theme.paragraphStyles) {
    const p = style.properties;
    const face = theme.typefaces[p.typeface];
    if (face === undefined) throw new Error(`Unresolved typeface "${p.typeface}"`);
    rules.push(
      `.aw-p-${style.id} { margin: 0; font-family: "${face.family}"; font-size: ${pt(p.size)}; ` +
        `font-weight: ${p.bold ? 700 : 400}; font-style: ${p.italic ? 'italic' : 'normal'}; ` +
        `color: ${p.colour}; text-indent: ${pt(p.firstLineIndent)}; ` +
        `padding-top: ${pt(p.spaceBefore)}; padding-bottom: ${pt(p.spaceAfter)}; ` +
        `line-height: ${pt(p.lineSpacing)}; }`,
    );
  }

  for (const mark of markNames) {
    const style = theme.characterStyles[mark];
    if (style === undefined) continue;
    const declarations: string[] = [];
    if (style.bold !== undefined) declarations.push(`font-weight: ${style.bold ? 700 : 400}`);
    if (style.italic !== undefined)
      declarations.push(`font-style: ${style.italic ? 'italic' : 'normal'}`);
    if (declarations.length > 0) rules.push(`.aw-mark-${mark} { ${declarations.join('; ')}; }`);
  }

  return rules.join('\n') + '\n';
}

function pt(value: number): string {
  return `${Number(value.toFixed(3))}pt`;
}
