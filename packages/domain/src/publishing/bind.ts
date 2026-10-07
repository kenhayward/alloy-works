import type { BlockNode } from '../content/model/blocks.js';
import type { ContentDocument } from '../content/model/document.js';
import type { Alternative, FootnoteNode, InlineNode } from '../content/model/inline.js';
import type { Binding } from '../data/binding.js';
import type { CanonicalResult, CanonicalValue } from '../data/canonical.js';
import type { ColumnType, ImageColumnType, ValueType } from '../data/columns.js';
import type { Column } from '../data/definition.js';
import type { FieldFormat } from '../data/field-format.js';
import { formatValue } from '../data/format.js';
import { layoutTable, type TablePresentation } from '../data/table.js';
import { keyNamesTheKey, matchNoteRows, placeTableNotes } from '../data/table-notes.js';
import { takeValue, type TakeOutcome } from '../data/take.js';
import { canonicalJson } from '../stored/canonical.js';
import type { ValueFormats } from '../theme/schema.js';

import { DEFAULT_NEGATIVE_COLOUR, laidOutTable } from './bound.js';
import type { PublishFailure } from './failures.js';

declare const BOUND: unique symbol;

/**
 * **Content through the binding stage** (the B3 plan, B3-D; PUB-108): each binding taken and set as
 * text, or failed. `contributionsOf` and the reference resolver take this alone, so nothing is
 * counted, numbered, referenced or listed from content whose values are not yet in it. A brand of the
 * type only: at run time it is a `ContentDocument`.
 */
export type Bound = ContentDocument & { readonly [BOUND]: true };

/**
 * **The one way to count without values**, for the document page's numbering, which shows numbers
 * before any publish: no contribution reads a value, so the numbers are the same, and a caption's
 * words are those stored, a binding in it read as nothing.
 */
export function unbound(content: ContentDocument): Bound {
  return content as Bound;
}

/**
 * A binding's result as the request recorded it and the worker read it, held to its checksum: the
 * rows, the columns its dataset version's provenance declares, that version, and the asset version
 * each image hash of the result was admitted as (its provenance's `images`, D8-D). `unreadable` where
 * the object was missing, altered or not canonical (B3-F).
 */
export type Held =
  | {
      readonly result: CanonicalResult;
      readonly columns: readonly Column[];
      readonly datasetVersion: string;
      readonly images: Readonly<Record<string, string>>;
      /** The key of the definition version the dataset version ran (TB3-B): what a keyed note names. */
      readonly key: readonly string[];
    }
  | 'unreadable';

/** Where a value was set: its node, its block, its binding and take, and the version it came from. */
interface Placed {
  readonly node: string;
  readonly block: string;
  readonly binding: string;
  readonly take: Binding['take'];
  readonly datasetVersion: string;
}

/**
 * **A bound table as printed** (the TB1 plan, TB1-J; TAB-019): each column shown - its result column's
 * name and type, its header and the format it was printed by, its rounding rule among it - and each
 * printed cell, row by row, with the canonical value it was printed from.
 */
export interface PrintedTable {
  readonly columns: readonly {
    readonly name: string;
    readonly type: ColumnType;
    readonly header: string;
    readonly format: FieldFormat;
  }[];
  readonly rows: readonly (readonly {
    readonly printed: string;
    readonly value: CanonicalValue;
  }[])[];
  /** Each note printed beneath it, by its letter, and the anchor it was stored with (TB3.1). */
  readonly notes: readonly {
    readonly note: string;
    readonly letter: string;
    readonly anchor: FootnoteNode['anchor'];
  }[];
}

/**
 * A value set in the content: where, which binding, what was printed and what it was printed from -
 * or, for an image (the B6 plan, B6-E), the image's hash and the asset version it was placed as, and
 * its description: the text it was described by, or `decorative` - or, for a bound table (TB1-J), the
 * table as printed, its binding taking no value.
 */
export type PrintedValue =
  | (Placed & {
      readonly printed: string;
      readonly value: string | boolean;
      readonly column: { readonly name: string; readonly type: ValueType };
    })
  | (Placed & {
      readonly image: { readonly hash: string; readonly assetVersion: string };
      readonly description: string;
      readonly column: { readonly name: string; readonly type: ImageColumnType };
    })
  | (Omit<Placed, 'take'> & { readonly table: PrintedTable });

