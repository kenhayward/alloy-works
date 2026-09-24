import {
  drawsNothing,
  equationAlternative,
  MATHML_NAMESPACE,
  readMathmlTree,
  type MathElement,
} from '../content/admission/mathml.js';
import { BODY_SIZE } from './measure.js';

/**
 * An equation's stored MathML made into the maths tree both writers read (publishing.md's EQ-B;
 * equations 2, ruling R2): the publication template assembles an equation from the engine's own
 * maths functions by walking it, and the Word writer will write it as OMML from the same tree
 * (word-output.md's Equations), so neither ever reads MathML and neither ever sees source.
 *
 * **Every string in the tree is a value**, never markup or code. An identifier spelled
 * `#read("/etc/passwd")` is those twenty characters, handed by the template to `symbol` or `text`
 * and set as they are; nothing in the tree is evaluated (PUB-062, measured by the equations spike).
 *
 * **It refuses what it does not map, by name, and never guesses.** The stored MathML is what the
 * strict reader keeps (`content/admission/mathml.ts`), read here by that reader's own parser, but
 * this does not lean on the reader's allowlist: every element and every attribute it meets must be
 * one this module has a decision about, on the element it stands on, or the equation is refused. So
 * when the reader is widened to keep something new, that something reaches the template only after
 * a mapping for it is written here. What it refuses on purpose, because the engine has no way to set
 * it: an error the converter that wrote the MathML reported (`merror`), maths set right to left,
 * more than one pair of scripts on a side of `mmultiscripts`, a box moved up or down (`mpadded`'s
 * `voffset` - the engine cannot move maths and keep it maths), a table cell spanning others, a
 * `mathvariant` MathML names that the engine has no style for, a space too wide for any line or for a
 * number, an accent of more than one character, and an equation that draws nothing at all.
 *
 * **Two things the engine will not do that this does** (the spike's traps): an identifier is given
 * its style explicitly - text built from data is set upright inside an equation - by MathML Core's
 * rule, one character italic and anything longer upright; and a row is a list of nodes the template
 * joins, never a string laid out as markup, which would put spaces between them.
 *
 * Where the mapping knowingly sets less than MathML says, each place says so: a bracket's `minsize`
 * and `maxsize` (`\big`), a padded box's width, height and depth, and a space's height and depth.
 */

/**
 * An identifier's style: MathML Core's rule where it names none, and otherwise what its
 * `mathvariant` names - `bb` double-struck, `cal` script, `frak` fraktur, the names mathematicians
 * write them with (`\mathbb`, `\mathcal`, `\mathfrak`).
 */
export type MathsVariant =
  'italic' | 'upright' | 'bold' | 'bold-italic' | 'bb' | 'cal' | 'frak' | 'sans' | 'mono';

/**
 * Where scripts stand: beside the base (`scripts`), above and below it (`limits`), or above and
 * below in a display equation and beside it in running text (`limits-display`, MathML's
 * `movablelimits`).
 */
export type MathsAttachMode = 'scripts' | 'limits' | 'limits-display';

/** A brace, a bracket or a parenthesis stretched under or over its content. */
export type MathsBrace =
  'underbrace' | 'overbrace' | 'underbracket' | 'overbracket' | 'underparen' | 'overparen';

/** How a table's column is aligned, as its MathML `columnalign` says, centred where it says nothing. */
export type MathsAlignment = 'left' | 'center' | 'right';

/**
 * One node of the maths tree. The kinds and their fields are those the equations spike's template
 * function reads, with two changes: `primes`, which the spike measured and its converter did not yet
 * emit, and a table's `columns`, its alignment, which equations 1 now keeps (EQ-C) and the spike's
 * reader lost. Kept terse - `k`, `t`, `c` - because a tree is written into the published document's
 * data once per equation.
 *
 * - `row`: its nodes in order. `i` an identifier, `n` a number, `o` an operator (`large` for one
 *   MathML marks `largeop`), `mid` a stretchy operator between two fences, `op` a named operator
 *   (`sin`, `lim`), `primes` a count of primes, `text` text, `space` a horizontal space in ems.
 * - `frac` a fraction; `stack` a fraction with no line; `binom` a binomial.
 * - `sqrt` and `root`, the latter with its `index`.
 * - `attach`: a `base` with scripts at any of six places - `t` and `b` above and below, or beside
 *   where the mode is `scripts`, and `tl`, `bl`, `tr`, `br` at its corners - where the mode says.
 * - `accent` one character over its base; `line` an overline or an underline; `brace` a brace over
 *   or under its content, with a `label` beyond it where one is attached.
 * - `lr` content between fences that stretch to it, either fence empty where MathML draws none.
 * - `mat` a table: in fences, or bare (`open` and `close` empty); `display` where MathML sets it in
 *   display style, as `aligned` and `gathered` are. `cases` a table after a stretched left brace.
 * - `phantom` its content's space, drawn as nothing; `display` and `inline` its content in that style;
 *   `script` and `sscript` its content a script level smaller and two, as MathML's `scriptlevel` sets
 *   it (`\substack`, `smallmatrix`, `subarray`, `\scriptstyle`, `\scriptscriptstyle`).
 */
