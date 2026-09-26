import { describe, expect, it } from 'vitest';

import { scanXml } from '../content/ooxml/xml.js';
import { mathsTree, type MathsNode, type MathsTree } from '../publishing/maths.js';

import { omml, type OmmlOptions } from './omml.js';
import { EVERY_KIND_MATHML } from './omml.fixture.js';

// ---------------------------------------------------------------------------------------------------
// Reading OMML back: the fragment as a tree of elements, and a sketch of its structure.
// ---------------------------------------------------------------------------------------------------

interface Element {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: (Element | string)[];
}

/** The converter's output inside the `m:oMath` the writer puts it in, as a tree. */
function read(tree: MathsTree, options: Partial<OmmlOptions> = {}): Element {
  const xml = omml(tree, { display: true, size: 11, ...options });
  const root: Element = { name: '#root', attrs: {}, children: [] };
  const stack: Element[] = [root];
  for (const event of scanXml(`<m:oMath>${xml}</m:oMath>`)) {
    const top = stack[stack.length - 1]!;
    if (event.kind === 'text') top.children.push(event.value);
    else if (event.kind === 'close') {
      const closed = stack.pop()!;
      if (closed.name !== event.name) throw new Error(`${event.name} closes ${closed.name}`);
    } else {
      const element: Element = { name: event.name, attrs: event.attrs, children: [] };
      top.children.push(element);
      if (event.kind === 'open') stack.push(element);
    }
  }
  if (stack.length !== 1) throw new Error('unclosed element');
  return root.children[0] as Element;
}

const kids = (element: Element, name?: string): Element[] =>
  element.children.filter(
    (child): child is Element =>
      typeof child !== 'string' && (name === undefined || child.name === name),
  );

/** Every element beneath this one with this name, or of any name for `*`, in document order. */
function all(element: Element, name: string): Element[] {
  return kids(element).flatMap((child) => [
    ...(name === '*' || child.name === name ? [child] : []),
    ...all(child, name),
  ]);
}

const first = (element: Element, name: string) => all(element, name)[0];
const value = (element: Element | undefined, name: string) =>
  element === undefined ? undefined : first(element, name)?.attrs['m:val'];
const textOf = (run: Element) =>
  kids(run, 'm:t')
    .map((t) => t.children.join(''))
    .join('');

/**
 * A run as its text in quotes, with what its `m:rPr` says after it in brackets - `'d'[p]`,
 * `'R'[double-struck p]`, `' if '[nor]` - and its size where it states one (`{16}`).
 */
function sketchRun(run: Element): string {
  const properties = kids(run, 'm:rPr')[0];
  const says =
    properties === undefined
      ? []
      : kids(properties).map((each) => each.attrs['m:val'] ?? each.name.slice(2));
  const size = first(run, 'w:sz')?.attrs['w:val'];
  return `'${textOf(run)}'${says.length > 0 ? `[${says.join(' ')}]` : ''}${size === undefined ? '' : `{${size}}`}`;
}

/**
 * An element's structure as a sketch: each OMML object by its name, its arguments in parentheses,
 * every run as `sketchRun` writes it, and the property elements left out - they are read by `value`.
 */
function sketch(element: Element): string {
  return kids(element)
    .filter((child) => !child.name.endsWith('Pr'))
    .map((child) =>
      child.name === 'm:r' ? sketchRun(child) : `${child.name.slice(2)}(${sketch(child)})`,
    )
    .join(' ');
}

const shape = (tree: MathsTree, options: Partial<OmmlOptions> = {}) => sketch(read(tree, options));

// ---------------------------------------------------------------------------------------------------
// Trees, built short.
// ---------------------------------------------------------------------------------------------------

const row = (...c: MathsNode[]): MathsNode => ({ k: 'row', c });
const i = (t: string, v: 'italic' | 'upright' = 'italic'): MathsNode => ({ k: 'i', t, v });
const n = (t: string): MathsNode => ({ k: 'n', t });
const o = (t: string): MathsNode => ({ k: 'o', t });
const space = (em: number): MathsNode => ({ k: 'space', em });
const op = (t: string, limits = false): MathsNode => ({ k: 'op', t, limits });
const SUM = '\u{2211}';
const INTEGRAL = '\u{222B}';

