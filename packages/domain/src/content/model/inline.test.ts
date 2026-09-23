import { describe, expect, it } from 'vitest';

import { MATHML_NAMESPACE } from '../admission/mathml.js';

import { alternativeSchema, inlineNodeSchema } from './inline.js';

const text = (value: string, marks: unknown[] = []) => ({ type: 'text', value, marks });

describe('the inline vocabulary', () => {
  it('CNT-024 makes text the base inline node, carrying marks', () => {
    const node = inlineNodeSchema.parse(text('hello', [{ type: 'strong', id: 'm1' }]));
    expect(node).toMatchObject({ type: 'text', value: 'hello' });
  });

  it('CNT-024 refuses a text node carrying appearance', () => {
    expect(() => inlineNodeSchema.parse({ ...text('hello'), fontSize: 12 })).toThrow();
  });

  it('CNT-027 carries a target identity and a display kind on a cross-reference, and no number or title', () => {
    const node = {
      type: 'crossReference',
      id: 'x1',
      target: { kind: 'block', block: 'b7' },
      display: 'numberAndTitle',
    };
    expect(inlineNodeSchema.parse(node)).toEqual(node);
    expect(() => inlineNodeSchema.parse({ ...node, number: 3 })).toThrow();
    expect(() => inlineNodeSchema.parse({ ...node, title: 'Figure 2' })).toThrow();
  });

  it('CNT-050 makes a citation a reference by identity, with no text member', () => {
    expect(inlineNodeSchema.parse({ type: 'citation', entry: 'bib-4' }).type).toBe('citation');
    expect(() => inlineNodeSchema.parse({ type: 'citation', text: 'Smith 2020' })).toThrow();
  });

  it('CNT-052 lets a citation carry a locator beside its reference', () => {
    expect(
      inlineNodeSchema.parse({ type: 'citation', entry: 'bib-4', locator: 'p. 12' }),
    ).toMatchObject({
      locator: 'p. 12',
    });
  });

  it('CNT-029 carries a name and no value on a variable', () => {
    expect(inlineNodeSchema.parse({ type: 'variable', name: 'productName' }).type).toBe('variable');
    expect(() =>
      inlineNodeSchema.parse({ type: 'variable', name: 'productName', value: 'Alloy' }),
    ).toThrow();
  });

  it('CNT-030 carries a query reference and no value on a binding', () => {
    expect(inlineNodeSchema.parse({ type: 'binding', query: 'q-2' }).type).toBe('binding');
    expect(() => inlineNodeSchema.parse({ type: 'binding', query: 'q-2', value: '42' })).toThrow();
  });

  it('CNT-043 stores an equation as MathML, with the LaTeX typed kept beside it', () => {
    const mathml = `<math xmlns="${MATHML_NAMESPACE}"><mi>x</mi></math>`;
    const node = inlineNodeSchema.parse({ type: 'equation', mathml, latex: 'x' });
    expect(node).toMatchObject({ mathml, latex: 'x' });
  });

  it('CNT-043 refuses an equation with no MathML, whatever else it carries', () => {
    expect(() => inlineNodeSchema.parse({ type: 'equation', latex: 'x' })).toThrow();
  });

  it('CNT-022 and AST-015 make an alternative a three-state, with absent not one of them', () => {
    expect(alternativeSchema.parse({ kind: 'own', text: 'A bar chart' }).kind).toBe('own');
    expect(alternativeSchema.parse({ kind: 'inherited' }).kind).toBe('inherited');
    expect(alternativeSchema.parse({ kind: 'decorative' }).kind).toBe('decorative');
    expect(() => alternativeSchema.parse({ kind: 'own', text: '' })).toThrow();
    expect(() => alternativeSchema.parse({})).toThrow();
  });

  it('names what a cross-reference points at as one of three kinds, and never as a bare string', () => {
    const reference = (target: unknown) => ({
      type: 'crossReference',
      id: 'x1',
      target,
      display: 'number',
    });
    const component = '7c2e9b41-3a6d-4f18-8e05-1d9a4c6b8f27';
    const node = 'a'.repeat(26);
    for (const target of [
      { kind: 'block', block: 'b7' },
      { kind: 'component', component, block: 'b7' },
      { kind: 'node', node },
    ]) {
      expect(inlineNodeSchema.parse(reference(target))).toMatchObject({ target });
    }
    // The bare identifier the node held until now, which resolves against whichever occurrence comes
    // first and says nothing when it is wrong.
    expect(() => inlineNodeSchema.parse(reference('b7'))).toThrow();
    // Closed: no occurrence on a block of this component, which the component cannot know, and no
    // fourth kind.
    expect(() =>
      inlineNodeSchema.parse(reference({ kind: 'block', block: 'b7', occurrence: node })),
    ).toThrow();
    expect(() => inlineNodeSchema.parse(reference({ kind: 'entry', entry: 'bib-1' }))).toThrow();
    // Each identity spelled as the product spells it.
    expect(() =>
      inlineNodeSchema.parse(
        reference({ kind: 'component', component: component.toUpperCase(), block: 'b7' }),
      ),
    ).toThrow();
    expect(() => inlineNodeSchema.parse(reference({ kind: 'node', node: 'Section-4' }))).toThrow();
    expect(() => inlineNodeSchema.parse(reference({ kind: 'block', block: '' }))).toThrow();
  });

  it('gives a cross-reference an identifier of its own, so a failure can name it', () => {
    const target = { kind: 'block', block: 'b7' };
    expect(
      inlineNodeSchema.parse({ type: 'crossReference', id: 'x1', target, display: 'number' }),
    ).toMatchObject({ id: 'x1' });
    expect(() =>
      inlineNodeSchema.parse({ type: 'crossReference', target, display: 'number' }),
    ).toThrow();
    expect(() =>
      inlineNodeSchema.parse({ type: 'crossReference', id: '', target, display: 'number' }),
    ).toThrow();
  });

  it('declares the form a page reference takes where there are no pages, and only on a page reference', () => {
    const reference = (over: Record<string, unknown>) => ({
      type: 'crossReference',
      id: 'x1',
      target: { kind: 'block', block: 'b7' },
      ...over,
    });
    for (const withoutPages of ['number', 'title', 'numberAndTitle']) {
      expect(inlineNodeSchema.parse(reference({ display: 'page', withoutPages }))).toMatchObject({
        withoutPages,
      });
    }
    // Declaring none is a state of its own: the publish fails where there are no pages (STR-055).
    expect(inlineNodeSchema.parse(reference({ display: 'page' }))).not.toHaveProperty(
      'withoutPages',
    );
    // Never a form that needs pages itself, and never on a reference that is not to a page.
    expect(() =>
      inlineNodeSchema.parse(reference({ display: 'page', withoutPages: 'page' })),
    ).toThrow();
    expect(() =>
      inlineNodeSchema.parse(reference({ display: 'page', withoutPages: 'relative' })),
    ).toThrow();
    expect(() =>
      inlineNodeSchema.parse(reference({ display: 'number', withoutPages: 'title' })),
    ).toThrow();
  });

  it('CNT-123 refuses a dimension on an inline image', () => {
    const ok = {
      type: 'image',
      asset: '00000000-0000-4000-8000-00000000a551',
      imageStyle: 'inline',
      alternative: { kind: 'decorative' },
    };
    expect(inlineNodeSchema.parse(ok).type).toBe('image');
    expect(() => inlineNodeSchema.parse({ ...ok, width: 120 })).toThrow();
  });
});