export type MathsNode =
  | { readonly k: 'row'; readonly c: readonly MathsNode[] }
  | { readonly k: 'i'; readonly t: string; readonly v: MathsVariant }
  | { readonly k: 'n'; readonly t: string }
  | { readonly k: 'o'; readonly t: string; readonly large?: true }
  | { readonly k: 'mid'; readonly t: string }
  | { readonly k: 'op'; readonly t: string; readonly limits: boolean }
  | { readonly k: 'primes'; readonly count: number }
  | { readonly k: 'text'; readonly t: string }
  | { readonly k: 'space'; readonly em: number }
  | { readonly k: 'frac' | 'stack' | 'binom'; readonly n: MathsNode; readonly d: MathsNode }
  | { readonly k: 'sqrt'; readonly body: MathsNode }
  | { readonly k: 'root'; readonly index: MathsNode; readonly body: MathsNode }
  | {
      readonly k: 'attach';
      readonly mode: MathsAttachMode;
      readonly base: MathsNode;
      readonly t?: MathsNode;
      readonly b?: MathsNode;
      readonly tl?: MathsNode;
      readonly bl?: MathsNode;
      readonly tr?: MathsNode;
      readonly br?: MathsNode;
    }
  | { readonly k: 'accent'; readonly body: MathsNode; readonly a: string }
  | { readonly k: 'line'; readonly which: 'overline' | 'underline'; readonly body: MathsNode }
  | {
      readonly k: 'brace';
      readonly which: MathsBrace;
      readonly body: MathsNode;
      readonly label?: MathsNode;
    }
  | { readonly k: 'lr'; readonly open: string; readonly close: string; readonly body: MathsNode }
  | {
      readonly k: 'mat';
      readonly open: string;
      readonly close: string;
      readonly rows: readonly (readonly MathsNode[])[];
      readonly columns: readonly MathsAlignment[];
      readonly display: boolean;
    }
  | {
      readonly k: 'cases';
      readonly rows: readonly (readonly MathsNode[])[];
      readonly columns: readonly MathsAlignment[];
    }
  | {
      readonly k: 'phantom' | 'display' | 'inline' | 'script' | 'sscript';
      readonly body: MathsNode;
    };

/** A whole equation's tree: its root node. */
export type MathsTree = MathsNode;

/**
 * Why an equation cannot be set, by name, never quoting its text. `unreadable` is MathML the strict
 * reader cannot read at all; `error`, `rightToLeft`, `scripts`, `offset`, `spanningCell` and
 * `variant` are the constructs refused on purpose; `element` is an element this does not map, or one
 * standing where it cannot (a cell outside a table, a fraction without two parts); `attribute` an
 * attribute this does not map on that element, or a value it has no mapping for; `text` text standing
 * outside a token element. Three more the final review of equations 2 named, the first two of which
 * reached the engine and stopped the compile with nothing to say which equation (I1), and the third
 * set nothing for the equation's words to be carried by (M1): `space` a space wider than
 * `WIDEST_SPACE` either way, or wider than a number holds; `accent` an accent of more than one
 * character, which the engine's accent refuses; and `empty` an equation that draws nothing
 * (`drawsNothing`).
 */
export type MathsRefusal =
  | { readonly ok: false; readonly reason: 'unreadable' }
  | { readonly ok: false; readonly reason: 'error' }
  | { readonly ok: false; readonly reason: 'rightToLeft' }
  | { readonly ok: false; readonly reason: 'scripts' }
  | { readonly ok: false; readonly reason: 'offset' }
  | { readonly ok: false; readonly reason: 'spanningCell' }
  | { readonly ok: false; readonly reason: 'variant'; readonly variant: string }
  | { readonly ok: false; readonly reason: 'element'; readonly element: string }
  | {
      readonly ok: false;
      readonly reason: 'attribute';
      readonly element: string;
      readonly attribute: string;
    }
  | { readonly ok: false; readonly reason: 'text'; readonly element: string }
  | { readonly ok: false; readonly reason: 'space' }
  | { readonly ok: false; readonly reason: 'accent' }
  | { readonly ok: false; readonly reason: 'empty' };

/**
 * The tree, and the words the equation is spoken by - its `alttext`, read as the editor reads it
 * (`equationAlternative`), null where it has none or where it says nothing.
 */
export type MathsConversion =
  | { readonly ok: true; readonly tree: MathsTree; readonly alternative: string | null }
  | MathsRefusal;

class Refused extends Error {
  constructor(readonly refusal: MathsRefusal) {
    super(refusal.reason);
  }
}

/** U+2061 FUNCTION APPLICATION: after an identifier, it makes that identifier an operator's name. */
const FUNCTION_APPLICATION = '\u{2061}';

/**
 * The characters that only say where a line may or may not break - U+00AD SOFT HYPHEN, U+200B ZERO
 * WIDTH SPACE, U+2060 WORD JOINER, and U+FEFF, the joiner's older spelling - dropped from every token
 * before the tree is built (the final review of equations 2, M2). The engine never breaks a line
 * inside a token, so each says nothing there; they are what a paste from a web page or a word
 * processor carries in; and set, each takes the letter before it out of the PDF's text, so "ab",
 * U+200B, "cd" is drawn abcd and copied as acd. Only these: every other character that draws nothing
 * means something - a joiner or a non-joiner changes the shape of the letters around it, a variation
 * selector chooses a glyph, an isolate a direction - and dropping one would set something other than
 * what was written, so the glyph check refuses those instead (`characterProblems`, the maths face).
 */
