import type { ReaderResult } from '@alloy-works/domain';
import MarkdownIt from 'markdown-it';

import { readHtml } from './html.js';
import { refuseOversized } from './text.js';

/**
 * CommonMark, with the tables and strikethrough most Markdown is written with. HTML written in the
 * Markdown is kept, so that it meets the same sanitising as a paste of HTML rather than arriving as
 * its own tags in the text; no link is made of a bare address, and no quotation marks or dashes are
 * rewritten, because an author's text is theirs.
 */
const markdown = new MarkdownIt({ html: true, linkify: false, typographer: false });

/**
 * Markdown, as the pipeline's input: rendered as HTML and read by the HTML reader, so one mapping
 * decides what an element becomes and one report says what was kept differently or left out.
 *
 * **Only ever asked for.** A clipboard never says that it holds Markdown, so a plain paste reads
 * plain text; this reader is behind the editor's **Paste as Markdown**, and in its own entry point so
 * the renderer loads the parser the first time an author presses it.
 */
export function readMarkdown(text: string): ReaderResult {
  return refuseOversized(text) ?? readHtml(markdown.render(text));
}
