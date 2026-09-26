import { escapeXml } from '../content/ooxml/xml.js';
import type { MathsAlignment, MathsNode, MathsTree } from '../publishing/maths.js';

/**
 * **The maths tree as OMML** (Word 4, ruling R3; word-output.md's Equations): an equation's content
 * as Word's own equation markup, built from the tree the PDF's template sets (`mathsTree`), never from
 * MathML and never from its source, so a Word equation and a PDF one are one conversion apart. Each
 * kind of node is written as M11 measured Word to set it (spikes/word-measure), and what the writer
 * adds around it - `m:oMath` or `m:oMathPara`, and `m:mathPr` naming Cambria Math - is the writer's.
 *
 * **Where OMML and the tree disagree, the operand rule.** MathML and the engine set a sum's operand
 * beside the sum and a function's argument beside its name; OMML holds each inside (`m:nary`'s and
 * `m:func`'s `m:e`). So a large operator, and a named operator, takes the next node in its row into
 * itself (`sequence`): spaces before it with it, an opening bracket with everything to its matching
 * close, and a large or named operator with what that one takes in turn. A group within a row is read
 * as the nodes it holds, since OMML has no group and sets a group's nodes exactly as it sets them in the
 * row around it; that is what lets Temml's `\sin x`, whose sine is grouped with its space and whose
 * argument follows the group, reach its argument. Where nothing follows, a large operator holds
 * nothing - Word draws no placeholder for an empty argument, measured - and a named operator is its
 * name alone, which is all a function with no argument would set.
 *
 * **What it approximates, since OMML cannot say it.** A part in the display style or the inline one
 * (`display`, `inline`): Word sets every part in the equation's own style, so the style decides only
 * where limits that move (`limits-display`) stand, above and below or beside. A part a script level
 * smaller or two (`script`, `sscript`): set at Cambria Math's own script sizes (73% and 60%, its MATH
 * table) as an explicit size on every run and object in it, where it stands in running maths; where
 * Word already sets it smaller - in a script, a limit or a degree - as Word sets it there, one level
 * larger than the PDF for `sscript` in a script. A space: the space characters Cambria Math has, to the
 * eighteenth of an em, and a negative one as nothing, since Word has no space that takes room away.
 *
 * Pure: every string in the tree is a value, escaped, and nothing is read but the tree.
 */

/** What the converter is told about where the equation stands. */
export interface OmmlOptions {
  /** Whether the equation is displayed in a paragraph of its own, or set in a line of text. */
  readonly display: boolean;
  /** The size in points of the text the equation stands in: what a smaller script level is taken from. */
  readonly size: number;
  /**
   * The Word family text inside the equation is set in: the maths face's Word face, as the PDF sets
   * text in the maths face (Word 4's ledger, correcting the design's body face). Word sets normal text
   * in the body face unless its run names another (measured, task 2), where it sets maths runs in
   * `m:mathPr`'s face without one (M11).
   */
  readonly face: string;
}

/**
 * Cambria Math's script sizes, from its MATH table (`ScriptPercentScaleDown`, 73, and
 * `ScriptScriptPercentScaleDown`, 60): the face Word sets every equation in, so a part set smaller by
 * hand matches the scripts Word sets smaller itself.
 */
const SCRIPT = 0.73;
const SCRIPT_SCRIPT = 0.6;

/**
 * The large operators Word sets as `m:nary`, by character: those Unicode's maths classes call large
 * (MathClass `L`) that take an operand - the sums, products, coproducts, integrals, the n-ary logical
 * and set operators and their circled and squared kin. The engine knows a large operator by its class,
 * so Temml need not mark one `largeop`, and does not; one it marks is large whatever its character.
 */
const LARGE = new Set([
  '\u{2140}',
  '\u{220F}',
  '\u{2210}',
  '\u{2211}',
  ...range(0x222b, 0x2233),
  ...range(0x22c0, 0x22c3),
  ...range(0x2a00, 0x2a1c),
  '\u{2AFC}',
  '\u{2AFF}',
]);

function range(from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, index) => String.fromCodePoint(from + index));
}