/**
 * What the binding stage lays a bound table out with (TB1-H): the table style's presentation by its
 * identifier, and the layout's words - each absent from a layout stored before its schema 7. Absent
 * altogether for a request made before layouts, whose bound table `assemble` refuses by name.
 */
export interface BoundTables {
  readonly style: (
    id: string,
  ) => (TablePresentation & { readonly negativeColour?: string | undefined }) | undefined;
  readonly words: {
    readonly noRows?: string | undefined;
    readonly notAvailable?: string | undefined;
    readonly source?: string | undefined;
  };
  /** Each table laid out once per dataset version and presentation, across the occurrences. */
  readonly laidOut?: Map<string, ReturnType<typeof layoutTable>>;
}

/** An image a take gave, with the asset version its result's provenance admitted it as. */
type TakenImage = Extract<TakeOutcome, { image: string }> & { readonly assetVersion: string };

/**
 * What a bound image is described by (B6-C): decorative where its column's type says so, and otherwise
 * the words its row holds as its own text - words that read "decorative" among them. Decided by the
 * type, never by the text. An author's decorative on a figure is the figure's, applied where it is set.
 */
const describedBy = (image: TakenImage): Alternative =>
  image.column.type.description === 'decorative'
    ? { kind: 'decorative' }
    : { kind: 'own', text: image.description };

/**
 * **The binding stage** (bindings.md; the B3 plan, B3-D): every binding in one occurrence's content
 * taken from the result `held` gives it by `takeValue`, printed by `formatValue` in `formats`, and set
 * where it stood as a text run, marks-free, in its paragraph's language. A binding with no result
 * recorded is `binding_unresolved` (DAT-087), an unreadable result `result_unreadable`, and a take
 * that holds no value fails by its own code (DAT-046): each at stage `bind`, naming its block and, in
 * `detail`, the binding. **A failed binding is left a binding**, never a text of any kind, and every
 * failure is gathered.
 *
 * **A bound image is set as an ordinary one** (the B6 plan, B6-E): an inline binding taking an image
 * becomes an `image` inline in the inline image style, `inline`, and a figure's binding gives the
 * figure its `asset`, each the asset version the result's provenance admitted the image as, and each
 * described by the description taken, or decorative (a figure the author marked decorative stays so,
 * and needs no description: Ken, 2026-10-06).
 * So everything after this stage reads what it reads today. An image in a footnote's text is
 * `image_not_placeable` (CNT-129), and a figure's binding taking anything but an image
 * `value_not_image`; a description missing is `image_description_missing`, its `detail` the binding and
 * the description's column (DAT-097).
 */
