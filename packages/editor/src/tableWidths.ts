import {
  columnExtents,
  columnWidths,
  type MeasuredCell,
  type MeasuredRun,
} from '@alloy-works/domain';
import type { Node } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { TableMap } from 'prosemirror-tables';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

/**
 * **A table's columns as wide as what they hold, on the page** (the TG plan, TG3; TAB-053, TG-F): where
 * its table style says `content` - the theme's CSS says so as `--aw-table-widths` - each column is
 * measured as `assemble` measures it, every run unkerned in the face and size the browser sets it in,
 * and shared out by the same `columnWidths`, so the page and the PDF set the same widths. An authored
 * table takes them as decorations on its first row's cells, which the fixed layout reads; a bound
 * table's body, drawn by its own view, takes a `colgroup`.
 */

/** Each table's widths by where it stands, or null where its columns at their least overflow. */
type Widths = ReadonlyMap<number, readonly number[]>;

interface WidthsState {
  readonly widths: Widths;
  readonly set: DecorationSet;
}

const widthsKey = new PluginKey<WidthsState>('tableWidths');

/** What a table's widths are measured by: the element it is drawn as, or undefined where not by content. */
export type TableMeasurer = (table: HTMLTableElement) => readonly number[] | null | undefined;

/**
 * **The decorations for each table's widths** (TG3): its first row's cells, each as wide as the columns
 * it spans, borders and padding within, in percentages of the table, which `table-layout: fixed`
 * reads its columns from.
 */
export function widthDecorations(doc: Node, widths: Widths): DecorationSet {
  const decorations: Decoration[] = [];
  for (const [pos, shares] of widths) {
    const table = doc.nodeAt(pos);
    if (table === null || table.type.name !== 'table') continue;
    const map = TableMap.get(table);
    if (map.width !== shares.length) continue;
    const row = table.firstChild;
    if (row === null) continue;
    let offset = pos + 2;
    row.forEach((cell) => {
      const at = map.findCell(offset - pos - 1);
      const share = shares.slice(at.left, at.right).reduce((total, each) => total + each, 0);
      decorations.push(
        Decoration.node(offset, offset + cell.nodeSize, {
          style: `width: ${(share * 100).toFixed(4)}%; box-sizing: border-box`,
        }),
      );
      offset += cell.nodeSize;
    });
  }
  return DecorationSet.create(doc, decorations);
}

/** A run of a drawn cell's text, in the element it stands in, whose face and weight it is set in. */
interface ElementRun extends MeasuredRun {
  readonly element: Element;
}

/** The text a canvas measures, unkerned, in an element's own face, weight, posture and size. */
function measurerOf(document: Document) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  return (text: string, element: Element): number => {
    if (context === null) return 0;
    const style = element.ownerDocument.defaultView!.getComputedStyle(element);
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    if ('fontKerning' in context) context.fontKerning = 'none';
    return context.measureText(text).width;
  };
}

/**
 * **A drawn table measured** (TG3): undefined where its style does not width it by content; else its
 * cells read from the DOM - each paragraph's text nodes in the element each stands in, an image or an
 * equation making its column opaque - and shared out over the table's own width by `columnWidths`.
 */
export const measureDrawnTable: TableMeasurer = (table) => {
  const view = table.ownerDocument.defaultView;
  if (view === null) return undefined;
  const holder = table.closest('[data-table-style]') ?? table;
  if (view.getComputedStyle(holder).getPropertyValue('--aw-table-widths').trim() !== 'content') {
    return undefined;
  }
  const width = measurerOf(table.ownerDocument);
  const taken: number[] = [];
  const cells: MeasuredCell<Element, ElementRun>[] = [];
  let padding = 0;
  Array.from(table.rows).forEach((row, y) => {
    let x = 0;
    for (const cell of Array.from(row.cells)) {
      while ((taken[x] ?? -1) >= y) x += 1;
      for (let span = 0; span < cell.colSpan; span += 1) taken[x + span] = y + cell.rowSpan - 1;
      const style = view.getComputedStyle(cell);
      padding = Math.max(
        padding,
        (parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)) / 2,
      );
      const blocks = Array.from(cell.children).filter((each) => each.matches('[data-style], p'));
      const paragraphs = (blocks.length > 0 ? blocks : [cell]).map((block) => {
        const runs: ElementRun[] = [];
        const walker = table.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
          if (text.parentElement !== null && text.textContent !== null) {
            runs.push({
              text: text.textContent,
              strong: false,
              slanted: false,
              element: text.parentElement,
            });
          }
        }
        return {
          style: block,
          runs,
          opaque: block.querySelector('img, math, svg') !== null,
        };
      });
      cells.push({ column: x, colspan: cell.colSpan, paragraphs });
      x += cell.colSpan;
    }
  });
  const columns = Math.max(0, ...cells.map((cell) => cell.column + cell.colspan));
  const measure = table.getBoundingClientRect().width;
  // Each part of a run measured in the element its run stands in.
  const extents = columnExtents(columns, cells, {
    padding,
    measure,
    width: (text, _, run) => width(text, run.element),
  });
  return columnWidths(extents, measure);
};

