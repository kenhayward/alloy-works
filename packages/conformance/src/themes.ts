import {
  SIXTH_DEFAULT_CATALOGUES,
  SIXTH_DEFAULT_CATALOGUES_BY_VERSION,
  SIXTH_DEFAULT_THEME,
  readTheme,
  type Catalogue,
  type CharacterProperties,
  type ParagraphProperties,
  type ResolvedParagraphProperties,
  type ResolvedTheme,
  type TableRule,
  type Theme,
} from '@alloy-works/domain';

/**
 * **The themes the editor and Word are measured under** (the W13 plan's B-M; the W15 plan's W15-F):
 * the default; a second, hand-written, that differs from it in every property the editor projects;
 * and themes generated from a seeded generator within the catalogue's schema, narrowed to what the
 * store accepts (the W13 plan's question 3) - three from W13.4's seeds, and for Word three more with
 * the editor's one remaining narrowing lifted. The browser suite writes each but the default to
 * artifacts of its own, which a template then names; the worker's suite reads each as a publish would.
 */

/** The catalogues a measured theme brings of its own; the other two are the default's. */
export const OWN_KINDS = ['paragraph', 'character', 'table', 'image'] as const;
export type OwnKind = (typeof OWN_KINDS)[number];

/**
 * A measured theme's content: the theme but for the catalogues it binds, which are named by the
 * versions they become where it is written or read, and its four catalogues of its own at `catalogue/3`.
 */
export interface ThemeContent {
  readonly theme: Omit<Theme, 'catalogues'>;
  readonly catalogues: { readonly [K in OwnKind]: Extract<Catalogue, { kind: K }> };
}

/** W13.4's seeds, which the editor is measured under and Word beside it. */
const W13_SEEDS: readonly number[] = [1301, 1302, 1303];

/**
 * The seeds the generated themes are made from, from `ALLOY_BROWSER_STYLE_SEEDS` - `11,22,33` - where
 * it is set, so another set can be tried without changing a test, and W13.4's three where it is not.
 * Read by the kit for both suites, so Word and the editor are held to the PDF over the same values.
 */
export function styleSeeds(value: string | undefined): number[] {
  return value === undefined ? [...W13_SEEDS] : value.split(',').map((each) => Number(each.trim()));
}

/** The seeds of the themes both the editor and Word are measured under. */
export const EDITOR_SEEDS: readonly number[] = styleSeeds(process.env.ALLOY_BROWSER_STYLE_SEEDS);

/** The seeds of the three themes generated for Word alone (W15-F), a figure free to float. */
export const WORD_SEEDS: readonly number[] = [1501, 1502, 1503];

type ParagraphCatalogue = Extract<Catalogue, { kind: 'paragraph' }>;
type CharacterCatalogue = Extract<Catalogue, { kind: 'character' }>;
type TableCatalogue = Extract<Catalogue, { kind: 'table' }>;
type ImageCatalogue = Extract<Catalogue, { kind: 'image' }>;
type TableStyle = TableCatalogue['styles'][number];
type ImageStyle = ImageCatalogue['styles'][number];

/** The default theme, resolved: every paragraph style with every property stated. */
function resolvedDefault(): ResolvedTheme {
  const read = readTheme(SIXTH_DEFAULT_THEME, SIXTH_DEFAULT_CATALOGUES_BY_VERSION);
  if (!read.ok) throw new Error('The default theme does not read');
  return read.theme;
}

/** The default theme's content but for the catalogues it binds, which each theme here binds its own. */
const defaultContent: Omit<typeof SIXTH_DEFAULT_THEME, 'catalogues'> = Object.fromEntries(
  Object.entries(SIXTH_DEFAULT_THEME).filter(([key]) => key !== 'catalogues'),
) as Omit<typeof SIXTH_DEFAULT_THEME, 'catalogues'>;

/**
 * A theme like the default in its styles' identifiers, names, places and roles - so the fixture's
 * stored `body`, `lead`, `table` and `figure` name a style in every one - whose every paragraph style
 * states what `paragraph` gives it, every mark what `character` gives it, and every table and image
 * style what `table` and `image` give it.
 */