/**
 * Each accent the tree holds as the combining character Word's `m:acc` draws over its base. The tree
 * keeps the spacing characters Temml writes (`\hat` is U+02C6, `\bar` U+203E, `\vec` U+2192), which
 * the engine maps itself; Word sets U+02C6 and U+203E acceptably but draws U+2192 through its base
 * (measured), so every spacing accent is written as its combining form, and a combining one as it is.
 * `\bar` and an overline's macron are Word's own bar accent, U+0305.
 */
const COMBINING: ReadonlyMap<string, string> = new Map([
  ['\u{2C6}', '\u{302}'],
  ['^', '\u{302}'],
  ['\u{2C7}', '\u{30C}'],
  ['\u{2DC}', '\u{303}'],
  ['~', '\u{303}'],
  ['\u{AF}', '\u{305}'],
  ['\u{203E}', '\u{305}'],
  ['\u{2D9}', '\u{307}'],
  ['\u{A8}', '\u{308}'],
  ['\u{2192}', '\u{20D7}'],
  ['\u{2190}', '\u{20D6}'],
  ['\u{B4}', '\u{301}'],
  ['`', '\u{300}'],
  ['\u{2D8}', '\u{306}'],
  ['\u{2DA}', '\u{30A}'],
]);

/** Each brace by its character and the side it stands on, as `m:groupChr` takes them. */
const BRACES = {
  underbrace: { chr: '\u{23DF}', over: false },
  overbrace: { chr: '\u{23DE}', over: true },
  underbracket: { chr: '\u{23B5}', over: false },
  overbracket: { chr: '\u{23B4}', over: true },
  underparen: { chr: '\u{23DD}', over: false },
  overparen: { chr: '\u{23DC}', over: true },
} as const;

/** Each bracket that opens, by the bracket that closes it; a bar closes itself. */
const PAIRS: ReadonlyMap<string, string> = new Map([
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
  ['|', '|'],
  ['\u{2016}', '\u{2016}'],
  ['\u{2308}', '\u{2309}'],
  ['\u{230A}', '\u{230B}'],
  ['\u{27E8}', '\u{27E9}'],
  ['\u{27E6}', '\u{27E7}'],
  ['\u{2983}', '\u{2984}'],
]);

/**
 * The space characters Cambria Math has, by their width in eighteenths of an em (read from its
 * `hmtx`): em, en, three-per-em, medium mathematical, six-per-em and hair.
 */
const SPACES: readonly (readonly [number, string])[] = [
  [18, '\u{2003}'],
  [9, '\u{2002}'],
  [6, '\u{2004}'],
  [4, '\u{205F}'],
  [3, '\u{2006}'],
  [1, '\u{200A}'],
];

/**
 * For each width under an em, in eighteenths, the fewest of those characters that make it, the widest
 * first.
 */
const UNDER_AN_EM: readonly string[] = (() => {
  const best: string[] = [''];
  for (let width = 1; width < 18; width++) {
    let fewest: string | undefined;
    for (const [each, character] of SPACES) {
      if (each > width) continue;
      const made = character + best[width - each]!;
      if (fewest === undefined || [...made].length < [...fewest].length) fewest = made;
    }
    best.push(fewest!);
  }
  return best;
})();

/** Where a node stands: what decides its limits, its size and how an ampersand in it is read. */
interface Context {
  readonly display: boolean;
  readonly size: number;
  /** How many script levels Word itself sets this deep: in a script or a limit one, in a degree two. */
  readonly depth: number;
  /** The size in half points stated on every run and object, where a script level has been set. */
  readonly halfPoints?: number;
  /** Whether this stands in an equation array, where Word reads an ampersand as an alignment point. */
  readonly array: boolean;
  /** The Word family normal text is set in (`OmmlOptions.face`). */
  readonly face: string;
}

/**
 * An equation's content as OMML: what goes inside the `m:oMath` the writer wraps it in. Pure and
 * deterministic; every string escaped.
 */
export function omml(tree: MathsTree, options: OmmlOptions): string {
  return argument(tree, {
    display: options.display,
    size: options.size,
    depth: 0,
    array: false,
    face: options.face,
  });
}

