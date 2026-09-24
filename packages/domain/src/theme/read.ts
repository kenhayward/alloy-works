import type { z } from 'zod';

import { migrateStored, type MigrationChain } from '../stored/migrate.js';

import { contrastRatio, requiredContrast } from './contrast.js';
import {
  CATALOGUE_KINDS,
  CATALOGUE_SCHEMA_VERSION,
  PLACES,
  ROLES,
  SCRIPT_SCALE,
  STYLED_MARKS,
  THEME_SCHEMA_VERSION,
  catalogueSchema,
  catalogueSchema1,
  themeSchema,
  type Catalogue,
  type Catalogue1,
  type CatalogueKind,
  type CharacterCatalogue,
  type CharacterProperties,
  type ImageLength,
  type ImageStyle,
  type ParagraphCatalogue,
  type ParagraphStyle,
  type Place,
  type ResolvedParagraphProperties,
  type Role,
  type StyleTarget,
  type StyledMark,
  type TableStyle,
  type Typeface,
} from './schema.js';

/**
 * **The reader** (themes 1, ruling R2): the one place a theme's rules live (STY-035,
 * docs/design/themes.md). A theme and the catalogues it names go in; a `ResolvedTheme` comes out, in
 * which every paragraph style has every property concrete - its chain walked to the base, its typeface
 * found - or **every refusal at once**, never the first alone, each a stable code and a sentence
 * (STY-061). The projections that follow translate what this returns and decide nothing, so the editor,
 * the publisher and Word cannot resolve a style differently: none of them resolves one.
 *
 * The same reader serves the store, which refuses a version this refuses when it is saved, `assemble`,
 * which reads the theme a request recorded, and the tests. It is a pure function of its arguments
 * (STY-038): it reads no clock and no store, and changes neither argument.
 */

export const themeRefusalCodes = [
  /** The theme is not a `theme/1`: one refusal for each place its shape fails. */
  'theme_malformed',
  /** A catalogue version the theme names was not among those given. */
  'catalogue_missing',
  /**
   * A catalogue is not a `catalogue/2`, nor a `catalogue/1` the reader can upgrade: one refusal for
   * each place its shape fails.
   */
  'catalogue_malformed',
  /** The theme names a catalogue of one kind where it binds another. */
  'catalogue_wrong_kind',
  /** Two styles of one catalogue share an identifier (STY-005). */
  'style_duplicate',
  /** A style is based on one its catalogue does not contain. */
  'style_parent_missing',
  /** A style's chain returns to itself (STY-056). */
  'style_cycle',
  /** A character catalogue styles one mark twice. */
  'mark_duplicate',
  /** A character catalogue leaves a mark a publication carries without a style (STY-009). */
  'mark_unstyled',
  /** The theme declares two typefaces with one identifier. */
  'typeface_duplicate',
  /** A style, a catalogue's base or the maths face names a typeface the theme does not declare. */
  'typeface_missing',
  /** A place or a role is given a style the paragraph catalogue does not contain (STY-027). */
  'style_missing',
  /** A place or a role is given a style that does not apply there (STY-006). */
  'style_not_applicable',
  /** Preformatted text is set in a face with no advance, whose columns cannot be measured. */
  'preformatted_not_monospaced',
  /**
   * A style's lines, as it resolves, are closer than its size (STY-051): a line is one em tall, so
   * they would be set over each other (the final review of themes 1, I2).
   */
  'line_spacing_below_size',
  /** Text below the contrast its size asks against something it can stand on (STY-069, TH-G). */
  'contrast_too_low',
  /**
   * An image style gives a width as a fraction of the text block's height, or a height as a fraction
   * of the measure: each measures only the other dimension (themes 2, ruling R1).
   */
  'image_unit_wrong_dimension',
  /** An image style sizes in ems an image that is not in a line of text, which has no ems to size by. */
  'image_unit_not_applicable',
  /**
   * An image style places a figure in a line of text, or an image in a line of text as a block or
   * floated: a figure stands on its own, and an image in a line of text where its text puts it.
   */
  'image_placement_not_applicable',
  /**
   * A table style draws a rule wider than twice its cells' padding: a rule takes no room, so half of it
   * stands inside the cell beside it, and over its text (the final whole-branch review of themes 2, I3).
   */
  'table_rule_over_text',
] as const;

export type ThemeRefusalCode = (typeof themeRefusalCodes)[number];

/** A named failure: a stable code for automation and counting, and a sentence for a person. */
export interface ThemeRefusal {
  readonly code: ThemeRefusalCode;
  readonly message: string;
}

/** A paragraph style with nothing left to inherit. */
export interface ResolvedParagraphStyle {
  readonly id: string;
  readonly name: string;
  /** Kept only for a projection that shows hierarchy - Word's styles pane. Nothing is inherited from it. */
  readonly basedOn?: string;
  readonly appliesTo: readonly StyleTarget[];
  /** Every property stated, the chain walked to the catalogue's base. */
  readonly properties: ResolvedParagraphProperties;
  /** The typeface `properties.typeface` names, found. */
  readonly typeface: Typeface;
}

