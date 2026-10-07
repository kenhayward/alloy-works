import {
  bindingDigestInput,
  checkTable,
  defaultLayout,
  DEFAULT_VALUE_FORMATS,
  layoutTable,
  placeTableNotes,
  tableOrder,
  type AnyBinding,
  type Binding,
  type BoundTableNode,
  type CanonicalResult,
  type CanonicalValue,
  type ColumnAlignment,
  type FootnoteNode,
  type TableColumn,
  type TableFailure,
  type TablePresentation,
  type TableWords,
  type TakeFailure,
  type ValueFormats,
} from '@alloy-works/domain';
import type { Node } from 'prosemirror-model';
import { NodeSelection, type Command, type EditorState } from 'prosemirror-state';

import { assetContentPath, BOUND_IMAGE, BOUND_TABLE, editorSchema } from './schema.js';

const bindingNode = editorSchema.nodes.binding!;
const figureNode = editorSchema.nodes.figure!;
const boundTableNode = editorSchema.nodes.boundTable!;

/**
 * Why a binding holds no value where the view answered for it: a take's failure (`takeValue`), or a
 * result the service could not read (`unavailable`, B1-H), which is never stored.
 */
export type BindingFailureShown =
  | TakeFailure
  | 'unavailable'
  // Where an image a take gave cannot stand (the B6 plan, B6-D): the view's, never a take's.
  | 'value_not_image'
  | 'image_not_placeable';

/**
 * A failure as the host tells it: `take_invalid` with the column, taken or key, the version does not
 * have - the take's outcome names it, so the words never guess which - `image_description_missing`
 * with the description's column, and `value_many` with its count.
 */
export type BindingFailureHeld = {
  readonly [K in BindingFailureShown]: K extends 'take_invalid' | 'image_description_missing'
    ? { readonly failure: K; readonly column: string }
    : { readonly failure: K; readonly count?: number };
}[BindingFailureShown];

/**
 * What the document holds for one binding, as the host tells the surface (B1-J): the binding the view
 * answered for, as `bindingDigestInput` spells it - compared as a string, with no hash in the browser -
 * and what it shows: the value formatted by the document's theme, whether a newer result waits, or why
 * there is none.
 */
export interface BindingHeld {
  readonly binding: string;
  /**
   * Where the host could not read what the document holds for it: its failure is shown, and it has no
   * provenance to open.
   */
  readonly unread?: true;
  readonly shown:
    | {
        readonly value: string;
        readonly waiting: boolean;
        /**
         * Where the value is an image (the B6 plan, B6-G): the asset version its bytes are read from,
         * and its `alt` - the description, or empty where it is decorative. `value` is then its words,
         * which a copy's plain text writes.
         */
        readonly image?: { readonly asset: string; readonly alt: string };
      }
    | { readonly table: TableHeld }
    | BindingFailureHeld;
}

/**
 * **What the document holds for a bound table's binding** (the TB2 plan, TB2-A, TB2-D): the declared
 * columns of the version held and its row count, from the bindings view - enough for `checkTable` -
 * and its rows, the canonical result trimmed to the table's columns, once read; null until then. The
 * surface lays it out itself, so the host keeps `rows` the same object while it is the same result.
 */
export interface TableHeld {
  readonly columns: readonly TableColumn[];
  readonly rowCount: number;
  readonly rows: CanonicalResult | null;
  /**
   * Whether the rows came already in the table's order, its sort columns not sent - as the rows route
   * answers a reader (the TB2 final review) - so they are laid out as they stand.
   */
  readonly presorted?: boolean;
  /**
   * The key of the definition version held, from the bindings view (TB3-B), which a keyed note names
   * its row by: empty where it declares none, `key_required` for a keyed note. Unknown where absent.
   */
  readonly key?: readonly string[];
  /**
   * Each keyed note's row among `rows`, by its identifier, as the rows route answered (TB3-C): null
   * where the result has none (`note_row_missing`). A note it has not answered for is being read.
   */
  readonly notes?: Readonly<Record<string, number | null>>;
}

