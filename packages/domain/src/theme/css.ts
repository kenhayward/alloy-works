import { faceFamily } from './faces.js';
import type { ResolvedParagraphStyle, ResolvedTheme } from './read.js';
import type { Typeface } from './schema.js';
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
 * - **Block spacing adds** (STY-050, CNT-082): a block's space before and after are padding, which never
 *   collapses and which a browser draws at its length, with its fill painted between them. Borders were
 *   snapped to whole pixels, which the browser suite measured losing up to three quarters of a point at
 *   a block (W13.4).
 * - **A line's extra space goes above it**, as Word puts it (STY-051, STY-054). Where the face's cap
 *   height is known (`ProjectCssOptions`) and the browser can, each block is trimmed to its first line's
 *   cap height and its last line's baseline, and its first baseline placed from those by padding, which
 *   a browser measures exactly. Otherwise each block adds its half-leading above as padding and takes it
 *   back below as a negative margin - margin, because padding cannot go negative, and a single negative
 *   margin collapsing against the next block's zero leaves exactly that amount - which rests on the
 *   face's ascent and descent, which a browser rounds to whole pixels. Measured against Word's model in
 *   spikes/theme-conformance, and against the PDF in the browser suite (STY-080).
 * - **What the template decides of a block's parts, the canvas sets as it does**: a list's items their
 *   place's leading apart, a table's rules taking no room and its cells' first and last blocks without
 *   their outer spaces, a quotation's attribution within its indents, preformatted text's label above
 *   its block, a figure apart from its neighbours as its caption is - each measured in the browser suite.
 * - **Contextual spacing** drops the space between two neighbours of one style that both ask for it:
 *   siblings, so never across a quotation's, a list item's or a cell's edge.
 * - **A caption stands where its style places it** (STY-079, W14.5): the markup stands a table's
 *   caption before its cells and a figure's after its image, so a style placing one there needs
 *   nothing, and one placing it on the other side stacks the block's parts and orders the caption
 *   there - a table's note staying last.
 * - **A mark states every property**: the style's value where it states one, and otherwise the text's
 *   own, so a browser's default for `strong`, `a`, `code` or `sup` never shows through.
 * - **A line is opened by what stands above its text's top or below its foot, as the template's is**
 *   (issue #331): an image in it, a run larger than its text, a list's marker in a larger style than
 *   its item. The template's line is exactly one em of its text tall, an em less the descender above
 *   the baseline and the descender below, and grows by whatever stands further out; a browser's line
 *   is its line spacing tall, split about the face's ascent and descent as it rounds them. So what
 *   stands out is measured against a line of the paragraph's own text, which the browser makes the
 *   same as the paragraph's, never against a length written here (`markRules`, `imageRules`,
 *   `growerRules`, `markerRules`).
 *
 * Safe to generate from tenant data because the schema already restricts every string that
 * reaches it: identifiers are class-safe, and colours are hex (STY-N03).
 */
