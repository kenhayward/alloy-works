/**
 * The theme model prototype (docs/design/themes.md). Deliberately not exported from the package's
 * public surface yet - like the content model draft, promoting it is a decision for whoever starts
 * the editor or the publishing pipeline. spikes/theme-conformance imports it from `dist/theme/`.
 */
export { projectCss } from './css.js';
export { exampleTheme } from './example.js';
export { markStyleId, projectStylesXml } from './ooxml.js';
export { ThemeError, resolveStyle, resolveTheme } from './resolve.js';
export { runFormat, wordRun } from './runs.js';
export { markNames, styleIdSchema, themeSchema } from './schema.js';
export { projectTypst } from './typst.js';

export type {
  ResolvedParagraphStyle,
  ResolvedProperties,
  ResolvedTheme,
  ThemeErrorCode,
} from './resolve.js';
export type { RunFormat, WordRun } from './runs.js';
export type { CharacterStyle, MarkName, ParagraphProperties, Theme, Typeface } from './schema.js';
export type { TypstMark, TypstStyle, TypstTheme } from './typst.js';