/**
 * What a document lays its bound tables out with (TB2-A): each table style by its identifier, the
 * value formats for the document's language and the words a table prints - the default layout's,
 * since the page holds no publishing layout (TB2-D).
 */
export interface TableSetting {
  readonly styles: ReadonlyMap<string, TablePresentation>;
  readonly formats: ValueFormats;
  readonly words: TableWords;
}

/** What a page lays a bound table out with where its host says nothing: the product's own. */
export const DEFAULT_TABLE_SETTING: TableSetting = {
  styles: new Map(),
  formats: DEFAULT_VALUE_FORMATS,
  words: {
    noRows: defaultLayout.words.noRows ?? 'No rows',
    notAvailable: defaultLayout.words.notAvailable ?? 'Not available',
  },
};

/**
 * What the host tells a surface about where its bindings are shown (B1-D): in a document, what it
 * holds for each binding by identifier, for the one occurrence being shown - `node`, the occurrence's
 * outline node, where the host gives it, so the read text can say where a value stands; on its own,
 * each definition's title by its identifier, null where the reader may not read it.
 */
export type BindingContext =
  | {
      readonly kind: 'document';
      readonly held: ReadonlyMap<string, BindingHeld>;
      readonly node?: string;
      /** What its bound tables are laid out with (TB2-A); the product's own where absent. */
      readonly tables?: TableSetting;
    }
  | { readonly kind: 'alone'; readonly titles: ReadonlyMap<string, string | null> };

/** What one binding shows, and where it stands in the document it was read from. */
export interface BindingShown {
  readonly pos: number;
  /** Its identifier, where it has one yet. */
  readonly id: string | null;
  /** What is seen: the value, why there is none, or what it asks for. */
  readonly text: string;
  /** The words after it a screen reader is told and nobody sees: its kind (B1-L). */
  readonly hidden: string;
  /** A marker always shown beside a value, by an icon and these words, or null. */
  readonly marker: string | null;
  /** Whether it holds no value, drawn apart by its words and more than colour (DAT-047). */
  readonly failed: boolean;
  /**
   * The image it shows in place of its words, where its value is one (B6.2): the asset version, the
   * route its bytes are read from and its `alt`; null otherwise.
   */
  readonly image: BoundImage | null;
  /**
   * Whether the document holds a resolution for it as it stands, so it has a provenance to open: in
   * the read text it is then a button (B1-L, B1-M).
   */
  readonly resolved: boolean;
}

/** An image a binding shows: its asset version, where its bytes are read from, and its `alt`. */
export interface BoundImage {
  readonly asset: string;
  readonly src: string;
  readonly alt: string;
}

/** The image a decoration's spec carries, flat as `bindingDecorations` puts it, or null. */
export function imageOfSpec(spec: Record<string, unknown>): BoundImage | null {
  return typeof spec.boundSrc === 'string'
    ? { asset: spec.boundAsset as string, src: spec.boundSrc, alt: spec.boundAlt as string }
    : null;
}

/** A binding selected whole, as the Value panel reads it. */
export interface BindingSelected {
  /** Where the `binding` node starts. */
  readonly pos: number;
  /** The binding as the component stores it. */
  readonly binding: Binding;
}

/** What the node says with nothing to tell it more: `toDOM`'s words. */
export const BOUND_VALUE = 'Bound value';

/** A binding the document holds nothing for. */
export const NEVER_RESOLVED = 'No value - never resolved';

/** A binding the author has changed since the document's value was taken for it. */
export const CHANGED_SINCE_RESOLVED = 'No value - the binding changed since it was resolved';

/** A held value with a newer result waiting: shown always, beside the value. */
export const REVISION_WAITING = 'revision waiting';

/** On its own, where the definition's title cannot be shown. */
export const A_BOUND_VALUE = 'a bound value';

/** The class a binding shown on its own carries: the application's chip (B1-K). */
export const ALONE_CLASS = 'aw-binding-alone';

/** The class a binding with no value carries, on the surface and in the read text. */
export const FAILED_CLASS = 'aw-binding-failed';

/** Its kind, as a screen reader is told it after what it shows (B1-L). */
const KIND = ', bound value';