export function projectCss(theme: ResolvedTheme, options: ProjectCssOptions = {}): string {
  const capHeight = options.capHeight ?? (() => undefined);
  const ink = theme.paragraphStyles.get(theme.places.text)?.properties.colour;
  // What a browser that trims a line to its face's cap height and its baseline sets instead (below).
  const trimmed: string[] = [];
  const rules = [
    // The size a run of text stands at, computed where it is set, so a mark inside another reads the
    // size of the one around it (`markRules`).
    "@property --aw-run { syntax: '<length>'; inherits: true; initial-value: 0; }",
    `.aw-canvas { background: ${theme.paper}; color: ${ink}; }`,
    // A quotation is inset by its paragraphs' own indents, as the template sets it; the editor's own
    // inset and rule stand down.
    `${CANVAS} blockquote { margin: 0; padding: 0; border: 0; }`,
    `${CANVAS} math { font-family: "${faceFamily(theme.maths.id)}"; }`,
    // Preformatted text's lines are in its role's face and size: the browser's own face for `code`,
    // and the size it scales a monospace font to, stand down (found by the browser suite, W13.4).
    `${CANVAS} pre code { font: inherit; }`,
    ...listRules(theme),
    ...labelRules(theme),
    ...attributionRules(theme),
  ];

  for (const style of theme.paragraphStyles.values()) {
    const selectors = selectorsOf(theme, style.id);
    if (selectors.length === 0) continue;
    rules.push(`${selectors.join(', ')} { ${paragraphDeclarations(style).join('; ')}; }`);
    const cap = capHeight(style.typeface);
    if (cap !== undefined) {
      trimmed.push(`${selectors.join(', ')} { ${lines(style, cap).join('; ')}; }`);
      trimmed.push(...growerRules(theme, style, selectors, cap));
    }
    if (style.properties.contextualSpacing) {
      const neighbours = selectors.filter((selector) => !selector.includes('::'));
      // Labelled preformatted text begins with its label, in the label's style, not the block's.
      const pairs = neighbours.flatMap((first) =>
        neighbours.map(
          (second) => [first, `${second.replace(`${CANVAS} `, '')}:not([data-language])`] as const,
        ),
      );
      rules.push(
        `${pairs.map(([first, second]) => `${first} + ${second}`).join(', ')} ` +
          `{ --aw-before: ${NONE}; }`,
        `${pairs.map(([first, second]) => `${first}:has(+ ${second})`).join(', ')} ` +
          `{ --aw-after: ${NONE}; }`,
      );
    }
  }

  rules.push(...markRules(theme));

  const cell = theme.paragraphStyles.get(theme.places.tableCell);
  for (const table of theme.tableStyles.values()) rules.push(...tableRules(table, cell));

  // An image's size is `styledSize`'s, which the editor sets on each image from its pixels (CNT-122):
  // the editor stylesheet's own caps stand down, and a figure is aligned in its band by its style.
  rules.push(
    `${CANVAS} [data-image-style] img, ${CANVAS} img[data-image-style] { max-height: none; height: auto; }`,
    // An image in a line stands on its baseline, as the template sets one.
    `${CANVAS} img.aw-inline-image { vertical-align: baseline; }`,
  );
  const caption = theme.paragraphStyles.get(theme.roles.caption)?.properties;
  for (const image of theme.imageStyles.values()) {
    if (image.placement === 'inline') continue;
    // A figure stands apart from its neighbours as its caption does, as the template sets it: its
    // caption's space before and leading above its image where the caption is below it, and its space
    // after below the image where the caption is above; the editor stylesheet's own space stands down.
    // As padding, in a block of its own, so that it adds to a neighbour's space as the template's gaps
    // do, rather than collapsing into it as two margins would (found by the browser suite, W13.4).
    if (caption) {
      const [above, below] =
        image.caption === 'above'
          ? [0, caption.spaceAfter]
          : [caption.spaceBefore + caption.lineSpacing - caption.size, 0];
      rules.push(
        `${CANVAS} figure[data-image-style="${image.id}"] ` +
          `{ margin: 0; padding: ${zoomed(above)} 0 ${zoomed(below)}; display: flow-root; }`,
      );
    }
    rules.push(
      `${CANVAS} [data-image-style="${image.id}"] .aw-figure-image { text-align: ${ALIGN[image.alignment]}; }`,
      // The image is a block in the editor stylesheet, which `text-align` does not move: its margins
      // place it in its band instead (found by the browser suite, W13.4).
      `${CANVAS} [data-image-style="${image.id}"] .aw-figure-image img ` +
        `{ margin-inline: ${image.alignment === 'start' ? '0 auto' : image.alignment === 'end' ? 'auto 0' : 'auto'}; }`,
    );
    // Where its caption stands (STY-079): a figure's is the last thing in its markup, below the image,
    // so only a caption above it is moved - to the head of the figure, which stacks what it holds.
    if (image.caption === 'above') {
      const at = `${CANVAS} figure[data-image-style="${image.id}"]`;
      rules.push(
        `${at} { display: flex; flex-direction: column; }`,
        `${at} > .aw-figure-body { order: -1; }`,
      );
    }
  }

  if (trimmed.length > 0) {
    trimmed.push(...imageRules(), ...markerRules(theme, capHeight));
    rules.push(`@supports (text-box: trim-both cap alphabetic) {\n${trimmed.join('\n')}\n}`);
  }
  return rules.join('\n') + '\n';
}

/**
 * What the projection is told beside the theme: each face's cap height, as a fraction of its em, where
 * the renderer knows it (`@alloy-works/fonts`). With it, a browser that can trims each block to its
 * first line's cap height and its last line's baseline and places the baseline from those, which it
 * measures exactly; without it, or in one that cannot, the baseline is placed from the face's ascent
 * and descent, which a browser rounds to whole pixels - up to half a point at a block's edge.
 */
export interface ProjectCssOptions {
  readonly capHeight?: (face: Typeface) => number | undefined;
}

/**
 * A list, as the template sets one: in its items' place's style - its markers too - with its items
 * standing that style's leading apart and nothing more, as Word sets one list's paragraphs, and that
 * style's space before and after around the list as a whole, whatever style its first and last items
 * are in. The editor stylesheet's own space around a list and between its items stands down, and a
 * marker, in the place's face and size, does not open its line.
 *
 * **And its items where the engine sets them** (found by the browser suite, W13.4's review): no indent
 * of the list's own, then a column of markers as wide as the widest - a bullet, or the widest number
 * right-aligned in it - then half an em of the place's size, then the item's text, which is Typst's
 * `list` and `enum` at their defaults. So a list is a grid of two columns, each item a row of it
 * through `subgrid`, its marker drawn in the first and its blocks stacked in the second: the column is
 * as wide as the widest marker the list draws, as the engine's is, which no length written here could
 * know without the face's own widths. The bullets are the template's, cycling by depth; a number is the
 * item's own, counted as the browser counts a list's items, from the list's start.
 */