const BREAK_HINTS = /[\u{AD}\u{200B}\u{2060}\u{FEFF}]/gu;

/** The invisible operators - function application, times, separator, plus - which set nothing. */
const INVISIBLE = new Set(['\u{2061}', '\u{2062}', '\u{2063}', '\u{2064}']);

const OPENING = new Set([
  '(',
  '[',
  '{',
  '|',
  '\u{2016}',
  '\u{2308}',
  '\u{230A}',
  '\u{27E8}',
  '\u{27E6}',
  '\u{2983}',
]);
const CLOSING = new Set([
  ')',
  ']',
  '}',
  '|',
  '\u{2016}',
  '\u{2309}',
  '\u{230B}',
  '\u{27E9}',
  '\u{27E7}',
  '\u{2984}',
]);

/**
 * The named operators whose limits stand above and below them: the spike's list, and the same names
 * as Temml spells them, with a space (`\liminf` is `lim inf`, `\argmax` is `arg max`).
 */
const LIMITS = new Set([
  'lim',
  'liminf',
  'limsup',
  'lim inf',
  'lim sup',
  'inj lim',
  'proj lim',
  'max',
  'min',
  'sup',
  'inf',
  'det',
  'gcd',
  'Pr',
  'argmax',
  'argmin',
  'arg max',
  'arg min',
]);

/**
 * The characters set as an accent over their base even where MathML does not mark them one: Temml
 * marked its accents with a class, which the reader removes, so an accent is known by its character.
 */
const ACCENTS = new Set([
  '\u{2C6}',
  '^',
  '\u{2C7}',
  '\u{2DC}',
  '~',
  '\u{AF}',
  '\u{203E}',
  '\u{2D9}',
  '\u{A8}',
  '\u{2192}',
  '\u{2190}',
  '\u{B4}',
  '`',
  '\u{2D8}',
  '\u{2DA}',
  '\u{20D7}',
  '\u{302}',
  '\u{303}',
  '\u{304}',
  '\u{307}',
  '\u{308}',
]);

/** A line over or under the content: stretchy, as equations 1 stores `\overline` and `\underline`. */
const OVERLINES = new Set(['\u{203E}', '\u{AF}']);
const UNDERLINES = new Set(['_', '\u{203E}']);

/** Each brace by its character, and whether it stands under its content or over it. */
const BRACES: ReadonlyMap<string, { readonly which: MathsBrace; readonly under: boolean }> =
  new Map([
    ['\u{23DF}', { which: 'underbrace', under: true }],
    ['\u{23DE}', { which: 'overbrace', under: false }],
    ['\u{23B5}', { which: 'underbracket', under: true }],
    ['\u{23B4}', { which: 'overbracket', under: false }],
    ['\u{23DD}', { which: 'underparen', under: true }],
    ['\u{23DC}', { which: 'overparen', under: false }],
  ]);

/** How many primes each prime character is. */
const PRIMES: ReadonlyMap<string, number> = new Map([
  ['\u{2032}', 1],
  ['\u{2033}', 2],
  ['\u{2034}', 3],
  ['\u{2057}', 4],
]);

/**
 * Every character the maths tree sets on its own account, by what it is rather than because an
 * equation wrote it: the fences it opens and closes, the accents it sets over a base, the lines over
 * and under, the braces and the primes. The maths face must hold each of them (STY-074), which the
 * worker's test reads from the pinned file's character map; a character an equation writes itself is
 * asked of the face at publish, as `math_glyph_missing`.
 */
export const MATHS_CHARACTERS: ReadonlySet<string> = new Set([
  ...OPENING,
  ...CLOSING,
  ...ACCENTS,
  ...OVERLINES,
  ...UNDERLINES,
  ...BRACES.keys(),
  ...PRIMES.keys(),
]);

/** The `mathvariant`s the engine has a style for. Any other is refused by name. */
const VARIANTS: ReadonlyMap<string, MathsVariant> = new Map([
  ['normal', 'upright'],
  ['italic', 'italic'],
  ['bold', 'bold'],
  ['bold-italic', 'bold-italic'],
  ['double-struck', 'bb'],
  ['script', 'cal'],
  ['fraktur', 'frak'],
  ['sans-serif', 'sans'],
  ['monospace', 'mono'],
]);

const ALIGNMENTS: ReadonlySet<string> = new Set(['left', 'center', 'right']);

/**
 * The widest space, in ems either way, set as the space it is: ten times `\qquad`, the widest LaTeX
 * names, and about half the line the default layout gives at the body's size (41 ems on A4). A space
 * wider takes the equation off its line before anything else in it is set - a block equation is not
 * kept to the line (features.md's width gap) - and one wider than a number can hold (four hundred
 * nines) is written by JSON as nothing at all, which stops the compile (the final review of
 * equations 2, I1). Refused by name, since nothing an author means by a space needs more.
 */
const WIDEST_SPACE = 20;