/** `site is north and open is true`: a key's values as stored. */
const keyWords = (key: Readonly<Record<string, string | boolean>>): string =>
  Object.entries(key)
    .map(([name, value]) => `${name} is ${String(value)}`)
    .join(' and ');

/**
 * **The words each failure shows** (B1-J), keyed by the literal union so a code the view gains is a
 * compile error here, not a silent gap: the count and the missing column as the host tells them, the
 * key read from the binding as the editor holds it.
 */
export const BINDING_FAILURE_WORDS = {
  take_invalid: (_binding, held) => `No value - the definition has no column ${held.column}`,
  value_none: () => 'No value - the query returned no rows',
  value_many: (_binding, held) => `No value - the query returned ${held.count ?? 'several'} rows`,
  row_missing: (binding) =>
    'take' in binding && 'key' in binding.take
      ? `No value - no row where ${keyWords(binding.take.key)}`
      : 'No value - no row',
  value_null: () => 'No value - empty',
  value_empty: () => 'No value - empty',
  unavailable: () => 'No value - the result cannot be read',
  image_description_missing: (_binding, held) =>
    `No image - the row has no description in ${held.column}`,
  value_not_image: () => 'No image - the column is not an image',
  image_not_placeable: () => 'No image - a footnote or a caption cannot hold one',
} satisfies {
  readonly [K in BindingFailureShown]: (
    binding: AnyBinding,
    held: Extract<BindingFailureHeld, { readonly failure: K }>,
  ) => string;
};

/**
 * The words for one failure, in the text and a value's provenance alike: the record indexed by a union
 * cannot correlate it with its argument.
 */
export const bindingFailureWords = (binding: AnyBinding, held: BindingFailureHeld): string =>
  (
    BINDING_FAILURE_WORDS[held.failure] as (binding: AnyBinding, held: BindingFailureHeld) => string
  )(binding, held);

/** A binding node's attributes as the component stores the binding. */
export function storedBinding(node: Node): Binding {
  const { id, query, version, parameters, mode, take } = node.attrs;
  return {
    type: 'binding',
    id: id as string,
    query: query as string,
    ...(version === null ? {} : { version: version as string }),
    parameters: parameters as Binding['parameters'],
    mode: mode as Binding['mode'],
    take: take as Binding['take'],
  };
}

/** What it asks for: its column, and a key's values as stored. */
const asksFor = (take: Binding['take']): string =>
  'key' in take ? `${take.column} where ${keyWords(take.key)}` : take.column;

/** One binding's words in `context`. */
function shownFor(
  binding: Binding,
  context: BindingContext | null,
): Omit<BindingShown, 'pos' | 'id'> {
  if (context === null) {
    return {
      text: BOUND_VALUE,
      hidden: '',
      marker: null,
      failed: false,
      resolved: false,
      image: null,
    };
  }
  if (context.kind === 'alone') {
    const title = context.titles.get(binding.query) ?? null;
    return {
      text: title === null ? A_BOUND_VALUE : `${asksFor(binding.take)}, ${title}`,
      hidden: `${KIND}, a value in each document`,
      marker: null,
      failed: false,
      resolved: false,
      image: null,
    };
  }
  const failed = (text: string, resolved = false) => ({
    text,
    hidden: `${KIND}, failed`,
    marker: null,
    failed: true,
    resolved,
    image: null,
  });
  const held = context.held.get(binding.id);
  if (held === undefined) return failed(NEVER_RESOLVED);
  if (held.binding !== bindingDigestInput(binding)) return failed(CHANGED_SINCE_RESOLVED);
  // A bound table's result stands in no line: an inline binding is never shown one (TB2-C).
  if ('table' in held.shown) return failed(BINDING_FAILURE_WORDS.unavailable());
  if ('failure' in held.shown) {
    return failed(bindingFailureWords(binding, held.shown), held.unread !== true);
  }
  const image =
    held.shown.image === undefined
      ? null
      : {
          asset: held.shown.image.asset,
          src: assetContentPath(held.shown.image.asset),
          alt: held.shown.image.alt,
        };
  return held.shown.waiting
    ? {
        text: held.shown.value,
        hidden: `${KIND},`,
        marker: REVISION_WAITING,
        failed: false,
        resolved: true,
        image,
      }
    : { text: held.shown.value, hidden: KIND, marker: null, failed: false, resolved: true, image };
}