function listRules(theme: ResolvedTheme): string[] {
  const item = theme.paragraphStyles.get(theme.places.listItem);
  if (!item) return [];
  const p = item.properties;
  const list = `${CANVAS} :is(ul, ol)`;
  const bullets = ['\\2022', '\\25E6', '\\25AA'];
  return [
    `${list}, ${CANVAS} li { margin-block: 0; }`,
    `${CANVAS} li { font-family: "${faceFamily(item.typeface.id)}"; font-size: ${zoomed(p.size)}; ` +
      `font-weight: ${p.bold ? 700 : 400}; font-style: ${p.italic ? 'italic' : 'normal'}; ` +
      `color: ${p.colour}; line-height: 0; }`,
    `${list} { display: grid; grid-template-columns: max-content minmax(0, 1fr); ` +
      `column-gap: ${zoomed(p.size / 2)}; padding-inline-start: 0; list-style: none; }`,
    `${list} > li { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; ` +
      'align-items: baseline; margin-inline: 0; counter-increment: list-item; }',
    `${list} > li::before { grid-column: 1; grid-row: 1; }`,
    `${CANVAS} ol > li::before { content: counter(list-item, decimal) "."; justify-self: end; }`,
    `${CANVAS} ol[data-format="alphabetic"] > li::before { content: counter(list-item, lower-alpha) "."; }`,
    `${CANVAS} ol[data-format="roman"] > li::before { content: counter(list-item, lower-roman) "."; }`,
    ...[0, 1, 2, 3, 4, 5].map(
      (depth) =>
        `${CANVAS} ${'ul '.repeat(depth)}ul > li::before { content: "${bullets[depth % 3]}"; justify-self: start; }`,
    ),
    `${list} > li > * { grid-column: 2; min-width: 0; }`,
    `${list} > li > [data-style]:first-child ` +
      `{ margin-block-start: calc(${length(p.lineSpacing - p.size)} - var(--aw-leading) + ${LIFT}); }`,
    `${list} > li:first-child > [data-style]:first-child { --aw-before: ${length(p.spaceBefore)}; }`,
    `${list} > li:not(:first-child) > [data-style]:first-child { --aw-before: ${NONE}; }`,
    `${list} > li:last-child > [data-style]:last-child { --aw-after: ${length(p.spaceAfter)}; }`,
    `${list} > li:not(:last-child) > [data-style]:last-child { --aw-after: ${NONE}; }`,
    // A list that ends an item which is not its list's last stands no space after it: the template
    // sets only the leading between one item and the next, whatever the first ends in (found by the
    // browser suite, issue #331). Where the item is its list's last, the space after is the outer
    // list's, which is the same place's.
    `${NESTED_ENDS.map((each) => `${each} > [data-style]:last-child`).join(', ')} { --aw-after: ${NONE}; }`,
    // A filled block given the list's spaces paints its fill between them, whatever its own were.
    `${list} > li:first-child > [data-style]:first-child, ${list} > li:last-child > [data-style]:last-child ` +
      `{ background-color: transparent; ${BETWEEN_SPACES.join('; ')}; }`,
  ];
}

/**
 * Preformatted text's label stands above its block, as the template sets it: a paragraph of its own
 * in its role's style, with its own indents and fill, its space after and the block's space before
 * between them, and the block's fill below it alone. The editor draws the label from the block's
 * attribute, inside the block; so it is taken out of the block's flow and stood above it, in the room
 * the block leaves above itself - the label's height, which is its space before, its line spacing, its
 * space after and its fill's padding twice, since a block of one line is that tall in either model.
 */
function labelRules(theme: ResolvedTheme): string[] {
  const label = theme.paragraphStyles.get(theme.roles.preformattedLabel)?.properties;
  const block = theme.paragraphStyles.get(theme.roles.preformatted)?.properties;
  if (!label || !block) return [];
  const padding = label.background === 'none' ? 0 : label.padding;
  const height = label.spaceBefore + label.lineSpacing + label.spaceAfter + 2 * padding;
  const at = `${CANVAS} pre[data-language][data-role]`;
  return [
    `${at} { position: relative; margin-block-start: ${zoomed(height)}; }`,
    `${at}::before { position: absolute; inset-block-start: ${zoomed(-height)}; ` +
      `inset-inline: ${zoomed(-block.startIndent)} ${zoomed(-block.endIndent)}; }`,
  ];
}

/**
 * A quotation's attribution stands inside the quotation's own indents, as the template sets it in the
 * quotation's block: at its style's indent where that is deeper, and at the quotation's otherwise.
 */
function attributionRules(theme: ResolvedTheme): string[] {
  const quotation = theme.paragraphStyles.get(theme.places.quotation)?.properties;
  const attribution = theme.paragraphStyles.get(theme.roles.attribution)?.properties;
  if (!quotation || !attribution) return [];
  const start = Math.max(quotation.startIndent, attribution.startIndent);
  const end = Math.max(quotation.endIndent, attribution.endIndent);
  return [
    `${CANVAS} blockquote > [data-role="attribution"] { margin-inline: ${zoomed(start)} ${zoomed(end)}; }`,
  ];
}

