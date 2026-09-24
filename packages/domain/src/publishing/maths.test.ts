import { describe, expect, it } from 'vitest';

import { MATHML_NAMESPACE, withAlternative } from '../content/admission/mathml.js';
import { temmlOutput } from '../content/admission/temml.fixture.js';
import { admitTemmlMathml } from '../content/admission/temml.js';
import { mathsTree, type MathsNode, type MathsTree } from './maths.js';

/** U+2061 FUNCTION APPLICATION, invisible, so built rather than typed. */
const APPLIED = String.fromCodePoint(0x2061);

const math = (inner: string, attributes = '') =>
  `<math xmlns="${MATHML_NAMESPACE}"${attributes}>${inner}</math>`;

/** A fixture as the editor stores it: Temml's output through `admitTemmlMathml`. */
const stored = (name: string, form: 'inline' | 'block'): string => {
  const fixture = temmlOutput().find((each) => each.name === name);
  const output = fixture?.[form];
  if (output === undefined) throw new Error(`no ${form} fixture named ${name}`);
  const admitted = admitTemmlMathml(output);
  if (!admitted.ok) throw new Error(`the fixture ${name} is not admitted`);
  return admitted.mathml;
};

const treeOf = (mathml: string): MathsNode => {
  const converted = mathsTree(mathml);
  if (!converted.ok) throw new Error(`expected a tree, got: ${JSON.stringify(converted)}`);
  return converted.tree;
};

// The tree's nodes, spelled short.
const row = (...c: MathsNode[]): MathsNode => ({ k: 'row', c });
const i = (t: string, v: 'italic' | 'upright' = 'italic'): MathsNode => ({ k: 'i', t, v });
const n = (t: string): MathsNode => ({ k: 'n', t });
const o = (t: string): MathsNode => ({ k: 'o', t });
const text = (t: string): MathsNode => ({ k: 'text', t });
const space = (em: number): MathsNode => ({ k: 'space', em });
const paren = (...inside: MathsNode[]) => row(o('('), ...inside, o(')'));

