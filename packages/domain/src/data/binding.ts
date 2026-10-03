import type { z } from 'zod';

import type { BlockNode } from '../content/model/blocks.js';
import type { ContentDocument } from '../content/model/document.js';
import type { bindingNodeSchema, InlineNode } from '../content/model/inline.js';
import { canonicalJson } from '../stored/canonical.js';
import { valueProblem } from './canonical.js';
import type { QueryDefinition } from './definition.js';
import type { ParameterValues } from './parameters.js';

/**
 * A binding as a component stores it (data.md, "The binding, in the component's content"; the D3 plan,
 * D3-C): the definition it names, the parameters it runs it with, its mode and the value it takes.
 */
export type Binding = z.infer<typeof bindingNodeSchema>;

/**
 * The input to the digest a resolution holds (D3-R): the binding's canonical form, every member - its
 * `id` and `mode` among them - with no set rule, so a parameter's list keeps its order whatever the
 * parameter is called. A component version that changes any of it moves the digest, and the binding
 * holds nothing in a document until it is resolved again (DA-AA). Hashed by the caller, as content's
 * canonical form is, since a hash is not platform-free.
 */
export function bindingDigestInput(binding: Binding): string {
  return canonicalJson(binding);
}

/** A binding in a component, and where it stands: the members walked to it, joined by dots. */
export interface BindingAt {
  readonly binding: Binding;
  readonly path: string;
}

/**
 * Every binding in a component, in reading order, wherever its content admits an inline (D3-D): a
 * paragraph, a definition's term, a quotation's attribution, a table's caption, cells and note, a
 * figure's caption, and a footnote's paragraphs. Reads content `parseContentDocument` returned, whose
 * footnotes hold parsed paragraphs.
 */
export function bindingsIn(content: ContentDocument): BindingAt[] {
  const found: BindingAt[] = [];
  blocks(content.content, 'content', found);
  return found;
}

function blocks(sequence: readonly BlockNode[], path: string, found: BindingAt[]): void {
  sequence.forEach((block, at) => {
    const here = `${path}.${at}`;
    switch (block.type) {
      case 'paragraph':
        inlines(block.content, `${here}.content`, found);
        break;
      case 'list':
        block.items.forEach((item, index) => {
          if (item.term) inlines(item.term, `${here}.items.${index}.term`, found);
          blocks(item.content, `${here}.items.${index}.content`, found);
        });
        break;
      case 'blockquote':
        blocks(block.content, `${here}.content`, found);
        if (block.attribution) inlines(block.attribution, `${here}.attribution`, found);
        break;
      case 'table':
        inlines(block.caption, `${here}.caption`, found);
        if (block.note) inlines(block.note, `${here}.note`, found);
        block.rows.forEach((row, rowAt) =>
          row.cells.forEach((cell, cellAt) =>
            blocks(cell.content, `${here}.rows.${rowAt}.cells.${cellAt}.content`, found),
          ),
        );
        break;
      case 'figure':
        inlines(block.caption, `${here}.caption`, found);
        break;
      default:
        break;
    }
  });
}

function inlines(sequence: readonly InlineNode[], path: string, found: BindingAt[]): void {
  sequence.forEach((inline, at) => {
    const here = `${path}.${at}`;
    if (inline.type === 'binding') found.push({ binding: inline, path: here });
    if (inline.type === 'footnote') {
      blocks(inline.content as BlockNode[], `${here}.content`, found);
    }
  });
}

/**
 * Why what a binding takes is not the definition's, or null where it is (D3-L, `take_invalid`): its
 * column is declared, and a key names exactly the definition's key columns, each value canonical in
 * its column's type. Checked where the binding is resolved, against the definition version it
 * resolves to, as a cross-reference's target is - never where the component is written, since a
 * floating binding's definition can change afterwards. Names columns, never a value.
 */
export function checkTake(
  take: Binding['take'],
  definition: Pick<QueryDefinition, 'columns' | 'key'>,
): string | null {
  const columns = new Map(definition.columns.map((column) => [column.name, column]));
  if (!columns.has(take.column)) {
    return `The binding takes ${take.column}, which the definition does not declare`;
  }
  if (!('key' in take)) return null;
  const named = Object.keys(take.key).sort();
  const declared = [...definition.key].sort();
  if (declared.length === 0) {
    return 'The binding names a row by its key, and the definition declares no key';
  }
  if (named.length !== declared.length || named.some((name, at) => name !== declared[at])) {
    return `The binding names a row by ${named.join(', ')}, and the definition's key is ${declared.join(', ')}`;
  }
  for (const name of named) {
    if (valueProblem(columns.get(name)!.type, take.key[name]) !== null) {
      return `The binding's key value for ${name} is not written in its column's canonical form`;
    }
  }
  return null;
}

/**
 * The values a binding runs its definition with: its literals by name, under `values` so that a
 * parameter named `document` is never read as the other answer - or, where it takes a parameter
 * from the document, that parameter's name, which the act fails `parameter_invalid` until a document
 * has a parameter set (TPL-020; D3-L). The values are D2's to check against the definition
 * (`checkParameterValues`, D2-R).
 */
export function literalValues(
  binding: Binding,
): { readonly values: ParameterValues } | { readonly document: string } {
  const values: Record<string, ParameterValues[string]> = {};
  for (const [name, parameter] of Object.entries(binding.parameters)) {
    if ('document' in parameter) return { document: parameter.document };
    values[name] = parameter.literal;
  }
  return { values };
}
