import {
  admit,
  createReport,
  readProductClipboard,
  writeProductClipboard,
  type ReaderResult,
  type ReportEntry,
} from '@alloy-works/domain';
import { readHtml, readPlainText } from '@alloy-works/readers';
import { Fragment, Slice } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';

import { fromEditor, toEditor } from './mapping.js';
import { editorSchema } from './schema.js';

/**
 * The clipboard type the product writes its own format under. A registered-looking vendor type
 * rather than a bare name, because a browser keeps a type it does not know only if it looks like one.
 * What it holds is `writeProductClipboard`'s text, trusted no further than any other paste.
 */
export const PRODUCT_CLIPBOARD_TYPE = 'application/vnd.alloy-works.content+json';

/** What a paste event's `clipboardData` offers: the types it holds, and each one's text. */
export interface ClipboardSource {
  readonly types: readonly string[];
  getData(type: string): string;
}

/**
 * Reads a clipboard as the pipeline's input, from the best type it holds: the product's own, then
 * HTML, then plain text. **Into preformatted text only plain text is read**, and kept exactly - code
 * pasted into code keeps every character, and HTML would lose its spaces to whitespace collapsing.
 *
 * A product type that cannot be read falls back to the others rather than refusing: any page can put
 * text under that type, and a paste that also carries HTML is still worth reading.
 */
export function readClipboard(
  source: ClipboardSource,
  into: 'blocks' | 'preformatted',
): ReaderResult {
  const has = (type: string) => source.types.includes(type);
  if (into === 'blocks') {
    if (has(PRODUCT_CLIPBOARD_TYPE)) {
      const reading = readProductClipboard(source.getData(PRODUCT_CLIPBOARD_TYPE));
      if (reading.ok || !(has('text/html') || has('text/plain'))) return reading;
    }
    if (has('text/html')) return readHtml(source.getData('text/html'));
  }
  if (has('text/plain')) return readPlainText(source.getData('text/plain'), into);
  const report = createReport();
  report.add('read', 'refused', 'unreadable');
  return {
    ok: false,
    refusal: 'unreadable',
    failure: `The clipboard holds none of the types this editor reads: ${source.types.join(', ')}`,
    report: report.entries,
  };
}

/**
 * Text read as Markdown, which only an author's asking makes it (**Paste as Markdown**): a clipboard
 * never says that it holds Markdown, and reading every plain paste as Markdown would turn asterisks
 * into emphasis nobody asked for. Into preformatted text it is kept exactly, as any plain text is,
 * because Markdown means nothing in code.
 *
 * **The parser is loaded the first time it is asked for**, from the readers' own entry point, so a
 * renderer that never pastes Markdown never downloads it.
 */
export async function readMarkdownText(
  text: string,
  into: 'blocks' | 'preformatted',
): Promise<ReaderResult> {
  if (into === 'preformatted') return readPlainText(text, 'preformatted');
  const { readMarkdown } = await import('@alloy-works/readers/markdown');
  return readMarkdown(text);
}

export type PasteOutcome =
  | {
      readonly ok: true;
      readonly transaction: Transaction;
      readonly report: readonly ReportEntry[];
    }
  | { readonly ok: false; readonly report: readonly ReportEntry[] };

/**
 * A paste, as one transaction: what the clipboard held, admitted against the component as it stands
 * (content-model.md, "The admission boundary"), then placed over the selection.
 *
 * **It reaches ProseMirror only through `admit`** (component-editor.md, "Identity, by operation"), so
 * every pasted block and mark carries an identifier allocated for this component before ProseMirror
 * sees it (CNT-132), and nothing hostile arrives at all (CNT-130).
 *
 * **It lands as ProseMirror's own paste does**: the blocks are one slice, open as far as its first and
 * last text blocks go, so pasted text in the middle of a paragraph joins it rather than splitting it
 * round a new one. The receiving paragraph keeps its identifier by the descent rule.
 *
 * Admitted content this editor cannot hold - a table from another component - is refused whole and
 * by name, as opening one is: placing part of it would be the silent loss the pipeline exists to stop.
 */
export function pasteInto(
  state: EditorState,
  reading: ReaderResult,
  newIdentifier: () => string,
): PasteOutcome {
  if (!reading.ok) return { ok: false, report: reading.report };
  const document = fromEditor(state.doc);
  const admitted = admit(reading.input, { document, conditionAxes: [], newIdentifier });
  if (!admitted.ok) return { ok: false, report: admitted.report };

  const opened = toEditor({ ...document, content: [...admitted.content] });
  if (!opened.editable) {
    const report = createReport(admitted.report);
    report.add('validate', 'discarded', 'unrepresentable', {
      detail: opened.unsupported.join(', '),
    });
    report.add('validate', 'refused', 'invalid');
    return { ok: false, report: report.entries };
  }

  const transaction = state.tr
    .replaceSelection(Slice.maxOpen(opened.doc.content))
    .scrollIntoView()
    .setMeta('paste', true)
    .setMeta('uiEvent', 'paste');
  return { ok: true, transaction, report: admitted.report };
}

/**
 * The range from `from` to `to` in the product's own format, or nothing where it is not a document
 * on its own - the attribution of a quotation without the quotation, which no block can hold. HTML
 * and plain text are still written for that one; they are the view's, because they need a DOM.
 *
 * **The range is wrapped in the blocks it stands in.** A slice is rooted at the deepest node the two
 * ends share, so a few words of one paragraph are bare text, which is no document; wrapped in their
 * paragraph - and a list item's words in the item and the list - they are the blocks they were copied
 * from, which the receiving component then joins to its own text as any paste is joined.
 */
export function productClipboard(state: EditorState, from: number, to: number): string | undefined {
  try {
    const $from = state.doc.resolve(from);
    let content = state.doc.slice(from, to).content;
    for (let depth = $from.sharedDepth(to); depth > 0; depth -= 1) {
      content = Fragment.from($from.node(depth).copy(content));
    }
    const doc = editorSchema.topNodeType.createChecked(state.doc.attrs, content);
    const copied = fromEditor(doc);
    return writeProductClipboard(copied, copied.content);
  } catch {
    return undefined;
  }
}