describe('the maths tree, from what the editor stores', () => {
  it('converts every equation Temml writes that the editor admits, inline and block', () => {
    const refused: string[] = [];
    let converted = 0;
    for (const fixture of temmlOutput()) {
      for (const output of [fixture.inline, fixture.block]) {
        if (output === undefined) continue;
        const admitted = admitTemmlMathml(output);
        if (!admitted.ok) continue;
        const result = mathsTree(admitted.mathml);
        if (result.ok) converted += 1;
        else refused.push(`${fixture.name}: ${JSON.stringify(result)}`);
      }
    }
    expect(refused).toEqual([]);
    // Every fixture the editor admits: the count moves only when somebody adds one. A strut alone is
    // not among them, since it draws nothing (the final review of equations 2, M1).
    expect(converted).toBe(66);
  });

  it('sets a fraction over its numerator and denominator', () => {
    expect(treeOf(stored('fraction', 'inline'))).toEqual({
      k: 'frac',
      n: row(i('a'), o('+'), i('b')),
      d: i('c'),
    });
  });

  it('sets a sum in a display equation with its limits above and below, and inline beside it', () => {
    const quotient: MathsNode = {
      k: 'frac',
      n: row(i('n'), paren(i('n'), o('+'), n('1'))),
      d: n('2'),
    };
    const bounds = { b: row(i('i'), o('='), n('1')), t: i('n') };
    expect(treeOf(stored('sum with limits', 'block'))).toEqual(
      row(
        { k: 'attach', mode: 'limits', base: o('\u{2211}'), ...bounds },
        i('i'),
        o('='),
        quotient,
      ),
    );
    expect(treeOf(stored('sum with limits', 'inline'))).toEqual(
      row(
        { k: 'attach', mode: 'scripts', base: o('\u{2211}'), ...bounds },
        i('i'),
        o('='),
        quotient,
      ),
    );
  });

  it('sets an integral with its scripts, a thin space and a root holding a strut', () => {
    expect(treeOf(stored('integral', 'block'))).toEqual(
      row(
        { k: 'attach', mode: 'scripts', base: o('\u{222B}'), b: n('0'), t: i('\u{221E}') },
        {
          k: 'attach',
          mode: 'scripts',
          base: i('e'),
          t: row(o('\u{2212}'), { k: 'attach', mode: 'scripts', base: i('x'), t: n('2') }),
        },
        space(0.1667),
        i('d'),
        i('x'),
        o('='),
        { k: 'frac', n: { k: 'sqrt', body: row(i('\u{3C0}'), space(0)) }, d: n('2') },
      ),
    );
  });

  it('sets a matrix in its brackets, its columns centred', () => {
    expect(treeOf(stored('matrix', 'block'))).toEqual(
      row(i('A'), o('='), {
        k: 'mat',
        open: '(',
        close: ')',
        rows: [
          [i('a'), i('b')],
          [i('c'), i('d')],
        ],
        columns: ['center', 'center'],
        display: false,
      }),
    );
  });

  it('sets cases with the alignment the editor kept', () => {
    const cases: MathsNode = {
      k: 'cases',
      rows: [
        [i('x'), row(i('x'), o('\u{2265}'), n('0'))],
        [row(o('\u{2212}'), i('x')), text('otherwise')],
      ],
      columns: ['left', 'left'],
    };
    expect(treeOf(stored('cases', 'block'))).toEqual(row(i('f'), paren(i('x')), o('='), cases));
    expect(treeOf(stored('cases alone', 'block'))).toMatchObject({
      k: 'cases',
      columns: ['left', 'left'],
    });
  });

  it('sets aligned rows as a display table, right then left', () => {
    expect(treeOf(stored('aligned', 'block'))).toEqual({
      k: 'mat',
      open: '',
      close: '',
      rows: [
        [i('a'), row(o('='), i('b'), o('+'), i('c'))],
        [i('d'), row(o('='), i('e'))],
      ],
      columns: ['right', 'left'],
      display: true,
    });
    expect(treeOf(stored('array lr', 'block'))).toMatchObject({
      k: 'mat',
      columns: ['left', 'right'],
      display: false,
    });
  });

  it('sets each accent over its base, a bar among them', () => {
    const accent = (base: string, a: string): MathsNode => ({ k: 'accent', body: i(base), a });
    expect(treeOf(stored('accents', 'block'))).toEqual(
      row(
        accent('x', '\u{2C6}'),
        o('+'),
        accent('y', '\u{203E}'),
        o('+'),
        accent('v', '\u{2192}'),
        o('+'),
        accent('a', '\u{2D9}'),
        o('+'),
        accent('n', '~'),
      ),
    );
    expect(treeOf(stored('bar', 'block'))).toEqual({ k: 'accent', body: i('x'), a: '\u{203E}' });
  });

  it('sets an overline and an underline as equations 1 stored them, stretched, as lines', () => {
    expect(treeOf(stored('overline', 'block'))).toEqual({
      k: 'line',
      which: 'overline',
      body: i('z'),
    });
    expect(treeOf(stored('underline', 'block'))).toEqual({
      k: 'line',
      which: 'underline',
      body: row(i('x'), o('+'), i('y')),
    });
    expect(treeOf(stored('overline twice', 'block'))).toEqual({
      k: 'line',
      which: 'overline',
      body: { k: 'line', which: 'overline', body: i('x') },
    });
  });

  it('sets a brace under its content with its label beneath', () => {
    expect(treeOf(stored('underbrace', 'block'))).toEqual(
      row(
        { k: 'brace', which: 'underbrace', body: row(i('a'), o('+'), i('b')), label: i('n') },
        o('+'),
        { k: 'line', which: 'overline', body: i('z') },
      ),
    );
    expect(
      treeOf(
        math(`<mover><mover><mi>a</mi><mo stretchy="true">\u{23DE}</mo></mover><mi>n</mi></mover>`),
      ),
    ).toEqual({ k: 'brace', which: 'overbrace', body: i('a'), label: i('n') });
    expect(treeOf(math(`<munder><mi>a</mi><mo stretchy="true">\u{23B5}</mo></munder>`))).toEqual({
      k: 'brace',
      which: 'underbracket',
      body: i('a'),
    });
    // A brace's character on the other side is only a script: no brace there to draw.
    expect(treeOf(math(`<mover><mi>a</mi><mo>\u{23DF}</mo></mover>`))).toEqual({
      k: 'attach',
      mode: 'limits',
      base: i('a'),
      t: o('\u{23DF}'),
    });
  });

  it('sets primes as primes, counted, never as operators one after another', () => {
    const primed = (base: string, count: number): MathsNode => ({
      k: 'attach',
      mode: 'scripts',
      base: i(base),
      t: { k: 'primes', count },
    });
    expect(treeOf(stored('primes', 'block'))).toEqual(
      row(primed('f', 1), paren(i('x')), o('+'), primed('g', 2), paren(i('x'))),
    );
    // A double prime written as one character counts two, and a subscript stays beside it.
    expect(
      treeOf(
        math(
          `<msubsup><mi>x</mi><mi>i</mi><mrow><mo>\u{2033}</mo><mo>\u{2032}</mo></mrow></msubsup>`,
        ),
      ),
    ).toEqual({
      k: 'attach',
      mode: 'scripts',
      base: i('x'),
      b: i('i'),
      t: { k: 'primes', count: 3 },
    });
    // A prime beside anything else is a script like any other.
    expect(treeOf(math(`<msup><mi>f</mi><mrow><mo>\u{2032}</mo><mn>2</mn></mrow></msup>`))).toEqual(
      { k: 'attach', mode: 'scripts', base: i('f'), t: row(o('\u{2032}'), n('2')) },
    );
  });

  it('sets a named operator upright as an operator, with limits where its name takes them', () => {
    const thin = space(0.1667);
    expect(treeOf(stored('operatorname', 'block'))).toEqual(
      row(
        {
          k: 'attach',
          mode: 'scripts',
          base: { k: 'op', t: 'argmax', limits: true },
          b: i('x'),
        },
        thin,
        i('f'),
        paren(i('x')),
        o('+'),
        row({ k: 'op', t: 'sin', limits: false }, thin),
        i('x'),
        o('+'),
        {
          k: 'attach',
          mode: 'limits',
          base: { k: 'op', t: 'lim', limits: true },
          b: row(i('n'), o('\u{2192}'), i('\u{221E}')),
        },
        thin,
        { k: 'attach', mode: 'scripts', base: i('a'), b: i('n') },
      ),
    );
    // Temml spells the two-word names with a space between.
    for (const name of ['lim inf', 'lim sup', 'arg max', 'arg min', 'inj lim', 'proj lim']) {
      expect(treeOf(math(`<mrow><mi>${name}</mi><mo>${APPLIED}</mo><mi>a</mi></mrow>`))).toEqual(
        row({ k: 'op', t: name, limits: true }, i('a')),
      );
    }
  });

  it('sets a double-struck letter Temml wrote as its own character, and a variant it named', () => {
    expect(treeOf(stored('mathbb', 'block'))).toEqual(
      row(
        i('x'),
        o('\u{2208}'),
        i('\u{211D}'),
        o(','),
        space(0.2778),
        i('\u{1D49C}'),
        o('\u{2286}'),
        i('\u{2115}'),
      ),
    );
    expect(treeOf(math(`<mi mathvariant="double-struck">R</mi>`))).toEqual({
      k: 'i',
      t: 'R',
      v: 'bb',
    });
  });

  it('sets text as it was written, its spaces kept', () => {
    // Temml writes the spaces of `\text{ if }` as no-break spaces, and they stay what they are.
    const noBreak = String.fromCodePoint(0xa0);
    expect(treeOf(stored('text', 'block'))).toEqual(
      row(i('x'), o('='), n('1'), text(`${noBreak}if${noBreak}`), i('y'), o('>'), n('0')),
    );
  });

  it('sets a binomial, and a fraction with no line outside brackets as a stack', () => {
    expect(treeOf(stored('binom', 'block'))).toEqual({ k: 'binom', n: i('n'), d: i('k') });
    expect(treeOf(math(`<mfrac linethickness="0"><mi>a</mi><mi>b</mi></mfrac>`))).toEqual({
      k: 'stack',
      n: i('a'),
      d: i('b'),
    });
  });

  it('sets a root with its index and a square root', () => {
    expect(treeOf(stored('root', 'block'))).toEqual(
      row({ k: 'root', index: n('3'), body: row(i('x'), space(0)) }, o('+'), {
        k: 'sqrt',
        body: row({ k: 'attach', mode: 'scripts', base: i('x'), t: n('2') }, o('+'), n('1')),
      }),
    );
  });

  it('sets scripts on nothing, and fences that stretch with a stretchy bar between', () => {
    expect(treeOf(stored('subsup', 'block'))).toEqual(
      row(
        { k: 'attach', mode: 'scripts', base: i('x'), b: i('i'), t: n('2') },
        o('+'),
        { k: 'attach', mode: 'scripts', base: row(), b: i('a'), t: i('b') },
        i('X'),
      ),
    );
    expect(treeOf(stored('left right', 'block'))).toEqual(
      row(
        {
          k: 'attach',
          mode: 'scripts',
          base: { k: 'lr', open: '(', close: ')', body: { k: 'frac', n: i('x'), d: i('y') } },
          t: n('2'),
        },
        o('+'),
        { k: 'lr', open: '{', close: '}', body: row(i('a'), { k: 'mid', t: '|' }, i('b')) },
      ),
    );
  });
});