function derive(
  name: string,
  paper: string,
  paragraph: (id: string, was: ResolvedParagraphProperties) => ResolvedParagraphProperties,
  character: (id: string, was: CharacterProperties) => CharacterProperties,
  table: (was: TableStyle) => TableStyle,
  image: (was: ImageStyle) => ImageStyle,
): ThemeContent {
  const resolved = resolvedDefault();
  const base = SIXTH_DEFAULT_CATALOGUES.paragraph.base;
  const paragraphs: ParagraphCatalogue = {
    schemaVersion: 3,
    kind: 'paragraph',
    base: { ...base, contextualSpacing: base.contextualSpacing ?? false },
    styles: SIXTH_DEFAULT_CATALOGUES.paragraph.styles.map((style) => ({
      ...style,
      properties: printable(
        style.id,
        style.appliesTo,
        paragraph(style.id, resolved.paragraphStyles.get(style.id)!.properties),
      ) as ParagraphProperties,
    })),
  };
  const characters: CharacterCatalogue = {
    schemaVersion: 3,
    kind: 'character',
    styles: SIXTH_DEFAULT_CATALOGUES.character.styles.map((style) => ({
      ...style,
      properties: character(style.id, style.properties),
    })),
  };
  const tables: TableCatalogue = {
    ...SIXTH_DEFAULT_CATALOGUES.table,
    styles: SIXTH_DEFAULT_CATALOGUES.table.styles.map(table),
  };
  const images: ImageCatalogue = {
    ...SIXTH_DEFAULT_CATALOGUES.image,
    styles: SIXTH_DEFAULT_CATALOGUES.image.styles.map(image),
  };
  return {
    theme: { ...defaultContent, name, paper },
    catalogues: { paragraph: paragraphs, character: characters, table: tables, image: images },
  };
}

/**
 * **What the PDF sets of a style**, which is what the editor is measured against: every property
 * the editor renders but these, which the template does not set (issue #330) and the themes here
 * therefore never state - a caption's fill, padding and indents, since the template sets a caption's
 * text and not its block; the first line's indent of centred text, which the engine does not indent,
 * of preformatted text, which it sets as code, of a paragraph in a list's item, which it does not
 * indent either, and of a heading, which it sets as a heading's text and not a paragraph (found by
 * this suite once it measured where a heading starts, issue #333).
 */
function printable(
  id: string,
  appliesTo: readonly string[],
  properties: ResolvedParagraphProperties,
): ResolvedParagraphProperties {
  const caption =
    id === SIXTH_DEFAULT_THEME.roles.caption
      ? { background: 'none', padding: 0, startIndent: 0, endIndent: 0, firstLineIndent: 0 }
      : {};
  const unindented =
    properties.alignment === 'centre' ||
    id === SIXTH_DEFAULT_THEME.roles.preformatted ||
    appliesTo.includes('listItem') ||
    Object.entries(SIXTH_DEFAULT_THEME.roles).some(
      ([role, style]) => role.startsWith('heading') && style === id,
    )
      ? { firstLineIndent: 0 }
      : {};
  return { ...properties, ...caption, ...unindented };
}

/** Where a measured theme's own catalogues are bound when it is read here: fixed, and no artifact's. */
const READ_AT: Readonly<Record<OwnKind, string>> = {
  paragraph: '00000000-0000-4000-8000-00000000c001',
  character: '00000000-0000-4000-8000-00000000c002',
  table: '00000000-0000-4000-8000-00000000c003',
  image: '00000000-0000-4000-8000-00000000c004',
};

/**
 * A measured theme read by the product's one theme reader, as a publish reads the theme its template
 * names (themes 1, ruling R4) - its own four catalogues and the default's other two - or thrown on with
 * what the reader refused, so no suite measures a theme the store would not hold.
 */
export function readMeasuredTheme(content: ThemeContent): ResolvedTheme {
  const catalogues = { ...SIXTH_DEFAULT_THEME.catalogues, ...READ_AT };
  const read = readTheme(
    { ...content.theme, catalogues },
    new Map<string, unknown>([
      ...SIXTH_DEFAULT_CATALOGUES_BY_VERSION,
      ...OWN_KINDS.map((kind) => [READ_AT[kind], content.catalogues[kind]] as const),
    ]),
  );
  if (!read.ok) {
    throw new Error(
      `${content.theme.name} does not read: ${read.refusals.map((each) => each.message).join('; ')}`,
    );
  }
  return read.theme;
}

