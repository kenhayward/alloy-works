/**
 * The theme (docs/design/themes.md), exported from the package by themes 1 (ruling R1), as ADR-0014
 * said the first publishing work would: the stored shapes' kinds, places, roles and marks; the reader,
 * which the store, `assemble` and the tests all read through; the product's default theme; and the
 * three projections, of which the PDF's is the one read today.
 */
export {
  CATALOGUE_KINDS,
  CATALOGUE_SCHEMA_VERSION,
  PLACES,
  ROLES,
  STYLED_MARKS,
  THEME_SCHEMA_VERSION,
} from './schema.js';
export type {
  AdmonitionCatalogue,
  Catalogue,
  CatalogueKind,
  CharacterCatalogue,
  CharacterProperties,
  CharacterStyle,
  CitationCatalogue,
  ImageCatalogue,
  ImageStyle,
  ParagraphCatalogue,
  ParagraphProperties,
  ParagraphStyle,
  Place,
  ResolvedParagraphProperties,
  Role,
  StyleTarget,
  StyledMark,
  TableCatalogue,
  TableStyle,
  Theme,
  Typeface,
} from './schema.js';

export { readCatalogue, readTheme, themeRefusalCodes } from './read.js';
export type {
  CatalogueReadOutcome,
  ResolvedCharacterStyle,
  ResolvedParagraphStyle,
  ResolvedTheme,
  ThemeReadOutcome,
  ThemeRefusal,
  ThemeRefusalCode,
} from './read.js';

export {
  DEFAULT_CATALOGUES,
  DEFAULT_CATALOGUES_BY_VERSION,
  DEFAULT_CATALOGUE_VERSIONS,
  DEFAULT_THEME,
} from './default.js';

export { projectTypst } from './typst.js';
export type { TypstMark, TypstParagraphStyle, TypstTheme } from './typst.js';
export { projectCss } from './css.js';
export { markStyleId, projectStylesXml } from './ooxml.js';
export { runFormat, wordRun } from './runs.js';
export type { RunFormat, WordRun } from './runs.js';