/**
 * **What each binding in `doc` shows** (B1-D, B1-J, B1-K), in document order - pure, so the surface's
 * decorations, a footnote's own editor, the read text and the copy all draw the same words:
 *
 * - **in a document**, the value the document holds where the binding as the editor holds it is the
 *   binding the view answered for - compared by `bindingDigestInput` - with _revision waiting_ beside
 *   it where a newer result waits; otherwise why it has none: never resolved, changed since it was
 *   resolved, or the take's failure in words of its own, each drawn apart;
 * - **on its own**, what it asks for, never a value (BI-B): its column and its definition's title -
 *   _depth, Readings_, _depth where site is north, Readings_ - or _a bound value_ where the reader may
 *   not read the definition, or its title is not known yet;
 * - **with no context**, what the node alone says, `toDOM`'s _Bound value_.
 */
export function bindingsShown(doc: Node, context: BindingContext | null): readonly BindingShown[] {
  const shown: BindingShown[] = [];
  doc.descendants((node, pos) => {
    if (node.type !== bindingNode) return true;
    const id = typeof node.attrs.id === 'string' ? node.attrs.id : null;
    shown.push({ pos, id, ...shownFor(storedBinding(node), context) });
    return false;
  });
  return shown;
}

/**
 * **What each bound figure in `doc` shows** (the B6 plan, B6-A, B6-G), in document order, by the rule
 * `bindingsShown` shows an inline binding by: its image where the document holds one for its binding
 * as it stands, or why there is none, in place. Its `alt` is the figure's: empty where the author
 * marked it decorative (B6-C), and otherwise the description the document holds. `pos` is the
 * figure's own.
 */
export function boundFiguresShown(
  doc: Node,
  context: BindingContext | null,
): readonly BindingShown[] {
  const shown: BindingShown[] = [];
  doc.descendants((node, pos) => {
    if (node.type !== figureNode) return true;
    const binding = node.attrs.binding as Binding | null;
    if (binding === null) return false;
    const each = shownFor(binding, context);
    const decorative = (node.attrs.alternative as { kind: string }).kind === 'decorative';
    shown.push({
      pos,
      id: binding.id,
      ...each,
      // With nothing to tell it more, what the node says: `toDOM`'s words.
      ...(context === null ? { text: BOUND_IMAGE } : {}),
      image: each.image === null || !decorative ? each.image : { ...each.image, alt: '' },
    });
    return false;
  });
  return shown;
}

/** The most rows a bound table shows on the page; the rest are counted (TB2-D). */
export const PAGE_ROWS = 50;

/** A bound table's binding never resolved in the document. */
export const TABLE_NEVER_RESOLVED = 'No rows - never resolved';

/** A bound table's binding changed since its result was held. */
export const TABLE_CHANGED = 'No rows - the binding changed since it was resolved';

/** A bound table whose result the page cannot read. */
export const TABLE_UNAVAILABLE = 'No rows - the result cannot be read';

/** A bound table whose rows the page is still reading. */
export const TABLE_READING = 'Reading the rows';

/** The words each failure of `checkTable` shows in place, by its code. */
export const TABLE_FAILURE_WORDS = {
  column_missing: (failure) => `No rows - the result has no column ${failure.column}`,
  column_image: (failure) =>
    `No rows - ${failure.column} is an image column, which a table cannot show`,
  format_mismatch: (failure) =>
    `No rows - the format of ${failure.column} sets ${failure.detail}, which does not apply to its values`,
  table_too_long: (failure) =>
    `No rows - the result has ${failure.detail} rows, more than a table prints`,
} satisfies {
  readonly [K in TableFailure['code']]: (failure: TableFailure & { readonly code: K }) => string;
};

/** One failure of a bound table in words. */
export const tableFailureWords = (failure: TableFailure): string =>
  (TABLE_FAILURE_WORDS[failure.code] as (failure: TableFailure) => string)(failure);

/** A keyed note on a table whose definition declares no key (DAT-012, `key_required`). */
export const NOTE_KEY_REQUIRED =
  'Its query definition declares no key, so this note cannot name its row';