/** Each table's width decorations as the plugin holds them, for the one decorations plugin. */
export const tableWidthDecorations = (state: EditorState): DecorationSet =>
  widthsKey.getState(state)?.set ?? DecorationSet.empty;

/**
 * **The plugin** (TG3): after each update, each table drawn is measured again where its node changed,
 * and where the widths differ a transaction of its own sets them, which the history never holds. A
 * face loading measures them all again.
 */
export function tableWidthsPlugin(measure: TableMeasurer = measureDrawnTable): Plugin {
  return new Plugin<WidthsState>({
    key: widthsKey,
    state: {
      init: (_, state: EditorState): WidthsState => ({
        widths: new Map(),
        set: DecorationSet.create(state.doc, []),
      }),
      apply(tr, value): WidthsState {
        const next = tr.getMeta(widthsKey) as Widths | undefined;
        if (next !== undefined) return { widths: next, set: widthDecorations(tr.doc, next) };
        if (!tr.docChanged) return value;
        const widths = new Map<number, readonly number[]>();
        for (const [pos, shares] of value.widths) {
          const mapped = tr.mapping.mapResult(pos);
          if (!mapped.deleted) widths.set(mapped.pos, shares);
        }
        return { widths, set: widthDecorations(tr.doc, widths) };
      },
    },
    view(view: EditorView) {
      let measured = new WeakMap<Node, readonly number[] | null>();
      const update = () => {
        const current: Widths = widthsKey.getState(view.state)?.widths ?? new Map();
        const next = new Map<number, readonly number[]>();
        view.state.doc.descendants((node, pos) => {
          if (node.type.name !== 'table') return true;
          let shares = measured.get(node);
          if (shares === undefined) {
            const drawn = view.nodeDOM(pos);
            const table =
              drawn instanceof HTMLTableElement
                ? drawn
                : ((drawn as HTMLElement | null)?.querySelector?.('table') ?? null);
            shares = table === null ? null : (measure(table) ?? null);
            measured.set(node, shares);
          }
          if (shares !== null) next.set(pos, shares);
          return false;
        });
        // A bound table's body, drawn by its own view, takes its widths as a column group.
        view.dom.querySelectorAll<HTMLTableElement>('.aw-bound-table-grid').forEach((grid) => {
          const shares = measure(grid);
          grid.querySelector(':scope > colgroup')?.remove();
          if (shares === undefined || shares === null) return;
          const group = grid.ownerDocument.createElement('colgroup');
          for (const share of shares) {
            const column = grid.ownerDocument.createElement('col');
            column.style.width = `${(share * 100).toFixed(4)}%`;
            group.append(column);
          }
          grid.prepend(group);
        });
        const same =
          next.size === current.size &&
          [...next].every(([pos, shares]) => {
            const was = current.get(pos);
            return (
              was !== undefined && was.every((each, at) => Math.abs(each - shares[at]!) < 1e-6)
            );
          });
        if (!same)
          view.dispatch(view.state.tr.setMeta(widthsKey, next).setMeta('addToHistory', false));
      };
      const fonts = view.dom.ownerDocument.fonts as FontFaceSet | undefined;
      const remeasure = () => {
        measured = new WeakMap();
        update();
      };
      fonts?.addEventListener?.('loadingdone', remeasure);
      queueMicrotask(update);
      return {
        update: () => update(),
        destroy: () => fonts?.removeEventListener?.('loadingdone', remeasure),
      };
    },
  });
}
