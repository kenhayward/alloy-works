import {
  admit,
  createReport,
  readProductClipboard,
  writeProductClipboard,
  type ReaderResult,
  type ReportEntry,
} from '@alloy-works/domain';
import { readHtml, readPlainText } from '@alloy-works/readers';
import { Fragment, Slice, type Node } from 'prosemirror-model';
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';

import { KEEPS_IDENTIFIERS } from './identity.js';
import { fromEditor, toEditor } from './mapping.js';
import { editorSchema } from './schema.js';

/**
 * The clipboard type the product writes its own format under. A registered-looking vendor type
 * rather than a bare name, because a browser keeps a type it does not know only if it looks like one.
 * What it holds is `writeProductClipboard`'s text, trusted no further than any other paste.
 */
export const PRODUCT_CLIPBOARD_TYPE = 'application/vnd.alloy-works.content+json';

const crossReferenceNode = editorSchema.nodes.crossReference!;

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
 *
 * **Into a footnote's text** (footnotes 1, ruling R10), what arrives must be paragraphs of runs and
 * cross-references, which become the footnote's paragraphs; anything else - a list, a table, an image,
 * a footnote - is refused whole and by name, as a component that cannot hold it is.
 *
 * **What admission named keeps its name** (cross-references 1, rulings R7 and R8). The transaction
 * says so (`KEEPS_IDENTIFIERS`), so the identity plugin leaves every pasted identifier no other node
 * holds as admission allocated it, rather than renaming a block standing where nothing descended - and
 * leaving a reference admission pointed at it pointing at nothing. And **a reference left behind is
 * re-pointed**: one the component still holds, whose `block` target the placed document no longer
 * holds and which admission renamed to a block the paste placed, points at that block. So a cut and a
 * paste keeps a reference to what was cut, a copy and a paste changes nothing, the original still
 * standing, and every pasted block is still newly named (CNT-132). Identifiers are 128 random bits, so
 * a paste from another component cannot match one by chance. The report counts what was re-pointed.
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

  // Opened as far as it goes but never into an isolating node - a figure, a table - whose inside the
  // text either side of the caret would otherwise run into: its caption or its last cell took the
  // rest of the paragraph (figures 2, final review).
  const footnote = footnoteHolding(state);
  let content = opened.doc.content;
  if (footnote !== null) {
    const refused = new Set<string>();
    const paragraphs: Node[] = [];
    opened.doc.forEach((block) => {
      if (block.type !== editorSchema.nodes.paragraph) {
        refused.add(STORED_NAMES[block.type.name] ?? block.type.name);
        return;
      }
      block.forEach((child) => {
        if (!child.isText && child.type !== crossReferenceNode) refused.add(child.type.name);
      });
      paragraphs.push(editorSchema.nodes.footnoteParagraph!.create(block.attrs, block.content));
    });
    if (refused.size > 0 || !footnote) {
      const report = createReport(admitted.report);
      report.add('validate', 'discarded', 'unrepresentable', { detail: [...refused].join(', ') });
      report.add('validate', 'refused', 'invalid');
      return { ok: false, report: report.entries };
    }
    content = Fragment.from(paragraphs);
  }

  // Into a footnote, a plain replace of the selection: `replaceSelection` widens the range to where
  // the slice's first node would fit, which from inside a footnote is past its edge and into the
  // paragraph holding it.
  const slice = Slice.maxOpen(content, false);
  const { from, to } = state.selection;
  const placed =
    footnote === null ? state.tr.replaceSelection(slice) : state.tr.replace(from, to, slice);
  if (footnote !== null) {
    placed.setSelection(TextSelection.near(placed.doc.resolve(placed.mapping.map(to)), -1));
  }
  const repointed = repointLeftBehind(placed, admitted.renamed);
  const transaction = placed
    .scrollIntoView()
    .setMeta('paste', true)
    .setMeta('uiEvent', 'paste')
    .setMeta(KEEPS_IDENTIFIERS, true);
  // **Placed, the paste must still be a document the store takes.** The admitted blocks are valid on
  // their own, but where they land can make them not so: a quotation pasted into a list in a table's
  // cell fits ProseMirror's schema - a list item holds any block - and not the model's (tables 1,
  // decision T-D). Refused whole and by name rather than placed and refused at the next save.
  try {
    fromEditor(transaction.doc);
  } catch {
    const report = createReport(admitted.report);
    report.add('validate', 'refused', 'invalid');
    return { ok: false, report: report.entries };
  }
  if (repointed === 0) return { ok: true, transaction, report: admitted.report };
  const report = createReport(admitted.report);
  report.add('reidentify', 'rewritten', 'crossReferenceRepointed', { count: repointed });
  return { ok: true, transaction, report: report.entries };
}

/**
 * Points every reference in the placed document whose `block` target it no longer holds at the block
 * admission renamed that target to, where the paste placed one (ruling R8), and answers how many.
 * A reference that travelled with its target was pointed at the copy by admission already, and one
 * whose target still stands is left alone. Attribute steps move nothing, so the positions read from
 * the placed document hold for every change.
 */
function repointLeftBehind(placed: Transaction, renamed: ReadonlyMap<string, string>): number {
  const doc = placed.doc;
  const held = new Set<string>();
  doc.descendants((node) => {
    if (typeof node.attrs.id === 'string') held.add(node.attrs.id);
  });
  let repointed = 0;
  doc.descendants((node, pos) => {
    if (node.type !== crossReferenceNode) return true;
    const target = node.attrs.target as { kind: string; block?: string };
    if (target.kind !== 'block' || target.block === undefined || held.has(target.block))
      return false;
    const now = renamed.get(target.block);
    if (now === undefined || !held.has(now)) return false;
    placed.setNodeAttribute(pos, 'target', { kind: 'block', block: now });
    repointed += 1;
    return false;
  });
  return repointed;
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
/** The stored model's name for an editor block whose type is spelt differently. */
const STORED_NAMES: Record<string, string> = { definitionList: 'list', tableFigure: 'table' };

/**
 * Whether the selection stands in a footnote's text, both ends in the one footnote: true, false where
 * it is split across one's edge, which nothing can paste into, and null where it is in none.
 */
function footnoteHolding(state: EditorState): boolean | null {
  const holder = (depth: number, $pos: typeof state.selection.$from) => {
    for (let at = depth; at > 0; at -= 1) {
      if ($pos.node(at).type === editorSchema.nodes.footnote) return $pos.before(at);
    }
    return null;
  };
  const { $from, $to } = state.selection;
  const from = holder($from.depth, $from);
  const to = holder($to.depth, $to);
  if (from === null && to === null) return null;
  return from === to;
}

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