/** A node where an argument stands: a row of one where it is not a row. */
function argument(node: MathsNode, context: Context): string {
  return sequence(spliced(node.k === 'row' ? node.c : [node]), context);
}

/** A row's nodes with every group in it read as the nodes it holds, however deep. */
function spliced(nodes: readonly MathsNode[]): MathsNode[] {
  return nodes.flatMap((node) => (node.k === 'row' ? spliced(node.c) : [node]));
}

const deeper = (context: Context, levels = 1): Context => ({
  ...context,
  depth: context.depth + levels,
});

/** Whether a node is a large operator Word sets as `m:nary`: alone, or the base of its limits. */
function isLarge(node: MathsNode): boolean {
  const operator = node.k === 'attach' ? node.base : node;
  if (operator.k !== 'o' || [...operator.t].length !== 1) return false;
  if (operator.large !== true && !LARGE.has(operator.t)) return false;
  // An n-ary operator has one limit under or beside it and one over: none at its corners, and no
  // primes, which are set after a base rather than as its limit.
  return (
    node.k !== 'attach' ||
    (node.tl === undefined &&
      node.bl === undefined &&
      node.tr === undefined &&
      node.br === undefined &&
      node.t?.k !== 'primes')
  );
}

/** Whether a node is a named operator, alone or with its scripts: what Word sets as `m:func`. */
const isNamed = (node: MathsNode) => (node.k === 'attach' ? node.base : node).k === 'op';

/**
 * A row's nodes in order, each large operator and named operator holding its operand (the operand
 * rule, above).
 */
function sequence(nodes: readonly MathsNode[], context: Context): string {
  let xml = '';
  for (let index = 0; index < nodes.length;) {
    const [written, next] = take(nodes, index, context);
    xml += written;
    index = next;
  }
  return xml;
}

/** The node at `index` with whatever it takes, and the index after the last node it took. */
function take(nodes: readonly MathsNode[], index: number, context: Context): [string, number] {
  const node = nodes[index]!;
  const large = isLarge(node);
  if (!large && !isNamed(node)) return [write(node, context), index + 1];

  let at = index + 1;
  let operand = '';
  while (at < nodes.length && nodes[at]!.k === 'space') operand += write(nodes[at++]!, context);
  if (at < nodes.length) {
    const close = closing(nodes, at);
    if (close === undefined) {
      const [taken, next] = take(nodes, at, context);
      operand += taken;
      at = next;
    } else {
      operand += sequence(nodes.slice(at, close + 1), context);
      at = close + 1;
    }
  } else if (!large) {
    // Nothing that draws follows: the name alone, and the spaces after it as they were.
    return [write(node, context) + operand, at];
  }
  return [large ? nary(node, operand, context) : func(node, operand, context), at];
}

/**
 * Where an opening bracket at `at` is closed, counting the brackets between; the last node where it
 * is never closed. Undefined where the node there opens nothing.
 */
function closing(nodes: readonly MathsNode[], at: number): number | undefined {
  const node = nodes[at]!;
  if (node.k !== 'o' || !PAIRS.has(node.t)) return undefined;
  const open: string[] = [];
  for (let index = at; index < nodes.length; index++) {
    const each = nodes[index]!;
    if (each.k !== 'o') continue;
    if (open.length > 0 && PAIRS.get(open[open.length - 1]!) === each.t) open.pop();
    else if (PAIRS.has(each.t)) open.push(each.t);
    if (open.length === 0) return index;
  }
  return nodes.length - 1;
}

/** A large operator as `m:nary`, its limits where the PDF sets them and the operand it took inside. */
function nary(node: MathsNode, operand: string, context: Context): string {
  const operator = (node.k === 'attach' ? node.base : node) as { readonly t: string };
  const limits = node.k === 'attach' ? node : undefined;
  const beside =
    limits === undefined
      ? undefined
      : limits.mode === 'scripts' || (limits.mode === 'limits-display' && !context.display);
  const script = deeper(context);
  const properties =
    `<m:chr m:val="${escapeXml(operator.t)}"/>` +
    (beside === undefined ? '' : `<m:limLoc m:val="${beside ? 'subSup' : 'undOvr'}"/>`) +
    (limits?.b === undefined ? '<m:subHide m:val="1"/>' : '') +
    (limits?.t === undefined ? '<m:supHide m:val="1"/>' : '');
  return (
    `<m:nary>${pr('nary', properties, context)}` +
    `<m:sub>${limits?.b === undefined ? '' : argument(limits.b, script)}</m:sub>` +
    `<m:sup>${limits?.t === undefined ? '' : argument(limits.t, script)}</m:sup>` +
    `<m:e>${operand}</m:e></m:nary>`
  );
}