describe('the maths tree, identifiers', () => {
  it('sets one character italic and more than one upright, as MathML Core does', () => {
    expect(treeOf(math('<mi>x</mi>'))).toEqual(i('x'));
    expect(treeOf(math('<mi>abc</mi>'))).toEqual(i('abc', 'upright'));
    // One character to a reader: a letter and the accent combined with it.
    expect(treeOf(math('<mi>x&#x302;</mi>'))).toEqual(i('x\u{302}'));
  });

  it('sets each variant MathML names', () => {
    const variants: Record<string, string> = {
      normal: 'upright',
      italic: 'italic',
      bold: 'bold',
      'bold-italic': 'bold-italic',
      'double-struck': 'bb',
      script: 'cal',
      fraktur: 'frak',
      'sans-serif': 'sans',
      monospace: 'mono',
    };
    for (const [mathvariant, v] of Object.entries(variants)) {
      expect(treeOf(math(`<mi mathvariant="${mathvariant}">x</mi>`))).toEqual({
        k: 'i',
        t: 'x',
        v,
      });
    }
  });

  it('drops the characters that only say where a line may break, inside any token', () => {
    // U+200B ZERO WIDTH SPACE, U+00AD SOFT HYPHEN, U+2060 WORD JOINER and U+FEFF, its older spelling:
    // the engine never breaks a line inside a token, and set there each takes the letter before it
    // out of the PDF's text (the final review of equations 2, M2). Written as references, since
    // none of them would survive being typed.
    expect(treeOf(math('<mi>ab&#x200B;cd</mi>'))).toEqual(i('abcd', 'upright'));
    expect(treeOf(math('<mtext>pq&#xAD;rs</mtext>'))).toEqual(text('pqrs'));
    expect(treeOf(math('<mrow><mi>a</mi><mo>&#x2060;</mo><mn>1&#xFEFF;2</mn></mrow>'))).toEqual(
      row(i('a'), n('12')),
    );
    // What is left is counted as MathML Core counts it: one letter is italic.
    expect(treeOf(math('<mi>x&#x200B;</mi>'))).toEqual(i('x'));
  });

  it('drops an empty identifier and an invisible operator, and sets a large operator large', () => {
    expect(treeOf(math(`<mrow><mi></mi><mi>a</mi><mo>\u{2062}</mo><mi>b</mi></mrow>`))).toEqual(
      row(i('a'), i('b')),
    );
    expect(treeOf(math(`<mo largeop="true">\u{22C3}</mo>`))).toEqual({
      k: 'o',
      t: '\u{22C3}',
      large: true,
    });
  });
});

