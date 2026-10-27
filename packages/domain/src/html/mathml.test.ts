import { describe, expect, it } from 'vitest';

import { scanXml } from '../content/ooxml/xml.js';
import { mathsTree, type MathsTree } from '../publishing/maths.js';
import { EVERY_KIND_MATHML } from '../word/omml.fixture.js';

import { mathml } from './mathml.js';

const treeOf = (source: string): MathsTree => {
  const converted = mathsTree(source);
  if (!converted.ok) throw new Error(converted.reason);
  return converted.tree;
};

const math = (body: string) => `<math xmlns="http://www.w3.org/1998/Math/MathML">${body}</math>`;

/** Each element's name and attributes, in order, and the text it holds, checking it is well formed. */
function read(markup: string): { names: string[]; text: string; attributes: string[] } {
  const names: string[] = [];
  const attributes: string[] = [];
  const open: string[] = [];
  let text = '';
  for (const event of scanXml(`<math>${markup}</math>`)) {
    if (event.kind === 'text') text += event.value;
    else if (event.kind === 'close') expect(open.pop()).toBe(event.name);
    else {
      names.push(event.name);
      attributes.push(...Object.keys(event.attrs));
      if (event.kind === 'open') open.push(event.name);
    }
  }
  return { names, text, attributes };
}

/** MathML Core's elements: what a browser lays out as maths (W3C MathML Core, section 3). */
const CORE = new Set([
  'math',
  'mrow',
  'mi',
  'mn',
  'mo',
  'mtext',
  'mspace',
  'mfrac',
  'msqrt',
  'mroot',
  'msub',
  'msup',
  'msubsup',
  'munder',
  'mover',
  'munderover',
  'mmultiscripts',
  'mprescripts',
  'mtable',
  'mtr',
  'mtd',
  'mstyle',
  'mphantom',
]);

describe('the maths tree as MathML Core (the HT plan, HT-H)', () => {
  it('writes every kind of node as MathML Core elements alone, well formed', () => {
    const { names, attributes } = read(mathml(treeOf(EVERY_KIND_MATHML), true));
    expect(names.filter((name) => !CORE.has(name))).toEqual([]);
    for (const name of ['mfrac', 'msqrt', 'mroot', 'mmultiscripts', 'mtable', 'mphantom']) {
      expect(names).toContain(name);
    }
    // Nothing MathML Core does not read but the cells' alignment, a style.
    expect(
      new Set(attributes.filter((each) => !['mathvariant', 'style'].includes(each))),
    ).toEqual(
      new Set([
        'largeop',
        'stretchy',
        'width',
        'linethickness',
        'accent',
        'accentunder',
        'displaystyle',
        'scriptlevel',
      ]),
    );
  });

  it("writes an identifier's variant in Unicode's mathematical letters, a letter upright as normal", () => {
    const written = mathml(
      treeOf(
        math(
          '<mi mathvariant="bold">v</mi><mi mathvariant="double-struck">R</mi><mi>x</mi>' +
            '<mi mathvariant="normal">d</mi><mi mathvariant="script">L</mi>',
        ),
      ),
      false,
    );
    expect(written).toBe(
      '<mrow><mi mathvariant="normal">\u{1D42F}</mi><mi mathvariant="normal">\u{211D}</mi>' +
        '<mi>x</mi><mi mathvariant="normal">d</mi><mi mathvariant="normal">\u{2112}</mi></mrow>',
    );
  });

  it('sets a limit that moves above and below in display style and beside in a line', () => {
    const sum = treeOf(
      math(
        '<munderover><mo movablelimits="true">\u{2211}</mo><mi>i</mi><mi>n</mi></munderover>',
      ),
    );
    expect(read(mathml(sum, true)).names).toContain('munderover');
    expect(read(mathml(sum, false)).names).toContain('msubsup');
  });

  it('escapes every string the tree holds', () => {
    const written = mathml(treeOf(math('<mtext>&lt;script&gt; &amp; "x"</mtext>')), false);
    expect(written).toBe('<mtext>&lt;script&gt; &amp; &quot;x&quot;</mtext>');
  });
});