/** A named operator, with its scripts or limits, as `m:func` holding the argument it took. */
function func(node: MathsNode, argumentXml: string, context: Context): string {
  return (
    `<m:func>${pr('func', '', context)}<m:fName>${write(node, context)}</m:fName>` +
    `<m:e>${argumentXml}</m:e></m:func>`
  );
}

/** One node as OMML, taking nothing from beside it. */
function write(node: MathsNode, context: Context): string {
  switch (node.k) {
    case 'row':
      return argument(node, context);
    case 'i':
      return run(node.t, variant(node.v), context);
    case 'n':
      return run(node.t, '<m:sty m:val="p"/>', context);
    case 'o':
    case 'mid':
      // An operator is set by its character, Word spacing it by its class; one spelled in letters
      // upright, as MathML sets an operator.
      return run(node.t, /\p{L}/u.test(node.t) ? '<m:sty m:val="p"/>' : '', context);
    case 'op':
      return run(node.t, '<m:sty m:val="p"/>', context);
    case 'primes':
      // As M11 measured: the prime characters after their base, which Cambria Math raises itself.
      return run('\u{2032}'.repeat(node.count), '', context);
    case 'text':
      return run(node.t, '<m:nor/>', context);
    case 'space':
      return space(node.em, context);
    case 'frac':
    case 'stack':
      return fraction(node.n, node.d, node.k === 'stack', context);
    case 'binom':
      return delimited('(', ')', [fraction(node.n, node.d, true, context)], context);
    case 'sqrt':
      return (
        `<m:rad>${pr('rad', '<m:degHide m:val="1"/>', context)}<m:deg/>` +
        `<m:e>${argument(node.body, context)}</m:e></m:rad>`
      );
    case 'root':
      return (
        `<m:rad>${pr('rad', '', context)}<m:deg>${argument(node.index, deeper(context, 2))}</m:deg>` +
        `<m:e>${argument(node.body, context)}</m:e></m:rad>`
      );
    case 'attach':
      return attach(node, context);
    case 'accent':
      return (
        `<m:acc>${pr('acc', `<m:chr m:val="${escapeXml(COMBINING.get(node.a) ?? node.a)}"/>`, context)}` +
        `<m:e>${argument(node.body, context)}</m:e></m:acc>`
      );
    case 'line':
      return (
        `<m:bar>${pr('bar', `<m:pos m:val="${node.which === 'overline' ? 'top' : 'bot'}"/>`, context)}` +
        `<m:e>${argument(node.body, context)}</m:e></m:bar>`
      );
    case 'brace': {
      const { chr, over } = BRACES[node.which];
      const properties =
        `<m:chr m:val="${chr}"/><m:pos m:val="${over ? 'top' : 'bot'}"/>` +
        `<m:vertJc m:val="${over ? 'bot' : 'top'}"/>`;
      const brace =
        `<m:groupChr>${pr('groupChr', properties, context)}` +
        `<m:e>${argument(node.body, context)}</m:e></m:groupChr>`;
      return node.label === undefined ? brace : limit(brace, node.label, over, context);
    }
    case 'lr':
      return fenced(node.open, node.close, node.body, context);
    case 'mat':
      if (node.open === '' && node.close === '' && node.display && alternating(node.columns)) {
        return equationArray(node.rows, node.columns, context);
      }
      return node.open === '' && node.close === ''
        ? matrix(node.rows, node.columns, context)
        : delimited(node.open, node.close, [matrix(node.rows, node.columns, context)], context);
    case 'cases':
      return delimited('{', '', [equationArray(node.rows, node.columns, context)], context);
    case 'phantom':
      return (
        `<m:phant>${pr('phant', '<m:show m:val="0"/>', context)}` +
        `<m:e>${argument(node.body, context)}</m:e></m:phant>`
      );
    case 'display':
    case 'inline':
      return argument(node.body, { ...context, display: node.k === 'display' });
    case 'script':
    case 'sscript':
      return argument(node.body, smaller(node.k, context));
    default: {
      const unreachable: never = node;
      throw new Error(`No OMML for a maths node of kind ${(unreachable as MathsNode).k}`);
    }
  }
}

