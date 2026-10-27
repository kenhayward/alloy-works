/**
 * The HTML writer (the HT plan; ADR-0070): a publication as one HTML file to read on a screen, from
 * what `assemble` answers for HTML, the version an HTML output records it was made by, and its text as
 * the leak scan reads it.
 */
export { HTML_WRITER_VERSION, writeHtml } from './write.js';
export type { HtmlWriting, WrittenHtml } from './write.js';
export { htmlText } from './text.js';