/** A mark's rendering. Its properties stay optional: an unstated one leaves the paragraph's alone. */
export interface ResolvedCharacterStyle {
  readonly id: string;
  readonly name: string;
  readonly mark: StyledMark;
  readonly properties: CharacterProperties;
  /** The typeface `properties.typeface` names, found, where it names one. */
  readonly typeface?: Typeface;
}

export interface ResolvedTheme {
  readonly name: string;
  readonly paper: string;
  /** In the order the theme declares them. */
  readonly typefaces: ReadonlyMap<string, Typeface>;
  /** The face every equation is set in. */
  readonly maths: Typeface;
  /** The catalogue version bound for each kind (STY-024): what a publication records, through the theme's. */
  readonly catalogues: Readonly<Record<CatalogueKind, string>>;
  /** By identifier, in the catalogue's order, which is the order a projection emits them in. */
  readonly paragraphStyles: ReadonlyMap<string, ResolvedParagraphStyle>;
  /** One for each mark a publication carries (STY-009), from this theme's catalogue (STY-010). */
  readonly characterStyles: Readonly<Record<StyledMark, ResolvedCharacterStyle>>;
  readonly tableStyles: ReadonlyMap<string, TableStyle>;
  readonly imageStyles: ReadonlyMap<string, ImageStyle>;
  /** The paragraph style's identifier each place defaults to (TH-E): what a stored `body` means there. */
  readonly places: Readonly<Record<Place, string>>;
  /** The paragraph style's identifier each role is set in (TH-E). */
  readonly roles: Readonly<Record<Role, string>>;
}

export type CatalogueReadOutcome =
  { ok: true; catalogue: Catalogue } | { ok: false; refusals: ThemeRefusal[] };

export type ThemeReadOutcome =
  { ok: true; theme: ResolvedTheme } | { ok: false; refusals: ThemeRefusal[] };

// Read-time projections, as every chain's are: the stored bytes never change. A stored version from a
// newer build is refused rather than half read.
export const themeMigrationChain: MigrationChain = {
  subject: 'theme',
  current: THEME_SCHEMA_VERSION,
  migrations: {},
};

/**
 * **What a table style at `catalogue/1` reads as**: template 12's look, which the engine drew while no
 * table style said anything (themes 2, ruling R1) - every rule 1pt black, outer, horizontal and
 * vertical; cells padded 5pt; the header neither filled nor bold, ruled by the rules alone; no banding;
 * the header repeated on each page and a row allowed to split; no continuation label. So a publication
 * made under a version 1 catalogue looks as template 12 set it.
 */
const TEMPLATE_12_TABLE = {
  headerRow: { fill: 'none', bold: false, rule: 'none' },
  headerColumn: { fill: 'none', bold: false, rule: 'none' },
  banding: { fill: 'none' },
  rules: {
    outer: { width: 1, colour: '#000000' },
    horizontal: { width: 1, colour: '#000000' },
    vertical: { width: 1, colour: '#000000' },
  },
  padding: 5,
  breaks: { repeatHeader: true, keepRowsWhole: false, continuationLabel: false },
} as const satisfies Omit<TableStyle, 'id' | 'name' | 'appliesTo'>;

/**
 * **What an image style at `catalogue/1` reads as**: today's rules, which `assemble` and template 12
 * held as their own. A figure fixes its width at the measure, is at most 60 per cent of the text
 * block's height, and stands as a block, centred; an image in a line of text fixes its height at 1.2
 * ems of its text, is at most the measure wide, and stands where its text puts it. A version 1 style
 * applying to both is given the figure's, and refused as `image_placement_not_applicable`: no placement
 * holds both. None is stored - no route writes a catalogue, and the default's rows apply each to one.
 */
const TODAYS_FIGURE = {
  fixed: { dimension: 'width', value: 1, unit: 'measure' },
  maximum: { value: 0.6, unit: 'textHeight' },
  placement: 'block',
  alignment: 'centre',
} as const;

const TODAYS_INLINE_IMAGE = {
  fixed: { dimension: 'height', value: 1.2, unit: 'em' },
  maximum: { value: 1, unit: 'measure' },
  placement: 'inline',
} as const;

/**
 * **A `catalogue/1` as `catalogue/2` reads it**, from one `catalogueSchema1` has already parsed: a table
 * style gains template 12's look, an image style today's rules, and a paragraph catalogue's base
 * contextual spacing, off, as no version 1 paragraph asked for it. A character catalogue, and the empty
 * two, change only their version. Pure, and it changes nothing it is given.
 */