/** The script levels MathML sets smaller, as the engine's sizes for them: one smaller, and two. */
const SCRIPT_LEVELS: ReadonlyMap<string, 'script' | 'sscript'> = new Map([
  ['1', 'script'],
  ['2', 'sscript'],
]);

/**
 * Allowed on any element: its direction, where only left to right is set, and `intent` and `arg`,
 * which tell a speech engine how to read the maths and draw nothing - the alternative is what a
 * reader hears.
 */
const EVERYWHERE = new Set(['dir', 'intent', 'arg']);

/**
 * Every element this maps, with the attributes it has a decision about on that element; anything
 * else on it is refused. A `Map`, as the reader's entities are, so that no name falls through to
 * `Object.prototype`. `merror` is not here: it is refused by name before this is asked.
 *
 * Read but set as nothing: an operator's `fence`, `form`, `separator`, `lspace`, `rspace` and
 * `symmetric`, since the engine spaces and stretches an operator from its own table as MathML Core's
 * dictionary would; its `minsize` and `maxsize`, **which the engine does not honour** - `\big(` is set
 * as `(` at its own size, the one place a bracket is smaller than the author asked; a space's
 * `height` and `depth` (a strut); a padded box's `width`, `height`, `depth` and `lspace`, **so
 * `\mathrlap` and `\smash` take the room their content does**; and an annotation's `encoding`.
 */
const ATTRIBUTES: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  (
    [
      ['math', ['xmlns', 'display', 'alttext']],
      ['mrow', []],
      ['mi', ['mathvariant']],
      ['mn', []],
      [
        'mo',
        [
          'fence',
          'form',
          'largeop',
          'lspace',
          'maxsize',
          'minsize',
          'movablelimits',
          'rspace',
          'separator',
          'stretchy',
          'symmetric',
        ],
      ],
      ['mtext', []],
      ['ms', []],
      ['mspace', ['width', 'height', 'depth']],
      ['mfrac', ['linethickness']],
      ['msqrt', []],
      ['mroot', []],
      ['msub', []],
      ['msup', []],
      ['msubsup', []],
      ['munder', ['accentunder']],
      ['mover', ['accent']],
      ['munderover', ['accent', 'accentunder']],
      ['mtable', ['columnalign', 'displaystyle']],
      ['mtr', ['columnalign']],
      ['mtd', ['columnalign', 'columnspan', 'rowspan']],
      ['mstyle', ['displaystyle', 'scriptlevel']],
      ['mpadded', ['width', 'height', 'depth', 'lspace', 'voffset']],
      ['mphantom', []],
      ['mmultiscripts', []],
      ['mprescripts', []],
      ['none', []],
      ['semantics', []],
      ['annotation', ['encoding']],
    ] as const
  ).map(([element, attributes]) => [element, new Set<string>(attributes)]),
);

const BOOLEANS = new Set([
  'accent',
  'accentunder',
  'displaystyle',
  'fence',
  'largeop',
  'movablelimits',
  'separator',
  'stretchy',
  'symmetric',
]);

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });
const graphemeCount = (text: string) => [...graphemes.segment(text)].length;

/**
 * An equation's stored MathML as its maths tree and its alternative, or the reason it cannot be set.
 * Pure, and it never throws for what the MathML holds: every refusal is returned by name.
 */
export function mathsTree(mathml: string): MathsConversion {
  const read = readMathmlTree(mathml);
  if (!read.ok) return { ok: false, reason: 'unreadable' };
  try {
    const root = read.root;
    if (root.name !== 'math') refuseElement(root);
    attributesOf(root);
    const tree = row(elementsOf(root));
    // Asked once the whole equation is known to be one the tree maps, so what it holds is named first.
    if (drawsNothing(root)) return { ok: false, reason: 'empty' };
    return { ok: true, tree, alternative: equationAlternative(mathml) };
  } catch (error) {
    if (error instanceof Refused) return error.refusal;
    throw error;
  }
}

function refuseElement(element: MathElement): never {
  throw new Refused(
    element.name === 'merror'
      ? { ok: false, reason: 'error' }
      : { ok: false, reason: 'element', element: element.name },
  );
}

function refuseAttribute(element: MathElement, attribute: string): never {
  throw new Refused({ ok: false, reason: 'attribute', element: element.name, attribute });
}

/** An attribute as the reader read it, before it is checked: for looking ahead at a neighbour. */
function rawAttribute(element: MathElement, name: string): string | undefined {
  return element.attributes.find(([attribute]) => attribute === name)?.[1];
}

/**
 * The element's attributes, each checked: one this does not map on this element, or a value it has
 * no mapping for, refuses the equation, as do the constructs refused on purpose that an attribute
 * carries - right to left, a vertical offset, a spanning cell, an unknown variant.
 */
function attributesOf(element: MathElement): ReadonlyMap<string, string> {
  if (element.name === 'merror') refuseElement(element);
  const known = ATTRIBUTES.get(element.name);
  if (known === undefined) refuseElement(element);
  const values = new Map(element.attributes);
  for (const [attribute, value] of element.attributes) {
    if (!known.has(attribute) && !EVERYWHERE.has(attribute)) refuseAttribute(element, attribute);
    if (!acceptable(element, attribute, value, values)) refuseAttribute(element, attribute);
  }
  return values;
}