/** A keyed note whose row the result no longer has (DAT-048, `note_row_missing`), by its key. */
export const noteRowMissing = (key: Readonly<Record<string, CanonicalValue>>): string =>
  `No row has the key ${Object.entries(key)
    .map(([column, value]) => `${column} ${String(value)}`)
    .join(', ')} now`;

/** What a bound table shows on its own: the definition that fills it in each document (BI-B). */
export const tableAlone = (title: string | null): string =>
  `Filled from ${title ?? 'a query definition'} in each document`;

/** A column of a bound table as the page draws it: its header, alignment and wrap. */
export interface BoundTableColumnShown {
  readonly text: string;
  readonly align: ColumnAlignment | null;
  readonly wrap: boolean;
  /** The letters of the notes on the column (TB3.3), where it has any. */
  readonly marks?: readonly string[];
}

/**
 * **A bound table's note as the page shows it** (TB3.3): its letter in the table's sequence, or null
 * where it has none - its row gone, not yet read, or the table not laid out - and the words it says
 * in place, `failed` where it would fail the publish.
 */
export interface BoundTableNoteShown {
  readonly id: string;
  readonly letter: string | null;
  readonly said: string | null;
  readonly failed: boolean;
}

/** A cell as the page draws it: its text, whether it heads its row, and its negative colour. */
export interface BoundTableCellShown {
  readonly text: string;
  readonly scope: 'row' | null;
  readonly negative: boolean;
  /** The letters of the notes on the cell (TB3.3), where it has any. */
  readonly marks?: readonly string[];
}

/**
 * **What a bound table's body shows** (the TB2 plan, TB2-D): its headers, its first rows laid out and
 * how many more there are, or one row spanning it with words in place of rows - the empty statement,
 * the definition filling it, or why it has none, `failed` drawn apart (DAT-047).
 */
export interface BoundTableShown {
  readonly columns: readonly BoundTableColumnShown[];
  readonly rows: readonly (readonly BoundTableCellShown[])[];
  readonly spanning: { readonly text: string; readonly failed: boolean } | null;
  readonly more: number;
  /** Each of its keyed and column notes, in the order they stand beneath it (TB3.3). */
  readonly notes?: readonly BoundTableNoteShown[];
}

/** One bound table's body in `doc`: where its table and its body stand, and what it shows. */
export interface BoundTableAt {
  readonly tablePos: number;
  readonly bodyPos: number;
  /** Its binding's identifier. */
  readonly id: string;
  /** Its table's own identifier, or null where it has none yet. */
  readonly table: string | null;
  readonly shown: BoundTableShown;
}

/**
 * A `boundTable` node's notes, each by its identifier and anchor alone, which is all that places one
 * (TB3-C): its paragraphs are the text typed beneath the table.
 */
export function boundTableNotes(node: Node): FootnoteNode[] {
  const notes: FootnoteNode[] = [];
  node.forEach((child) => {
    if (child.type.name !== 'boundTableNote') return;
    notes.push({
      type: 'footnote',
      id: (child.attrs.id as string | null) ?? '',
      anchor: child.attrs.anchor as FootnoteNode['anchor'],
      content: [],
    });
  });
  return notes;
}

/**
 * The stored table a `boundTable` node's attributes hold, for `checkTable` and `layoutTable`, with its
 * notes' anchors (`boundTableNotes`), which the page reads their rows by (TB3.3).
 */
export function storedBoundTable(node: Node): BoundTableNode {
  const { id, style, numbered, binding, columns, headerColumn, sort } = node.attrs;
  const notes = boundTableNotes(node);
  return {
    type: 'boundTable',
    id: id as string,
    style: style as string,
    ...(numbered === false ? { numbered: false as const } : {}),
    binding: binding as BoundTableNode['binding'],
    caption: [],
    columns: columns as BoundTableNode['columns'],
    headerColumn: headerColumn as boolean,
    ...(sort === null ? {} : { sort: sort as NonNullable<BoundTableNode['sort']> }),
    ...(notes.length === 0 ? {} : { notes }),
  };
}