/** An identifier's variant as M11 set it: italic, upright, bold and bold italic by `m:sty`, the rest
 * by `m:scr` and upright - Word's own characters for each, measured in the PDF's text. */
function variant(v: Extract<MathsNode, { k: 'i' }>['v']): string {
  const script = (name: string) => `<m:scr m:val="${name}"/><m:sty m:val="p"/>`;
  switch (v) {
    case 'italic':
      return '<m:sty m:val="i"/>';
    case 'upright':
      return '<m:sty m:val="p"/>';
    case 'bold':
      return '<m:sty m:val="b"/>';
    case 'bold-italic':
      return '<m:sty m:val="bi"/>';
    case 'bb':
      return script('double-struck');
    case 'cal':
      return script('script');
    case 'frak':
      return script('fraktur');
    case 'sans':
      return script('sans-serif');
    case 'mono':
      return script('monospace');
  }
}

/**
 * A run: its maths properties, its face where it is normal text, its size where a script level states
 * one, and its text, spaces kept. In an equation array Word reads an ampersand in a maths run as an
 * alignment point, so a run the content holds with one in it is written as normal text there, which
 * Word sets as it is (measured).
 */
function run(text: string, properties: string, context: Context): string {
  const own = context.array && text.includes('&') ? '<m:nor/>' : properties;
  const family = escapeXml(context.face);
  const face =
    own === '<m:nor/>'
      ? `<w:rFonts w:ascii="${family}" w:hAnsi="${family}" w:cs="${family}" w:eastAsia="${family}"/>`
      : '';
  const stated = face + size(context);
  return (
    `<m:r>${own === '' ? '' : `<m:rPr>${own}</m:rPr>`}${stated === '' ? '' : `<w:rPr>${stated}</w:rPr>`}` +
    `<m:t xml:space="preserve">${escapeXml(text)}</m:t></m:r>`
  );
}

/** The alignment point an equation array's cells are joined by: never read from the content. */
const AMPERSAND = '<m:r><m:t>&amp;</m:t></m:r>';

/** A size stated on a run or in an object's control properties, where a script level set one. */
function sized(context: Context): string {
  const stated = size(context);
  return stated === '' ? '' : `<w:rPr>${stated}</w:rPr>`;
}

/** The size a script level states, as `w:rPr`'s children, or nothing. */
function size(context: Context): string {
  const halfPoints = context.halfPoints;
  return halfPoints === undefined
    ? ''
    : `<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/>`;
}

/**
 * An object's properties: what it says, then its control properties where a size is stated, which
 * size what Word draws of the object itself - a fraction's bar, a bracket, an operator.
 */
function pr(name: string, properties: string, context: Context): string {
  const control = context.halfPoints === undefined ? '' : `<m:ctrlPr>${sized(context)}</m:ctrlPr>`;
  return properties === '' && control === ''
    ? ''
    : `<m:${name}Pr>${properties}${control}</m:${name}Pr>`;
}

/** A space as the fewest of Cambria Math's space characters, to the nearest eighteenth of an em. */
function space(em: number, context: Context): string {
  const eighteenths = Math.round(em * 18);
  if (eighteenths <= 0) return '';
  const text = '\u{2003}'.repeat(Math.floor(eighteenths / 18)) + UNDER_AN_EM[eighteenths % 18]!;
  return run(text, '', context);
}

function fraction(
  numerator: MathsNode,
  denominator: MathsNode,
  lineless: boolean,
  context: Context,
) {
  return (
    `<m:f>${pr('f', lineless ? '<m:type m:val="noBar"/>' : '', context)}` +
    `<m:num>${argument(numerator, context)}</m:num>` +
    `<m:den>${argument(denominator, context)}</m:den></m:f>`
  );
}

