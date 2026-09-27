import { faceFamily } from './faces.js';
import type { ResolvedParagraphStyle, ResolvedTheme } from './read.js';
import {
  PLACES,
  ROLES,
  SCRIPT_SCALE,
  STYLED_MARKS,
  type CharacterProperties,
  type ResolvedParagraphProperties,
  type TableRule,
  type TableStyle,
} from './schema.js';

/**
 * The paragraph properties that depend on pagination, which the editor does not render and preview
 * shows (STY-037): the only ones `projectCss` leaves out.
 */
export const PAGINATION_BOUND = [
  'keepWithNext',
  'keepTogether',
  'widowControl',
  'hyphenate',
] as const satisfies readonly (keyof ResolvedParagraphProperties)[];

/** Every other paragraph property, each of which `projectCss` writes for every paragraph style. */
export const PROJECTED_PARAGRAPH_PROPERTIES = [
  'typeface',
  'size',
  'bold',
  'italic',
  'colour',
  'background',
  'padding',
  'alignment',
  'firstLineIndent',
  'startIndent',
  'endIndent',
  'spaceBefore',
  'spaceAfter',
  'lineSpacing',
  'contextualSpacing',
] as const satisfies readonly (keyof ResolvedParagraphProperties)[];

/** Every character property, each of which `projectCss` writes for every mark. */
export const PROJECTED_CHARACTER_PROPERTIES = [
  'bold',
  'italic',
  'underline',
  'colour',
  'typeface',
  'position',
  'scale',
] as const satisfies readonly (keyof CharacterProperties)[];

/**
 * The editor's projection: resolved styles as CSS (themes.md, "The editor" and "The theme in the
 * editor"). It translates and decides nothing, and it writes **every** paragraph and character property
 * but the pagination-bound (STY-058, STY-037).
 *
 * - **Where a style applies** is said by the editor's markup, never by this: a paragraph carries its
 *   stored style as `data-style` and the place it stands in as `data-place`, so a stored `body` is set
 *   in its place's default (TH-E) and any other identifier in the style it names; a footnote's
 *   paragraph is always in the footnote's place; and what the template sets by role - a caption, a
 *   table's note, an attribution, preformatted text and its label - carries `data-role`. Every rule is
 *   scoped under `.aw-canvas`, the paper the editor sets text on.
 * - **Every length is in points times `--aw-zoom`**, the canvas's zoom, so the whole page scales as
 *   one (CNT-115, ET-E).
 * - **Block spacing adds** (STY-050, CNT-082): a block's space before and after are transparent borders,
 *   which never collapse, with its fill clipped inside them to its padding.
 * - **A line's extra space goes above it**, as Word puts it (STY-051, STY-054): each block adds its
 *   half-leading above as padding and takes it back below as a negative margin - margin, because padding
 *   cannot go negative, and a single negative margin collapsing against the next block's zero leaves
 *   exactly that amount. Measured against Word's model in spikes/theme-conformance.
 * - **Contextual spacing** drops the space between two neighbours of one style that both ask for it:
 *   siblings, so never across a quotation's, a list item's or a cell's edge.
 * - **A mark states every property**: the style's value where it states one, and otherwise the text's
 *   own, so a browser's default for `strong`, `a`, `code` or `sup` never shows through.
 *
 * Safe to generate from tenant data because the schema already restricts every string that
 * reaches it: identifiers are class-safe, and colours are hex (STY-N03).
 */
export function projectCss(theme: ResolvedTheme): string {
  const ink = theme.paragraphStyles.get(theme.places.text)?.properties.colour;
  const rules = [
    `.aw-canvas { background: ${theme.paper}; color: ${ink}; }`,
    // A quotation is inset by its paragraphs' own indents, as the template sets it; the editor's own
    // inset and rule stand down.
    `${CANVAS} blockquote { margin: 0; padding: 0; border: 0; }`,
    `${CANVAS} math { font-family: "${faceFamily(theme.maths.id)}"; }`,
  ];

  for (const style of theme.paragraphStyles.values()) {
    const selectors = selectorsOf(theme, style.id);
    if (selectors.length === 0) continue;
    rules.push(`${selectors.join(', ')} { ${paragraphDeclarations(style).join('; ')}; }`);
    if (style.properties.contextualSpacing) {
      const neighbours = selectors.filter((selector) => !selector.includes('::'));
      const pairs = neighbours.flatMap((first) =>
        neighbours.map((second) => [first, second.replace(`${CANVAS} `, '')] as const),
      );
      rules.push(
        `${pairs.map(([first, second]) => `${first} + ${second}`).join(', ')} ` +
          '{ border-block-start-width: 0; }',
        `${pairs.map(([first, second]) => `${first}:has(+ ${second})`).join(', ')} ` +
          '{ border-block-end-width: 0; }',
      );
    }
  }

  for (const mark of STYLED_MARKS) {
    const style = theme.characterStyles[mark];
    const declarations = characterDeclarations(
      style.properties,
      style.typeface && faceFamily(style.typeface.id),
    );
    rules.push(`${CANVAS} .aw-mark-${mark} { ${declarations.join('; ')}; }`);
  }

  for (const table of theme.tableStyles.values()) rules.push(...tableRules(table));

  // An image's size is `styledSize`'s, which the editor sets on each image from its pixels (CNT-122):
  // the editor stylesheet's own caps stand down, and a figure is aligned in its band by its style.
  rules.push(
    `${CANVAS} [data-image-style] img, ${CANVAS} img[data-image-style] { max-height: none; height: auto; }`,
  );
  for (const image of theme.imageStyles.values()) {
    if (image.placement === 'inline') continue;
    rules.push(
      `${CANVAS} [data-image-style="${image.id}"] .aw-figure-image { text-align: ${ALIGN[image.alignment]}; }`,
    );
  }

  return rules.join('\n') + '\n';
}