export function bind(
  node: string,
  content: ContentDocument,
  held: ReadonlyMap<string, Held>,
  formats: ValueFormats,
  tables?: BoundTables,
): { bound: Bound; values: PrintedValue[]; failures: PublishFailure[] } {
  const values: PrintedValue[] = [];
  const failures: PublishFailure[] = [];
  const fail = (code: PublishFailure['code'], block: string, detail: string) =>
    failures.push({ stage: 'bind', code, node, block, detail });

  /**
   * The take of one binding, failed by name where it holds nothing, with where it came from. A figure
   * its author marked `decorative` (Ken, 2026-10-06) is taken as though its image column were
   * declared decorative, so its row's description is never required; the column it is recorded
   * against is still the one the definition declares.
   */
  const take = (binding: Binding, block: string, decorative = false) => {
    const result = held.get(binding.id);
    if (result === undefined) {
      fail('binding_unresolved', block, binding.id);
      return undefined;
    }
    if (result === 'unreadable') {
      fail('result_unreadable', block, binding.id);
      return undefined;
    }
    const declared = result.columns.find((column) => column.name === binding.take.column);
    const columns =
      decorative && declared?.type.base === 'image'
        ? result.columns.map((column) =>
            column === declared
              ? { ...column, type: { ...declared.type, description: 'decorative' as const } }
              : column,
          )
        : result.columns;
    const outcome = takeValue(binding.take, result.result, columns);
    const taken =
      'image' in outcome && declared?.type.base === 'image'
        ? { ...outcome, column: { name: declared.name, type: declared.type } }
        : outcome;
    if ('failure' in taken) {
      fail(
        taken.failure,
        block,
        taken.failure === 'image_description_missing'
          ? `${binding.id}: ${taken.column}`
          : binding.id,
      );
      return undefined;
    }
    const placed: Placed = {
      node,
      block,
      binding: binding.id,
      take: binding.take,
      datasetVersion: result.datasetVersion,
    };
    if ('value' in taken) return { placed, taken };
    // Recorded only where the provenance names an asset version for every image it holds (D8-D), so
    // one missing is a result that does not read as recorded.
    const assetVersion = result.images[taken.image];
    if (assetVersion === undefined) {
      fail('result_unreadable', block, binding.id);
      return undefined;
    }
    return { placed, taken: { ...taken, assetVersion } as TakenImage };
  };

  /** Records an image placed, as `provenance.json` lists it. */
  const placedImage = (placed: Placed, image: TakenImage) =>
    values.push({
      ...placed,
      image: { hash: image.image, assetVersion: image.assetVersion },
      description: image.description,
      column: image.column,
    });

  /**
   * **A bound table laid out in its place** (TB1-H): its result read as an inline binding's is, laid
   * out by `layoutTable` in its table style and the document's formats, and replaced by a table of the
   * text it printed; or every failure, by name, at stage `bind`, the block left as it stood.
   */
  const layOut = (table: Extract<BlockNode, { type: 'boundTable' }>): BlockNode => {
    if (tables === undefined) return table;
    const result = held.get(table.binding.id);
    if (result === undefined) {
      fail('binding_unresolved', table.id, table.binding.id);
      return table;
    }
    if (result === 'unreadable') {
      fail('result_unreadable', table.id, table.binding.id);
      return table;
    }
    const { noRows, notAvailable, source } = tables.words;
    if (noRows === undefined || notAvailable === undefined || source === undefined) {
      const missing = Object.entries({ noRows, notAvailable, source })
        .filter(([, word]) => word === undefined)
        .map(([name]) => name);
      fail('table_words_missing', table.id, missing.join(', '));
      return table;
    }
    const style = tables.style(table.style) ?? {};
    const key = canonicalJson({ version: result.datasetVersion, table, style, formats });
    let laid = tables.laidOut?.get(key);
    if (laid === undefined) {
      laid = layoutTable(table, result.result, result.columns, style, formats, {
        noRows,
        notAvailable,
      });
      tables.laidOut?.set(key, laid);
    }
    if ('failures' in laid) {
      for (const each of laid.failures) {
        fail(
          each.code,
          table.id,
          each.code === 'table_too_long'
            ? each.detail
            : each.code === 'format_mismatch'
              ? `${each.column}: ${each.detail}`
              : each.column,
        );
      }
      return table;
    }
    // Its notes (TB3-B, TB3-C): a keyed one needs the definition's key, and its row by that key.
    const notes = table.notes ?? [];
    const definition = table.binding.query;
    if (result.key.length === 0 && notes.some((note) => note.anchor.kind === 'keyed')) {
      fail('key_required', table.id, definition);
      return table;
    }
    const noteRows = matchNoteRows(notes, result.result, result.key, result.columns);
    let gone = false;
    for (const note of notes) {
      if (note.anchor.kind !== 'keyed' || noteRows.get(note.id) !== null) continue;
      gone = true;
      const why = keyNamesTheKey(note.anchor.key, result.key)
        ? ''
        : `: the key is ${result.key.join(', ')}`;
      const key = canonicalJson(note.anchor.key);
      fail('note_row_missing', table.id, `${note.id}: ${key}: ${definition}${why}`);
    }
    if (gone) return table;
    const placed = placeTableNotes(table, laid, noteRows);
    values.push({
      node,
      block: table.id,
      binding: table.binding.id,
      datasetVersion: result.datasetVersion,
      table: {
        columns: laid.columns.map((column) => ({
          name: column.name,
          type: column.type,
          header: column.header,
          format: column.format,
        })),
        rows: laid.rows.map((row) =>
          row.cells.map((cell) => ({ printed: cell.text, value: cell.value })),
        ),
        notes: placed.map(({ note, letter }) => ({ note: note.id, letter, anchor: note.anchor })),
      },
    });
    // The empty statement's own bindings are set only where it prints - the result has no rows - so a
    // statement not printed records no value and fails nothing (the TB1 final review, M2).
    const printed =
      laid.empty === null || table.empty === undefined
        ? laid
        : { ...laid, empty: { ...laid.empty, content: inlines(table.empty, table.id) } };
    return laidOutTable(table, printed, style.negativeColour ?? DEFAULT_NEGATIVE_COLOUR, placed);
  };

  const inlines = (sequence: readonly InlineNode[], block: string, noImage = false): InlineNode[] =>
    sequence.map((inline): InlineNode => {
      if (inline.type === 'footnote') {
        return { ...inline, content: blocks(inline.content as BlockNode[], true) };
      }
      if (inline.type !== 'binding') return inline;
      const got = take(inline, block);
      if (got === undefined) return inline;
      const { placed, taken } = got;
      if ('image' in taken) {
        // A footnote holds no image (CNT-129), and a caption sets none (`image_in_caption`), so a bound
        // one is placed in neither (B6-D), as the bindings view says.
        if (noImage) {
          fail('image_not_placeable', block, inline.id);
          return inline;
        }
        placedImage(placed, taken);
        return {
          type: 'image',
          asset: taken.assetVersion,
          imageStyle: 'inline',
          alternative: describedBy(taken),
        };
      }
      const printed = formatValue(taken.value, taken.column.type, formats);
      values.push({ ...placed, printed, value: taken.value, column: taken.column });
      return { type: 'text', value: printed, marks: [] };
    });

  const blocks = (sequence: readonly BlockNode[], inFootnote = false): BlockNode[] =>
    sequence.map((block): BlockNode => {
      switch (block.type) {
        case 'paragraph':
          return { ...block, content: inlines(block.content, block.id, inFootnote) };
        case 'list':
          return {
            ...block,
            items: block.items.map((item) => ({
              ...item,
              ...(item.term ? { term: inlines(item.term, block.id, inFootnote) } : {}),
              content: blocks(item.content, inFootnote),
            })),
          };
        case 'blockquote':
          return {
            ...block,
            content: blocks(block.content, inFootnote),
            ...(block.attribution
              ? { attribution: inlines(block.attribution, block.id, inFootnote) }
              : {}),
          };
        case 'table':
          return {
            ...block,
            caption: inlines(block.caption, block.id, true),
            ...(block.note ? { note: inlines(block.note, block.id, inFootnote) } : {}),
            rows: block.rows.map((row) => ({
              ...row,
              cells: row.cells.map((cell) => ({
                ...cell,
                content: blocks(cell.content, inFootnote),
              })),
            })),
          };
        case 'boundTable':
          // The bindings in its own words first, as a table's caption's and note's are - but for its
          // empty statement's, set only where it prints; then its own binding, the whole result laid
          // out in its place (TB1-H).
          return layOut({
            ...block,
            caption: inlines(block.caption, block.id, true),
            ...(block.note ? { note: inlines(block.note, block.id, inFootnote) } : {}),
            ...(block.notes
              ? { notes: inlines(block.notes, block.id, true) as FootnoteNode[] }
              : {}),
            ...(block.source ? { source: inlines(block.source, block.id, inFootnote) } : {}),
          });
        case 'figure': {
          // The figure's own binding first, as a reader meets its image before its caption.
          let figure: BlockNode = block;
          if (block.binding !== undefined) {
            const got = take(block.binding, block.id, block.alternative.kind === 'decorative');
            if (got !== undefined && !('image' in got.taken)) {
              fail('value_not_image', block.id, block.binding.id);
            } else if (got !== undefined && 'image' in got.taken) {
              placedImage(got.placed, got.taken);
              // Set as an ordinary figure: its asset in place of its binding, never both.
              const placed = { ...block };
              delete placed.binding;
              figure = {
                ...placed,
                asset: got.taken.assetVersion,
                // The author's decorative stands; `inherited` is the definition's description (B6-C).
                alternative:
                  block.alternative.kind === 'decorative'
                    ? block.alternative
                    : describedBy(got.taken),
              };
            }
          }
          return { ...figure, caption: inlines(block.caption, block.id, true) };
        }
        default:
          return block;
      }
    });

  const bound = { ...content, content: blocks(content.content) } as Bound;
  return { bound, values, failures };
}