/** `m:d`: content between two characters, either empty, its parts each an argument between separators. */
function delimited(
  open: string,
  close: string,
  parts: readonly string[],
  context: Context,
  separator?: string,
): string {
  const properties =
    `<m:begChr m:val="${escapeXml(open)}"/>` +
    (separator === undefined ? '' : `<m:sepChr m:val="${escapeXml(separator)}"/>`) +
    `<m:endChr m:val="${escapeXml(close)}"/>`;
  return `<m:d>${pr('d', properties, context)}${parts.map((part) => `<m:e>${part}</m:e>`).join('')}</m:d>`;
}

/**
 * Content between fences: its parts split at the stretched operators between them (`mid`), which
 * `m:d` sets as its one separator character. Where they are not all one character, they stay the
 * operators they are, unstretched, in one part.
 */
function fenced(open: string, close: string, body: MathsNode, context: Context): string {
  const nodes = spliced(body.k === 'row' ? body.c : [body]);
  const separators = new Set(nodes.flatMap((node) => (node.k === 'mid' ? [node.t] : [])));
  if (separators.size !== 1) return delimited(open, close, [sequence(nodes, context)], context);
  const parts: MathsNode[][] = [[]];
  for (const node of nodes) {
    if (node.k === 'mid') parts.push([]);
    else parts[parts.length - 1]!.push(node);
  }
  return delimited(
    open,
    close,
    parts.map((part) => sequence(part, context)),
    context,
    [...separators][0],
  );
}

/** A limit over (`m:limUpp`) or under (`m:limLow`) what is already written. */
function limit(base: string, script: MathsNode, over: boolean, context: Context): string {
  const name = over ? 'limUpp' : 'limLow';
  return (
    `<m:${name}>${pr(name, '', context)}<m:e>${base}</m:e>` +
    `<m:lim>${argument(script, deeper(context))}</m:lim></m:${name}>`
  );
}

/**
 * Scripts on a base, placed as the PDF places them: beside it (`scripts`), under and over it
 * (`limits`), or under and over in the display style and beside in the inline one (`limits-display`);
 * at its corners beside it, and before it (`m:sPre`), around everything else. Primes are set after
 * the base, as M11 measured, not as a script of it.
 */
function attach(node: Extract<MathsNode, { k: 'attach' }>, context: Context): string {
  const primed = node.t?.k === 'primes';
  // A large operator here is a base with scripts an n-ary operator cannot have: its character alone.
  const base = node.base.k === 'o' ? write(node.base, context) : argument(node.base, context);
  let xml = base + (primed ? write(node.t!, context) : '');
  const top = primed ? undefined : node.t;
  const over = node.mode === 'limits' || (node.mode === 'limits-display' && context.display);
  const beside = { below: [node.br], above: [node.tr] };
  if (over) {
    if (node.b !== undefined) xml = limit(xml, node.b, false, context);
    if (top !== undefined) xml = limit(xml, top, true, context);
  } else {
    beside.below.unshift(node.b);
    beside.above.unshift(top);
  }
  xml = scripts(xml, beside.below, beside.above, context);
  if (node.tl === undefined && node.bl === undefined) return xml;
  const script = deeper(context);
  return (
    `<m:sPre>${pr('sPre', '', context)}<m:sub>${written(node.bl, script)}</m:sub>` +
    `<m:sup>${written(node.tl, script)}</m:sup><m:e>${xml}</m:e></m:sPre>`
  );
}

const written = (node: MathsNode | undefined, context: Context) =>
  node === undefined ? '' : argument(node, context);