/**
 * The layouts made, memoised (TB2-D, B1's rule): by the result's rows - or, unread, its columns - the
 * node's attributes, the table style and the setting, then the words that vary, so a transaction
 * that changes none of them hands the decoration the very object it held, and the body is not drawn
 * again. Weak, so nothing outlives the result or the node it was made from.
 */
const MEMO = new WeakMap<object, unknown>();
/** A style the setting names nothing for: one object, so the memo finds it again. */
const NO_STYLE: TablePresentation = {};
const LAST = {};
function memoised(keys: readonly object[], last: string, make: () => BoundTableShown) {
  let level = MEMO;
  for (const key of keys) {
    let next = level.get(key) as WeakMap<object, unknown> | undefined;
    if (next === undefined) {
      next = new WeakMap();
      level.set(key, next);
    }
    level = next;
  }
  let made = level.get(LAST) as Map<string, BoundTableShown> | undefined;
  if (made === undefined) {
    made = new Map();
    level.set(LAST, made);
  }
  let shown = made.get(last);
  if (shown === undefined) {
    shown = make();
    made.set(last, shown);
  }
  return shown;
}

/** Its headers as declared, a unit in the header bracketed as the style says: with no layout. */
function declaredColumns(
  table: BoundTableNode,
  style: TablePresentation,
): readonly BoundTableColumnShown[] {
  const [open, close] = style.unitBrackets === 'brackets' ? ['[', ']'] : ['(', ')'];
  return table.columns.map((column) => ({
    text:
      column.unit?.place === 'header'
        ? `${column.header} ${open}${column.unit.text}${close}`
        : column.header,
    align: column.align ?? null,
    wrap: column.wrap !== false,
  }));
}

/** The words of a bound table's own child of this type, spaces run together, or empty. */
function wordsOf(node: Node, type: string): string {
  let words = '';
  node.forEach((child) => {
    if (child.type.name === type) words = child.textContent;
  });
  return words.replace(/\s+/g, ' ').trim();
}

/**
 * **A bound table's notes placed** (TB3.3; TB3-C): lettered by `placeTableNotes` over every row in the
 * table's order - so a note on a row past the first rows shown still takes its letter - with each mark
 * on the column or the laid-out cell it names; a keyed note failing `key_required` where the definition
 * declares no key, or `note_row_missing` where the rows route found no row by its key.
 */
function notesPlaced(
  table: BoundTableNode,
  notes: readonly FootnoteNode[],
  held: TableHeld,
  order: readonly number[] | null,
): {
  readonly notes: readonly BoundTableNoteShown[];
  readonly placed: ReturnType<typeof placeTableNotes>;
} {
  const keyless = held.key !== undefined && held.key.length === 0;
  const noteRows = new Map<string, number | null>();
  for (const note of notes) {
    const row = held.notes?.[note.id];
    if (note.anchor.kind === 'keyed' && !keyless && row !== undefined) noteRows.set(note.id, row);
  }
  const placed =
    order === null
      ? []
      : placeTableNotes(
          { ...table, notes: [...notes] },
          { rows: order.map((index) => ({ index })) },
          noteRows,
        );
  const letters = new Map(placed.map((each) => [each.note.id, each.letter]));
  return {
    placed,
    notes: notes.map((note): BoundTableNoteShown => {
      const { anchor } = note;
      const letter = letters.get(note.id) ?? null;
      if (anchor.kind === 'keyed' && keyless) {
        return { id: note.id, letter: null, said: NOTE_KEY_REQUIRED, failed: true };
      }
      if (anchor.kind === 'keyed' && order !== null && noteRows.get(note.id) === null) {
        return { id: note.id, letter: null, said: noteRowMissing(anchor.key), failed: true };
      }
      return { id: note.id, letter, said: null, failed: false };
    }),
  };
}

/** What a table's notes are memoised by: each one's identifier and anchor, never its words. */
const notesKey = (notes: readonly FootnoteNode[], held: TableHeld | null) =>
  JSON.stringify([
    notes.map((each) => [each.id, each.anchor]),
    held?.key ?? null,
    held?.notes ?? null,
  ]);