export function upgradeCatalogue1(catalogue: Catalogue1): Catalogue {
  switch (catalogue.kind) {
    case 'paragraph':
      return {
        ...catalogue,
        schemaVersion: 2,
        base: { ...catalogue.base, contextualSpacing: false },
      };
    case 'table':
      return {
        ...catalogue,
        schemaVersion: 2,
        styles: catalogue.styles.map((style) => ({
          ...style,
          ...structuredClone(TEMPLATE_12_TABLE),
        })),
      };
    case 'image':
      return {
        ...catalogue,
        schemaVersion: 2,
        styles: catalogue.styles.map((style) => ({
          ...style,
          ...structuredClone(
            style.appliesTo.includes('figure') ? TODAYS_FIGURE : TODAYS_INLINE_IMAGE,
          ),
        })),
      };
    case 'character':
      return { ...catalogue, schemaVersion: 2 };
    case 'admonition':
      return { ...catalogue, schemaVersion: 2 };
    case 'citation':
      return { ...catalogue, schemaVersion: 2 };
  }
}

/**
 * The catalogue's chain. Its one step is `upgradeCatalogue1`, which takes a version 1 catalogue
 * `catalogueSchema1` has parsed: `parseCatalogue` holds one to that parse first, so nothing version 1
 * refused is upgraded past it.
 */
export const catalogueMigrationChain: MigrationChain = {
  subject: 'catalogue',
  current: CATALOGUE_SCHEMA_VERSION,
  migrations: {
    1: (catalogue) =>
      upgradeCatalogue1(catalogue as unknown as Catalogue1) as unknown as Record<string, unknown>,
  },
};

/**
 * **One catalogue on its own**, as the store reads a version it is asked to save: its shape, and what
 * can be known without a theme - identifiers each used once, each mark styled once and every mark
 * styled, and every chain unbroken. Whether a typeface it names exists is the theme's question, since
 * the typefaces are the theme's.
 */
export function readCatalogue(value: unknown): CatalogueReadOutcome {
  const parsed = parseCatalogue(value, 'The catalogue');
  if (!parsed.ok) return parsed;
  const refusals = examine(parsed.value).refusals;
  return refusals.length === 0 ? { ok: true, catalogue: parsed.value } : { ok: false, refusals };
}

/**
 * **A theme and the catalogues it names**, each given under the artifact-version identifier the theme
 * names it by. A catalogue given under any other identifier is never read: the theme binds versions.
 */