const ALIGNMENTS = ['start', 'end', 'centre', 'justify'] as const;

/**
 * **The second theme: every property the editor projects, changed** - every paragraph style's face,
 * size, weight, posture, colour, fill and its padding, alignment, three indents, two spaces, line
 * spacing and contextual spacing; every mark's weight, posture, underline, colour, face and scale; both
 * table styles' header treatment, banding, rules, padding and caption side; each figure style's size,
 * alignment and caption side, and the image in a line's height; and the paper. Preformatted text keeps
 * its monospaced face, whose advance is what the template counts its columns by.
 */
export function contraryTheme(): { readonly name: string; readonly content: ThemeContent } {
  const content = derive(
    'Contrary',
    '#fdfaf2',
    (id, was) => ({
      ...was,
      typeface: id.startsWith('preformatted')
        ? 'mono'
        : was.typeface === 'serif'
          ? 'mono'
          : 'serif',
      size: was.size + 1.5,
      bold: !was.bold,
      italic: !was.italic,
      colour: '#1f2d4a',
      background: was.background === 'none' ? '#eef3fb' : 'none',
      padding: was.background === 'none' ? 3.5 : 0,
      alignment: ALIGNMENTS[(ALIGNMENTS.indexOf(was.alignment) + 1) % 4]!,
      firstLineIndent: was.firstLineIndent + 7,
      startIndent: was.startIndent + 9,
      endIndent: was.endIndent + 6,
      spaceBefore: was.spaceBefore + 4.25,
      spaceAfter: was.spaceAfter + 3.5,
      lineSpacing: Math.round((was.size + 1.5) * 1.45 * 100) / 100,
      contextualSpacing: !was.contextualSpacing,
    }),
    (id, was) => ({
      bold: !(was.bold ?? false),
      italic: !(was.italic ?? false),
      underline: !(was.underline ?? false),
      colour: '#5a1f1f',
      typeface: was.typeface === 'mono' ? 'serif' : 'mono',
      ...(was.position ? { position: was.position } : {}),
      scale: was.scale === undefined ? 1.25 : 1,
    }),
    (was) => ({
      ...was,
      headerRow: {
        fill: '#e6eef7',
        bold: !was.headerRow.bold,
        rule: { width: 1.5, colour: '#2b3a55' },
      },
      headerColumn: {
        fill: '#f4ecdf',
        bold: !was.headerColumn.bold,
        rule: { width: 0.75, colour: '#6b4a1f' },
      },
      banding: { fill: was.banding.fill === 'none' ? '#f7f7ec' : 'none' },
      rules: {
        outer: { width: 2, colour: '#123456' },
        horizontal: { width: 0.5, colour: '#556677' },
        vertical: was.rules.vertical === 'none' ? { width: 0.25, colour: '#778899' } : 'none',
      },
      padding: 7,
      caption: was.caption === 'above' ? 'below' : 'above',
    }),
    (was) =>
      was.placement === 'inline'
        ? { ...was, fixed: { dimension: 'height', unit: 'em', value: 0.9 } }
        : {
            ...was,
            fixed: { dimension: 'width', unit: 'measure', value: was.id === 'figure' ? 0.7 : 0.35 },
            alignment: was.alignment === 'centre' ? 'end' : 'start',
            caption: was.caption === 'below' ? 'above' : 'below',
          },
  );
  return { name: 'Contrary', content };
}

/** mulberry32: a small seeded generator, so a generated theme is the same every run of its seed. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * **A theme generated from `seed`**, within the catalogue's schema and narrowed to what the store takes
 * (the W13 plan's question 3): text dark enough on fills and paper light enough that contrast
 * (STY-069) is met at any size; a line spacing never below its size, and never below the face's own
 * height, which the editor's line cannot hold (`line_spacing_below_size`, and themes.md); a table's rules
 * no wider than twice its padding (`table_rule_over_text`); preformatted text in the monospaced face;
 * and a figure as a block, since the editor has no page to float one to. A mark's scale runs from 0.6 to
 * 1.6 of its text, so a run larger than its text opens its line in both outputs (issue #331).
 *
 * **`forWord`** lifts the one narrowing left that is the editor's alone (W15-F): a figure's style may
 * float it, which Word and the PDF both render - the other, a mark no larger than its text, was lifted
 * for both by issue #331. Where each figure stands is drawn from a generator of its own, so everything
 * else a seed makes is the same for Word as for the editor, and the editor's themes are W13.4's.
 */
