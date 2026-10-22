import type { ImportFlowItem } from '@alloy-works/domain';
import { readDocx, type DocxRead } from './docx/docx.js';
import { readZip } from './docx/zip.js';
import { readHtml } from './html.js';
import { readMarkdown } from './markdown.js';

export { readDocx } from './docx/docx.js';
export type { DocxRead, DocxRefusal } from './docx/docx.js';

/** The kinds of file an import takes (the IM plan, IM-B). */
export type ImportFileType = 'docx' | 'markdown' | 'html';

const ZIP = [0x50, 0x4b, 0x03, 0x04];

const asText = (bytes: Uint8Array): string | undefined => {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.includes(String.fromCharCode(0)) ? undefined : text;
  } catch {
    return undefined;
  }
};

/**
 * Whether the bytes are what their name says (IM-B), read from the bytes: a Word document is a zip
 * holding `word/document.xml`, its entries' names read and nothing inflated; Markdown and HTML are
 * UTF-8 text.
 */
export function checkImportFile(bytes: Uint8Array, type: ImportFileType): boolean {
  if (type !== 'docx') return asText(bytes) !== undefined;
  if (!ZIP.every((byte, index) => bytes[index] === byte)) return false;
  const zip = readZip(bytes, () => false);
  return zip.ok && zip.names.some((name) => name.toLowerCase() === 'word/document.xml');
}

/** What an import reads a file into: the flow `proposeImport` breaks out, or why not. */
export type ImportRead = DocxRead;

/** The plain text of a candidate block, for a part's source. */
function textOf(value: unknown): string {
  if (typeof value !== 'object' || value === null) return '';
  if (Array.isArray(value)) return value.map(textOf).join('');
  const node = value as { type?: unknown; value?: unknown };
  if (node.type === 'text' && typeof node.value === 'string') return node.value;
  return Object.values(value).map(textOf).join('');
}

/**
 * A file read for an import. Markdown and HTML go through the paste's readers whole, as one run of
 * blocks, their headings kept as paragraphs and said: breaking them out is IMe's.
 */
export function readImport(bytes: Uint8Array, type: ImportFileType): ImportRead {
  if (type === 'docx') return readDocx(bytes);
  const text = asText(bytes);
  if (text === undefined) return { ok: false, refusal: 'unreadable', failure: 'Not UTF-8 text' };
  const read = type === 'markdown' ? readMarkdown(text) : readHtml(text);
  if (!read.ok) {
    return {
      ok: false,
      refusal: read.refusal === 'oversized' ? 'tooLarge' : 'unreadable',
      failure: read.failure,
    };
  }
  const { content } = read.input.candidate as { content: unknown[] };
  const flow: ImportFlowItem[] = content.map((block) => ({
    kind: 'block',
    block,
    source: textOf(block),
  }));
  return { ok: true, flow, title: null, language: null, report: read.input.report };
}
