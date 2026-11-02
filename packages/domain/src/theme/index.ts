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
  CITATION_CATALOGUE_SCHEMA_VERSION,
  FIELD_KEYS,
  IMAGE_UNITS,
  PLACES,
  ROLES,
  STYLED_MARKS,
  TERM_CATALOGUE_KIND,
  TERM_CATALOGUE_SCHEMA_VERSION,
  TERM_EXPANSIONS,
  THEME_SCHEMA_VERSION,
  VALUE_CATALOGUE_KIND,
  valueFormatsSchema,
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
  TermCatalogue,
  TermExpansion,
  ValueCatalogue,
  ValueFormats,
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
  DEFAULT_TERM_CATALOGUE_ID,
  DEFAULT_THEME_VERSION,
  NINTH_DEFAULT_CATALOGUES,
  NINTH_DEFAULT_CATALOGUES_BY_VERSION,
  NINTH_DEFAULT_CATALOGUE_VERSIONS,
  NINTH_DEFAULT_THEME,
  NINTH_DEFAULT_THEME_VERSION,
  TENTH_DEFAULT_THEME,
  TENTH_DEFAULT_THEME_VERSION,
  EIGHTH_DEFAULT_CATALOGUES,
  EIGHTH_DEFAULT_CATALOGUES_BY_VERSION,
  EIGHTH_DEFAULT_CATALOGUE_VERSIONS,
  EIGHTH_DEFAULT_THEME,
  EIGHTH_DEFAULT_THEME_VERSION,
  DEFAULT_VALUE_FORMATS,
  FIFTH_DEFAULT_CATALOGUES,
  FIFTH_DEFAULT_CATALOGUES_BY_VERSION,
  FIFTH_DEFAULT_CATALOGUE_VERSIONS,
  FIFTH_DEFAULT_THEME,
  FIFTH_DEFAULT_THEME_VERSION,
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
  SIXTH_DEFAULT_CATALOGUES,
  SIXTH_DEFAULT_CATALOGUES_BY_VERSION,
  SIXTH_DEFAULT_CATALOGUE_VERSIONS,
  SIXTH_DEFAULT_THEME,
  SIXTH_DEFAULT_THEME_VERSION,
  SEVENTH_DEFAULT_CATALOGUES,
  SEVENTH_DEFAULT_CATALOGUES_BY_VERSION,
  SEVENTH_DEFAULT_CATALOGUE_VERSIONS,
  SEVENTH_DEFAULT_THEME,
  SEVENTH_DEFAULT_THEME_VERSION,
  THIRD_DEFAULT_THEME,
  THIRD_DEFAULT_THEME_VERSION,
} from './default.js';

export { explainStyle } from './explain.js';
export { allowsStyle } from './read.js';
export {
  CATALOGUE_DOCUMENT_FORMAT,
  CATALOGUE_DOCUMENT_VERSION,
  exportCatalogue,
  readCatalogueDocument,
} from './document.js';
export type { CatalogueDocument } from './document.js';
export type { ExplainOutcome, ExplainedProperties, ExplainedProperty } from './explain.js';

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