export function readTheme(
  theme: unknown,
  catalogues: ReadonlyMap<string, unknown>,
): ThemeReadOutcome {
  const parsedTheme = parse(
    theme,
    themeMigrationChain,
    themeSchema,
    'The theme',
    'theme_malformed',
  );
  if (!parsedTheme.ok) return parsedTheme;
  const stated = parsedTheme.value;
  const refusals: ThemeRefusal[] = [];

  const typefaces = new Map<string, Typeface>();
  for (const face of stated.typefaces) {
    if (typefaces.has(face.id)) {
      refusals.push({
        code: 'typeface_duplicate',
        message: `The theme declares two typefaces with the identifier ${face.id}`,
      });
    } else {
      typefaces.set(face.id, face);
    }
  }
  const maths = typefaces.get(stated.maths);
  if (maths === undefined) {
    refusals.push(missingFace(`The theme's maths face is the typeface ${stated.maths}`));
  }

  // Each catalogue at the version the theme names, of the kind it is named for.
  const examined: Partial<Record<CatalogueKind, Examined>> = {};
  for (const kind of CATALOGUE_KINDS) {
    const version = stated.catalogues[kind];
    if (!catalogues.has(version)) {
      refusals.push({
        code: 'catalogue_missing',
        message: `The theme's ${kind} catalogue, version ${version}, was not found`,
      });
      continue;
    }
    const parsed = parseCatalogue(catalogues.get(version), `The ${kind} catalogue ${version}`);
    if (!parsed.ok) {
      refusals.push(...parsed.refusals);
      continue;
    }
    if (parsed.value.kind !== kind) {
      refusals.push({
        code: 'catalogue_wrong_kind',
        message: `The theme names ${version} as its ${kind} catalogue, which is ${article(parsed.value.kind)} ${parsed.value.kind} catalogue`,
      });
      continue;
    }
    const outcome = examine(parsed.value);
    refusals.push(...outcome.refusals);
    examined[kind] = outcome;
  }

  // Every paragraph style's typeface found. The base's and each style's own are checked where they are
  // stated, so a face missing from the base is refused once rather than once for every style.
  const paragraph = examined.paragraph;
  const paragraphStyles = new Map<string, ResolvedParagraphStyle>();
  if (paragraph?.kind === 'paragraph') {
    const base = paragraph.catalogue.base.typeface;
    if (!typefaces.has(base)) {
      refusals.push(missingFace(`The paragraph catalogue's base is set in the typeface ${base}`));
    }
    for (const style of paragraph.catalogue.styles) {
      const own = style.properties.typeface;
      if (own !== undefined && !typefaces.has(own) && paragraph.styles.get(style.id) === style) {
        refusals.push(missingFace(`The paragraph style ${style.id} is set in the typeface ${own}`));
      }
    }
    for (const [id, { style, properties }] of paragraph.resolved) {
      const typeface = typefaces.get(properties.typeface);
      if (typeface === undefined) continue;
      paragraphStyles.set(id, {
        id,
        name: style.name,
        ...(style.basedOn === undefined ? {} : { basedOn: style.basedOn }),
        appliesTo: style.appliesTo,
        properties,
        typeface,
      });
    }
  }

  const character = examined.character;
  const characterStyles: Partial<Record<StyledMark, ResolvedCharacterStyle>> = {};
  if (character?.kind === 'character') {
    for (const style of character.marks.values()) {
      const own = style.properties.typeface;
      const typeface = own === undefined ? undefined : typefaces.get(own);
      if (own !== undefined && typeface === undefined) {
        refusals.push(missingFace(`The character style ${style.id} is set in the typeface ${own}`));
        continue;
      }
      characterStyles[style.mark] = {
        id: style.id,
        name: style.name,
        mark: style.mark,
        properties: style.properties,
        ...(typeface === undefined ? {} : { typeface }),
      };
    }
  }

  // Each place and each role given a style that exists and that applies there (STY-006, STY-027).
  if (paragraph?.kind === 'paragraph') {
    const given = (target: StyleTarget, what: 'place' | 'role', id: string) => {
      const style = paragraph.styles.get(id);
      if (style === undefined) {
        refusals.push({
          code: 'style_missing',
          message: `The ${target} ${what} is given the paragraph style ${id}, which the paragraph catalogue does not contain`,
        });
      } else if (!style.appliesTo.includes(target)) {
        refusals.push({
          code: 'style_not_applicable',
          message: `The ${target} ${what} is given the paragraph style ${id}, which applies only to ${inWords(style.appliesTo)}`,
        });
      }
    };
    for (const place of PLACES) given(place, 'place', stated.places[place]);
    for (const role of ROLES) given(role, 'role', stated.roles[role]);

    // A column of preformatted text is measured by its face's advance, so the face must have one.
    const preformatted = paragraphStyles.get(stated.roles.preformatted);
    if (preformatted !== undefined && preformatted.typeface.advance === undefined) {
      refusals.push({
        code: 'preformatted_not_monospaced',
        message: `The preformatted role is set in the typeface ${preformatted.typeface.id}, which records no advance: it is not monospaced`,
      });
    }
  }

  // Line spacing is a minimum distance from baseline to baseline, and a line in this model is one em
  // tall, its edges the face's descender below the baseline and one em less that above it: a spacing
  // below the size would set each line over the one before, in the PDF as Word's `atLeast` never
  // would. Refused for each style as it resolves, so a style that states a size larger than the line
  // spacing it inherits is named, and the base is named through every style that keeps both.
  for (const style of paragraphStyles.values()) {
    const { size, lineSpacing } = style.properties;
    if (lineSpacing < size) {
      refusals.push({
        code: 'line_spacing_below_size',
        message: `The paragraph style ${style.id} sets its lines ${lineSpacing}pt apart, closer than its size of ${size}pt: a line is never set closer than its size`,
      });
    }
  }

  const table = examined.table;
  refusals.push(
    ...contrast(
      stated.paper,
      paragraphStyles,
      character?.kind === 'character' ? [...character.marks.values()] : [],
      // Every style a table's cell can hold text in (the final whole-branch review of themes 2, I4):
      // the places' own first, then each other that applies to a cell or, since a list can stand in
      // one, to a list item, in the catalogue's order - `assemble` sets a paragraph stored in any of
      // them there.
      [
        ...new Set([
          stated.places.tableCell,
          stated.places.listItem,
          ...[...paragraphStyles.values()]
            .filter(
              ({ appliesTo }) => appliesTo.includes('tableCell') || appliesTo.includes('listItem'),
            )
            .map(({ id }) => id),
        ]),
      ].flatMap((id) => {
        const style = paragraphStyles.get(id);
        return style === undefined ? [] : [style];
      }),
      table?.kind === 'table' ? [...table.styles.values()] : [],
    ),
  );

  if (refusals.length > 0 || maths === undefined) return { ok: false, refusals };
  const image = examined.image;
  return {
    ok: true,
    theme: {
      name: stated.name,
      paper: stated.paper,
      typefaces,
      maths,
      catalogues: Object.fromEntries(
        CATALOGUE_KINDS.map((kind) => [kind, stated.catalogues[kind]]),
      ) as Record<CatalogueKind, string>,
      paragraphStyles,
      characterStyles: characterStyles as Record<StyledMark, ResolvedCharacterStyle>,
      tableStyles: table?.kind === 'table' ? table.styles : new Map(),
      imageStyles: image?.kind === 'image' ? image.styles : new Map(),
      places: Object.fromEntries(PLACES.map((place) => [place, stated.places[place]])) as Record<
        Place,
        string
      >,
      roles: Object.fromEntries(ROLES.map((role) => [role, stated.roles[role]])) as Record<
        Role,
        string
      >,
    },
  };
}

