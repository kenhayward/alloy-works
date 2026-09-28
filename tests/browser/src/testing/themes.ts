import {
  DEFAULT_CATALOGUES,
  DEFAULT_CATALOGUES_BY_VERSION,
  DEFAULT_THEME,
  readTheme,
  type Catalogue,
  type CharacterProperties,
  type ParagraphProperties,
  type ResolvedParagraphProperties,
  type ResolvedTheme,
  type TableRule,
} from '@alloy-works/domain';
import type { ThemeArtifacts, ThemeToWrite } from './store.js';

/**
 * **The five themes W13.4 measures** (the W13 plan's B-M): the default; a second, hand-written, that
 * differs from it in every property the editor projects; and three generated from a seeded generator
 * within the catalogue's schema, narrowed to what the store accepts (the plan's question 3). Each but
 * the default is written to artifacts of its own (`store.ts`), which a template then names.
 */

type ParagraphCatalogue = Extract<Catalogue, { kind: 'paragraph' }>;
type CharacterCatalogue = Extract<Catalogue, { kind: 'character' }>;
type TableCatalogue = Extract<Catalogue, { kind: 'table' }>;
type ImageCatalogue = Extract<Catalogue, { kind: 'image' }>;
type TableStyle = TableCatalogue['styles'][number];
type ImageStyle = ImageCatalogue['styles'][number];

/** The default theme, resolved: every paragraph style with every property stated. */
function resolvedDefault(): ResolvedTheme {
  const read = readTheme(DEFAULT_THEME, DEFAULT_CATALOGUES_BY_VERSION);
  if (!read.ok) throw new Error('The default theme does not read');
  return read.theme;
}

/** The default theme's content but for the catalogues it binds, which each theme here binds its own. */
const defaultContent: Omit<typeof DEFAULT_THEME, 'catalogues'> = Object.fromEntries(
  Object.entries(DEFAULT_THEME).filter(([key]) => key !== 'catalogues'),
) as Omit<typeof DEFAULT_THEME, 'catalogues'>;

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
): ThemeToWrite {
  const resolved = resolvedDefault();
  const base = DEFAULT_CATALOGUES.paragraph.base;
  const paragraphs: ParagraphCatalogue = {
    schemaVersion: 3,
    kind: 'paragraph',
    base: { ...base, contextualSpacing: base.contextualSpacing ?? false },
    styles: DEFAULT_CATALOGUES.paragraph.styles.map((style) => ({
      ...style,
      properties: printable(
        style.id,
        paragraph(style.id, resolved.paragraphStyles.get(style.id)!.properties),
      ) as ParagraphProperties,
    })),
  };
  const characters: CharacterCatalogue = {
    schemaVersion: 3,
    kind: 'character',
    styles: DEFAULT_CATALOGUES.character.styles.map((style) => ({
      ...style,
      properties: character(style.id, style.properties),
    })),
  };
  const tables: TableCatalogue = {
    ...DEFAULT_CATALOGUES.table,
    styles: DEFAULT_CATALOGUES.table.styles.map(table),
  };
  const images: ImageCatalogue = {
    ...DEFAULT_CATALOGUES.image,
    styles: DEFAULT_CATALOGUES.image.styles.map(image),
  };
  return {
    theme: { ...defaultContent, name, paper },
    catalogues: { paragraph: paragraphs, character: characters, table: tables, image: images },
  };
}

/**
 * **What the PDF sets of a style**, which is what STY-080 measures the editor against: every property
 * the editor renders but these, which the template does not set (issue #330) and the themes here
 * therefore never state - a caption's fill, padding and indents, since the template sets a caption's
 * text and not its block; the first line's indent of centred text, which the engine does not indent;
 * and of preformatted text, which it sets as code.
 */
function printable(
  id: string,
  properties: ResolvedParagraphProperties,
): ResolvedParagraphProperties {
  const caption =
    id === DEFAULT_THEME.roles.caption
      ? { background: 'none', padding: 0, startIndent: 0, endIndent: 0, firstLineIndent: 0 }
      : {};
  const unindented =
    properties.alignment === 'centre' || id === DEFAULT_THEME.roles.preformatted
      ? { firstLineIndent: 0 }
      : {};
  return { ...properties, ...caption, ...unindented };
}

/** Where each theme but the default is written: fixed, so a later run writes nothing unchanged. */
function artifactsOf(n: number): ThemeArtifacts {
  const id = (k: number) => `a7e5b0c1-5a1e-4b0c-8f00-000000000${n}0${k}`;
  return {
    theme: id(0),
    catalogues: { paragraph: id(1), character: id(2), table: id(3), image: id(4) },
  };
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
export function contraryTheme(): {
  readonly name: string;
  readonly write: ThemeToWrite;
  readonly artifacts: ThemeArtifacts;
} {
  const write = derive(
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
      scale: was.scale === undefined ? 0.9 : 1,
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
  return { name: 'Contrary', write, artifacts: artifactsOf(1) };
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
 * no wider than twice its padding (`table_rule_over_text`); a mark's scale no larger than its text,
 * since a larger one grows its line by a rule the editor does not follow (themes.md); preformatted text
 * in the monospaced face; and a figure as a block, since the editor has no page to float one to.
 */
export function generatedTheme(n: number, seed: number) {
  const random = generator(seed);
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
  const write = derive(
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
      ...(chance(0.4) ? { scale: between(0.6, 1, 0.05) } : {}),
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
          },
  );
  return { name, write, artifacts: artifactsOf(n + 1), seed };
}