/**
 * A table style's rules on the surface's tables (STY-076, TH-I), as template 13 draws them: the side
 * its caption stands on (STY-079), as template 15 sets it; its rules inside and its outer frame; its cells' padding; its header row's and header column's fill, bold and
 * rule - the header row's below its last row, the header column's after its last column; and the band
 * behind every other body row from the first, under a filled header column's own fill. Header cells are
 * told by the `scope` the editor gives them from the table's header counts. What depends on pages -
 * the header repeated, rows kept whole, the continuation label - is preview's (STY-037).
 */
function tableRules(style: TableStyle, cell: ResolvedParagraphStyle | undefined): string[] {
  const at = `${CANVAS} [data-table-style="${style.id}"]`;
  // Where its caption stands (STY-079): a table's is the first thing in its markup, above the cells, so
  // only a caption below them is moved - after the cells and before the note, which stays last.
  const placed =
    style.caption === 'below'
      ? [
          `${at} { display: flex; flex-direction: column; }`,
          `${at} > .aw-table-caption { order: 1; }`,
          `${at} > .aw-table-note { order: 2; }`,
        ]
      : [];
  const fill = (colour: string) => (colour === 'none' ? 'transparent' : colour);
  // **A rule takes no room**, as the template draws one: centred on its line, half in each cell beside
  // it and the outer rule's other half outside the table. So each cell paints the half of each rule on
  // its edges as an inset shadow, over its fill and under its text, and the table the outer rule's
  // outside half as a shadow of its own; a cell's padding is the style's, whole. A border would take its
  // width from the cells, and be snapped to whole pixels besides (found by the browser suite, W13.4).
  const width = (rule: TableRule) =>
    rule === 'none' ? NONE : `calc(${fixed(rule.width / 2)}pt * var(--aw-zoom))`;
  const colour = (rule: TableRule) => (rule === 'none' ? 'transparent' : rule.colour);
  const side = (name: 'top' | 'bottom' | 'start' | 'end', rule: TableRule) =>
    `--aw-rule-${name}: ${width(rule)}; --aw-rule-${name}-colour: ${colour(rule)}`;
  const outer = style.rules.outer;
  // A table stands apart from what is before it as its cells' place does - that style's space before
  // and its leading - and from what follows by its space after; inside a cell, the first block takes no
  // space or leading above it and the last no space after, as the template sets a cell's blocks.
  const space = cell
    ? ` margin-block: ${length(cell.properties.spaceBefore + cell.properties.lineSpacing - cell.properties.size)} ` +
      `${length(cell.properties.spaceAfter)};`
    : '';
  const rules = [
    // The editor stylesheet's own space around a table stands down.
    // A block of its own, so that its cells' spaces add to a neighbour's as the template's gaps do,
    // rather than collapsing into them as two margins would.
    `${at} { margin: 0; ${style.caption === 'below' ? '' : 'display: flow-root; '}}`,
    // The application's own look for a table - its surface, a row lit under the pointer, a header's
    // capitals and tracking - stands down, as the editor stylesheet's does (found by the browser suite).
    `${at} table { border-collapse: collapse; border: 0; background: transparent; ` +
      `box-shadow: ${outer === 'none' ? 'none' : `0 0 0 ${width(outer)} ${colour(outer)}`};${space} }`,
    `${at} tr { background: transparent; }`,
    `${at} td, ${at} th { padding: ${zoomed(style.padding)}; border: 0; ` +
      `${side('top', style.rules.horizontal)}; ${side('bottom', style.rules.horizontal)}; ` +
      `${side('start', style.rules.vertical)}; ${side('end', style.rules.vertical)}; ` +
      '--aw-rule-left: var(--aw-rule-start); --aw-rule-left-colour: var(--aw-rule-start-colour); ' +
      '--aw-rule-right: var(--aw-rule-end); --aw-rule-right-colour: var(--aw-rule-end-colour); ' +
      'box-shadow: inset 0 var(--aw-rule-top) 0 0 var(--aw-rule-top-colour), ' +
      'inset 0 calc(-1 * var(--aw-rule-bottom)) 0 0 var(--aw-rule-bottom-colour), ' +
      'inset var(--aw-rule-left) 0 0 0 var(--aw-rule-left-colour), ' +
      'inset calc(-1 * var(--aw-rule-right)) 0 0 0 var(--aw-rule-right-colour); ' +
      'background-color: transparent; font-weight: inherit; text-transform: none; ' +
      'letter-spacing: normal; }',
    // Right to left, a cell's start is its right.
    `${at} :is(td, th):dir(rtl) { ` +
      '--aw-rule-left: var(--aw-rule-end); --aw-rule-left-colour: var(--aw-rule-end-colour); ' +
      '--aw-rule-right: var(--aw-rule-start); --aw-rule-right-colour: var(--aw-rule-start-colour); }',
    `${at} tr:first-child > * { ${side('top', outer)}; }`,
    `${at} tr:last-child > * { ${side('bottom', outer)}; }`,
    `${at} tr > :first-child { ${side('start', outer)}; }`,
    `${at} tr > :last-child { ${side('end', outer)}; }`,
    `${at} :is(td, th) > [data-style]:first-child ` +
      `{ margin-block-start: calc(${LIFT} - var(--aw-before) - var(--aw-leading)); }`,
    `${at} :is(td, th) > [data-style]:last-child { --aw-after: ${NONE}; }`,
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
  // The corner - a header row's cells in the header columns - takes the header row's fill and weight,
  // and the header column's where the header row has none, as the template sets it.
  const corner = cornerOf(at);
  if (style.headerRow.fill === 'none' && style.headerColumn.fill !== 'none') {
    rules.push(`${corner} { background-color: ${style.headerColumn.fill}; }`);
  }
  if (!style.headerRow.bold && style.headerColumn.bold) {
    rules.push(
      `${corner
        .split(', ')
        .map((each) => `${each} [data-style]`)
        .join(', ')} { font-weight: 700; }`,
    );
  }
  // A header's rule is drawn by the cells on both sides of its line, over the table's own there.
  if (style.headerRow.rule !== 'none') {
    rules.push(
      `${at} tr:has(> [scope="col"]):not(:has(+ tr > [scope="col"])) > * ` +
        `{ ${side('bottom', style.headerRow.rule)}; }`,
      `${at} tr:has(> [scope="col"]) + tr:not(:has(> [scope="col"])) > * ` +
        `{ ${side('top', style.headerRow.rule)}; }`,
    );
  }
  // The header column's rule runs the table's whole height, the header rows' too, as the template draws
  // it: after the last header cell of every row, the corner's included (found by the browser suite).
  if (style.headerColumn.rule !== 'none') {
    rules.push(
      `${at} [scope="row"]:not(:has(+ [scope="row"])), ` +
        `${cornerOf(at, (count) => `:nth-child(${count})`)} ` +
        `{ ${side('end', style.headerColumn.rule)}; }`,
      `${at} [scope="row"]:not(:has(+ [scope="row"])) + *, ` +
        `${cornerOf(at, (count) => `:nth-child(${count + 1})`)} ` +
        `{ ${side('start', style.headerColumn.rule)}; }`,
    );
  }
  return [...placed, ...rules];
}

/**
 * A table's corner cells: in a header row, and among the first as many cells as its body rows have
 * header cells - which the markup says only by the `scope` of the cells below, so the count is read
 * from those, up to six header columns.
 */
function cornerOf(at: string, cells = (count: number) => `:nth-child(-n + ${count})`): string {
  return [1, 2, 3, 4, 5, 6]
    .map(
      (count) =>
        `${at} table:has(tr > [scope="row"]:nth-child(${count})):not(:has(tr > [scope="row"]:nth-child(${count + 1}))) ` +
        `tr > [scope="col"]${cells(count)}`,
    )
    .join(', ');
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
  const filled = p.background !== 'none';
  const padding = filled ? p.padding : 0;
  return [
    `font-family: "${faceFamily(face.id)}"`,
    `font-size: ${zoomed(p.size)}`,
    `font-weight: ${p.bold ? 700 : 400}`,
    `font-style: ${p.italic ? 'italic' : 'normal'}`,
    `color: ${p.colour}`,
    // Its spaces, named once so contextual spacing can take either away, and drawn as padding: a
    // browser snaps a border's width to whole device pixels, which lost up to three quarters of a point
    // at every block (measured in the browser suite, W13.4), and padding it does not.
    `--aw-before: ${length(p.spaceBefore)}`,
    `--aw-after: ${length(p.spaceAfter)}`,
    // And its leading, the line spacing less the em a line of it is: what a block first in a cell
    // takes back (`tableRules`).
    `--aw-leading: ${length(p.lineSpacing - p.size)}`,
    // What a line of it is, for what stands in the line to be measured against (issue #331): its face,
    // size, weight, posture and line spacing, which a line of its text is drawn in wherever one is
    // needed; its face's descender, and its text's own top above the baseline, an em less the
    // descender, which is the template's; and the size a run in it stands at, and the face, weight
    // and posture a mark in it inherits where its style states none (`markRules`).
    `--aw-face: "${faceFamily(face.id)}"`,
    `--aw-size: ${length(p.size)}`,
    `--aw-weight: ${p.bold ? 700 : 400}`,
    `--aw-posture: ${p.italic ? 'italic' : 'normal'}`,
    `--aw-line: ${length(p.lineSpacing)}`,
    `--aw-descent: ${precise(face.descent)}`,
    `--aw-top: ${length((1 - face.descent) * p.size)}`,
    `--aw-run: ${length(p.size)}`,
    `--aw-run-face: "${faceFamily(face.id)}"`,
    `--aw-run-weight: ${p.bold ? 700 : 400}`,
    `--aw-run-posture: ${p.italic ? 'italic' : 'normal'}`,
    // Its fill, painted between its spaces: where it has none, its padding box, as a colour, which an
    // accessibility checker reads as the text's background; where it has spaces, the padding box less
    // them, which only a positioned gradient paints - and which a checker cannot read, so it hands such
    // text to a person (docs/testing.md).
    ...(filled
      ? fill(p.background, p.spaceBefore === 0 && p.spaceAfter === 0)
      : ['--aw-fill: transparent', 'background: transparent']),
    `text-align: ${ALIGN[p.alignment]}`,
    `text-indent: ${zoomed(p.firstLineIndent)}`,
    `margin-inline: ${zoomed(p.startIndent)} ${zoomed(p.endIndent)}`,
    // No rule of its own: a style has no border property, so the frame the editor's stylesheet draws
    // round preformatted text stands down on the canvas, as the quotation's does - the page prints the
    // style's fill and padding and no frame, and the canvas shows the page.
    'border: 0',
    ...lines(style, undefined),
    `padding-inline: ${zoomed(padding)}`,
    `line-height: ${zoomed(p.lineSpacing)}`,
  ];
}

/**
 * A block's first baseline and its last line's foot, placed as Word places them (STY-051, STY-054): its
 * first baseline its space before, its padding and its line spacing less its descender below its top,
 * and its foot its descender, its padding and its space after below its last baseline. Where `cap` is
 * the face's cap height, the block is trimmed to its first line's cap and its last line's baseline,
 * which a browser measures exactly, and the rest is padding; otherwise the half-leading is moved above
 * each line, from the face's ascent and descent, which a browser rounds to whole pixels.
 */
function lines(style: ResolvedParagraphStyle, cap: number | undefined): string[] {
  const p = style.properties;
  const face = style.typeface;
  const padding = p.background !== 'none' ? p.padding : 0;
  if (cap === undefined) {
    const halfLeading = (p.lineSpacing - (face.ascent + face.descent) * p.size) / 2;
    return [
      `margin-block: 0 ${zoomed(-halfLeading)}`,
      `padding-block: calc(var(--aw-before) + ${length(halfLeading + padding)}) ` +
        `calc(${length(padding)} + var(--aw-after))`,
    ];
  }
  return [
    'text-box: trim-both cap alphabetic',
    // Lifted where it begins with a line of its own text above its first (`growerRules`).
    `margin-block: ${LIFT} 0`,
    `padding-block: calc(var(--aw-before) + ${length(padding + p.lineSpacing - (face.descent + cap) * p.size)}) ` +
      `calc(${length(padding + face.descent * p.size)} + var(--aw-after))`,
  ];
}

/**
 * **Every mark as three boxes** (issue #331), which the editor's markup gives it (`schema.ts`): the
 * mark's own element, an `.aw-mark-below` inside it, and an `.aw-mark-run` inside that holding the text.
 *
 * The template opens a line by what a run larger than its text stands above the text's top and below
 * its foot - the run's growth, the size it is set at less the text's, times an em less the descender
 * above and the descender below, since its line's edges are ems of whatever size is set - and it
 * measures a script by its mark's scale, the script's own size being the engine's shaping. A browser
 * opens a line by each inline box's line spacing, split about its face's ascent and descent as it
 * rounds them to pixels, so no length written here can say where the paragraph's own line stands. So
 * the two outer boxes are each a line of the paragraph's own text - its face, size, weight, posture and
 * line spacing, which the browser makes as it makes the paragraph's - the first raised by the growth
 * above and the second lowered below by the growth below, and on every line the run is on: a line is
 * held open to the further of the paragraph's own and theirs. The text is set back on the baseline at
 * no height of its own, in the mark's look and at its scale of the run around it.
 */
function markRules(theme: ResolvedTheme): string[] {
  const rules: string[] = [];
  for (const mark of STYLED_MARKS) {
    const style = theme.characterStyles[mark];
    const at = `${CANVAS} .aw-mark-${mark}`;
    const scale = style.properties.scale ?? 1;
    rules.push(
      `${at} { ${[
        'font-family: var(--aw-face)',
        'font-size: var(--aw-size)',
        'font-weight: var(--aw-weight)',
        'font-style: var(--aw-posture)',
        'line-height: var(--aw-line)',
        'color: inherit',
        'text-decoration-line: none',
        '--aw-around: var(--aw-run)',
        `--aw-grow: max(${NONE}, calc(var(--aw-run)${scale === 1 ? '' : ` * ${fixed(scale)}`} - var(--aw-size)))`,
        '--aw-up: calc((1 - var(--aw-descent)) * var(--aw-grow))',
        '--aw-down: calc(var(--aw-descent) * var(--aw-grow))',
        'vertical-align: var(--aw-up)',
      ].join('; ')}; }`,
      `${at} > .aw-mark-below { vertical-align: calc(-1 * var(--aw-grow)); }`,
      `${at} > .aw-mark-below > .aw-mark-run { ${characterDeclarations(
        style.properties,
        style.typeface && faceFamily(style.typeface.id),
      ).join('; ')}; }`,
    );
  }
  return rules;
}

/**
 * A mark's text: what its style states, and otherwise what the run around it is set in - the face,
 * weight and posture a paragraph or an enclosing mark passes down, since the mark's own element is set
 * in its paragraph's - at its scale of the run around it, a script at the theme's script size of that.
 * A script moves by the browser's own rule, drawn where it would stand from the text's baseline, and
 * opens no line of its own, as the template's does not.
 */
function characterDeclarations(p: CharacterProperties, family: string | undefined): string[] {
  const scale = (p.scale ?? 1) * (p.position === undefined ? 1 : SCRIPT_SCALE);
  const stated = (property: string, name: string, value: string | undefined) =>
    value === undefined
      ? [`${property}: var(${name})`]
      : [`${property}: ${value}`, `${name}: ${value}`];
  return [
    ...stated(
      'font-weight',
      '--aw-run-weight',
      p.bold === undefined ? undefined : p.bold ? '700' : '400',
    ),
    ...stated(
      'font-style',
      '--aw-run-posture',
      p.italic === undefined ? undefined : p.italic ? 'italic' : 'normal',
    ),
    `text-decoration-line: ${p.underline ? 'underline' : 'none'}`,
    `color: ${p.colour ?? 'inherit'}`,
    ...stated('font-family', '--aw-run-face', family === undefined ? undefined : `"${family}"`),
    `font-size: ${scale === 1 ? 'var(--aw-around)' : `calc(var(--aw-around) * ${fixed(scale)})`}`,
    '--aw-run: 1em',
    'line-height: 0',
    ...(p.position === undefined
      ? ['vertical-align: var(--aw-down)']
      : [
          `vertical-align: ${p.position === 'subscript' ? 'sub' : 'super'}`,
          'position: relative',
          'top: calc(-1 * var(--aw-down))',
        ]),
  ];
}

/**
 * An image in a line (issue #331), in a holder the editor gives it: the template opens its line by what
 * the image stands above the text's own top, an em less the descender, where a browser opens it by what
 * the image stands above its line spacing's share. So the holder is a block standing on the text's
 * baseline, and above the image it holds a line of the paragraph's text, trimmed at its baseline - as
 * tall above it as the paragraph's own lines, which the browser rounds alike - less that top: the line
 * is held open to the further of the paragraph's own top and the image's above the text's.
 */
function imageRules(): string[] {
  const holder = `${CANVAS} .aw-inline-image-holder`;
  return [
    `${holder} { display: inline-block; line-height: 0; text-indent: 0; vertical-align: baseline; }`,
    `${holder}::before { content: "\\200b"; display: block; line-height: var(--aw-line); ` +
      'text-box: trim-end text alphabetic; margin-block-end: calc(-1 * var(--aw-top)); pointer-events: none; }',
  ];
}

/**
 * **A paragraph holding what can open its first or last line** (issue #331) - an image in a line, a
 * mark larger than its text - begins and ends with a line of its own text, which the browser trims
 * instead: it trims a block's first line to its cap height and its last to its baseline, and with them
 * whatever holds either open. The line above is its first and stands a line above the text's own, so
 * the paragraph is lifted by that line: its padding above is what it had less a line, where that is
 * more than nothing, and the rest a lift, which every block's margin above carries (`lines`,
 * `listRules`, `tableRules`) and its fill is painted clear of. Its first line's indent is given to the
 * text's own first line, after the break. The line below is a block, which stands the line's height
 * back into its paragraph. A footnote's paragraph, which the document view sets in its anchor's line,
 * and one marked as not resolving, whose label is its first line, are left as they are.
 */
function growerRules(
  theme: ResolvedTheme,
  style: ResolvedParagraphStyle,
  selectors: readonly string[],
  cap: number,
): string[] {
  const growers = [
    '.aw-inline-image-holder',
    ...STYLED_MARKS.filter((mark) => (theme.characterStyles[mark].properties.scale ?? 1) > 1).map(
      (mark) => `.aw-mark-${mark}`,
    ),
  ].map((each) => `${each}:not(.aw-footnote-text *)`);
  const at = selectors
    .filter(
      (each) =>
        !each.includes('::') &&
        !each.includes('[data-unresolved]') &&
        !each.includes('.aw-footnote-paragraph'),
    )
    .map((each) => `${each}:has(${growers.join(', ')})`);
  if (at.length === 0) return [];
  const p = style.properties;
  const filled = p.background !== 'none';
  const lifted = `calc(var(--aw-before) + ${length((filled ? p.padding : 0) - (style.typeface.descent + cap) * p.size)})`;
  return [
    `${at.join(', ')} { ${[
      `--aw-lift: min(${NONE}, ${lifted})`,
      `padding-block-start: max(${NONE}, ${lifted})`,
      `text-indent: ${zoomed(p.firstLineIndent)} each-line`,
      ...(filled ? ['background-color: transparent', ...BETWEEN_SPACES] : []),
    ].join('; ')}; }`,
    `${at.map((each) => `${each}::before`).join(', ')} ` +
      '{ content: "\\200b\\A"; white-space: pre; pointer-events: none; }',
    `${at.map((each) => `${each}::after`).join(', ')} ` +
      '{ content: "\\200b"; display: block; margin-block-end: calc(-1 * var(--aw-line)); pointer-events: none; }',
  ];
}

/**
 * **A list's markers hold their items' lines open**, as the template's do (issue #331): a marker is set
 * in the list's place's style, and its line is an em of that style tall, so where the item's text is
 * smaller the marker stands further above and below it. Each marker is trimmed to its cap height and
 * its baseline, which a browser measures exactly, and padded to the list's leading and its own top above
 * its baseline and its descender below - the first item's the list's space before too, and the last
 * item's its space after, as their text is given them - so the row of the list's grid its item stands
 * in is as tall as the further of the two.
 */
function markerRules(
  theme: ResolvedTheme,
  capHeight: (face: Typeface) => number | undefined,
): string[] {
  const item = theme.paragraphStyles.get(theme.places.listItem);
  const cap = item && capHeight(item.typeface);
  if (!item || cap === undefined) return [];
  const p = item.properties;
  const above = p.lineSpacing - (item.typeface.descent + cap) * p.size;
  const below = item.typeface.descent * p.size;
  const list = `${CANVAS} :is(ul, ol)`;
  return [
    `${list} > li::before { text-box: trim-both cap alphabetic; line-height: ${zoomed(p.lineSpacing)}; ` +
      `padding-block: ${zoomed(above)} ${zoomed(below)}; }`,
    `${list} > li:first-child::before { padding-block-start: ${zoomed(above + p.spaceBefore)}; }`,
    `${list} > li:last-child::before { padding-block-end: ${zoomed(below + p.spaceAfter)}; }`,
    `${NESTED_ENDS.map((each) => `${each}::before`).join(', ')} { padding-block-end: ${zoomed(below)}; }`,
  ];
}

/**
 * A block's fill, named once as `--aw-fill`: a colour where the block has no spaces of its own, and
 * otherwise a gradient painted between them. Where a list gives its first or last item's block the
 * list's spaces, `listRules` paints that block's fill as the gradient, from `--aw-fill`.
 */
function fill(colour: string, spaceless: boolean): string[] {
  return [
    `--aw-fill: ${colour}`,
    ...(spaceless
      ? [`background: ${colour}`]
      : ['background-color: transparent', ...BETWEEN_SPACES]),
  ];
}

/** A fill painted between a block's spaces, from its `--aw-fill`. */
const BETWEEN_SPACES = [
  'background-image: linear-gradient(var(--aw-fill), var(--aw-fill))',
  'background-repeat: no-repeat',
  // Clear of the line a lifted paragraph begins with above its own (`growerRules`).
  'background-position: 0 calc(var(--aw-before) - var(--aw-lift, calc(0pt * var(--aw-zoom))))',
  'background-size: 100% calc(100% - var(--aw-before) - var(--aw-after) + var(--aw-lift, calc(0pt * var(--aw-zoom))))',
];

/** No length, with a unit, so that a `calc` can add it: what a space taken away is. */
const NONE = 'calc(0pt * var(--aw-zoom))';

/** How far a block is lifted, where it begins with a line of its own text above its first. */
const LIFT = `var(--aw-lift, ${NONE})`;

/**
 * An item ending in a list, where the item is not its list's last - and that list's last item ending
 * in a list, and so on, six deep: where the template sets only its leading between the item and the
 * next, whatever the item ends in.
 */
const NESTED_ENDS = [0, 1, 2, 3, 4, 5].map(
  (depth) =>
    `${CANVAS} li:not(:last-child) > ${':is(ul, ol):last-child > li:last-child > '.repeat(depth)}` +
    ':is(ul, ol):last-child > li:last-child',
);

/** A length in points, scaled by the canvas's zoom, always with a unit: what a `calc` can add. */
function length(points: number): string {
  return `calc(${fixed(points)}pt * var(--aw-zoom))`;
}

/** A length in points, scaled by the canvas's zoom. */
function zoomed(points: number): string {
  return points === 0 ? '0' : `calc(${fixed(points)}pt * var(--aw-zoom))`;
}

function fixed(value: number): string {
  return String(Number(value.toFixed(3)));
}

/** A fraction of an em, to a hundred-thousandth: what a length is multiplied by. */
function precise(value: number): string {
  return String(Number(value.toFixed(5)));
}
