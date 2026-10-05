import type { BlockNode } from '../content/model/blocks.js';
import type { ContentDocument } from '../content/model/document.js';
import type { InlineNode } from '../content/model/inline.js';
import type { Binding } from '../data/binding.js';
import type { CanonicalResult } from '../data/canonical.js';
import type { ValueType } from '../data/columns.js';
import type { Column } from '../data/definition.js';
import { formatValue } from '../data/format.js';
import { takeValue } from '../data/take.js';
import type { ValueFormats } from '../theme/schema.js';

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
 * rows, the columns its dataset version's provenance declares, and that version. `unreadable` where
 * the object was missing, altered or not canonical (B3-F).
 */
export type Held =
  | {
      readonly result: CanonicalResult;
      readonly columns: readonly Column[];
      readonly datasetVersion: string;
    }
  | 'unreadable';

/** A value set in the content: where, which binding, what was printed and what it was printed from. */
export interface PrintedValue {
  readonly node: string;
  readonly block: string;
  readonly binding: string;
  readonly take: Binding['take'];
  readonly printed: string;
  readonly value: string | boolean;
  readonly column: { readonly name: string; readonly type: ValueType };
  readonly datasetVersion: string;
}

/**
 * **The binding stage** (bindings.md; the B3 plan, B3-D): every binding in one occurrence's content
 * taken from the result `held` gives it by `takeValue`, printed by `formatValue` in `formats`, and set
 * where it stood as a text run, marks-free, in its paragraph's language. A binding with no result
 * recorded is `binding_unresolved` (DAT-087), an unreadable result `result_unreadable`, and a take
 * that holds no value fails by its own code (DAT-046): each at stage `bind`, naming its block and, in
 * `detail`, the binding. **A failed binding is left a binding**, never a text of any kind, and every
 * failure is gathered.
 */
export function bind(
  node: string,
  content: ContentDocument,
  held: ReadonlyMap<string, Held>,
  formats: ValueFormats,
): { bound: Bound; values: PrintedValue[]; failures: PublishFailure[] } {
  const values: PrintedValue[] = [];
  const failures: PublishFailure[] = [];
  const fail = (code: PublishFailure['code'], block: string, binding: string) =>
    failures.push({ stage: 'bind', code, node, block, detail: binding });

  const inlines = (sequence: readonly InlineNode[], block: string): InlineNode[] =>
    sequence.map((inline) => {
      if (inline.type === 'footnote') {
        return { ...inline, content: blocks(inline.content as BlockNode[]) };
      }
      if (inline.type !== 'binding') return inline;
      const result = held.get(inline.id);
      if (result === undefined) {
        fail('binding_unresolved', block, inline.id);
        return inline;
      }
      if (result === 'unreadable') {
        fail('result_unreadable', block, inline.id);
        return inline;
      }
      const taken = takeValue(inline.take, result.result, result.columns);
      if ('failure' in taken) {
        fail(taken.failure, block, inline.id);
        return inline;
      }
      const printed = formatValue(taken.value, taken.column.type, formats);
      values.push({
        node,
        block,
        binding: inline.id,
        take: inline.take,
        printed,
        value: taken.value,
        column: taken.column,
        datasetVersion: result.datasetVersion,
      });
      return { type: 'text', value: printed, marks: [] };
    });

  const blocks = (sequence: readonly BlockNode[]): BlockNode[] =>
    sequence.map((block): BlockNode => {
      switch (block.type) {
        case 'paragraph':
          return { ...block, content: inlines(block.content, block.id) };
        case 'list':
          return {
            ...block,
            items: block.items.map((item) => ({
              ...item,
              ...(item.term ? { term: inlines(item.term, block.id) } : {}),
              content: blocks(item.content),
            })),
          };
        case 'blockquote':
          return {
            ...block,
            content: blocks(block.content),
            ...(block.attribution ? { attribution: inlines(block.attribution, block.id) } : {}),
          };
        case 'table':
          return {
            ...block,
            caption: inlines(block.caption, block.id),
            ...(block.note ? { note: inlines(block.note, block.id) } : {}),
            rows: block.rows.map((row) => ({
              ...row,
              cells: row.cells.map((cell) => ({ ...cell, content: blocks(cell.content) })),
            })),
          };
        case 'figure':
          return { ...block, caption: inlines(block.caption, block.id) };
        default:
          return block;
      }
    });

  const bound = { ...content, content: blocks(content.content) } as Bound;
  return { bound, values, failures };
}