/** One bound table's body in `context`. */
function tableShownFor(node: Node, context: BindingContext | null): BoundTableShown {
  const table = storedBoundTable(node);
  const notes = table.notes ?? [];
  let heldTable: TableHeld | null = null;
  const spanning = (keys: readonly object[], text: string, failed: boolean) =>
    memoised(keys, `${failed ? 'failed' : 'shown'} ${text} ${notesKey(notes, heldTable)}`, () => ({
      columns: declaredColumns(table, setting.styles.get(table.style) ?? NO_STYLE),
      rows: [],
      spanning: { text, failed },
      more: 0,
      ...(notes.length === 0 || heldTable === null
        ? {}
        : { notes: notesPlaced(table, notes, heldTable, null).notes }),
    }));
  const setting =
    context?.kind === 'document'
      ? (context.tables ?? DEFAULT_TABLE_SETTING)
      : DEFAULT_TABLE_SETTING;
  if (context === null) return spanning([node.attrs], BOUND_TABLE, false);
  if (context.kind === 'alone') {
    return spanning(
      [node.attrs],
      tableAlone(context.titles.get(table.binding.query) ?? null),
      false,
    );
  }
  const held = context.held.get(table.binding.id);
  if (held === undefined) return spanning([node.attrs, setting], TABLE_NEVER_RESOLVED, true);
  if (held.binding !== bindingDigestInput(table.binding)) {
    return spanning([node.attrs, setting], TABLE_CHANGED, true);
  }
  if (!('table' in held.shown)) return spanning([node.attrs, setting], TABLE_UNAVAILABLE, true);
  heldTable = held.shown.table;
  const { columns, rowCount, rows } = held.shown.table;
  const presorted = held.shown.table.presorted === true;
  const style = setting.styles.get(table.style) ?? NO_STYLE;
  const failures = checkTable(table, columns, rowCount, style);
  if (failures.length > 0) {
    return spanning(
      [columns, node.attrs, style, setting],
      failures.map(tableFailureWords).join('; '),
      true,
    );
  }
  // Read for another set of columns than the table now names: read again by the host (TB2-A).
  const sent = new Set(rows?.columns.map(([name]) => name) ?? []);
  const named = [
    ...table.columns.map((each) => each.column),
    ...(presorted ? [] : (table.sort ?? []).map((each) => each.column)),
  ];
  if (rows === null || named.some((name) => !sent.has(name))) {
    return spanning([columns, node.attrs, style, setting], TABLE_READING, false);
  }
  // The empty statement shows only where there are no rows: typing it changes nothing else.
  const empty = rows.rows.length === 0 ? wordsOf(node, 'boundTableEmpty') : '';
  const shownHeld = held.shown.table;
  return memoised(
    [rows, node.attrs, style, setting],
    `${empty} ${notesKey(notes, shownHeld)}`,
    () => {
      const laid = layoutTable(table, rows, columns, style, setting.formats, setting.words, {
        limit: PAGE_ROWS,
        presorted,
      });
      if ('failures' in laid) {
        return {
          columns: declaredColumns(table, style),
          rows: [],
          spanning: { text: laid.failures.map(tableFailureWords).join('; '), failed: true },
          more: 0,
        };
      }
      const order = presorted
        ? rows.rows.map((_, index) => index)
        : tableOrder(table, rows, columns);
      const { notes: notesShown, placed } = notesPlaced(table, notes, shownHeld, order);
      // Each mark where its note stands: a column's in its header, a cell's in a row laid out.
      const marks = new Map<string, string[]>();
      for (const each of placed) {
        if (each.column < 0) continue;
        const at = `${each.row ?? 'header'} ${each.column}`;
        marks.set(at, [...(marks.get(at) ?? []), each.letter]);
      }
      const marked = (at: string) => {
        const found = marks.get(at);
        return found === undefined ? {} : { marks: found };
      };
      return {
        columns: laid.columns.map((column, at) => ({
          text: column.header,
          align: column.align,
          wrap: column.wrap,
          ...marked(`header ${at}`),
        })),
        rows: laid.rows.map((row, y) =>
          row.cells.map((cell, x) => ({
            text: cell.text,
            scope: cell.scope,
            negative: cell.negative,
            ...marked(`${y} ${x}`),
          })),
        ),
        spanning:
          laid.rows.length > 0
            ? null
            : { text: empty === '' ? setting.words.noRows : empty, failed: false },
        more: rowCount - laid.rows.length,
        ...(notes.length === 0 ? {} : { notes: notesShown }),
      };
    },
  );
}