function acceptable(
  element: MathElement,
  attribute: string,
  value: string,
  values: ReadonlyMap<string, string>,
): boolean {
  if (BOOLEANS.has(attribute)) return value === 'true' || value === 'false';
  switch (attribute) {
    case 'dir':
      if (value === 'rtl') throw new Refused({ ok: false, reason: 'rightToLeft' });
      return value === 'ltr';
    case 'xmlns':
      return value === MATHML_NAMESPACE;
    case 'display':
      return value === 'block' || value === 'inline';
    case 'form':
      return value === 'prefix' || value === 'infix' || value === 'postfix';
    case 'mathvariant':
      if (!VARIANTS.has(value)) throw new Refused({ ok: false, reason: 'variant', variant: value });
      return true;
    // The level a style sets anyway, where it names a style: the engine's display and inline styles
    // are both at the first level. Or a level smaller, one or two, in no style or the inline one, as
    // `\substack`, `smallmatrix` and `subarray` write it, and `\scriptstyle` and `\scriptscriptstyle`
    // (the final review of equations 2, I2). A level counted from the one around it (`+1`) is not
    // mapped: an absolute level is all Temml writes. Nor is a third, which the engine has no size for.
    case 'scriptlevel':
      if (SCRIPT_LEVELS.has(value)) return values.get('displaystyle') !== 'true';
      return value === '0' && values.has('displaystyle');
    case 'columnalign': {
      const alignments = value.split(/[ \t\n\r]+/).filter((each) => each !== '');
      return (
        alignments.length > 0 &&
        (element.name !== 'mtd' || alignments.length === 1) &&
        alignments.every((each) => ALIGNMENTS.has(each))
      );
    }
    case 'columnspan':
    case 'rowspan':
      if (!/^[1-9][0-9]*$/.test(value)) return false;
      if (value !== '1') throw new Refused({ ok: false, reason: 'spanningCell' });
      return true;
    case 'voffset':
      if (ems(value) !== 0) throw new Refused({ ok: false, reason: 'offset' });
      return true;
    case 'width': {
      if (element.name !== 'mspace') return true;
      const width = ems(value);
      if (width === undefined) return false;
      if (!(Math.abs(width) <= WIDEST_SPACE)) throw new Refused({ ok: false, reason: 'space' });
      return true;
    }
    default:
      return true;
  }
}

/**
 * A length in ems of the text it stands in: MathML's units, with a point and a pixel taken at the
 * body text's size, an `ex` at 0.45 em (the spike's figure) and a `mu` at an eighteenth of an em, as
 * TeX has it. A bare number is ems. Undefined where it is not a length this reads (`1fill`, `10%`).
 */
function ems(value: string): number | undefined {
  const length = /^(-?(?:[0-9]+\.?[0-9]*|\.[0-9]+))(em|ex|pt|px|mu)?$/.exec(value.trim());
  if (length === null) return undefined;
  const size = Number(length[1]);
  switch (length[2]) {
    case 'ex':
      return size * 0.45;
    case 'pt':
      return size / BODY_SIZE;
    case 'px':
      return (size * 0.75) / BODY_SIZE;
    case 'mu':
      return size / 18;
    default:
      return size;
  }
}

const lineless = (fraction: MathElement) => {
  const thickness = rawAttribute(fraction, 'linethickness');
  return thickness !== undefined && ems(thickness) === 0;
};

/** An element's element children. Whitespace between them is markup; any other text is refused. */
function elementsOf(element: MathElement): MathElement[] {
  const elements: MathElement[] = [];
  for (const child of element.children) {
    if (typeof child !== 'string') elements.push(child);
    else if (child.replace(/[ \t\n\r]/g, '') !== '') {
      throw new Refused({ ok: false, reason: 'text', element: element.name });
    }
  }
  return elements;
}

/** Exactly this many element children, or the element is refused as one this cannot set. */
function partsOf(element: MathElement, count: number): MathElement[] {
  const parts = elementsOf(element);
  if (parts.length !== count) refuseElement(element);
  return parts;
}

/**
 * A token element's text, without the marks that only say where a line may break (`BREAK_HINTS`).
 * The reader keeps no element inside a token.
 */
function tokenText(element: MathElement): string {
  let text = '';
  for (const child of element.children) {
    if (typeof child !== 'string') refuseElement(child);
    text += child;
  }
  return text.replace(BREAK_HINTS, '');
}

const EMPTY: MathsNode = { k: 'row', c: [] };

/** A node where one must stand: nothing there - an empty identifier - is an empty row. */
const required = (element: MathElement, applied = false) => node(element, applied) ?? EMPTY;

/**
 * A row of elements, one node where it has one. An identifier followed by U+2061 is an operator's
 * name (`applied`); inside fences that stretch, an operator marked stretchy stretches with them.
 */
function row(elements: readonly MathElement[], middle = false): MathsNode {
  const nodes: MathsNode[] = [];
  elements.forEach((element, index) => {
    const next = elements[index + 1];
    const applied = next?.name === 'mo' && tokenText(next) === FUNCTION_APPLICATION;
    const converted = node(element, applied, middle);
    if (converted !== null) nodes.push(converted);
  });
  return nodes.length === 1 ? nodes[0]! : { k: 'row', c: nodes };
}

