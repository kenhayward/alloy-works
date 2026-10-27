import type { MathsAlignment, MathsNode, MathsTree, MathsVariant } from '../publishing/maths.js';

/**
 * **The maths tree as MathML Core** (the HT plan, HT-H): an equation as HTML writes it, built from the
 * tree the PDF's template sets and Word's OMML is built from (`omml`), never from the stored MathML,
 * so the three outputs are one conversion apart and nothing the author's MathML carries reaches the
 * page but what the tree kept (PUB-067's rule). The writer puts it in a `math` element carrying the
 * alternative.
 *
 * MathML Core has no `mathvariant` but `normal`, so an identifier in another variant is written in
 * Unicode's mathematical letters, as a browser would map it; a part in another style or script level
 * is an `mstyle` saying so; and a limit that moves stands above and below only in display style.
 *
 * Pure: every string in the tree is a value, escaped, and nothing is read but the tree.
 */
export function mathml(tree: MathsTree, display: boolean): string {
  return write(tree, display);
}

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const token = (tag: string, text: string, attributes = '') =>
  `<${tag}${attributes}>${escape(text)}</${tag}>`;

/** Its nodes in one `mrow`, or the one node alone. */
const grouped = (content: string) => `<mrow>${content}</mrow>`;

/** The characters MathML draws a line or a brace with, above or below, as the template's own. */
const BRACES: Readonly<Record<Extract<MathsNode, { k: 'brace' }>['which'], [string, boolean]>> = {
  overbrace: ['\u{23DE}', true],
  underbrace: ['\u{23DF}', false],
  overbracket: ['\u{23B4}', true],
  underbracket: ['\u{23B5}', false],
  overparen: ['\u{23DC}', true],
  underparen: ['\u{23DD}', false],
};

function write(node: MathsNode, display: boolean): string {
  const each = (child: MathsNode) => write(child, display);
  switch (node.k) {
    case 'row':
      return grouped(node.c.map(each).join(''));
    case 'i':
      return identifier(node.t, node.v);
    case 'n':
      return token('mn', node.t);
    case 'o':
      return token('mo', node.t, node.large === true ? ' largeop="true"' : '');
    case 'mid':
      return token('mo', node.t, ' stretchy="true"');
    case 'op':
      return token('mi', node.t);
    case 'primes':
      return token('mo', '\u{2032}'.repeat(node.count));
    case 'text':
      return token('mtext', node.t);
    case 'space':
      return `<mspace width="${Math.round(node.em * 1000) / 1000}em"></mspace>`;
    case 'frac':
      return `<mfrac>${each(node.n)}${each(node.d)}</mfrac>`;
    case 'stack':
      return `<mfrac linethickness="0">${each(node.n)}${each(node.d)}</mfrac>`;
    case 'binom':
      return grouped(
        `${token('mo', '(')}<mfrac linethickness="0">${each(node.n)}${each(node.d)}</mfrac>${token('mo', ')')}`,
      );
    case 'sqrt':
      return `<msqrt>${each(node.body)}</msqrt>`;
    case 'root':
      return `<mroot>${each(node.body)}${each(node.index)}</mroot>`;
    case 'attach':
      return attach(node, display);
    case 'accent':
      return `<mover accent="true">${each(node.body)}${token('mo', node.a)}</mover>`;
    case 'line':
      return node.which === 'overline'
        ? `<mover accent="true">${each(node.body)}${token('mo', '\u{203E}')}</mover>`
        : `<munder accentunder="true">${each(node.body)}${token('mo', '_')}</munder>`;
    case 'brace': {
      const [character, over] = BRACES[node.which];
      const brace = over
        ? `<mover accent="true">${each(node.body)}${token('mo', character)}</mover>`
        : `<munder accentunder="true">${each(node.body)}${token('mo', character)}</munder>`;
      if (node.label === undefined) return brace;
      return over
        ? `<mover>${brace}${each(node.label)}</mover>`
        : `<munder>${brace}${each(node.label)}</munder>`;
    }
    case 'lr':
      return fenced(node.open, node.close, each(node.body));
    case 'mat':
      return fenced(node.open, node.close, table(node.rows, node.columns, node.display, display));
    case 'cases':
      return fenced('{', '', table(node.rows, node.columns, false, display));
    case 'phantom':
      return `<mphantom>${each(node.body)}</mphantom>`;
    case 'display':
    case 'inline':
      return `<mstyle displaystyle="${node.k === 'display'}">${write(node.body, node.k === 'display')}</mstyle>`;
    case 'script':
    case 'sscript':
      return `<mstyle scriptlevel="${node.k === 'script' ? '+1' : '+2'}">${write(node.body, false)}</mstyle>`;
    default: {
      const unreachable: never = node;
      throw new Error(`No MathML for a maths node of kind ${(unreachable as MathsNode).k}`);
    }
  }
}

/** Content between fences, either left out where it is empty. */
function fenced(open: string, close: string, content: string): string {
  if (open === '' && close === '') return content;
  const side = (fence: string) => (fence === '' ? '' : token('mo', fence));
  return grouped(`${side(open)}${content}${side(close)}`);
}