/**
 * **What each bound table's body in `doc` shows** (the TB2 plan, TB2-D), in document order, by the rule
 * `bindingsShown` shows an inline binding by: in a document, its first `PAGE_ROWS` rows laid out by
 * `layoutTable` from the result the document holds for its binding as it stands, and the count of the
 * rest; `checkTable`'s failures in place without its rows; or why it holds none. On its own, its
 * headers and one row naming the definition that fills it; with no context, `toDOM`'s words.
 */
export function boundTablesShown(
  doc: Node,
  context: BindingContext | null,
): readonly BoundTableAt[] {
  const shown: BoundTableAt[] = [];
  doc.descendants((node, pos) => {
    if (node.type !== boundTableNode) return true;
    let bodyPos = pos + 1;
    node.forEach((child, offset) => {
      if (child.type.name === 'boundTableBody') bodyPos = pos + 1 + offset;
    });
    shown.push({
      tablePos: pos,
      bodyPos,
      id: (node.attrs.binding as { id: string }).id,
      table: typeof node.attrs.id === 'string' ? node.attrs.id : null,
      shown: tableShownFor(node, context),
    });
    return false;
  });
  return shown;
}

/** The binding the selection holds whole, or null: a binding is an atom, only ever selected so. */
export function bindingSelected(state: EditorState): BindingSelected | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection) || selection.node.type !== bindingNode) return null;
  return { pos: selection.from, binding: storedBinding(selection.node) };
}

/** What the Value dialog chooses for a binding: everything it stores but its kind and identifier. */
export type BindingChoice = Omit<Binding, 'type' | 'id'>;

const attrsOf = (choice: BindingChoice) => ({
  query: choice.query,
  version: choice.version ?? null,
  parameters: choice.parameters,
  mode: choice.mode,
  take: choice.take,
});

/**
 * Whether a binding could be placed at the selection's end (the B2 plan, task 1): wherever a content
 * expression of the component's schema admits one there - each of the seven inline homes, a
 * footnote's own editor among them - and so never in preformatted text, beside a block selected
 * whole, or in a section's title, whose schema is another.
 */
export const bindingPlaceable = (state: EditorState): boolean => {
  const { $to } = state.selection;
  const index = $to.index();
  return (
    $to.parent.type.schema === editorSchema &&
    $to.parent.inlineContent &&
    $to.parent.canReplaceWith(index, index, bindingNode)
  );
};

/**
 * Places a binding at the end of the selection and selects it whole, as a reference is placed. It
 * carries no identifier: the identity plugin gives it a fresh one, as it names a block.
 */
export function insertBinding(choice: BindingChoice): Command {
  return (state, dispatch) => {
    if (!bindingPlaceable(state)) return false;
    if (dispatch) {
      const { $to } = state.selection;
      const tr = state.tr.insert($to.pos, bindingNode.create({ id: null, ...attrsOf(choice) }));
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, $to.pos)).scrollIntoView());
    }
    return true;
  };
}

/**
 * Changes the binding at `pos`, keeping its identifier - the same binding, changed, so each document's
 * resolutions still name it - and keeping it selected whole. False where no binding stands there.
 */
export function changeBinding(pos: number, choice: BindingChoice): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (node?.type !== bindingNode) return false;
    if (dispatch) {
      const tr = state.tr.setNodeMarkup(pos, undefined, { id: node.attrs.id, ...attrsOf(choice) });
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
    }
    return true;
  };
}

/**
 * **Value** as a registry command (B2-A): whether one could be placed, or one is selected whole to
 * change. What it binds is the author's to choose in the renderer's dialog, so it places nothing.
 */
export const canPlaceBinding: Command = (state) =>
  bindingPlaceable(state) || bindingSelected(state) !== null;