/** A base with scripts beside it: each side's scripts one after the other, where the tree has two. */
function scripts(
  base: string,
  below: readonly (MathsNode | undefined)[],
  above: readonly (MathsNode | undefined)[],
  context: Context,
): string {
  const script = deeper(context);
  const side = (nodes: readonly (MathsNode | undefined)[]) =>
    nodes.flatMap((node) => (node === undefined ? [] : [argument(node, script)])).join('');
  const sub = side(below);
  const sup = side(above);
  const e = `<m:e>${base}</m:e>`;
  if (sub !== '' && sup !== '') {
    return `<m:sSubSup>${pr('sSubSup', '', context)}${e}<m:sub>${sub}</m:sub><m:sup>${sup}</m:sup></m:sSubSup>`;
  }
  if (sub !== '') return `<m:sSub>${pr('sSub', '', context)}${e}<m:sub>${sub}</m:sub></m:sSub>`;
  if (sup !== '') return `<m:sSup>${pr('sSup', '', context)}${e}<m:sup>${sup}</m:sup></m:sSup>`;
  return base;
}

/**
 * Whether a bare table's columns alternate right and left from the first, as `aligned` writes them:
 * the template's test for a multi-line equation, the same here.
 */
const alternating = (columns: readonly MathsAlignment[]) =>
  columns.length > 1 &&
  columns.every((alignment, index) => alignment === (index % 2 === 0 ? 'right' : 'left'));

/**
 * A matrix: its rows filled out to the widest with empty cells, each column aligned as the tree says,
 * and its placeholders hidden, so an empty cell draws nothing.
 */
function matrix(
  rows: readonly (readonly MathsNode[])[],
  columns: readonly MathsAlignment[],
  context: Context,
): string {
  const width = Math.max(1, ...rows.map((cells) => cells.length));
  const alignments = Array.from({ length: width }, (_, index) => columns[index] ?? 'center');
  const properties =
    '<m:plcHide m:val="1"/><m:mcs>' +
    alignments
      .map(
        (alignment) =>
          `<m:mc><m:mcPr><m:count m:val="1"/><m:mcJc m:val="${alignment}"/></m:mcPr></m:mc>`,
      )
      .join('') +
    '</m:mcs>';
  const body = rows
    .map((cells) => {
      const written = Array.from({ length: width }, (_, index) => {
        const cell = cells[index];
        return `<m:e>${cell === undefined ? '' : argument(cell, context)}</m:e>`;
      });
      return `<m:mr>${written.join('')}</m:mr>`;
    })
    .join('');
  return `<m:m>${pr('m', properties, context)}${body}</m:m>`;
}

/**
 * An equation array (`m:eqArr`): each row one argument, its cells joined by alignment points. Word
 * reads the points as AMS's `aligned` does - columns alternately aligned right and left at them - so
 * each cell is put in the next column of its own side: a right-aligned cell in the next right column,
 * a left-aligned one (or a centred one, which an equation array has no column for) in the next left
 * column, with a point for each column passed. An aligned equation's cells alternate already, one
 * point between each; cases' left-aligned cells are `& x, && x ≥ 0`, measured to set both columns
 * at their left where Word's own cases, `x, & x ≥ 0`, sets the first at its right.
 */
function equationArray(
  rows: readonly (readonly MathsNode[])[],
  columns: readonly MathsAlignment[],
  context: Context,
): string {
  const array = { ...context, array: true };
  const written = rows.map((cells) => {
    let column = 0;
    let xml = '';
    cells.forEach((cell, index) => {
      const side = columns[index] === 'right' ? 0 : 1;
      let next = index === 0 ? 0 : column + 1;
      if (next % 2 !== side) next += 1;
      xml += AMPERSAND.repeat(next - (index === 0 ? 0 : column)) + argument(cell, array);
      column = next;
    });
    return `<m:e>${xml}</m:e>`;
  });
  return `<m:eqArr>${pr('eqArr', '', context)}${written.join('')}</m:eqArr>`;
}

/**
 * A part a script level smaller, or two: at Cambria Math's script sizes, stated, where Word sets it at
 * the full size - never larger than a size already stated around it - and as Word sets it where Word
 * already sets it smaller.
 */
function smaller(level: 'script' | 'sscript', context: Context): Context {
  if (context.depth > 0) return context;
  const halfPoints = Math.round(context.size * (level === 'script' ? SCRIPT : SCRIPT_SCRIPT) * 2);
  return { ...context, halfPoints: Math.min(halfPoints, context.halfPoints ?? halfPoints) };
}