/**
 * A table style's rules on the surface's tables (STY-076, TH-I), as template 13 draws them: its rules
 * inside and its outer frame; its cells' padding; its header row's and header column's fill, bold and
 * rule - the header row's below its last row, the header column's after its last column; and the band
 * behind every other body row from the first, under a filled header column's own fill. Header cells are
 * told by the `scope` the editor gives them from the table's header counts. What depends on pages -
 * the header repeated, rows kept whole, the continuation label - is preview's (STY-037).
 */
function tableRules(style: TableStyle): string[] {
  const at = `${CANVAS} [data-table-style="${style.id}"]`;
  const line = (rule: TableRule) =>
    rule === 'none' ? 'none' : `${zoomed(rule.width)} solid ${rule.colour}`;
  const fill = (colour: string) => (colour === 'none' ? 'transparent' : colour);
  const outer = line(style.rules.outer);
  const rules = [
    `${at} table { border-collapse: collapse; border: ${outer}; }`,
    `${at} td, ${at} th { padding: ${zoomed(style.padding)}; ` +
      `border-block: ${line(style.rules.horizontal)}; border-inline: ${line(style.rules.vertical)}; ` +
      'background-color: transparent; font-weight: inherit; }',
    `${at} tr:first-child > * { border-block-start: ${outer}; }`,
    `${at} tr:last-child > * { border-block-end: ${outer}; }`,
    `${at} tr > :first-child { border-inline-start: ${outer}; }`,
    `${at} tr > :last-child { border-inline-end: ${outer}; }`,
  ];
  if (style.banding.fill !== 'none') {
    const cells = style.headerColumn.fill === 'none' ? '*' : ':not([scope="row"])';
    rules.push(
      `${at} tr:nth-child(odd of :not(:has(> [scope="col"]))) > ${cells} ` +
        `{ background-color: ${style.banding.fill}; }`,
    );
  }
  rules.push(
    `${at} [scope="col"] { background-color: ${fill(style.headerRow.fill)}; }`,
    `${at} [scope="row"] { background-color: ${fill(style.headerColumn.fill)}; }`,
  );
  if (style.headerRow.bold) {
    rules.push(`${at} [scope="col"] [data-style] { font-weight: 700; }`);
  }
  if (style.headerColumn.bold) {
    rules.push(`${at} [scope="row"] [data-style] { font-weight: 700; }`);
  }
  // A header's rule is stated by the cells on both sides of its line: with collapsed borders a browser
  // draws the wider of two that disagree, where the template draws the header's whatever the body's.
  if (style.headerRow.rule !== 'none') {
    rules.push(
      `${at} tr:has(> [scope="col"]):not(:has(+ tr > [scope="col"])) > * ` +
        `{ border-block-end: ${line(style.headerRow.rule)}; }`,
      `${at} tr:has(> [scope="col"]) + tr:not(:has(> [scope="col"])) > * ` +
        `{ border-block-start: ${line(style.headerRow.rule)}; }`,
    );
  }
  if (style.headerColumn.rule !== 'none') {
    rules.push(
      `${at} [scope="row"]:not(:has(+ [scope="row"])) ` +
        `{ border-inline-end: ${line(style.headerColumn.rule)}; }`,
      `${at} [scope="row"]:not(:has(+ [scope="row"])) + * ` +
        `{ border-inline-start: ${line(style.headerColumn.rule)}; }`,
    );
  }
  return rules;
}

/**
 * Where a paragraph style is set: by the identifier an author chose, as a place's default, and in the
 * roles the theme gives it. A stored `body` never names the style called `body`: it means the default
 * where it stands, which the place selectors say.
 */