describe('the converter from the maths tree to OMML (Word 4, ruling R3)', () => {
  describe('runs', () => {
    it("sets each identifier's variant as M11 measured: italic, upright, bold and bold italic by style, the rest by script and upright", () => {
      const variants = [
        'italic',
        'upright',
        'bold',
        'bold-italic',
        'bb',
        'cal',
        'frak',
        'sans',
        'mono',
      ] as const;
      const tree = row(...variants.map((v): MathsNode => ({ k: 'i', t: 'x', v })));

      expect(shape(tree)).toBe(
        "'x'[i] 'x'[p] 'x'[b] 'x'[bi] 'x'[double-struck p] 'x'[script p] 'x'[fraktur p] 'x'[sans-serif p] 'x'[monospace p]",
      );
      // CT_RPR is a sequence: the script before the style.
      const [bb] = all(read(tree), 'm:rPr').slice(4);
      expect(kids(bb!).map((each) => each.name)).toEqual(['m:scr', 'm:sty']);
    });

    it('sets a number upright, an operator as its character, and an operator spelled in letters upright', () => {
      expect(shape(row(n('2.5'), o('+'), o('mod')))).toBe("'2.5'[p] '+' 'mod'[p]");
    });

    it("sets text as Word's normal text, its spaces kept, and names no face on any run", () => {
      const equation = read(row(i('x'), { k: 'text', t: ' if ' }, i('y')));

      expect(sketch(equation)).toBe("'x'[i] ' if '[nor] 'y'[i]");
      expect(all(equation, 'm:t').every((t) => t.attrs['xml:space'] === 'preserve')).toBe(true);
      // Cambria Math is m:mathPr's, the writer's (M11): no run says a face.
      expect(all(equation, 'w:rFonts')).toEqual([]);
    });

    it('escapes what it sets, so every string is a value and never markup', () => {
      const strings = ['<m:r>', '&amp;', 'a"b', "'", ']]>'];
      const xml = omml(row(...strings.map((t) => ({ k: 'text', t }) as MathsNode)), {
        display: true,
        size: 11,
      });

      expect(xml).not.toContain('<m:r><m:r>');
      expect(
        all(read(row(...strings.map((t) => ({ k: 'text', t }) as MathsNode))), 'm:r').map(textOf),
      ).toEqual(strings);
    });

    it('sets a space as the space characters Cambria Math has, to the eighteenth of an em, and a negative space as nothing', () => {
      const setOf = (em: number) =>
        all(read(row(i('a'), space(em), i('b'))), 'm:r')
          .map(textOf)
          .filter((t) => t !== 'a' && t !== 'b')
          .join('');

      expect(setOf(1)).toBe('\u{2003}');
      expect(setOf(2)).toBe('\u{2003}\u{2003}');
      expect(setOf(0.5)).toBe('\u{2002}');
      expect(setOf(0.1667)).toBe('\u{2006}');
      expect(setOf(0.2222)).toBe('\u{205F}');
      expect(setOf(0.2778)).toBe('\u{205F}\u{200A}');
      expect(setOf(0.4444)).toBe('\u{205F}\u{205F}');
      expect(setOf(0)).toBe('');
      expect(setOf(-0.1667)).toBe('');
    });

    it('sets primes as prime characters after their base, the subscript after them, as M11 measured, never raised a second time', () => {
      const primed: MathsNode = {
        k: 'attach',
        mode: 'scripts',
        base: i('f'),
        t: { k: 'primes', count: 2 },
      };
      const subscripted: MathsNode = { ...primed, b: i('i') } as MathsNode;

      expect(shape(primed)).toBe("'f'[i] '\u{2032}\u{2032}'");
      expect(shape(subscripted)).toBe("sSub(e('f'[i] '\u{2032}\u{2032}') sub('i'[i]))");
    });
  });

  describe('structures', () => {
    it('sets a fraction, a fraction without a line and a binomial as M11 did', () => {
      const tree = row(
        { k: 'frac', n: i('a'), d: i('b') },
        { k: 'stack', n: i('a'), d: i('b') },
        { k: 'binom', n: i('n'), d: i('k') },
      );
      const equation = read(tree);

      expect(sketch(equation)).toBe(
        "f(num('a'[i]) den('b'[i])) f(num('a'[i]) den('b'[i])) d(e(f(num('n'[i]) den('k'[i]))))",
      );
      const [fraction, stack, binomial] = kids(equation);
      expect(value(fraction, 'm:type')).toBeUndefined();
      expect(value(stack, 'm:type')).toBe('noBar');
      expect([
        value(binomial, 'm:begChr'),
        value(binomial, 'm:endChr'),
        value(binomial, 'm:type'),
      ]).toEqual(['(', ')', 'noBar']);
    });

    it('sets a square root with its degree hidden and a root with its degree', () => {
      const equation = read(
        row({ k: 'sqrt', body: i('x') }, { k: 'root', index: n('3'), body: i('x') }),
      );

      expect(sketch(equation)).toBe("rad(deg() e('x'[i])) rad(deg('3'[p]) e('x'[i]))");
      expect(kids(equation).map((each) => value(each, 'm:degHide'))).toEqual(['1', undefined]);
    });

    it('sets scripts beside a base, prescripts before it with either side empty, and limits under and over it', () => {
      const scripts = (mode: 'scripts' | 'limits', parts: object) =>
        ({ k: 'attach', mode, base: i('x'), ...parts }) as MathsNode;

      expect(shape(scripts('scripts', { b: i('i') }))).toBe("sSub(e('x'[i]) sub('i'[i]))");
      expect(shape(scripts('scripts', { t: n('2') }))).toBe("sSup(e('x'[i]) sup('2'[p]))");
      expect(shape(scripts('scripts', { b: i('i'), t: n('2') }))).toBe(
        "sSubSup(e('x'[i]) sub('i'[i]) sup('2'[p]))",
      );
      expect(shape(scripts('scripts', { bl: n('6'), tl: n('14') }))).toBe(
        "sPre(sub('6'[p]) sup('14'[p]) e('x'[i]))",
      );
      expect(shape(scripts('scripts', { tl: i('a') }))).toBe("sPre(sub() sup('a'[i]) e('x'[i]))");
      expect(shape(scripts('scripts', { tl: i('a'), br: i('b'), tr: n('2') }))).toBe(
        "sPre(sub() sup('a'[i]) e(sSubSup(e('x'[i]) sub('b'[i]) sup('2'[p]))))",
      );
      expect(shape(scripts('limits', { b: i('i'), t: n('2') }))).toBe(
        "limUpp(e(limLow(e('x'[i]) lim('i'[i]))) lim('2'[p]))",
      );
    });

    it('sets limits that move (limits-display) under and over in a display, and beside the base in running text', () => {
      const movable: MathsNode = {
        k: 'attach',
        mode: 'limits-display',
        base: o('\u{2192}'),
        t: i('f'),
      };

      expect(shape(movable, { display: true })).toBe("limUpp(e('\u{2192}') lim('f'[i]))");
      expect(shape(movable, { display: false })).toBe("sSup(e('\u{2192}') sup('f'[i]))");
    });

    it('sets an accent over its base as the combining character Word draws, from the spacing one the tree holds', () => {
      const accents = ['\u{2C6}', '\u{203E}', '\u{2192}', '\u{2D9}', '~', '\u{302}'];
      const equation = read(
        row(...accents.map((a): MathsNode => ({ k: 'accent', body: i('x'), a }))),
      );

      expect(sketch(equation)).toBe(Array(accents.length).fill("acc(e('x'[i]))").join(' '));
      expect(kids(equation).map((each) => value(each, 'm:chr'))).toEqual([
        '\u{302}',
        '\u{305}',
        '\u{20D7}',
        '\u{307}',
        '\u{303}',
        '\u{302}',
      ]);
    });

    it('sets a line over or under its content as a bar at the top or the bottom', () => {
      const equation = read(
        row(
          { k: 'line', which: 'overline', body: i('x') },
          { k: 'line', which: 'underline', body: i('x') },
        ),
      );

      expect(sketch(equation)).toBe("bar(e('x'[i])) bar(e('x'[i]))");
      expect(kids(equation).map((each) => value(each, 'm:pos'))).toEqual(['top', 'bot']);
    });

    it('sets a brace as a grouping character over or under its content, and its label as a limit beyond it', () => {
      const equation = read(
        row(
          { k: 'brace', which: 'overbrace', body: i('a'), label: i('n') },
          { k: 'brace', which: 'underbracket', body: i('b') },
        ),
      );

      expect(sketch(equation)).toBe(
        "limUpp(e(groupChr(e('a'[i]))) lim('n'[i])) groupChr(e('b'[i]))",
      );
      const [over, under] = all(equation, 'm:groupChr');
      expect([value(over, 'm:chr'), value(over, 'm:pos'), value(over, 'm:vertJc')]).toEqual([
        '\u{23DE}',
        'top',
        'bot',
      ]);
      expect([value(under, 'm:chr'), value(under, 'm:pos'), value(under, 'm:vertJc')]).toEqual([
        '\u{23B5}',
        'bot',
        'top',
      ]);
    });

    it('sets content between fences as a delimiter, an empty side empty, and one separator character between parts', () => {
      const equation = read(
        row(
          {
            k: 'lr',
            open: '\u{27E8}',
            close: '\u{27E9}',
            body: row(i('a'), { k: 'mid', t: '|' }, i('b')),
          },
          { k: 'lr', open: '', close: '|', body: i('x') },
        ),
      );

      expect(sketch(equation)).toBe("d(e('a'[i]) e('b'[i])) d(e('x'[i]))");
      const [separated, open] = kids(equation);
      expect([
        value(separated, 'm:begChr'),
        value(separated, 'm:sepChr'),
        value(separated, 'm:endChr'),
      ]).toEqual(['\u{27E8}', '|', '\u{27E9}']);
      expect([value(open, 'm:begChr'), value(open, 'm:sepChr'), value(open, 'm:endChr')]).toEqual([
        '',
        undefined,
        '|',
      ]);
    });

    it('keeps separators of two characters as the characters they are, since a delimiter has one separator', () => {
      const tree: MathsNode = {
        k: 'lr',
        open: '(',
        close: ')',
        body: row(i('a'), { k: 'mid', t: '|' }, i('b'), { k: 'mid', t: '\u{2016}' }, i('c')),
      };

      expect(shape(tree)).toBe("d(e('a'[i] '|' 'b'[i] '\u{2016}' 'c'[i]))");
    });

    it('sets a matrix in its fences, each column aligned as the tree says, a short row filled out and its empty cells never drawn as placeholders', () => {
      const equation = read({
        k: 'mat',
        open: '[',
        close: ']',
        rows: [[i('a'), i('b')], [i('c')]],
        columns: ['left', 'right'],
        display: false,
      });

      expect(sketch(equation)).toBe("d(e(m(mr(e('a'[i]) e('b'[i])) mr(e('c'[i]) e()))))");
      expect([value(equation, 'm:begChr'), value(equation, 'm:endChr')]).toEqual(['[', ']']);
      expect(value(equation, 'm:plcHide')).toBe('1');
      expect(all(equation, 'm:mcJc').map((each) => each.attrs['m:val'])).toEqual(['left', 'right']);
      expect(all(equation, 'm:count').map((each) => each.attrs['m:val'])).toEqual(['1', '1']);
    });

    it('sets a bare table that is not an aligned equation as a matrix without fences', () => {
      const tree: MathsNode = {
        k: 'mat',
        open: '',
        close: '',
        rows: [[i('a'), i('b')]],
        columns: ['center', 'center'],
        display: false,
      };

      expect(shape(tree)).toBe("m(mr(e('a'[i]) e('b'[i])))");
    });

    it('sets an aligned equation as an equation array whose cells are joined by alignment points, as the PDF joins them', () => {
      const tree: MathsNode = {
        k: 'mat',
        open: '',
        close: '',
        rows: [
          [i('a'), row(o('='), i('b')), i('c'), row(o('='), i('d'))],
          [i('e'), row(o('='), i('f'))],
        ],
        columns: ['right', 'left', 'right', 'left'],
        display: true,
      };

      expect(shape(tree)).toBe(
        "eqArr(e('a'[i] '&' '=' 'b'[i] '&' 'c'[i] '&' '=' 'd'[i]) e('e'[i] '&' '=' 'f'[i]))",
      );
    });

    it('sets cases as an equation array after a brace, each column left-aligned by its own alignment points (M11: without them the rows centre)', () => {
      const equation = read({
        k: 'cases',
        rows: [
          [row(i('x'), o(',')), row(i('x'), o('\u{2265}'), n('0'))],
          [row(o('\u{2212}'), i('x'), o(',')), { k: 'text', t: 'otherwise' }],
        ],
        columns: ['left', 'left'],
      });

      expect(sketch(equation)).toBe(
        "d(e(eqArr(e('&' 'x'[i] ',' '&' '&' 'x'[i] '\u{2265}' '0'[p]) e('&' '\u{2212}' 'x'[i] ',' '&' '&' 'otherwise'[nor]))))",
      );
      expect([value(equation, 'm:begChr'), value(equation, 'm:endChr')]).toEqual(['{', '']);
    });

    it("sets an ampersand the content holds in an equation array as Word's normal text, so it is never read as an alignment point", () => {
      const tree: MathsNode = {
        k: 'mat',
        open: '',
        close: '',
        rows: [[i('a'), row(o('='), o('&'))]],
        columns: ['right', 'left'],
        display: true,
      };

      expect(shape(tree)).toBe("eqArr(e('a'[i] '&' '=' '&'[nor]))");
      expect(shape(row(o('&')))).toBe("'&'");
    });

    it('sets a phantom as a phantom Word does not show, its space kept', () => {
      const equation = read(row({ k: 'phantom', body: row(i('a'), o('+'), i('b')) }, i('c')));

      expect(sketch(equation)).toBe("phant(e('a'[i] '+' 'b'[i])) 'c'[i]");
      expect(value(equation, 'm:show')).toBe('0');
    });
  });

  describe('a large operator takes its operand, a named operator its argument (the operand rule)', () => {
    const sum = (mode: 'scripts' | 'limits' | 'limits-display' = 'limits'): MathsNode => ({
      k: 'attach',
      mode,
      base: o(SUM),
      b: row(i('i'), o('='), n('1')),
      t: i('n'),
    });
    const xi: MathsNode = { k: 'attach', mode: 'scripts', base: i('x'), b: i('i') };

    it('sets a sum as an n-ary operator holding the next node in its row as its operand, and what follows after it', () => {
      const equation = read(row(sum(), xi, o('='), i('y')));

      expect(sketch(equation)).toBe(
        "nary(sub('i'[i] '=' '1'[p]) sup('n'[i]) e(sSub(e('x'[i]) sub('i'[i])))) '=' 'y'[i]",
      );
      expect([value(equation, 'm:chr'), value(equation, 'm:limLoc')]).toEqual([SUM, 'undOvr']);
      expect(value(equation, 'm:subHide')).toBeUndefined();
    });

    it('places the limits as the PDF does: beside (scripts), above and below (limits), and above and below in a display only (limits-display)', () => {
      const limLoc = (mode: 'scripts' | 'limits' | 'limits-display', display: boolean) =>
        value(read(row(sum(mode), i('x')), { display }), 'm:limLoc');

      expect([limLoc('scripts', true), limLoc('scripts', false)]).toEqual(['subSup', 'subSup']);
      expect([limLoc('limits', true), limLoc('limits', false)]).toEqual(['undOvr', 'undOvr']);
      expect([limLoc('limits-display', true), limLoc('limits-display', false)]).toEqual([
        'undOvr',
        'subSup',
      ]);
    });

    it('knows a large operator by its mark or by its character, hides a limit it lacks, and sets one standing without limits as an n-ary operator too', () => {
      const marked: MathsNode = { k: 'o', t: '\u{2A01}', large: true };
      const integral: MathsNode = { k: 'attach', mode: 'scripts', base: o(INTEGRAL), b: n('0') };
      const equation = read(row(marked, i('x'), o('+'), integral, i('f'), o('+'), o(SUM), i('y')));
      const [bare, lower, plain] = all(equation, 'm:nary');

      expect(sketch(equation)).toBe(
        "nary(sub() sup() e('x'[i])) '+' nary(sub('0'[p]) sup() e('f'[i])) '+' nary(sub() sup() e('y'[i]))",
      );
      expect([value(bare, 'm:chr'), value(bare, 'm:subHide'), value(bare, 'm:supHide')]).toEqual([
        '\u{2A01}',
        '1',
        '1',
      ]);
      expect([value(lower, 'm:chr'), value(lower, 'm:subHide'), value(lower, 'm:supHide')]).toEqual(
        [INTEGRAL, undefined, '1'],
      );
      expect(value(plain, 'm:limLoc')).toBeUndefined();
    });

    it('holds nothing where nothing follows it in its row, since Word draws no placeholder for an empty operand (measured)', () => {
      expect(shape(row(i('a'), o('+'), sum()))).toBe(
        "'a'[i] '+' nary(sub('i'[i] '=' '1'[p]) sup('n'[i]) e())",
      );
      expect(shape(sum())).toBe("nary(sub('i'[i] '=' '1'[p]) sup('n'[i]) e())");
    });

    it('takes the spaces before its operand into it, and holds only spaces where only spaces follow', () => {
      expect(shape(row(sum(), space(0.1667), i('x')))).toBe(
        "nary(sub('i'[i] '=' '1'[p]) sup('n'[i]) e('\u{2006}' 'x'[i]))",
      );
      expect(shape(row(sum(), space(0.1667)))).toBe(
        "nary(sub('i'[i] '=' '1'[p]) sup('n'[i]) e('\u{2006}'))",
      );
    });

    it('takes a following large operator with its own operand, so a double sum nests', () => {
      const inner: MathsNode = { k: 'attach', mode: 'limits', base: o(SUM), b: i('j') };

      expect(shape(row(sum(), inner, i('a'), o('+'), i('b')))).toBe(
        "nary(sub('i'[i] '=' '1'[p]) sup('n'[i]) e(nary(sub('j'[i]) sup() e('a'[i])))) '+' 'b'[i]",
      );
    });

    it('takes an opening bracket with everything up to its matching close, however deep', () => {
      const tree = row(sum(), o('('), i('a'), o('('), i('b'), o(')'), o(')'), o('+'), i('c'));

      expect(shape(tree)).toBe(
        "nary(sub('i'[i] '=' '1'[p]) sup('n'[i]) e('(' 'a'[i] '(' 'b'[i] ')' ')')) '+' 'c'[i]",
      );
      expect(shape(row(o(SUM), o('|'), i('x'), o('|'), o('+'), i('c')))).toBe(
        "nary(sub() sup() e('|' 'x'[i] '|')) '+' 'c'[i]",
      );
      expect(shape(row(o(SUM), o('('), i('x')))).toBe("nary(sub() sup() e('(' 'x'[i]))");
    });

    it('reads a group as the nodes it holds, which Word sets alike, so an operand in the row around a group, or grouped itself, is found', () => {
      // Temml's `\sin x`: the sine grouped with its space, the argument after the group.
      const sine = row(row(op('sin'), space(0.1667)), i('x'), o('+'), i('y'));

      expect(shape(sine)).toBe("func(fName('sin'[p]) e('\u{2006}' 'x'[i])) '+' 'y'[i]");
      // Temml's `(n+1)` after a sum: a group whose first node opens a bracket.
      expect(shape(row(sum(), row(o('('), i('n'), o('+'), n('1'), o(')')), i('z')))).toBe(
        "nary(sub('i'[i] '=' '1'[p]) sup('n'[i]) e('(' 'n'[i] '+' '1'[p] ')')) 'z'[i]",
      );
    });

    it('sets a named operator as a function holding the next node as its argument, its limits under and over its name', () => {
      const lim: MathsNode = {
        k: 'attach',
        mode: 'limits',
        base: op('lim', true),
        b: row(i('x'), o('\u{2192}'), n('0')),
      };
      const max: MathsNode = { k: 'attach', mode: 'limits', base: op('max', true), t: i('k') };

      expect(shape(row(op('sin'), i('x')))).toBe("func(fName('sin'[p]) e('x'[i]))");
      expect(shape(row(lim, i('f')))).toBe(
        "func(fName(limLow(e('lim'[p]) lim('x'[i] '\u{2192}' '0'[p]))) e('f'[i]))",
      );
      expect(shape(row(max, i('f')))).toBe(
        "func(fName(limUpp(e('max'[p]) lim('k'[i]))) e('f'[i]))",
      );
    });

    it("sets a named operator's scripts beside its name where the PDF does", () => {
      const squared: MathsNode = { k: 'attach', mode: 'scripts', base: op('sin'), t: n('2') };
      const inline: MathsNode = {
        k: 'attach',
        mode: 'limits-display',
        base: op('lim', true),
        b: i('n'),
      };

      expect(shape(row(squared, i('x')))).toBe(
        "func(fName(sSup(e('sin'[p]) sup('2'[p]))) e('x'[i]))",
      );
      expect(shape(row(inline, i('a')), { display: false })).toBe(
        "func(fName(sSub(e('lim'[p]) sub('n'[i]))) e('a'[i]))",
      );
      expect(shape(row(inline, i('a')), { display: true })).toBe(
        "func(fName(limLow(e('lim'[p]) lim('n'[i]))) e('a'[i]))",
      );
    });

    it('sets a named operator with nothing after it as its name alone, since an empty argument is all a function would add', () => {
      expect(shape(row(i('a'), op('sin')))).toBe("'a'[i] 'sin'[p]");
      expect(shape(row(op('log'), space(0.1667)))).toBe("'log'[p] '\u{2006}'");
      expect(shape(op('det', true))).toBe("'det'[p]");
    });

    it('lets a function take a large operator with its operand, and a large operator a function with its argument', () => {
      expect(shape(row(op('exp'), o(SUM), i('x')))).toBe(
        "func(fName('exp'[p]) e(nary(sub() sup() e('x'[i]))))",
      );
      expect(shape(row(o(SUM), op('sin'), i('x')))).toBe(
        "nary(sub() sup() e(func(fName('sin'[p]) e('x'[i]))))",
      );
    });

    it('finds operands inside every argument, a fraction, a cell and a script among them', () => {
      const tree: MathsNode = {
        k: 'frac',
        n: row(o(SUM), i('x')),
        d: { k: 'attach', mode: 'scripts', base: i('e'), t: row(op('sin'), i('y')) },
      };

      expect(shape(tree)).toBe(
        "f(num(nary(sub() sup() e('x'[i]))) den(sSup(e('e'[i]) sup(func(fName('sin'[p]) e('y'[i]))))))",
      );
    });

    it('sets a large operator with a prescript as its character with scripts, since an n-ary operator has none', () => {
      const prescripted: MathsNode = { k: 'attach', mode: 'scripts', base: o(SUM), tl: i('a') };

      expect(shape(row(prescripted, i('x')))).toBe("sPre(sub() sup('a'[i]) e('\u{2211}')) 'x'[i]");
    });
  });

  describe('styles and sizes, approximated', () => {
    it('sets content in the display style with moving limits above and below, and in the inline style beside, as the PDF does', () => {
      const movable: MathsNode = { k: 'attach', mode: 'limits-display', base: o(SUM), b: i('j') };
      const displayed = read(row({ k: 'display', body: row(movable, i('y')) }), { display: false });
      const inline = read(row({ k: 'inline', body: row(movable, i('y')) }), { display: true });

      expect(sketch(displayed)).toBe("nary(sub('j'[i]) sup() e('y'[i]))");
      expect(value(displayed, 'm:limLoc')).toBe('undOvr');
      expect(value(inline, 'm:limLoc')).toBe('subSup');
    });

    it("sets content a script level smaller, and two, at Cambria Math's script sizes where it stands in running maths", () => {
      const tree = row(
        i('x'),
        { k: 'script', body: row(i('y'), { k: 'frac', n: n('1'), d: n('2') }) },
        { k: 'sscript', body: i('z') },
      );
      const equation = read(tree, { size: 11 });

      // 11pt at 73% and 60%, in half points.
      expect(sketch(equation)).toBe(
        "'x'[i] 'y'[i]{16} f(num('1'[p]{16}) den('2'[p]{16})) 'z'[i]{13}",
      );
      expect(first(equation, 'w:szCs')?.attrs['w:val']).toBe('16');
      // The fraction's own bar is sized too, through its control properties.
      expect(first(first(equation, 'm:fPr')!, 'w:sz')?.attrs['w:val']).toBe('16');
    });

    it('sets content a script level smaller as Word sets it where Word already sets it smaller, in a script or a limit', () => {
      const tree: MathsNode = {
        k: 'attach',
        mode: 'limits',
        base: o(SUM),
        b: { k: 'script', body: row(i('i'), o('<'), i('n')) },
      };

      expect(shape(row(tree, i('a')))).toBe("nary(sub('i'[i] '<' 'n'[i]) sup() e('a'[i]))");
    });
  });

  describe('every kind at once', () => {
    const converted = mathsTree(EVERY_KIND_MATHML);
    if (!converted.ok) throw new Error(`The fixture is refused: ${converted.reason}`);
    const tree = converted.tree;

    /** Every kind a tree holds, an attachment by its mode and an identifier by its variant too. */
    function kindsOf(node: MathsNode): string[] {
      const own = [
        node.k,
        ...(node.k === 'attach' ? [`attach:${node.mode}`] : []),
        ...(node.k === 'i' ? [`i:${node.v}`] : []),
        ...(node.k === 'o' && node.large === true ? ['o:large'] : []),
        ...(node.k === 'mat' ? [node.open === '' ? `mat:bare:${node.display}` : 'mat:fenced'] : []),
      ];
      const isNode = (field: unknown): field is MathsNode =>
        typeof field === 'object' && field !== null && 'k' in field;
      const children = Object.values(node).flatMap((field): MathsNode[] =>
        Array.isArray(field)
          ? (field as unknown[]).flat().filter(isNode)
          : isNode(field)
            ? [field]
            : [],
      );
      return [...own, ...children.flatMap(kindsOf)];
    }

    it('is a fixture holding every kind of node, every variant and every mode', () => {
      expect(new Set(kindsOf(tree))).toEqual(
        new Set([
          ...[
            'row',
            'i',
            'n',
            'o',
            'mid',
            'op',
            'primes',
            'text',
            'space',
            'frac',
            'stack',
            'binom',
          ],
          ...['sqrt', 'root', 'attach', 'accent', 'line', 'brace', 'lr', 'mat', 'cases', 'phantom'],
          ...['display', 'inline', 'script', 'sscript', 'o:large'],
          ...['attach:scripts', 'attach:limits', 'attach:limits-display'],
          ...[
            'i:italic',
            'i:upright',
            'i:bold',
            'i:bold-italic',
            'i:bb',
            'i:cal',
            'i:frak',
            'i:sans',
            'i:mono',
          ],
          ...['mat:fenced', 'mat:bare:true', 'mat:bare:false'],
        ]),
      );
    });

    it('PUB-067 sets it as one well-formed equation of OMML objects alone, every row an argument of an equation array, inline and displayed', () => {
      for (const display of [true, false]) {
        const equation = read(tree, { display });
        const [array] = kids(equation);

        expect(kids(equation)).toHaveLength(1);
        expect(array!.name).toBe('m:eqArr');
        expect(kids(array!, 'm:e')).toHaveLength(9);
        const names = new Set(all(equation, '*').map((each) => each.name));
        for (const name of names) expect(name).toMatch(/^(m|w):/);
        expect(
          [
            'm:nary',
            'm:func',
            'm:limLow',
            'm:limUpp',
            'm:f',
            'm:rad',
            'm:sSub',
            'm:sSup',
            'm:sSubSup',
            'm:sPre',
            'm:acc',
            'm:bar',
            'm:groupChr',
            'm:d',
            'm:m',
            'm:eqArr',
            'm:phant',
          ].filter((name) => all(equation, name).length === 0),
        ).toEqual([]);
      }
    });

    it('takes each operand the rule names: the sum its x sub i, the integral its f, the union its A sub k, the limit its fraction', () => {
      const equation = read(tree);
      const operands = all(equation, 'm:nary').map((each) => sketch(kids(each, 'm:e')[0]!));

      expect(operands).toEqual([
        "sSub(e('x'[i]) sub('i'[i]))",
        "'f'[i]",
        "sSub(e('A'[i]) sub('k'[i]))",
        "'y'[i]",
        "sSub(e('a'[i]) sub('i'[i]))",
      ]);
      const functions = all(equation, 'm:func').map((each) => sketch(kids(each, 'm:e')[0]!));
      expect(functions).toEqual([
        "f(num(func(fName('sin'[p]) e('\u{2006}' 'x'[i]))) den('x'[i]))",
        "'\u{2006}' 'x'[i]",
      ]);
    });
  });
});