/** A catalogue as examined on its own: its refusals, and what of it could be resolved. */
type Examined =
  | {
      kind: 'paragraph';
      refusals: ThemeRefusal[];
      catalogue: ParagraphCatalogue;
      /** The first style of each identifier. */
      styles: Map<string, ParagraphStyle>;
      /** Each style whose chain reaches the base, with every property it resolves to. */
      resolved: Map<string, { style: ParagraphStyle; properties: ResolvedParagraphProperties }>;
    }
  | {
      kind: 'character';
      refusals: ThemeRefusal[];
      /** The first style of each mark. */
      marks: Map<StyledMark, CharacterCatalogue['styles'][number]>;
    }
  | { kind: 'table'; refusals: ThemeRefusal[]; styles: Map<string, TableStyle> }
  | { kind: 'image'; refusals: ThemeRefusal[]; styles: Map<string, ImageStyle> }
  | { kind: 'admonition' | 'citation'; refusals: ThemeRefusal[] };

function examine(catalogue: Catalogue): Examined {
  const refusals: ThemeRefusal[] = [];
  const unique = <T extends { id: string }>(styles: readonly T[]): Map<string, T> => {
    const byId = new Map<string, T>();
    for (const style of styles) {
      if (byId.has(style.id)) {
        refusals.push({
          code: 'style_duplicate',
          message: `The ${catalogue.kind} catalogue gives two styles the identifier ${style.id}`,
        });
      } else {
        byId.set(style.id, style);
      }
    }
    return byId;
  };

  switch (catalogue.kind) {
    case 'paragraph': {
      const styles = unique(catalogue.styles);
      return {
        kind: 'paragraph',
        refusals,
        catalogue,
        styles,
        resolved: chains(catalogue, styles, refusals),
      };
    }
    case 'character': {
      unique(catalogue.styles);
      const marks = new Map<StyledMark, CharacterCatalogue['styles'][number]>();
      for (const style of catalogue.styles) {
        if (marks.has(style.mark)) {
          refusals.push({
            code: 'mark_duplicate',
            message: `The character catalogue styles the mark ${style.mark} twice, as ${marks.get(style.mark)!.id} and as ${style.id}`,
          });
        } else {
          marks.set(style.mark, style);
        }
      }
      for (const mark of STYLED_MARKS) {
        if (!marks.has(mark)) {
          refusals.push({
            code: 'mark_unstyled',
            message: `The character catalogue has no style for the mark ${mark}`,
          });
        }
      }
      return { kind: 'character', refusals, marks };
    }
    case 'table': {
      const styles = unique(catalogue.styles);
      for (const style of catalogue.styles) refusals.push(...tableRefusals(style));
      return { kind: 'table', refusals, styles };
    }
    case 'image': {
      const styles = unique(catalogue.styles);
      for (const style of catalogue.styles) refusals.push(...imageRefusals(style));
      return { kind: 'image', refusals, styles };
    }
    case 'admonition':
    case 'citation':
      return { kind: catalogue.kind, refusals };
  }
}

/**
 * What a table style says that cannot hold: a rule wider than twice its cells' padding (the final
 * whole-branch review of themes 2, I3). A rule takes no room - template 13 insets a cell's text by the
 * padding alone and draws the rule over the cell's edge, as the engine does - so half of it stands
 * inside the cell each side, and where that half is wider than the padding the rule is painted over the
 * text, and is a background no contrast rule judges. Refused once for the style, by its widest rule, the
 * first of them where two are as wide: the rule the style would have to narrow, or its padding widen.
 * Where the outer rule is wide it reaches as far into the margin, half its width, which is left as found.
 */
function tableRefusals(style: TableStyle): ThemeRefusal[] {
  const rules = (
    [
      ['outer rule', style.rules.outer],
      ['horizontal rule', style.rules.horizontal],
      ['vertical rule', style.rules.vertical],
      ["header row's rule", style.headerRow.rule],
      ["header column's rule", style.headerColumn.rule],
    ] as const
  ).flatMap(([what, rule]) => (rule === 'none' ? [] : [{ what, width: rule.width }]));
  const widest = rules.reduce<(typeof rules)[number] | undefined>(
    (most, each) => (most === undefined || each.width > most.width ? each : most),
    undefined,
  );
  if (widest === undefined || widest.width <= 2 * style.padding) return [];
  return [
    {
      code: 'table_rule_over_text',
      message: `The table style ${style.id} draws its ${widest.what} ${widest.width}pt wide, more than twice its cells' padding of ${style.padding}pt: half a rule stands inside the cell beside it, over its text`,
    },
  ];
}

