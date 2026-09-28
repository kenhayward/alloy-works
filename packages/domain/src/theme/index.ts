/**
 * The theme (docs/design/themes.md), exported from the package by themes 1 (ruling R1), as ADR-0014
 * said the first publishing work would: the stored shapes' kinds, places, roles and marks; the reader,
 * which the store, `assemble` and the tests all read through; the product's default theme; and the
 * three projections, of which the PDF's is the one read today.
 */
export {
  CAPTION_PLACEMENTS,
  CATALOGUE_KINDS,
  CATALOGUE_SCHEMA_VERSION,
  IMAGE_UNITS,
  PLACES,
  ROLES,
  STYLED_MARKS,
  THEME_SCHEMA_VERSION,
} from './schema.js';
export type {
  AdmonitionCatalogue,
  AdmonitionCatalogue1,
  AdmonitionCatalogue2,
  CaptionPlacement,
  Catalogue,
  Catalogue1,
  Catalogue2,
  CatalogueKind,
  CharacterCatalogue,
  CharacterCatalogue1,
  CharacterCatalogue2,
  CharacterProperties,
  CharacterStyle,
  CitationCatalogue,
  CitationCatalogue1,
  CitationCatalogue2,
  ImageCatalogue,
  ImageCatalogue1,
  ImageCatalogue2,
  ImageLength,
  ImageStyle,
  ImageStyle2,
  ParagraphCatalogue,
  ParagraphCatalogue1,
  ParagraphCatalogue2,
  ParagraphProperties,
  ParagraphStyle,
  Place,
  ResolvedParagraphProperties,
  Role,
  StyleTarget,
  StyledMark,
  TableCatalogue,
  TableCatalogue1,
  TableCatalogue2,
  TableRule,
  TableStyle,
  TableStyle2,
  Theme,
  Typeface,
} from './schema.js';

export {
  readCatalogue,
  readTheme,
  themeRefusalCodes,
  upgradeCatalogue1,
  upgradeCatalogue2,
} from './read.js';
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
  DEFAULT_THEME_VERSION,
  FIRST_DEFAULT_CATALOGUES,
  FIRST_DEFAULT_CATALOGUES_BY_VERSION,
  FIRST_DEFAULT_CATALOGUE_VERSIONS,
  FIRST_DEFAULT_THEME,
  FOURTH_DEFAULT_CATALOGUES,
  FOURTH_DEFAULT_CATALOGUES_BY_VERSION,
  FOURTH_DEFAULT_CATALOGUE_VERSIONS,
  FOURTH_DEFAULT_THEME,
  FOURTH_DEFAULT_THEME_VERSION,
  SECOND_DEFAULT_CATALOGUES,
  SECOND_DEFAULT_CATALOGUES_BY_VERSION,
  SECOND_DEFAULT_CATALOGUE_VERSIONS,
  SECOND_DEFAULT_THEME,
  SECOND_DEFAULT_THEME_VERSION,
  THIRD_DEFAULT_THEME,
  THIRD_DEFAULT_THEME_VERSION,
} from './default.js';

export { projectTypst, projectTypst12 } from './typst.js';
export type {
  TypstImageStyle,
  TypstMark,
  TypstMark12,
  TypstParagraphStyle,
  TypstParagraphStyle12,
  TypstStroke,
  TypstTableHeader,
  TypstTableStyle,
  TypstTheme,
  TypstTheme12,
} from './typst.js';
export { CANVAS, projectCss } from './css.js';
export type { ProjectCssOptions } from './css.js';
export { faceFamily, projectFontFaces } from './faces.js';
export { markStyleId, projectStylesXml } from './ooxml.js';
export type { WordDocument, WordStylesOptions } from './ooxml.js';
export { runFormat, wordRun } from './runs.js';
export type { RunFormat, WordRun } from './runs.js';