describe('the maths tree, the rest of what it maps', () => {
  it('sets limits that move beside the operator in running text where MathML says they may', () => {
    expect(
      treeOf(
        math(`<munderover><mo movablelimits="true">\u{2211}</mo><mi>a</mi><mi>b</mi></munderover>`),
      ),
    ).toEqual({ k: 'attach', mode: 'limits-display', base: o('\u{2211}'), b: i('a'), t: i('b') });
  });

  it('sets a script MathML says is no accent as a script, and any stretchy operator between fences', () => {
    expect(treeOf(math(`<mover accent="false"><mi>x</mi><mo>\u{2192}</mo></mover>`))).toEqual({
      k: 'attach',
      mode: 'limits',
      base: i('x'),
      t: o('\u{2192}'),
    });
    // `\left( a \middle/ b \right)`, as Temml writes it.
    expect(
      treeOf(
        math(
          '<mrow><mo fence="true" form="prefix" stretchy="true">(</mo><mi>a</mi><mo form="infix" stretchy="true">/</mo><mi>b</mi><mo fence="true" form="postfix" stretchy="true">)</mo></mrow>',
        ),
      ),
    ).toEqual({ k: 'lr', open: '(', close: ')', body: row(i('a'), { k: 'mid', t: '/' }, i('b')) });
  });

  it("sets what MathML sets a script level smaller in the engine's script sizes, as the editor stores it", () => {
    const script = (body: MathsNode): MathsNode => ({ k: 'script', body });
    const bounds = (first: MathsNode, second: MathsNode): MathsNode => ({
      k: 'mat',
      open: '',
      close: '',
      rows: [[first], [second]],
      columns: ['center'],
      display: false,
    });
    // A substack under a sum: its rows at the script level, which a limit is set at anyway.
    expect(treeOf(stored('substack', 'block'))).toEqual(
      row(
        {
          k: 'attach',
          mode: 'limits',
          base: o(String.fromCodePoint(0x2211)),
          b: script(bounds(row(i('i'), o('<'), i('n')), row(i('i'), o('>'), n('0')))),
        },
        { k: 'attach', mode: 'scripts', base: i('a'), b: i('i') },
      ),
    );
    // A subarray the same, its column aligned as it declared.
    expect(treeOf(stored('subarray', 'inline'))).toMatchObject({
      c: [
        { k: 'attach', mode: 'scripts', b: { k: 'script', body: { k: 'mat', columns: ['left'] } } },
        {},
      ],
    });
    // A smallmatrix, a matrix set in running text's size between fences that stretch to it.
    expect(treeOf(stored('smallmatrix', 'inline'))).toEqual({
      k: 'lr',
      open: '(',
      close: ')',
      body: script({
        k: 'mat',
        open: '',
        close: '',
        rows: [
          [i('a'), i('b')],
          [i('c'), i('d')],
        ],
        columns: ['center', 'center'],
        display: false,
      }),
    });
    // And the two styles that name a level, one smaller and two.
    const sum = row(i('y'), o('+'), i('z'));
    expect(treeOf(stored('scriptstyle', 'inline'))).toEqual(row(i('x'), o('+'), script(sum)));
    expect(treeOf(stored('scriptscriptstyle', 'block'))).toEqual(
      row(i('x'), o('+'), { k: 'sscript', body: sum }),
    );
  });

  it("aligns a column by its table's list, its last entry repeated, where its cells say nothing", () => {
    expect(
      treeOf(
        math(
          '<mtable columnalign="left right"><mtr><mtd><mi>a</mi></mtd><mtd><mi>b</mi></mtd><mtd><mi>c</mi></mtd></mtr></mtable>',
        ),
      ),
    ).toMatchObject({ k: 'mat', columns: ['left', 'right', 'right'] });
  });

  it('sets scripts before and after a base, one pair a side, leaving out none', () => {
    expect(
      treeOf(
        math(
          '<mmultiscripts><mi>X</mi><mi>a</mi><none/><mprescripts/><mn>1</mn><mn>2</mn></mmultiscripts>',
        ),
      ),
    ).toEqual({ k: 'attach', mode: 'scripts', base: i('X'), br: i('a'), bl: n('1'), tl: n('2') });
  });

  it('sets display and inline style, a phantom, a string, and spaces in each unit', () => {
    expect(treeOf(math('<mstyle displaystyle="true" scriptlevel="0"><mi>x</mi></mstyle>'))).toEqual(
      { k: 'display', body: i('x') },
    );
    expect(treeOf(math('<mstyle displaystyle="false"><mi>x</mi></mstyle>'))).toEqual({
      k: 'inline',
      body: i('x'),
    });
    // A phantom and a space beside something that shows: alone, each is an equation that draws
    // nothing, which is refused.
    expect(treeOf(math('<mrow><mphantom><mi>x</mi></mphantom><mi>y</mi></mrow>'))).toEqual(
      row({ k: 'phantom', body: i('x') }, i('y')),
    );
    expect(treeOf(math('<ms>a b</ms>'))).toEqual(text('"a b"'));
    const widths = ['1em', '2ex', '11pt', '22px', '18mu', '-0.5em'].map((width) =>
      treeOf(math(`<mrow><mspace width="${width}"/><mi>y</mi></mrow>`)),
    );
    expect(widths).toEqual(
      [space(1), space(0.9), space(1), space(1.5), space(1), space(-0.5)].map((each) =>
        row(each, i('y')),
      ),
    );
  });

  it('keeps what a padded box holds and the first presentation of an annotated one', () => {
    expect(treeOf(math('<mpadded lspace="0" width="0"><mi>mod</mi></mpadded>'))).toEqual(
      i('mod', 'upright'),
    );
    expect(
      treeOf(
        math(
          '<semantics><mi>x</mi><annotation encoding="application/x-tex">x</annotation></semantics>',
        ),
      ),
    ).toEqual(i('x'));
  });

  it('reads the alternative from the alttext, and none where it says nothing', () => {
    const fraction = stored('fraction', 'block');
    const read = (mathml: string | null) => {
      const converted = mathsTree(mathml!);
      return converted.ok ? converted.alternative : 'refused';
    };
    expect(read(withAlternative(fraction, 'a plus b over c'))).toBe('a plus b over c');
    expect(read(fraction)).toBeNull();
    expect(read(math('<mi>x</mi>', ' alttext="  "'))).toBeNull();
  });

  it('carries strings the template could mistake for code through as the strings they are', () => {
    const strings = ['#read("/etc/passwd")', '$', '\\', '#panic("x")', '@ref <label>', '*bold*'];
    const escaped = (value: string) =>
      value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    for (const value of strings) {
      const inside = escaped(value);
      const tree: MathsTree = treeOf(
        math(
          `<mrow><mi>${inside}</mi><mo>${inside}</mo><mtext>${inside}</mtext><mn>${inside}</mn></mrow>`,
        ),
      );
      const identifier = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(value)]
        .length;
      expect(tree).toEqual(
        row(i(value, identifier === 1 ? 'italic' : 'upright'), o(value), text(value), n(value)),
      );
    }
  });
});

