import type { z } from 'zod';

import { migrateStored, type MigrationChain } from '../stored/migrate.js';

import { contrastRatio, requiredContrast } from './contrast.js';
import {
  CATALOGUE_KINDS,
  CATALOGUE_SCHEMA_VERSION,
  PLACES,
  ROLES,
  STYLED_MARKS,
  THEME_SCHEMA_VERSION,
  catalogueSchema,
  themeSchema,
  type Catalogue,
  type CatalogueKind,
  type CharacterCatalogue,
  type CharacterProperties,
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
  /** A catalogue is not a `catalogue/1`: one refusal for each place its shape fails. */
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
  /** Text below the contrast its size asks against something it can stand on (STY-069, TH-G). */
  'contrast_too_low',
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

// Read-time projections, as every chain's are. Both shapes are at their first version, so neither has
// a step yet; a stored version from a newer build is refused rather than half read.
export const themeMigrationChain: MigrationChain = {
  subject: 'theme',
  current: THEME_SCHEMA_VERSION,
  migrations: {},
};

export const catalogueMigrationChain: MigrationChain = {
  subject: 'catalogue',
  current: CATALOGUE_SCHEMA_VERSION,
  migrations: {},
};

/**
 * **One catalogue on its own**, as the store reads a version it is asked to save: its shape, and what
 * can be known without a theme - identifiers each used once, each mark styled once and every mark
 * styled, and every chain unbroken. Whether a typeface it names exists is the theme's question, since
 * the typefaces are the theme's.
 */
export function readCatalogue(value: unknown): CatalogueReadOutcome {
  const parsed = parse(
    value,
    catalogueMigrationChain,
    catalogueSchema,
    'The catalogue',
    'catalogue_malformed',
  );
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
    const parsed = parse(
      catalogues.get(version),
      catalogueMigrationChain,
      catalogueSchema,
      `The ${kind} catalogue ${version}`,
      'catalogue_malformed',
    );
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

  refusals.push(
    ...contrast(
      stated.paper,
      paragraphStyles,
      character?.kind === 'character' ? [...character.marks.values()] : [],
    ),
  );

  if (refusals.length > 0 || maths === undefined) return { ok: false, refusals };
  const table = examined.table;
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
    case 'table':
      return { kind: 'table', refusals, styles: unique(catalogue.styles) };
    case 'image':
      return { kind: 'image', refusals, styles: unique(catalogue.styles) };
    case 'admonition':
    case 'citation':
      return { kind: catalogue.kind, refusals };
  }
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
 * has none; and each character style that states a colour against every background it can stand on -
 * the paper, and each paragraph style's fill - at the size and weight of the text it would colour. A
 * mark's failure is refused once for each background and ratio, naming the first style it fails in.
 * A mark that states no colour takes its paragraph's, which is already checked.
 */
function contrast(
  paper: string,
  paragraphs: ReadonlyMap<string, ResolvedParagraphStyle>,
  marks: readonly CharacterCatalogue['styles'][number][],
): ThemeRefusal[] {
  const refusals: ThemeRefusal[] = [];
  const shortOf = (ratio: number, needed: number) =>
    `at ${(Math.floor(ratio * 100) / 100).toFixed(2)}:1, below the ${needed}:1 its text needs`;

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
    const colour = mark.properties.colour;
    if (colour === undefined) continue;
    const reported = new Set<string>();
    for (const style of paragraphs.values()) {
      const { background, size, bold } = style.properties;
      const behind = background === 'none' ? paper : background;
      const ratio = contrastRatio(colour, behind);
      const needed = requiredContrast(size, mark.properties.bold ?? bold);
      const key = `${background} ${needed}`;
      if (ratio >= needed || reported.has(key)) continue;
      reported.add(key);
      const on =
        background === 'none'
          ? `the paper ${paper}`
          : `the background ${background} of the paragraph style ${style.id}`;
      refusals.push({
        code: 'contrast_too_low',
        message: `The character style ${mark.id} sets ${colour} on ${on} ${shortOf(ratio, needed)}`,
      });
    }
  }
  return refusals;
}

function missingFace(what: string): ThemeRefusal {
  return { code: 'typeface_missing', message: `${what}, which the theme does not declare` };
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
  const result = schema.safeParse(migrated);
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