/** One element's node, or null where it sets nothing: an empty token, an invisible operator. */
function node(element: MathElement, applied = false, middle = false): MathsNode | null {
  const attributes = attributesOf(element);
  switch (element.name) {
    case 'mrow':
      return mrow(element);
    case 'mstyle': {
      const body = row(elementsOf(element));
      // A level smaller is the engine's script size, whose style is the inline one already.
      const level = SCRIPT_LEVELS.get(attributes.get('scriptlevel') ?? '');
      if (level !== undefined) return { k: level, body };
      const style = attributes.get('displaystyle');
      if (style === 'true') return { k: 'display', body };
      if (style === 'false') return { k: 'inline', body };
      return body;
    }
    case 'mpadded':
      return row(elementsOf(element));
    case 'mphantom':
      return { k: 'phantom', body: row(elementsOf(element)) };
    case 'semantics': {
      const [presentation, ...annotations] = elementsOf(element);
      if (presentation === undefined || presentation.name === 'annotation') refuseElement(element);
      for (const annotation of annotations) {
        if (annotation.name !== 'annotation') refuseElement(annotation);
        attributesOf(annotation);
        tokenText(annotation);
      }
      return node(presentation, applied, middle);
    }
    case 'mi': {
      const t = tokenText(element);
      if (t === '') return null;
      if (applied) return { k: 'op', t, limits: LIMITS.has(t) };
      const variant = attributes.get('mathvariant');
      if (variant !== undefined) return { k: 'i', t, v: VARIANTS.get(variant)! };
      return { k: 'i', t, v: graphemeCount(t) === 1 ? 'italic' : 'upright' };
    }
    case 'mn':
      return { k: 'n', t: tokenText(element) };
    case 'mo': {
      const t = tokenText(element);
      if (t === '' || INVISIBLE.has(t)) return null;
      if (middle && attributes.get('stretchy') === 'true') return { k: 'mid', t };
      return attributes.get('largeop') === 'true' ? { k: 'o', t, large: true } : { k: 'o', t };
    }
    case 'mtext':
      return { k: 'text', t: tokenText(element) };
    // A string literal, which MathML Core draws between quotation marks.
    case 'ms':
      return { k: 'text', t: `"${tokenText(element)}"` };
    case 'mspace': {
      const width = attributes.get('width');
      return { k: 'space', em: width === undefined ? 0 : ems(width)! };
    }
    case 'mfrac': {
      const [numerator, denominator] = partsOf(element, 2);
      return {
        k: lineless(element) ? 'stack' : 'frac',
        n: required(numerator!),
        d: required(denominator!),
      };
    }
    case 'msqrt':
      return { k: 'sqrt', body: row(elementsOf(element)) };
    case 'mroot': {
      const [body, index] = partsOf(element, 2);
      return { k: 'root', index: required(index!), body: required(body!) };
    }
    case 'msub':
    case 'msup':
    case 'msubsup':
      return scripts(element, applied);
    case 'munder':
    case 'mover':
    case 'munderover':
      return underOver(element, attributes, applied);
    case 'mtable':
      return { k: 'mat', open: '', close: '', ...table(element) };
    case 'mmultiscripts':
      return multiscripts(element);
    default:
      // `math` inside an equation, and an annotation, a cell, a row, `none` or `mprescripts` standing
      // anywhere but where they belong.
      return refuseElement(element);
  }
}

/**
 * A row, and the three things a row can be besides: a binomial - a fraction with no line between
 * brackets - and content between fences that stretch, which is a `cases` block where it is a table
 * after a left brace alone and a matrix where it is a table between two fences.
 */
function mrow(element: MathElement): MathsNode {
  const children = elementsOf(element);
  const [open, fraction, close] = children;
  if (
    children.length === 3 &&
    open!.name === 'mo' &&
    close!.name === 'mo' &&
    fraction!.name === 'mfrac' &&
    tokenText(open!) === '(' &&
    tokenText(close!) === ')' &&
    lineless(fraction!)
  ) {
    attributesOf(open!);
    attributesOf(close!);
    attributesOf(fraction!);
    const [numerator, denominator] = partsOf(fraction!, 2);
    return { k: 'binom', n: required(numerator!), d: required(denominator!) };
  }

  const fence = fencesOf(children);
  if (fence === null) return row(children);
  attributesOf(children[0]!);
  attributesOf(children[children.length - 1]!);
  const inner = children.slice(1, -1);
  if (inner.length === 1 && inner[0]!.name === 'mtable') {
    if (fence.open === '{' && fence.close === '') {
      const { rows, columns } = table(inner[0]!);
      return { k: 'cases', rows, columns };
    }
    if (fence.open !== '' && fence.close !== '') return { k: 'mat', ...fence, ...table(inner[0]!) };
  }
  return { k: 'lr', ...fence, body: row(inner, true) };
}

/**
 * The fences at the ends of a row, where both are operators that stretch - MathML Core stretches a
 * bracket unless told not to, and Temml writes `stretchy="false"` on a plain one - and at least one
 * draws something. Null where the row is not fenced.
 */
