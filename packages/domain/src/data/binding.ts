import type { z } from 'zod';

import type { BlockNode } from '../content/model/blocks.js';
import type { ContentDocument } from '../content/model/document.js';
import type { bindingNodeSchema, InlineNode, tableBindingSchema } from '../content/model/inline.js';
import { canonicalJson } from '../stored/canonical.js';
import { valueProblem } from './canonical.js';
import type { QueryDefinition } from './definition.js';
import type { ParameterValues } from './parameters.js';
import type { DocumentParameters } from '../template/parameters.js';

/**
 * A binding as a component stores it (data.md, "The binding, in the component's content"; the D3 plan,
 * D3-C): the definition it names, the parameters it runs it with, its mode and the value it takes.
 */
export type Binding = z.infer<typeof bindingNodeSchema>;

/** A bound table's binding (the TB1 plan, TB1-A): an inline binding's members, with no take. */
export type TableBinding = z.infer<typeof tableBindingSchema>;

/** Any binding a component stores: one taking a value, or a table's, taking the whole result. */
export type AnyBinding = Binding | TableBinding;

/** Whether a binding takes a value - every binding but a bound table's (TB1-C). */
export function takes(binding: AnyBinding): binding is Binding {
  return 'take' in binding;
}

/**
 * The input to the digest a resolution holds (D3-R): the binding's canonical form, every member - its
 * `id` and `mode` among them - with no set rule, so a parameter's list keeps its order whatever the
 * parameter is called. A component version that changes any of it moves the digest, and the binding
 * holds nothing in a document until it is resolved again (DA-AA). Hashed by the caller, as content's
 * canonical form is, since a hash is not platform-free.
 */
export function bindingDigestInput(binding: AnyBinding): string {
  return canonicalJson(binding);
}

/**
 * A binding in a component, and where it stands: the members walked to it, joined by dots, and how it
 * is placed - in a line, in a footnote's line, in a caption, or as a figure's image (the B6 plan, B6-D),
 * which decides whether an image it takes can stand there.
 */
export type BindingAt =
  | {
      readonly binding: Binding;
      readonly path: string;
      readonly place: BindingPlace;
      /**
       * A figure's binding whose figure the author marked decorative (Ken, 2026-10-06): its image
       * needs no description, so its row's missing one fails nothing. Absent everywhere else.
       */
      readonly decorative?: true;
    }
  | {
      /** A bound table's binding (TB1-C): the whole result, so it takes nothing. */
      readonly binding: TableBinding;
      readonly path: string;
      readonly place: 'table';
      readonly decorative?: undefined;
    };

/**
 * How a binding taking a value is placed: `figure` a figure's image, `footnote` in a footnote's text,
 * `caption` in a table's or a figure's caption - where no image stands (`image_in_caption`) - else
 * `line`. A bound table's own binding is placed `table` (TB1-C) and takes nothing.
 */
export type BindingPlace = 'line' | 'footnote' | 'caption' | 'figure';

/**
 * Every binding in a component, in reading order, wherever its content admits an inline (D3-D): a
 * paragraph, a definition's term, a quotation's attribution, a table's caption, cells and note, a
 * figure's caption, and a footnote's paragraphs - and a figure's own (B6-A), before its caption, and a
 * bound table's own (TB1-C), before its caption, empty statement, note and source.
 * Reads content `parseContentDocument` returned, whose footnotes hold parsed paragraphs.
 */
export function bindingsIn(content: ContentDocument): BindingAt[] {
  const found: BindingAt[] = [];
  blocks(content.content, 'content', found, 'line');
  return found;
}

