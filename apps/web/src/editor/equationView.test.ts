import {
  createEditorState,
  fromEditor,
  mountEditor,
  NodeSelection,
  openFootnote,
  toEditor,
  type EditorView,
} from '@alloy-works/editor';
import { fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { shimRangeMeasurement } from '../test/range.js';

shimRangeMeasurement();

const NS = 'http://www.w3.org/1998/Math/MathML';
/** An equation in the one form the MathML reader writes, spoken as _x squared_. */
const SQUARED = `<math xmlns="${NS}" alttext="x squared"><msup><mi>x</mi><mn>2</mn></msup></math>`;
/** A block's, with its alternative and `display` as the reader orders them. */
const ENERGY = `<math xmlns="${NS}" alttext="E equals m c squared" display="block"><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></math>`;
/** One with no alternative at all. */
const UNSPOKEN = `<math xmlns="${NS}"><mi>E</mi><mo>=</mo><mi>m</mi></math>`;

const counter = (prefix = 'n') => {
  let next = 0;
  return () => `${prefix}${(next += 1)}`;
};
const text = (value: string) => ({ type: 'text', value, marks: [] });
const para = (id: string, ...content: unknown[]) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content,
});
const inline = (mathml = SQUARED) => ({ type: 'equation', mathml, latex: 'x^2' });
const block = (id: string, mathml = ENERGY, numbered = true) => ({
  type: 'equation',
  id,
  mathml,
  latex: 'E = mc^2',
  numbered,
});

/** A surface over these blocks, mounted as the component editor mounts one; what it prompted for. */
function mount(content: unknown[]): { view: EditorView; prompted: string[] } {
  const opened = toEditor({
    schemaVersion: 1,
    title: 'Site visits',
    language: 'en-GB',
    direction: 'ltr',
    content,
  } as never);
  if (!opened.editable) throw new Error(opened.unsupported.join(', '));
  const prompted: string[] = [];
  const newIdentifier = counter('x');
  const place = document.createElement('div');
  document.body.appendChild(place);
  const view = mountEditor(place, {
    state: createEditorState({
      doc: opened.doc,
      newIdentifier,
      onPrompt: (name) => {
        prompted.push(name);
        return true;
      },
    }),
    label: 'Content',
    editable: () => true,
    dispatch: (tr, target) => target.updateState(target.state.apply(tr)),
    pasted: () => undefined,
    refused: () => undefined,
    newIdentifier,
  });
  return { view, prompted };
}

/** Where the first node of a type starts. */
function find(view: EditorView, type: string): number {
  let found = -1;
  view.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === type) found = pos;
    return found === -1;
  });
  if (found === -1) throw new Error(`no ${type}`);
  return found;
}

const select = (view: EditorView, pos: number) =>
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));

/** A character typed where the selection is, as a key press reaches ProseMirror. */
const typeInto = (view: EditorView, character: string) =>
  fireEvent.keyPress(view.dom, { key: character, charCode: character.charCodeAt(0) });

/** Every top-level block's type, and a paragraph's text, to read a document's shape at a glance. */
const shape = (view: EditorView) => {
  const found: string[] = [];
  view.state.doc.forEach((node) =>
    found.push(node.type.name === 'paragraph' ? `p:${node.textContent}` : node.type.name),
  );
  return found;
};

afterEach(() => {
  document.body.replaceChildren();
});