function fencesOf(
  children: readonly MathElement[],
): { readonly open: string; readonly close: string } | null {
  if (children.length < 2) return null;
  const fence = (element: MathElement, characters: ReadonlySet<string>) => {
    if (element.name !== 'mo' || rawAttribute(element, 'stretchy') === 'false') return undefined;
    const t = tokenText(element);
    return t === '' || characters.has(t) ? t : undefined;
  };
  const open = fence(children[0]!, OPENING);
  const close = fence(children[children.length - 1]!, CLOSING);
  if (open === undefined || close === undefined || (open === '' && close === '')) return null;
  return { open, close };
}

/**
 * Scripts beside a base. A superscript of nothing but primes is a count of primes, which the engine
 * sets as one glyph where it has one; set as operators one after another they stand apart.
 */
function scripts(element: MathElement, applied: boolean): MathsNode {
  const parts = partsOf(element, element.name === 'msubsup' ? 3 : 2);
  const base = required(parts[0]!, applied);
  const below = element.name === 'msup' ? undefined : parts[1];
  const above = element.name === 'msub' ? undefined : parts[parts.length - 1];
  return {
    k: 'attach',
    mode: 'scripts',
    base,
    ...(below === undefined ? {} : { b: required(below) }),
    ...(above === undefined ? {} : { t: primesOf(above) ?? required(above) }),
  };
}

/** A count of primes, where the script is nothing but prime characters, one or a row of them. */
function primesOf(script: MathElement): MathsNode | null {
  const operators = script.name === 'mrow' ? elementsOf(script) : [script];
  let count = 0;
  for (const operator of operators) {
    if (operator.name !== 'mo') return null;
    const primes = PRIMES.get(tokenText(operator));
    if (primes === undefined) return null;
    count += primes;
  }
  if (count === 0) return null;
  if (script.name === 'mrow') attributesOf(script);
  operators.forEach(attributesOf);
  return { k: 'primes', count };
}

/**
 * Scripts under and over a base, and what such a pair is besides: a brace under or over its content,
 * with a label beyond it where a second pair holds one; a line over or under it, stretched, as
 * equations 1 stores `\overline` and `\underline` - a line that does not stretch is a bar, an accent;
 * and an accent, one character over its base, known by its character unless MathML says it is not
 * one (`accent="false"`).
 *
 * An accent is known by what a reader sees - one grapheme - but the engine's accent takes exactly one
 * character, and stops the compile for more. So one that is still more than one once composed (NFC) -
 * x and U+0302, which no single character composes - is refused by name, and one that composes is set
 * as the one character it composes to (the final review of equations 2, I1).
 */
function underOver(
  element: MathElement,
  attributes: ReadonlyMap<string, string>,
  applied: boolean,
): MathsNode {
  const parts = partsOf(element, element.name === 'munderover' ? 3 : 2);
  const [base, first] = parts as [MathElement, MathElement];

  if (element.name !== 'munderover') {
    const under = element.name === 'munder';
    const brace = braceOf(first, under);
    if (brace !== undefined) return { k: 'brace', which: brace, body: required(base) };
    if (base.name === element.name) {
      const inner = elementsOf(base);
      const labelled = inner.length === 2 ? braceOf(inner[1]!, under) : undefined;
      if (labelled !== undefined) {
        attributesOf(base);
        return { k: 'brace', which: labelled, body: required(inner[0]!), label: required(first) };
      }
    }
    if (first.name === 'mo') {
      const t = tokenText(first);
      const stretches = rawAttribute(first, 'stretchy') !== 'false';
      const lines = under ? UNDERLINES : OVERLINES;
      if (stretches && lines.has(t)) {
        attributesOf(first);
        return { k: 'line', which: under ? 'underline' : 'overline', body: required(base) };
      }
      const accent = attributes.get('accent');
      if (
        !under &&
        accent !== 'false' &&
        (accent === 'true' || ACCENTS.has(t)) &&
        graphemeCount(t) === 1
      ) {
        attributesOf(first);
        const composed = t.normalize('NFC');
        if ([...composed].length !== 1) throw new Refused({ ok: false, reason: 'accent' });
        return { k: 'accent', body: required(base), a: composed };
      }
    }
  }

  const movable = base.name === 'mo' && rawAttribute(base, 'movablelimits') === 'true';
  const below = element.name === 'mover' ? undefined : first;
  const above = element.name === 'munder' ? undefined : parts[parts.length - 1];
  return {
    k: 'attach',
    mode: movable ? 'limits-display' : 'limits',
    base: required(base, applied),
    ...(below === undefined ? {} : { b: required(below) }),
    ...(above === undefined ? {} : { t: required(above) }),
  };
}

/** The brace a script is, where it is a brace's character on the side its element sets it. */
function braceOf(script: MathElement, under: boolean): MathsBrace | undefined {
  if (script.name !== 'mo') return undefined;
  const brace = BRACES.get(tokenText(script));
  if (brace === undefined || brace.under !== under) return undefined;
  attributesOf(script);
  return brace.which;
}

/**
 * Scripts at a base's corners: one pair after it and one before, either of a pair `none`. More than
 * one pair on a side has no place in the engine's attachments and is refused.
 */