function selectorsOf(theme: ResolvedTheme, id: string): string[] {
  const selectors = id === 'body' ? [] : [`${CANVAS} [data-style="${id}"]`];
  for (const place of PLACES) {
    if (theme.places[place] !== id) continue;
    // A paragraph whose style will not resolve is marked by the editor (STY-070) and set meanwhile
    // in the default where it stands, a selector heavier than its own style's rule.
    if (place === 'footnote') {
      selectors.push(
        `${CANVAS} .aw-footnote-paragraph[data-style="body"]`,
        `${CANVAS} .aw-footnote-paragraph[data-unresolved]`,
      );
    } else {
      selectors.push(
        `${CANVAS} [data-place="${place}"][data-style="body"]`,
        `${CANVAS} [data-place="${place}"]:not([data-style])`,
        `${CANVAS} [data-place="${place}"][data-unresolved]`,
      );
    }
  }
  for (const role of ROLES) {
    if (theme.roles[role] !== id) continue;
    selectors.push(
      role === 'preformattedLabel'
        ? `${CANVAS} pre[data-language]::before`
        : `${CANVAS} [data-role="${role}"]`,
    );
  }
  return selectors;
}

/**
 * The canvas, named twice: the same element, at two classes' weight, so that every rule the theme writes
 * outranks the editor's own stylesheet, whose rules reach two classes and an element at most -
 * `.aw-text a[href]`, `.aw-text footer.aw-attribution` - and which would otherwise set a link's colour
 * or an attribution's alignment over the theme's (`packages/editor/src/schema.test.ts` holds the
 * stylesheet below it).
 */
export const CANVAS = '.aw-canvas.aw-canvas';

const ALIGN = { start: 'start', end: 'end', centre: 'center', justify: 'justify' } as const;

function paragraphDeclarations(style: ResolvedParagraphStyle): string[] {
  const p = style.properties;
  const face = style.typeface;
  const halfLeading = (p.lineSpacing - (face.ascent + face.descent) * p.size) / 2;
  const filled = p.background !== 'none';
  const padding = filled ? p.padding : 0;
  return [
    `font-family: "${faceFamily(face.id)}"`,
    `font-size: ${zoomed(p.size)}`,
    `font-weight: ${p.bold ? 700 : 400}`,
    `font-style: ${p.italic ? 'italic' : 'normal'}`,
    `color: ${p.colour}`,
    `background-color: ${filled ? p.background : 'transparent'}`,
    'background-clip: padding-box',
    `text-align: ${ALIGN[p.alignment]}`,
    `text-indent: ${zoomed(p.firstLineIndent)}`,
    `margin-block: 0 ${zoomed(-halfLeading)}`,
    `margin-inline: ${zoomed(p.startIndent)} ${zoomed(p.endIndent)}`,
    // No rule of its own: a style has no border property, so the frame the editor's stylesheet draws
    // round preformatted text stands down on the canvas, as the quotation's does - the page prints the
    // style's fill and padding and no frame, and the canvas shows the page.
    'border: 0 solid transparent',
    `border-block-width: ${zoomed(p.spaceBefore)} ${zoomed(p.spaceAfter)}`,
    `padding-block: ${zoomed(halfLeading + padding)} ${zoomed(padding)}`,
    `padding-inline: ${zoomed(padding)}`,
    `line-height: ${zoomed(p.lineSpacing)}`,
  ];
}

function characterDeclarations(p: CharacterProperties, family: string | undefined): string[] {
  const scale = (p.scale ?? 1) * (p.position === undefined ? 1 : SCRIPT_SCALE);
  return [
    `font-weight: ${p.bold === undefined ? 'inherit' : p.bold ? 700 : 400}`,
    `font-style: ${p.italic === undefined ? 'inherit' : p.italic ? 'italic' : 'normal'}`,
    `text-decoration-line: ${p.underline ? 'underline' : 'none'}`,
    `color: ${p.colour ?? 'inherit'}`,
    `font-family: ${family === undefined ? 'inherit' : `"${family}"`}`,
    `vertical-align: ${p.position === 'subscript' ? 'sub' : p.position === 'superscript' ? 'super' : 'baseline'}`,
    `font-size: ${scale === 1 ? 'inherit' : `${fixed(scale)}em`}`,
    // A script does not open its line, as the template's does not.
    ...(p.position === undefined ? [] : ['line-height: 0']),
  ];
}

/** A length in points, scaled by the canvas's zoom. */
function zoomed(points: number): string {
  return points === 0 ? '0' : `calc(${fixed(points)}pt * var(--aw-zoom))`;
}

function fixed(value: number): string {
  return String(Number(value.toFixed(3)));
}