describe('an equation on the surface (equations 1, ruling R5)', () => {
  it('CNT-045 draws an inline equation as its stored MathML, element for element, carrying its alternative, never as HTML', () => {
    const { view } = mount([para('b1', text('Where '), inline(), text(' grows.'))]);
    const holder = view.dom.querySelector<HTMLElement>('.aw-equation')!;
    const math = holder.querySelector('math')!;
    expect(math).not.toBeNull();
    // The one representation drawn whole: what is on the screen is the stored MathML, every element
    // and attribute of it, with nothing but the name the view gives it beside - the MathML the PDF's
    // and Word's maths tree is read from (the worker's CNT-045 test).
    const drawn = math.cloneNode(true) as Element;
    drawn.removeAttribute('aria-label');
    const serialised = (element: Element) => new XMLSerializer().serializeToString(element);
    expect(serialised(drawn)).toBe(
      serialised(new DOMParser().parseFromString(SQUARED, 'application/xml').documentElement),
    );
    expect(math.namespaceURI).toBe(NS);
    expect(math.querySelector('msup')!.namespaceURI).toBe(NS);
    expect(math.querySelector('mi')!.namespaceURI).toBe(NS);
    expect(math.querySelector('mi')).toHaveTextContent('x');
    expect(math.getAttribute('alttext')).toBe('x squared');
    // Named by its alternative on the math element itself, which keeps its own role: a role on a
    // holder would hide the MathML from a screen reader that reads it.
    expect(math.getAttribute('aria-label')).toBe('x squared');
    expect(holder).not.toHaveAttribute('role');
    expect(math.hasAttribute('display')).toBe(false);
    expect(holder).not.toHaveClass('aw-equation-undescribed');
  });

  it('draws a block equation as display MathML, with a marker where it is numbered', () => {
    const { view } = mount([
      para('b1', text('Energy:')),
      block('e1'),
      // Stored with no `display`: a block is drawn as display all the same.
      block('e2', SQUARED, false),
      para('b2', text('As shown.')),
    ]);
    const [numbered, unnumbered] = [
      ...view.dom.querySelectorAll<HTMLElement>('.aw-equation-block'),
    ];
    const math = numbered!.querySelector('math')!;
    expect(math.namespaceURI).toBe(NS);
    expect(math.getAttribute('alttext')).toBe('E equals m c squared');
    expect(math.getAttribute('display')).toBe('block');
    const marker = numbered!.querySelector('.aw-equation-number')!;
    expect(marker).toHaveTextContent('(#)');
    expect(marker).toHaveAttribute('aria-label', 'Numbered');

    expect(unnumbered!.querySelector('math')!.getAttribute('display')).toBe('block');
    expect(unnumbered!.querySelector('.aw-equation-number')).toBeNull();
  });

  it('draws an equation with no alternative marked, in words a screen reader hears', () => {
    const { view } = mount([para('b1', inline(UNSPOKEN)), block('e1', UNSPOKEN)]);
    for (const holder of view.dom.querySelectorAll<HTMLElement>(
      '.aw-equation, .aw-equation-block',
    )) {
      expect(holder).toHaveClass('aw-equation-undescribed');
      expect(holder.querySelector('math')!.namespaceURI).toBe(NS);
      expect(holder.querySelector('math')!.hasAttribute('aria-label')).toBe(false);
      expect(holder.querySelector('.aw-equation-undescribed-marker')).toHaveTextContent(
        /^No description$/,
      );
    }
  });

  it('draws anything the MathML reader would not keep as a marked stand-in, never as live elements', () => {
    const hostile = [
      // Not MathML at all.
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      // HTML, which is not even XML.
      '<img src="x" onerror="alert(1)">',
      // MathML, with an event handler the reader removes.
      `<math xmlns="${NS}"><mi onclick="alert(1)">x</mi></math>`,
      // MathML, holding a script from another namespace.
      `<math xmlns="${NS}"><mtext><script xmlns="http://www.w3.org/1999/xhtml">alert(1)</script></mtext></math>`,
      // MathML cut short.
      `<math xmlns="${NS}"><mi>x</mi>`,
    ];
    const { view } = mount([para('b1', text('Where '), inline()), block('e1')]);
    for (const mathml of hostile) {
      // Handed straight to the node, past the reader that judges everything stored.
      for (const type of ['equation', 'equationBlock']) {
        const pos = find(view, type);
        const node = view.state.doc.nodeAt(pos)!;
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, mathml }));
      }
      for (const holder of view.dom.querySelectorAll<HTMLElement>(
        '.aw-equation, .aw-equation-block',
      )) {
        expect(holder).toHaveClass('aw-equation-unshown');
        expect(holder).toHaveTextContent(/^An equation that cannot be shown/);
      }
      // ProseMirror's own separator after an inline node is the only image on the surface.
      expect(
        view.dom.querySelector('math, svg, script, img:not(.ProseMirror-separator)'),
      ).toBeNull();
      const handlers = [...view.dom.querySelectorAll('*')].filter((each) =>
        each.getAttributeNames().some((name) => name.startsWith('on')),
      );
      expect(handlers).toEqual([]);
    }
  });

  it('shows an equation selected whole, and takes Enter over it to open it rather than split its text', () => {
    const { view, prompted } = mount([
      para('b1', text('Where '), inline(), text(' grows.')),
      block('e1'),
      para('b2', text('As shown.')),
    ]);
    const before = view.state.doc;
    for (const [type, selector] of [
      ['equation', '.aw-equation'],
      ['equationBlock', '.aw-equation-block'],
    ] as const) {
      select(view, find(view, type));
      const holder = view.dom.querySelector(selector)!;
      expect(holder).toHaveClass('ProseMirror-selectednode');
      fireEvent.keyDown(view.dom, { key: 'Enter', keyCode: 13 });
      expect(view.state.doc.eq(before)).toBe(true);
      expect(view.state.selection).toBeInstanceOf(NodeSelection);

      select(view, 1);
      expect(holder).not.toHaveClass('ProseMirror-selectednode');
    }
    expect(prompted).toEqual(['equation', 'equation']);
  });

  it('puts a gap cursor past a block equation that ends the component, changing nothing, where typing makes a named paragraph', () => {
    const { view } = mount([block('e1')]);
    const before = view.state.doc;
    select(view, 0);
    fireEvent.keyDown(view.dom, { key: 'ArrowDown', keyCode: 40 });
    expect(view.state.selection.toJSON()).toEqual({ type: 'gapcursor', pos: before.content.size });
    expect(view.state.doc.eq(before)).toBe(true);
    expect(view.dom.querySelector('.ProseMirror-gapcursor')).not.toBeNull();

    typeInto(view, 'A');
    expect(shape(view)).toEqual(['equationBlock', 'p:A']);
    // Named by the identity plugin as any new block is, and storable where it landed.
    expect(view.state.doc.lastChild!.attrs.id).toEqual(expect.any(String));
    expect(() => fromEditor(view.state.doc)).not.toThrow();

    // And before one that begins it, by the arrow pointing that way.
    const after = view.state.doc;
    select(view, 0);
    fireEvent.keyDown(view.dom, { key: 'ArrowUp', keyCode: 38 });
    expect(view.state.selection.toJSON()).toEqual({ type: 'gapcursor', pos: 0 });
    expect(view.state.doc.eq(after)).toBe(true);
    typeInto(view, 'B');
    expect(shape(view)).toEqual(['p:B', 'equationBlock', 'p:A']);
    expect(view.state.doc.firstChild!.attrs.id).toEqual(expect.any(String));
  });

  it('puts a gap cursor between two block equations, and leaves the arrows alone where text stands beyond one', () => {
    const { view } = mount([para('b1', text('Energy:')), block('e1'), block('e2'), para('b2')]);
    const before = view.state.doc;
    const first = find(view, 'equationBlock');
    select(view, first);
    fireEvent.keyDown(view.dom, { key: 'ArrowRight', keyCode: 39 });
    const between = first + view.state.doc.nodeAt(first)!.nodeSize;
    expect(view.state.selection.toJSON()).toEqual({ type: 'gapcursor', pos: between });

    // After the second there is a paragraph to stand in, so no gap is made there.
    select(view, between);
    fireEvent.keyDown(view.dom, { key: 'ArrowDown', keyCode: 40 });
    expect(view.state.selection.toJSON().type).not.toBe('gapcursor');
    expect(view.state.doc.eq(before)).toBe(true);
  });

  it("is drawn the same in a footnote's open editor, where Enter over it opens it too", () => {
    const { view, prompted } = mount([
      para('b1', text('Visited'), {
        type: 'footnote',
        id: 'f1',
        anchor: { kind: 'span' },
        content: [para('fp1', text('Where '), inline(), text(' grows.'))],
      }),
    ]);
    select(view, find(view, 'footnote'));
    const inner = openFootnote(view)!;
    const math = inner.dom.querySelector('.aw-equation math')!;
    expect(math.namespaceURI).toBe(NS);
    expect(math.getAttribute('alttext')).toBe('x squared');

    const before = view.state.doc;
    select(inner, find(inner, 'equation'));
    expect(inner.dom.querySelector('.aw-equation')).toHaveClass('ProseMirror-selectednode');
    fireEvent.keyDown(inner.dom, { key: 'Enter', keyCode: 13 });
    expect(view.state.doc.eq(before)).toBe(true);
    expect(prompted).toEqual(['equation']);
  });
});
