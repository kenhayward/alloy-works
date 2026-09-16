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

  it('CNT-027 carries a target and a display kind on a cross-reference, and no number', () => {
    const node = inlineNodeSchema.parse({
      type: 'crossReference',
      target: 'b7',
      display: 'numberAndTitle',
    });
    expect(node).toEqual({ type: 'crossReference', target: 'b7', display: 'numberAndTitle' });
    expect(() =>
      inlineNodeSchema.parse({
        type: 'crossReference',
        target: 'b7',
        display: 'number',
        number: 3,
      }),
    ).toThrow();
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

  it('CNT-123 refuses a dimension on an inline image', () => {
    const ok = {
      type: 'image',
      asset: 'asset-1',
      imageStyle: 'inline',
      alternative: { kind: 'decorative' },
    };
    expect(inlineNodeSchema.parse(ok).type).toBe('image');
    expect(() => inlineNodeSchema.parse({ ...ok, width: 120 })).toThrow();
  });
});