function table(
  rows: readonly (readonly MathsNode[])[],
  columns: readonly MathsAlignment[],
  own: boolean,
  display: boolean,
): string {
  const cells = rows
    .map(
      (row) =>
        `<mtr>${row
          .map(
            (cell, at) =>
              `<mtd style="text-align: ${columns[at] ?? 'center'}">${write(cell, own || display)}</mtd>`,
          )
          .join('')}</mtr>`,
    )
    .join('');
  return `<mtable${own ? ' displaystyle="true"' : ''}>${cells}</mtable>`;
}

/** A base and its scripts, as MathML Core's elements for where they stand. */
function attach(node: Extract<MathsNode, { k: 'attach' }>, display: boolean): string {
  const each = (child: MathsNode | undefined) =>
    child === undefined ? '<mrow></mrow>' : write(child, false);
  const base = write(node.base, display);
  if (node.tl !== undefined || node.bl !== undefined) {
    const after =
      node.b !== undefined || node.t !== undefined || node.br !== undefined || node.tr !== undefined
        ? each(node.br ?? node.b) + each(node.tr ?? node.t)
        : '';
    return `<mmultiscripts>${base}${after}<mprescripts></mprescripts>${each(node.bl)}${each(node.tl)}</mmultiscripts>`;
  }
  const below = node.b ?? node.br;
  const above = node.t ?? node.tr;
  // Limits stand above and below, but a limit that moves only in display style, as the engine sets it.
  const limits = node.mode === 'limits' || (node.mode === 'limits-display' && display);
  if (below !== undefined && above !== undefined) {
    return `<${limits ? 'munderover' : 'msubsup'}>${base}${each(below)}${each(above)}</${limits ? 'munderover' : 'msubsup'}>`;
  }
  if (below !== undefined) {
    return `<${limits ? 'munder' : 'msub'}>${base}${each(below)}</${limits ? 'munder' : 'msub'}>`;
  }
  if (above !== undefined) {
    return `<${limits ? 'mover' : 'msup'}>${base}${each(above)}</${limits ? 'mover' : 'msup'}>`;
  }
  return base;
}

/**
 * An identifier in its variant: a letter italic as MathML Core sets one alone, and upright marked
 * `normal`; a word italic in Unicode's italic letters; any other variant in Unicode's letters for it.
 */
function identifier(text: string, variant: MathsVariant): string {
  const alone = [...text].length === 1;
  if (variant === 'italic') return alone ? token('mi', text) : token('mi', lettered(text, variant));
  if (variant === 'upright') {
    return alone ? token('mi', text, ' mathvariant="normal"') : token('mi', text);
  }
  const mapped = lettered(text, variant);
  return token('mi', mapped, [...mapped].length === 1 ? ' mathvariant="normal"' : '');
}

/** Where each variant's capitals, small letters and digits begin in Unicode's mathematical letters. */
const ALPHANUMERICS: Readonly<
  Record<Exclude<MathsVariant, 'upright'>, readonly [number, number, number | null]>
> = {
  bold: [0x1d400, 0x1d41a, 0x1d7ce],
  italic: [0x1d434, 0x1d44e, null],
  'bold-italic': [0x1d468, 0x1d482, null],
  cal: [0x1d49c, 0x1d4b6, null],
  frak: [0x1d504, 0x1d51e, null],
  bb: [0x1d538, 0x1d552, 0x1d7d8],
  sans: [0x1d5a0, 0x1d5ba, 0x1d7e2],
  mono: [0x1d670, 0x1d68a, 0x1d7f6],
};

/** The letters Unicode encoded before the block, which it leaves as holes there. */
const HOLES: Readonly<Partial<Record<MathsVariant, Readonly<Record<string, number>>>>> = {
  italic: { h: 0x210e },
  cal: {
    B: 0x212c,
    E: 0x2130,
    F: 0x2131,
    H: 0x210b,
    I: 0x2110,
    L: 0x2112,
    M: 0x2133,
    R: 0x211b,
    e: 0x212f,
    g: 0x210a,
    o: 0x2134,
  },
  frak: { C: 0x212d, H: 0x210c, I: 0x2111, R: 0x211c, Z: 0x2128 },
  bb: { C: 0x2102, H: 0x210d, N: 0x2115, P: 0x2119, Q: 0x211a, R: 0x211d, Z: 0x2124 },
};

function lettered(text: string, variant: Exclude<MathsVariant, 'upright'>): string {
  const [capitals, small, digits] = ALPHANUMERICS[variant];
  return [...text]
    .map((character) => {
      const hole = HOLES[variant]?.[character];
      if (hole !== undefined) return String.fromCodePoint(hole);
      const code = character.codePointAt(0)!;
      if (code >= 0x41 && code <= 0x5a) return String.fromCodePoint(capitals + code - 0x41);
      if (code >= 0x61 && code <= 0x7a) return String.fromCodePoint(small + code - 0x61);
      if (digits !== null && code >= 0x30 && code <= 0x39) {
        return String.fromCodePoint(digits + code - 0x30);
      }
      return character;
    })
    .join('');
}