export function generatedTheme(n: number, seed: number, { forWord = false } = {}) {
  const random = generator(seed);
  // Only ever drawn from for Word: the editor's themes draw exactly what they drew before it.
  const floating = generator(seed ^ 0x5bd1e995);
  const pick = <T>(of: readonly T[]): T => of[Math.floor(random() * of.length)]!;
  const between = (low: number, high: number, step = 0.25) =>
    Math.round((low + random() * (high - low)) / step) * step;
  const chance = (p: number) => random() < p;
  const ink = () =>
    `#${[0, 1, 2]
      .map(() =>
        Math.floor(random() * 0x50)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`;
  const light = () =>
    `#${[0, 1, 2].map(() => (0xe1 + Math.floor(random() * 0x1e)).toString(16).padStart(2, '0')).join('')}`;
  const rule = (padding: number): TableRule =>
    chance(0.2) ? 'none' : { width: between(0.25, Math.min(3, padding * 2), 0.25), colour: ink() };
  const name = `Generated ${n}`;
  const content = derive(
    name,
    light(),
    (id, was) => {
      const size = id.startsWith('heading') || id === 'title' ? between(11, 20) : between(8, 14);
      const background = chance(0.3) ? light() : 'none';
      return {
        ...was,
        typeface: id.startsWith('preformatted') ? 'mono' : pick(['serif', 'mono'] as const),
        size,
        bold: chance(0.4),
        italic: chance(0.3),
        colour: ink(),
        background,
        padding: background === 'none' ? 0 : between(0, 6),
        alignment: pick(ALIGNMENTS),
        firstLineIndent: between(0, 12),
        startIndent: between(0, 24),
        endIndent: between(0, 24),
        spaceBefore: between(0, 12),
        spaceAfter: between(0, 12),
        lineSpacing: Math.round(size * between(1.2, 1.7, 0.01) * 100) / 100,
        contextualSpacing: chance(0.4),
      };
    },
    (id, was) => ({
      ...(chance(0.5) ? { bold: chance(0.5) } : {}),
      ...(chance(0.5) ? { italic: chance(0.5) } : {}),
      ...(chance(0.4) ? { underline: chance(0.6) } : {}),
      ...(chance(0.5) ? { colour: ink() } : {}),
      ...(chance(0.4) ? { typeface: pick(['serif', 'mono'] as const) } : {}),
      ...(was.position ? { position: was.position } : {}),
      ...(chance(0.4) ? { scale: between(0.6, 1.6, 0.05) } : {}),
    }),
    (was) => {
      const padding = between(1, 9);
      return {
        ...was,
        headerRow: { fill: chance(0.5) ? light() : 'none', bold: chance(0.5), rule: rule(padding) },
        headerColumn: {
          fill: chance(0.5) ? light() : 'none',
          bold: chance(0.5),
          rule: rule(padding),
        },
        banding: { fill: chance(0.5) ? light() : 'none' },
        rules: { outer: rule(padding), horizontal: rule(padding), vertical: rule(padding) },
        padding,
        caption: pick(['above', 'below'] as const),
      };
    },
    (was) =>
      was.placement === 'inline'
        ? { ...was, fixed: { dimension: 'height', unit: 'em', value: between(0.7, 1.5, 0.05) } }
        : {
            ...was,
            fixed: { dimension: 'width', unit: 'measure', value: between(0.25, 1, 0.05) },
            alignment: pick(['start', 'centre', 'end'] as const),
            caption: pick(['above', 'below'] as const),
            ...(forWord
              ? { placement: floating() < 0.5 ? ('float' as const) : ('block' as const) }
              : {}),
          },
  );
  return { name, content, seed };
}