function blocks(
  sequence: readonly BlockNode[],
  path: string,
  found: BindingAt[],
  place: 'line' | 'footnote',
): void {
  sequence.forEach((block, at) => {
    const here = `${path}.${at}`;
    switch (block.type) {
      case 'paragraph':
        inlines(block.content, `${here}.content`, found, place);
        break;
      case 'list':
        block.items.forEach((item, index) => {
          if (item.term) inlines(item.term, `${here}.items.${index}.term`, found, place);
          blocks(item.content, `${here}.items.${index}.content`, found, place);
        });
        break;
      case 'blockquote':
        blocks(block.content, `${here}.content`, found, place);
        if (block.attribution) inlines(block.attribution, `${here}.attribution`, found, place);
        break;
      case 'table':
        inlines(block.caption, `${here}.caption`, found, 'caption');
        if (block.note) inlines(block.note, `${here}.note`, found, place);
        block.rows.forEach((row, rowAt) =>
          row.cells.forEach((cell, cellAt) =>
            blocks(cell.content, `${here}.rows.${rowAt}.cells.${cellAt}.content`, found, place),
          ),
        );
        break;
      case 'boundTable':
        // Its own binding, then the bindings in its caption, empty statement, note and source, in
        // the order a reader meets them (the TB1 plan, TB1-C and TB1-D).
        found.push({ binding: block.binding, path: `${here}.binding`, place: 'table' });
        inlines(block.caption, `${here}.caption`, found, 'caption');
        if (block.empty) inlines(block.empty, `${here}.empty`, found, place);
        if (block.note) inlines(block.note, `${here}.note`, found, place);
        if (block.source) inlines(block.source, `${here}.source`, found, place);
        break;
      case 'figure':
        if (block.binding) {
          found.push({
            binding: block.binding,
            path: `${here}.binding`,
            place: 'figure',
            ...(block.alternative.kind === 'decorative' ? { decorative: true as const } : {}),
          });
        }
        inlines(block.caption, `${here}.caption`, found, 'caption');
        break;
      default:
        break;
    }
  });
}

function inlines(
  sequence: readonly InlineNode[],
  path: string,
  found: BindingAt[],
  place: 'line' | 'footnote' | 'caption',
): void {
  sequence.forEach((inline, at) => {
    const here = `${path}.${at}`;
    if (inline.type === 'binding') found.push({ binding: inline, path: here, place });
    if (inline.type === 'footnote') {
      blocks(inline.content as BlockNode[], `${here}.content`, found, 'footnote');
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
 * A binding with its document arguments replaced by the document's values (TP2-A; templates.md,
 * "Feeding the bindings"): each `{ document: name }` the document has a value for becomes that value as
 * a literal; one it has none for, or an empty list for, stays as it is, for the act to refuse. A
 * binding with no document argument is returned as it is, so its digest - and every resolution held
 * of it - stays. Its digest is taken over what this answers wherever it is compared.
 */
export function substituteDocumentArguments<B extends AnyBinding>(
  binding: B,
  parameters: DocumentParameters,
): B {
  const entries = Object.entries(binding.parameters);
  if (!entries.some(([, parameter]) => 'document' in parameter)) return binding;
  const substituted = entries.map(([name, parameter]) => {
    if (!('document' in parameter) || !Object.hasOwn(parameters, parameter.document)) {
      return [name, parameter] as const;
    }
    const value = parameters[parameter.document]!;
    if (Array.isArray(value) && value.length === 0) return [name, parameter] as const;
    return [name, { literal: value as Exclude<typeof value, readonly unknown[]> }] as const;
  });
  return { ...binding, parameters: Object.fromEntries(substituted) };
}

/**
 * The values a binding runs its definition with: its literals by name, under `values` so that a
 * parameter named `document` is never read as anything else, and the definition parameters it still
 * takes from the document - those `substituteDocumentArguments` found no value for - which the act
 * fails `parameter_invalid`, rule `required` (TP2-C). The values are D2's to check against the
 * definition (`checkParameterValues`, D2-R).
 */
export function literalValues(binding: AnyBinding): {
  readonly values: ParameterValues;
  readonly fromDocument: readonly string[];
} {
  const values: Record<string, ParameterValues[string]> = {};
  const fromDocument: string[] = [];
  for (const [name, parameter] of Object.entries(binding.parameters)) {
    if ('document' in parameter) fromDocument.push(name);
    else values[name] = parameter.literal;
  }
  return { values, fromDocument };
}
