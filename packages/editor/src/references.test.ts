import type { CrossReferenceTarget } from '@alloy-works/domain';
import { Fragment, type Node } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';

import { editorSchema } from './schema.js';

const { nodes } = editorSchema;

/** A reference node as the editor holds one, to a block of the component unless told otherwise. */
const reference = (
  target: CrossReferenceTarget = { kind: 'block', block: 't1' },
  extra: Record<string, unknown> = {},
): Node => nodes.crossReference!.create({ id: 'x1', target, display: 'number', ...extra });

describe('a cross-reference in the editor schema (cross-references 1)', () => {
  it('is an inline atom, selectable whole, carrying no marks, with its four attributes', () => {
    const type = nodes.crossReference!;
    expect(type.isInline).toBe(true);
    expect(type.isAtom).toBe(true);
    expect(type.isLeaf).toBe(true);
    expect(type.spec.selectable).toBe(true);
    expect(type.spec.draggable).toBe(false);
    expect(type.spec.marks).toBe('');
    // An identifier the identity plugin fills, and no form for an output with no pages until one is
    // stored: absent in the stored model, null here. A target and a form have no default: nothing
    // makes a reference without choosing both.
    const target = { kind: 'block', block: 't1' } as const;
    expect(type.create({ target, display: 'page' }).attrs).toEqual({
      id: null,
      target,
      display: 'page',
      withoutPages: null,
    });
    expect(() => type.create({ target })).toThrow(/display/);
  });

  it('stands wherever inline content does, and never in preformatted text', () => {
    const one = Fragment.from(reference());
    for (const home of [
      'paragraph',
      'footnoteParagraph',
      'term',
      'attribution',
      'tableCaption',
      'figureCaption',
      'tableNote',
    ]) {
      expect(nodes[home]!.validContent(one), home).toBe(true);
    }
    expect(nodes.preformatted!.validContent(one)).toBe(false);
  });

  it('renders a span a reader sees, saying Section for a section and Reference otherwise', () => {
    const spec = nodes.crossReference!.spec;
    expect(spec.toDOM!(reference())).toEqual([
      'span',
      { class: 'aw-reference', 'data-reference': '' },
      'Reference',
    ]);
    expect(spec.toDOM!(reference({ kind: 'node', node: 'n1' }))).toEqual([
      'span',
      { class: 'aw-reference', 'data-reference': '' },
      'Section',
    ]);
    // No parse rule, for a footnote's reason: a reference enters a component through its command or
    // the product's own clipboard alone, never guessed from an element.
    expect(spec.parseDOM).toBeUndefined();
  });
});