describe('the maths tree, what it refuses', () => {
  const refusal = (mathml: string) => {
    const converted = mathsTree(mathml);
    if (converted.ok) throw new Error(`expected a refusal, got: ${JSON.stringify(converted.tree)}`);
    return converted;
  };

  it('refuses an error the converter that wrote the MathML reported', () => {
    expect(refusal(math('<mrow><mi>x</mi><merror><mtext>bad</mtext></merror></mrow>'))).toEqual({
      ok: false,
      reason: 'error',
    });
  });

  it('refuses maths set right to left, on the equation or anywhere in it', () => {
    expect(refusal(math('<mi>x</mi>', ' dir="rtl"'))).toEqual({ ok: false, reason: 'rightToLeft' });
    expect(refusal(math('<mrow dir="rtl"><mi>x</mi><mi>y</mi></mrow>'))).toEqual({
      ok: false,
      reason: 'rightToLeft',
    });
  });

  it('refuses more than one pair of scripts on a side', () => {
    expect(
      refusal(
        math('<mmultiscripts><mi>X</mi><mi>a</mi><mi>b</mi><mi>c</mi><mi>d</mi></mmultiscripts>'),
      ),
    ).toEqual({ ok: false, reason: 'scripts' });
    expect(
      refusal(
        math(
          '<mmultiscripts><mi>X</mi><mprescripts/><mi>a</mi><mi>b</mi><mi>c</mi><mi>d</mi></mmultiscripts>',
        ),
      ),
    ).toEqual({ ok: false, reason: 'scripts' });
  });

  it('refuses a box moved up or down', () => {
    expect(refusal(math('<mpadded voffset="0.5em"><mi>x</mi></mpadded>'))).toEqual({
      ok: false,
      reason: 'offset',
    });
  });

  it('refuses a table cell spanning others', () => {
    const table = (cell: string) =>
      math(`<mtable><mtr>${cell}<mtd><mi>b</mi></mtd></mtr></mtable>`);
    expect(refusal(table('<mtd columnspan="2"><mi>a</mi></mtd>'))).toEqual({
      ok: false,
      reason: 'spanningCell',
    });
    expect(refusal(table('<mtd rowspan="2"><mi>a</mi></mtd>'))).toEqual({
      ok: false,
      reason: 'spanningCell',
    });
  });

  it('refuses a variant it does not know', () => {
    expect(refusal(math('<mi mathvariant="bold-fraktur">x</mi>'))).toEqual({
      ok: false,
      reason: 'variant',
      variant: 'bold-fraktur',
    });
  });

  it('refuses an element it does not map, or one standing where it cannot', () => {
    expect(refusal(math('<menclose notation="box"><mi>x</mi></menclose>'))).toEqual({
      ok: false,
      reason: 'element',
      element: 'menclose',
    });
    expect(refusal(math('<mrow><mtd><mi>x</mi></mtd></mrow>'))).toEqual({
      ok: false,
      reason: 'element',
      element: 'mtd',
    });
    expect(refusal(math('<mfrac><mi>a</mi></mfrac>'))).toEqual({
      ok: false,
      reason: 'element',
      element: 'mfrac',
    });
    expect(refusal(`<mrow xmlns="${MATHML_NAMESPACE}"><mi>x</mi></mrow>`)).toEqual({
      ok: false,
      reason: 'element',
      element: 'mrow',
    });
  });

  it('refuses an attribute it does not map on the element it stands on', () => {
    expect(refusal(math('<mfrac displaystyle="true"><mi>a</mi><mi>b</mi></mfrac>'))).toEqual({
      ok: false,
      reason: 'attribute',
      element: 'mfrac',
      attribute: 'displaystyle',
    });
    expect(refusal(math('<mn mathvariant="bold">1</mn>'))).toEqual({
      ok: false,
      reason: 'attribute',
      element: 'mn',
      attribute: 'mathvariant',
    });
    expect(refusal(math('<mi class="x">a</mi>'))).toEqual({
      ok: false,
      reason: 'attribute',
      element: 'mi',
      attribute: 'class',
    });
    // A value it has no mapping for is refused as the attribute is: a level counted from the one
    // around it, a third level the engine has no size for, and a smaller level in display style.
    for (const style of [
      'scriptlevel="+1"',
      'scriptlevel="3"',
      'scriptlevel="1" displaystyle="true"',
    ]) {
      expect(refusal(math(`<mstyle ${style}><mi>a</mi></mstyle>`)), style).toEqual({
        ok: false,
        reason: 'attribute',
        element: 'mstyle',
        attribute: 'scriptlevel',
      });
    }
    expect(refusal(math('<mspace width="1fill"/>'))).toEqual({
      ok: false,
      reason: 'attribute',
      element: 'mspace',
      attribute: 'width',
    });
    expect(
      refusal(
        math(
          '<mtable><mtr><mtd columnalign="left"><mi>a</mi></mtd></mtr><mtr><mtd columnalign="right"><mi>b</mi></mtd></mtr></mtable>',
        ),
      ),
    ).toEqual({ ok: false, reason: 'attribute', element: 'mtd', attribute: 'columnalign' });
  });

  it('refuses a space too wide to be set on any line, and one too wide to be a number', () => {
    // Twenty ems either way: ten times a qquad, the widest space LaTeX names, and about half the line
    // the default layout gives - a space wider takes the equation off the line. Four hundred nines is
    // a length no number holds, which JSON would write as nothing at all (the final review of
    // equations 2, I1).
    const spaced = (width: string) =>
      math(`<mrow><mi>a</mi><mspace width="${width}"/><mi>b</mi></mrow>`);
    for (const width of ['20.01em', '-21em', '221pt', `${'9'.repeat(400)}em`, '1000']) {
      expect(refusal(spaced(width)), width).toEqual({ ok: false, reason: 'space' });
    }
    for (const width of ['20em', '-20em', '220pt']) {
      expect(mathsTree(spaced(width)).ok, width).toBe(true);
    }
  });

  it('refuses an accent that is more than one character, and sets one that composes to one', () => {
    // x and U+0302, which no single character composes: one grapheme, and so an accent by its looks,
    // but two characters, and the engine's accent takes exactly one (the final review, I1).
    expect(refusal(math('<mover accent="true"><mi>y</mi><mo>x&#x302;</mo></mover>'))).toEqual({
      ok: false,
      reason: 'accent',
    });
    // a and U+0302 compose to U+00E2, one character, which is set.
    expect(treeOf(math('<mover accent="true"><mi>y</mi><mo>a&#x302;</mo></mover>'))).toEqual({
      k: 'accent',
      body: i('y'),
      a: String.fromCodePoint(0xe2),
    });
  });

  it('refuses an equation that draws nothing, since nothing would be tagged to carry its words', () => {
    // No token that shows anywhere in it: nothing, spaces, empty text, a fraction or a root of
    // nothing, a table of nothing, scripts on nothing, a phantom, an invisible operator (the final
    // review of equations 2, M1).
    for (const inner of [
      '<mrow></mrow>',
      '<mspace width="0.1667em"/>',
      '<mtext> </mtext>',
      '<mtext>&#xA0;&#x2003;</mtext>',
      '<mfrac><mrow></mrow><mrow></mrow></mfrac>',
      '<msqrt><mrow></mrow></msqrt>',
      '<mtable></mtable>',
      '<mtable><mtr><mtd></mtd></mtr></mtable>',
      '<msup><mrow></mrow><mrow></mrow></msup>',
      '<mphantom><mi>x</mi></mphantom>',
      '<mo>&#x2062;</mo>',
      '<mi>&#x200B;</mi>',
      '<semantics><mrow></mrow><annotation encoding="application/x-tex">x</annotation></semantics>',
    ]) {
      expect(refusal(math(inner)), inner).toEqual({ ok: false, reason: 'empty' });
    }
    // One thing that shows is enough: a fence, a string's quotation marks, a prime.
    for (const inner of [
      '<mrow><mo fence="true" stretchy="true">(</mo><mo fence="true" stretchy="true">)</mo></mrow>',
      '<ms></ms>',
      '<msup><mrow></mrow><mo>&#x2032;</mo></msup>',
    ]) {
      expect(mathsTree(math(inner)).ok, inner).toBe(true);
    }
  });

  it('refuses text standing outside a token, and MathML the reader cannot read', () => {
    expect(refusal(math('<mrow>x<mi>y</mi></mrow>'))).toEqual({
      ok: false,
      reason: 'text',
      element: 'mrow',
    });
    expect(refusal('<math><mi>x</mi>')).toEqual({ ok: false, reason: 'unreadable' });
  });
});