/**
 * What an image style says that cannot hold (themes 2, ruling R1): a unit that measures the other
 * dimension - the measure is a width, the text block's height a height - for what it fixes or for the
 * most the other dimension may be; ems for an image that is not in a line of text, which has no text
 * to take them from; and a placement that cannot hold what the style applies to, `inline` being only an
 * image in a line of text's and a block or a float only a figure's. The shape has said everything else.
 */
function imageRefusals(style: ImageStyle): ThemeRefusal[] {
  const refusals: ThemeRefusal[] = [];
  const inLineOnly = !style.appliesTo.includes('figure');
  const other = style.fixed.dimension === 'width' ? 'height' : 'width';
  const judge = (length: ImageLength, dimension: 'width' | 'height', what: string) => {
    if (length.unit === 'measure' && dimension === 'height') {
      refusals.push({
        code: 'image_unit_wrong_dimension',
        message: `The image style ${style.id} gives its ${what} as a fraction of the measure, which measures only a width`,
      });
    } else if (length.unit === 'textHeight' && dimension === 'width') {
      refusals.push({
        code: 'image_unit_wrong_dimension',
        message: `The image style ${style.id} gives its ${what} as a fraction of the text block's height, which measures only a height`,
      });
    } else if (length.unit === 'em' && !inLineOnly) {
      refusals.push({
        code: 'image_unit_not_applicable',
        message: `The image style ${style.id} gives its ${what} in ems, which only an image in a line of text is sized in, and it applies to ${inWords(style.appliesTo)}`,
      });
    }
  };
  judge(style.fixed, style.fixed.dimension, style.fixed.dimension);
  judge(style.maximum, other, `greatest ${other}`);

  if (style.placement === 'inline' && !inLineOnly) {
    refusals.push({
      code: 'image_placement_not_applicable',
      message: `The image style ${style.id} places its image in a line of text, which only an image in a line of text can be, and it applies to ${inWords(style.appliesTo)}`,
    });
  } else if (style.placement !== 'inline' && style.appliesTo.includes('inlineImage')) {
    const how = style.placement === 'block' ? 'as a block' : 'floated';
    refusals.push({
      code: 'image_placement_not_applicable',
      message: `The image style ${style.id} places its image ${how}, which an image in a line of text cannot be, and it applies to ${inWords(style.appliesTo)}`,
    });
  }
  return refusals;
}

/**
 * Every style's chain walked to the base with a visited path, so a cycle is a refusal rather than a
 * hang (STY-056). A broken chain is refused once, where it breaks - at the style whose parent is
 * missing, or once for each cycle, at the first of its members in the catalogue's order - and a style
 * based on a broken chain is left unresolved without a refusal of its own, since mending the break
 * mends it.
 */
function chains(
  catalogue: ParagraphCatalogue,
  styles: ReadonlyMap<string, ParagraphStyle>,
  refusals: ThemeRefusal[],
): Map<string, { style: ParagraphStyle; properties: ResolvedParagraphProperties }> {
  const resolved = new Map<
    string,
    { style: ParagraphStyle; properties: ResolvedParagraphProperties }
  >();
  const inReportedCycle = new Set<string>();
  for (const style of styles.values()) {
    const path: ParagraphStyle[] = [];
    let current = style;
    let broken = false;
    for (;;) {
      const at = path.indexOf(current);
      if (at >= 0) {
        broken = true;
        const members = path.slice(at).map((each) => each.id);
        if (members.includes(style.id) && !inReportedCycle.has(style.id)) {
          for (const member of members) inReportedCycle.add(member);
          refusals.push({
            code: 'style_cycle',
            message: `The paragraph style ${style.id} is based on itself: ${[...path.map((each) => each.id), current.id].join(', ')}`,
          });
        }
        break;
      }
      path.push(current);
      if (current.basedOn === undefined) break;
      const parent = styles.get(current.basedOn);
      if (parent === undefined) {
        broken = true;
        if (current === style) {
          refusals.push({
            code: 'style_parent_missing',
            message: `The paragraph style ${style.id} is based on ${style.basedOn}, which the paragraph catalogue does not contain`,
          });
        }
        break;
      }
      current = parent;
    }
    if (broken) continue;
    // The base, then each ancestor from the root down, then the style: a stated property overrides.
    const properties = path.reduceRight<ResolvedParagraphProperties>(
      (inherited, link) => overlay(inherited, link.properties),
      { ...catalogue.base },
    );
    resolved.set(style.id, { style, properties });
  }
  return resolved;
}

/**
 * What a style states, laid over what it inherits. A property the style does not state never
 * overrides - an unstated property and one explicitly left undefined mean the same thing.
 */