function multiscripts(element: MathElement): MathsNode {
  const [baseElement, ...rest] = elementsOf(element);
  if (baseElement === undefined) refuseElement(element);
  const at = rest.findIndex((each) => each.name === 'mprescripts');
  const after = at === -1 ? rest : rest.slice(0, at);
  const before = at === -1 ? [] : rest.slice(at + 1);
  if (after.length > 2 || before.length > 2) throw new Refused({ ok: false, reason: 'scripts' });
  if (after.length % 2 !== 0 || before.length % 2 !== 0) refuseElement(element);
  if (at !== -1) attributesOf(rest[at]!);
  const script = (key: 'br' | 'tr' | 'bl' | 'tl', each: MathElement | undefined) => {
    if (each === undefined) return {};
    if (each.name === 'none') {
      attributesOf(each);
      return {};
    }
    return { [key]: required(each) };
  };
  return {
    k: 'attach',
    mode: 'scripts',
    base: required(baseElement),
    ...script('br', after[0]),
    ...script('tr', after[1]),
    ...script('bl', before[0]),
    ...script('tl', before[1]),
  };
}

/**
 * A table's rows and the alignment of each column. A cell is aligned by its own `columnalign`, then
 * its row's, then its table's - a list, one per column, its last repeated - and centred where none
 * says. A column's cells aligned two ways cannot be set, since the engine aligns a column as one, and
 * is refused as the cell's alignment.
 */
function table(element: MathElement): {
  readonly rows: MathsNode[][];
  readonly columns: MathsAlignment[];
  readonly display: boolean;
} {
  const attributes = attributesOf(element);
  const listed = (value: string | undefined) =>
    (value ?? '').split(/[ \t\n\r]+/).filter((each) => each !== '') as MathsAlignment[];
  const pick = (list: readonly MathsAlignment[], index: number) =>
    list.length === 0 ? undefined : list[Math.min(index, list.length - 1)];
  const tableAlignment = listed(attributes.get('columnalign'));

  const rows: MathsNode[][] = [];
  const columns: MathsAlignment[] = [];
  for (const tableRow of elementsOf(element)) {
    if (tableRow.name !== 'mtr') refuseElement(tableRow);
    const rowAlignment = listed(attributesOf(tableRow).get('columnalign'));
    const cells: MathsNode[] = [];
    elementsOf(tableRow).forEach((cell, index) => {
      if (cell.name !== 'mtd') refuseElement(cell);
      const own = attributesOf(cell).get('columnalign') as MathsAlignment | undefined;
      const alignment = own ?? pick(rowAlignment, index) ?? pick(tableAlignment, index) ?? 'center';
      if (columns[index] === undefined) columns[index] = alignment;
      else if (columns[index] !== alignment) refuseAttribute(cell, 'columnalign');
      cells.push(row(elementsOf(cell)));
    });
    rows.push(cells);
  }
  return { rows, columns, display: attributes.get('displaystyle') === 'true' };
}

/**
 * **Every string a tree sets**, in the order a writer sets them (equations 2, ruling R3): what the
 * glyph check asks the maths face of, as a paragraph's text is asked of the body face. An identifier's,
 * a number's, an operator's, a named operator's and a text's characters, an accent's, and the fences of
 * a pair and of a matrix. What a writer draws rather than sets from a character the content holds - a
 * fraction's bar, a radical, a brace, a prime, the brace of cases, and an overline's or an underline's
 * line, whose node keeps no character (the template draws it with the engine's own) - is not here: it
 * is the template's own, drawn from the pinned face, and the same whatever the author wrote.
 *
 * **A branch per kind, and a `default:` that refuses what it cannot name**, so a kind added to
 * `MathsNode` fails to compile here rather than its characters going unchecked.
 */
export function mathsText(node: MathsNode): string {
  switch (node.k) {
    case 'i':
    case 'n':
    case 'o':
    case 'mid':
    case 'op':
    case 'text':
      return node.t;
    case 'primes':
    case 'space':
      return '';
    case 'row':
      return node.c.map(mathsText).join('');
    case 'frac':
    case 'stack':
    case 'binom':
      return mathsText(node.n) + mathsText(node.d);
    case 'sqrt':
    case 'phantom':
    case 'display':
    case 'inline':
    case 'script':
    case 'sscript':
    case 'line':
      return mathsText(node.body);
    case 'root':
      return mathsText(node.index) + mathsText(node.body);
    case 'attach':
      return [node.tl, node.bl, node.base, node.b, node.t, node.tr, node.br]
        .map((part) => (part === undefined ? '' : mathsText(part)))
        .join('');
    case 'accent':
      return mathsText(node.body) + node.a;
    case 'brace':
      return mathsText(node.body) + (node.label === undefined ? '' : mathsText(node.label));
    case 'lr':
      return node.open + mathsText(node.body) + node.close;
    case 'mat':
      return node.open + node.rows.flat().map(mathsText).join('') + node.close;
    case 'cases':
      return node.rows.flat().map(mathsText).join('');
    default: {
      const unreachable: never = node;
      throw new Error(`No characters for a maths node of kind ${(unreachable as MathsNode).k}`);
    }
  }
}
