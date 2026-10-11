import {
  columnExtents,
  columnWidths,
  type MeasuredCell,
  type MeasuredRun,
} from '@alloy-works/domain';
import type { Node } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { TableMap } from 'prosemirror-tables';
import { Decoration, DecorationSet, type EditorView, type NodeView } from 'prosemirror-view';

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
 * **The decorations for each table's widths** (TG3): one on each table node, carrying its shares, which
 * its view (`tableView`) sets as a `colgroup` - so a first-row cell spanning columns spans their own
 * widths, as the PDF sets them, never an even split of their sum.
 */
export function widthDecorations(doc: Node, widths: Widths): DecorationSet {
  const decorations: Decoration[] = [];
  for (const [pos, shares] of widths) {
    const table = doc.nodeAt(pos);
    if (table === null || table.type.name !== 'table') continue;
    if (TableMap.get(table).width !== shares.length) continue;
    decorations.push(Decoration.node(pos, pos + table.nodeSize, {}, { tableWidths: shares }));
  }
  return DecorationSet.create(doc, decorations);
}

/** The shares a table's decorations carry, or none. */
export const sharesOf = (decorations: readonly Decoration[]): readonly number[] | null =>
  (decorations.find((each) => each.spec.tableWidths !== undefined)?.spec.tableWidths as
    readonly number[] | undefined) ?? null;

/**
 * **A table drawn with its column group** (TG3): the table, a `colgroup` of its widths where its
 * decorations carry them, and the body ProseMirror fills. The column group is the view's own, outside
 * the content, so changing it is no edit.
 */
export function tableView(
  node: Node,
  document: Document,
  decorations: readonly Decoration[],
): NodeView {
  const dom = document.createElement('table');
  const group = document.createElement('colgroup');
  const body = document.createElement('tbody');
  dom.append(group, body);
  let set: readonly number[] | null = null;
  const draw = (from: readonly Decoration[]) => {
    const shares = sharesOf(from);
    if (shares === set || (shares !== null && set !== null && shares.join() === set.join())) return;
    set = shares;
    group.replaceChildren(
      ...(shares ?? []).map((share) => {
        const column = document.createElement('col');
        column.style.width = `${(share * 100).toFixed(4)}%`;
        return column;
      }),
    );
  };
  draw(decorations);
  return {
    dom,
    contentDOM: body,
    update(next, nextDecorations) {
      if (next.type !== node.type) return false;
      draw(nextDecorations);
      return true;
    },
    ignoreMutation: (mutation) =>
      mutation.type !== 'selection' &&
      (mutation.target === group || group.contains(mutation.target as globalThis.Node)),
  };
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
  const wraps: boolean[] = [];
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
      // Every paragraph, a list item's among them, at whatever depth it stands (the TG3 final review).
      const blocks = Array.from(cell.querySelectorAll('p'));
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
      // A bound column that may not wrap, said by its cells' class (TB1-I): its least its whole line.
      if (cell.colSpan === 1) {
        const nowrap = cell.classList.contains('aw-bound-table-nowrap');
        wraps[x] = (wraps[x] ?? false) || !nowrap;
      }
      x += cell.colSpan;
    }
  });
  const columns = Math.max(0, ...cells.map((cell) => cell.column + cell.colspan));
  const measure = table.getBoundingClientRect().width;
  // Each part of a run measured in the element its run stands in.
  const extents = columnExtents(columns, cells, {
    padding,
    measure,
    noWrap: Array.from({ length: columns }, (_, at) => wraps[at] === false),
    width: (text, _, run) => width(text, run.element),
  });
  return columnWidths(extents, measure);
};

/** Each table's width decorations as the plugin holds them, for the one decorations plugin. */
export const tableWidthDecorations = (state: EditorState): DecorationSet =>
  widthsKey.getState(state)?.set ?? DecorationSet.empty;

/**
 * **Tables drawn outside the editor's content, widthed** (TG3): a bound table's grid, or a read text's
 * every table (`render.ts`, Reading), each measured once - `seen` remembers it - and given a `colgroup`
 * of its widths where its style widths it by content. Measured in place, so call it once they stand in
 * the page.
 */
export function widthDrawnTables(
  root: ParentNode,
  selector = '[data-table-style] table, .aw-bound-table-grid',
  measure: TableMeasurer = measureDrawnTable,
  seen: WeakSet<HTMLTableElement> = new WeakSet(),
): void {
  root.querySelectorAll<HTMLTableElement>(selector).forEach((table) => {
    if (seen.has(table)) return;
    seen.add(table);
    const shares = measure(table);
    table.querySelector(':scope > colgroup')?.remove();
    if (shares === undefined || shares === null) return;
    const group = table.ownerDocument.createElement('colgroup');
    for (const share of shares) {
      const column = table.ownerDocument.createElement('col');
      column.style.width = `${(share * 100).toFixed(4)}%`;
      group.append(column);
    }
    table.prepend(group);
  });
}

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
      let grids = new WeakSet<HTMLTableElement>();
      const update = () => {
        // A view destroyed before its first measure, or before a face loaded, measures nothing.
        if (view.isDestroyed) return;
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
        // A bound table's body, drawn by its own view, takes its widths as a column group, measured
        // once each time it is drawn: a redraw is a new grid (the TG3 final review).
        widthDrawnTables(view.dom, '.aw-bound-table-grid', measure, grids);
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
        grids = new WeakSet();
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
