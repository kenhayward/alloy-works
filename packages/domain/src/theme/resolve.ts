import {
  themeSchema,
  type CharacterStyle,
  type MarkName,
  type ParagraphProperties,
  type ParagraphStyle,
  type Theme,
  type Typeface,
} from './schema.js';

/**
 * Resolution: the one place style rules live (STY-035, docs/design/themes.md).
 *
 * A theme goes in; every paragraph style comes out with every property concrete - inheritance
 * walked, defaults applied, references checked. The projections that follow translate these and
 * decide nothing, so the editor and the publisher cannot resolve a style differently: neither of
 * them resolves one.
 */

export type ThemeErrorCode =
  | 'duplicate-style'
  | 'duplicate-mark'
  | 'unknown-parent'
  | 'cycle'
  | 'unknown-typeface'
  | 'unknown-style'
  | 'unknown-mark';

/** A named failure. Resolution errors fail a publish; they never fall back to a default. */
export class ThemeError extends Error {
  override readonly name = 'ThemeError';

  constructor(
    readonly code: ThemeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Every property stated - the same shape the schema demands of a theme's defaults. */
export type ResolvedProperties = Theme['defaults'];

export interface ResolvedParagraphStyle {
  readonly id: string;
  readonly name: string;
  /** Kept only so projections that show hierarchy - Word's styles pane - can show it. */
  readonly basedOn?: string;
  readonly properties: ResolvedProperties;
}

export interface ResolvedTheme {
  readonly id: string;
  readonly paper: string;
  /** The root of every chain; also the canvas's ink. */
  readonly defaults: ResolvedProperties;
  readonly typefaces: Readonly<Record<string, Typeface>>;
  /** In catalogue order, which is the order projections emit them. */
  readonly paragraphStyles: readonly ResolvedParagraphStyle[];
  readonly characterStyles: Readonly<Partial<Record<MarkName, CharacterStyle>>>;
}

export function resolveTheme(input: unknown): ResolvedTheme {
  const theme = themeSchema.parse(input);

  const typefaces: Record<string, Typeface> = {};
  for (const face of theme.typefaces) typefaces[face.id] = face;

  const byId = new Map<string, ParagraphStyle>();
  for (const style of theme.paragraphStyles) {
    if (byId.has(style.id)) {
      throw new ThemeError('duplicate-style', `Style "${style.id}" is declared twice`);
    }
    byId.set(style.id, style);
  }

  const characterStyles: Partial<Record<MarkName, CharacterStyle>> = {};
  for (const style of theme.characterStyles) {
    if (characterStyles[style.mark] !== undefined) {
      throw new ThemeError('duplicate-mark', `Mark "${style.mark}" has two character styles`);
    }
    characterStyles[style.mark] = style;
  }

  /** The style and its ancestors, root first. A visited set makes a cycle an error, not a hang. */
  const chainOf = (style: ParagraphStyle): ParagraphStyle[] => {
    const chain: ParagraphStyle[] = [];
    const seen = new Set<string>();
    let current: ParagraphStyle | undefined = style;
    while (current !== undefined) {
      if (seen.has(current.id)) {
        const path = [...chain.map((s) => s.id).reverse(), current.id].join(' -> ');
        throw new ThemeError('cycle', `Style "${style.id}" inherits from itself: ${path}`);
      }
      seen.add(current.id);
      chain.unshift(current);
      if (current.basedOn === undefined) break;
      const parent = byId.get(current.basedOn);
      if (parent === undefined) {
        throw new ThemeError(
          'unknown-parent',
          `Style "${current.id}" is based on "${current.basedOn}", which the theme does not contain`,
        );
      }
      current = parent;
    }
    return chain;
  };

  const checkTypeface = (id: string, where: string): void => {
    if (typefaces[id] === undefined) {
      throw new ThemeError('unknown-typeface', `${where} uses typeface "${id}", which the theme does not declare`);
    }
  };
  checkTypeface(theme.defaults.typeface, 'The defaults');

  const paragraphStyles = theme.paragraphStyles.map((style): ResolvedParagraphStyle => {
    const properties = chainOf(style).reduce<ResolvedProperties>(
      (resolved, link) => overlay(resolved, link.properties),
      { ...theme.defaults },
    );
    checkTypeface(properties.typeface, `Style "${style.id}"`);
    return style.basedOn === undefined
      ? { id: style.id, name: style.name, properties }
      : { id: style.id, name: style.name, basedOn: style.basedOn, properties };
  });

  return {
    id: theme.id,
    paper: theme.paper,
    defaults: { ...theme.defaults },
    typefaces,
    paragraphStyles,
    characterStyles,
  };
}

/**
 * What a style states, laid over what it inherits. A property the style does not state never
 * overrides - an unstated property and one explicitly left undefined mean the same thing.
 */
function overlay(base: ResolvedProperties, stated: ParagraphProperties): ResolvedProperties {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(stated)) {
    if (value !== undefined) out[key] = value;
  }
  return out as ResolvedProperties;
}

/** A style by identifier, or a named failure - never a substituted default (STY-027). */
export function resolveStyle(theme: ResolvedTheme, id: string): ResolvedParagraphStyle {
  const style = theme.paragraphStyles.find((s) => s.id === id);
  if (style === undefined) {
    throw new ThemeError('unknown-style', `Style "${id}" is not in theme "${theme.id}"`);
  }
  return style;
}