function overlay(
  inherited: ResolvedParagraphProperties,
  stated: ParagraphStyle['properties'],
): ResolvedParagraphProperties {
  const out: Record<string, unknown> = { ...inherited };
  for (const [key, value] of Object.entries(stated)) {
    if (value !== undefined) out[key] = value;
  }
  return out as ResolvedParagraphProperties;
}

/**
 * **Contrast** (STY-069, TH-G), at WCAG's relative luminance: 4.5:1, or 3:1 for text of 18pt or of
 * 14pt bold. Each resolved paragraph style's colour against its own background, or the paper where it
 * has none. Then each character style in each paragraph style it can stand in, against that style's
 * fill or the paper, **at the size and weight its text is set at** (the final review of themes 1, I3):
 * the paragraph's size times the mark's `scale`, and times `SCRIPT_SCALE` where it is a subscript or a
 * superscript, bold where the mark says so or, where it says nothing, where the paragraph is. A mark
 * that states a colour is judged in it; one that states none is judged in its paragraph's, which is
 * checked already at the paragraph's own size and weight, so it is refused only where it asks more
 * than its paragraph does - a scale that shrinks the text, a position, bold turned off. A mark's failure
 * is refused once for each colour, background and ratio, naming the first style it fails in.
 *
 * Each character style is judged on its own. Marks nest - inline code in a subscript - and the size a
 * nest sets is the product of theirs, which is not judged: the reader does not know which marks an
 * author will combine.
 *
 * **A table style's fills** (themes 2, ruling R1; TH-G): its header row's, its header column's and its
 * band's, each that is not `none`, are what a table cell's text stands on, so the `tableCell` place's
 * style is judged against each, **bold where the header says bold** and otherwise as the style says,
 * and each character style in it, by the rule above, at the size and weight it sets there. So is the
 * `listItem` place's, where it is another style: a list can stand in a cell, and is set in that style
 * there as anywhere. And so is **every other style that applies to `tableCell` or to `listItem`** (the
 * final whole-branch review of themes 2, I4), since a paragraph stored in one is set in it there: the
 * places' defaults were once the only ones judged, and a style a cell's paragraph named passed on the
 * paper and was set at 3.01:1 on a header's fill. Where a style fills behind its own text, no table
 * fill is behind that text, and its own fill is judged already; the others are judged all the same.
 */
function contrast(
  paper: string,
  paragraphs: ReadonlyMap<string, ResolvedParagraphStyle>,
  marks: readonly CharacterCatalogue['styles'][number][],
  cells: readonly ResolvedParagraphStyle[],
  tables: readonly TableStyle[],
): ThemeRefusal[] {
  const refusals: ThemeRefusal[] = [];

  for (const style of paragraphs.values()) {
    const { colour, background, size, bold } = style.properties;
    const behind = background === 'none' ? paper : background;
    const ratio = contrastRatio(colour, behind);
    const needed = requiredContrast(size, bold);
    if (ratio < needed) {
      const on = background === 'none' ? `the paper ${paper}` : `its background ${background}`;
      refusals.push({
        code: 'contrast_too_low',
        message: `The paragraph style ${style.id} sets ${colour} on ${on} ${shortOf(ratio, needed)}`,
      });
    }
  }

  for (const mark of marks) {
    const { colour: own, scale = 1, position, bold: markBold } = mark.properties;
    const factor = scale * (position === undefined ? 1 : SCRIPT_SCALE);
    const reported = new Set<string>();
    for (const style of paragraphs.values()) {
      const { background, size, bold, colour: inherited } = style.properties;
      const colour = own ?? inherited;
      const behind = background === 'none' ? paper : background;
      const ratio = contrastRatio(colour, behind);
      const needed = requiredContrast(size * factor, markBold ?? bold);
      // In its paragraph's colour, a mark that asks no more than its paragraph is the paragraph's check.
      if (own === undefined && needed <= requiredContrast(size, bold)) continue;
      const key = `${colour} ${background} ${needed}`;
      if (ratio >= needed || reported.has(key)) continue;
      reported.add(key);
      const on =
        background === 'none'
          ? `the paper ${paper}`
          : `the background ${background} of the paragraph style ${style.id}`;
      const sets =
        own === undefined ? `${colour}, the colour of the paragraph style ${style.id},` : colour;
      refusals.push({
        code: 'contrast_too_low',
        message: `The character style ${mark.id} sets ${sets} on ${on} ${shortOf(ratio, needed)}`,
      });
    }
  }

  // A mark's failure on a fill is refused once, naming the first style it fails in, as on the paper.
  const reported = new Set<string>();
  for (const cell of cells) {
    if (cell.properties.background !== 'none') continue;
    refusals.push(...onFills(cell, marks, tables, reported));
  }
  return refusals;
}

/** A ratio short of what text needs, as every contrast refusal words it. */
function shortOf(ratio: number, needed: number): string {
  return `at ${(Math.floor(ratio * 100) / 100).toFixed(2)}:1, below the ${needed}:1 its text needs`;
}

/**
 * One style a table cell's text can be set in, judged on each fill a table style can put behind it,
 * with each character style in it: `contrast`'s last rule, for a style that fills behind none of its
 * own text.
 */
function onFills(
  cell: ResolvedParagraphStyle,
  marks: readonly CharacterCatalogue['styles'][number][],
  tables: readonly TableStyle[],
  reported: Set<string>,
): ThemeRefusal[] {
  const refusals: ThemeRefusal[] = [];
  // Each fill a table style can put behind a cell's text, and whether that text is bold there.
  const fills = tables.flatMap((table) =>
    (
      [
        ['header row', table.headerRow.fill, table.headerRow.bold],
        ['header column', table.headerColumn.fill, table.headerColumn.bold],
        ['band', table.banding.fill, false],
      ] as const
    ).flatMap(([where, fill, headerBold]) =>
      fill === 'none'
        ? []
        : [{ table: table.id, where, fill, bold: headerBold || cell.properties.bold }],
    ),
  );
  const { colour: ink, size } = cell.properties;
  for (const { table, where, fill, bold } of fills) {
    const ratio = contrastRatio(ink, fill);
    const needed = requiredContrast(size, bold);
    if (ratio < needed) {
      refusals.push({
        code: 'contrast_too_low',
        message: `The table style ${table} sets the text of the paragraph style ${cell.id}, ${ink}, on its ${where}'s fill ${fill} ${shortOf(ratio, needed)}`,
      });
    }
  }
  for (const mark of marks) {
    const { colour: own, scale = 1, position, bold: markBold } = mark.properties;
    const factor = scale * (position === undefined ? 1 : SCRIPT_SCALE);
    for (const { table, where, fill, bold } of fills) {
      const colour = own ?? ink;
      const needed = requiredContrast(size * factor, markBold ?? bold);
      // In the cell's colour, a mark that asks no more than the cell's text is the cell's check.
      if (own === undefined && needed <= requiredContrast(size, bold)) continue;
      const ratio = contrastRatio(colour, fill);
      const key = `${mark.id} ${colour} ${fill} ${needed}`;
      if (ratio >= needed || reported.has(key)) continue;
      reported.add(key);
      const sets =
        own === undefined ? `${colour}, the colour of the paragraph style ${cell.id},` : colour;
      refusals.push({
        code: 'contrast_too_low',
        message: `The character style ${mark.id} sets ${sets} on the ${where}'s fill ${fill} of the table style ${table} ${shortOf(ratio, needed)}`,
      });
    }
  }
  return refusals;
}

function missingFace(what: string): ThemeRefusal {
  return { code: 'typeface_missing', message: `${what}, which the theme does not declare` };
}

/**
 * A stored catalogue, read at the current version. One written at version 1 is held to
 * `catalogueSchema1`, the parse it was written against, before `upgradeCatalogue1` reads it as version
 * 2: a property version 1 never had is refused there, never upgraded past.
 */
function parseCatalogue(
  value: unknown,
  subject: string,
): { ok: true; value: Catalogue } | { ok: false; refusals: ThemeRefusal[] } {
  let stored = value;
  if (typeof value === 'object' && value !== null && Reflect.get(value, 'schemaVersion') === 1) {
    const first = issues(catalogueSchema1.safeParse(value), subject, 'catalogue_malformed');
    if (!first.ok) return first;
    stored = first.value;
  }
  return parse(stored, catalogueMigrationChain, catalogueSchema, subject, 'catalogue_malformed');
}

/** Migrate a stored value, then parse it, turning each place it fails into a refusal. */
function parse<T>(
  value: unknown,
  chain: MigrationChain,
  schema: z.ZodType<T>,
  subject: string,
  code: 'theme_malformed' | 'catalogue_malformed',
): { ok: true; value: T } | { ok: false; refusals: ThemeRefusal[] } {
  let migrated: Record<string, unknown>;
  try {
    migrated = migrateStored(value, chain);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, refusals: [{ code, message: `${subject} does not read: ${reason}` }] };
  }
  return issues(schema.safeParse(migrated), subject, code);
}

/** A parse's outcome, each place it fails a refusal naming where. */
function issues<T>(
  result: z.ZodSafeParseResult<T>,
  subject: string,
  code: 'theme_malformed' | 'catalogue_malformed',
): { ok: true; value: T } | { ok: false; refusals: ThemeRefusal[] } {
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    refusals: result.error.issues.map((issue) => ({
      code,
      message:
        issue.path.length === 0
          ? `${subject} does not read: ${issue.message}`
          : `${subject} does not read, at ${issue.path.map(String).join('.')}: ${issue.message}`,
    })),
  };
}

function article(kind: CatalogueKind): string {
  return kind === 'admonition' || kind === 'image' ? 'an' : 'a';
}

/** `a`, `a and b`, `a, b and c`. */
function inWords(list: readonly string[]): string {
  return list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}
