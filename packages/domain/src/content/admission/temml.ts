import {
  type MathElement,
  type MathNode,
  readMathmlTree,
  sanitiseMathml,
  writeMathmlTree,
} from './mathml.js';

/**
 * Temml's output made into the one form an equation is stored in (publishing.md's EQ-C, equations 1's
 * ruling R2).
 *
 * The editor turns LaTeX into MathML with Temml, and the strict reader (`mathml.ts`) decides what is
 * stored. Measured, the reader keeps every sample Temml writes but loses content in two places, and
 * this rewrites both before the reader sees them, because a stored version is immutable and a loss
 * there is permanent:
 *
 * - **`\overline` and `\underline` arrive as `<menclose>`**, which is not MathML Core, so the reader
 *   removes it and everything it holds - `\overline{z}` would be stored without its `z`. A line over
 *   the content becomes the `mover` MathML Core draws it with, and a line under it the `munder`. Any
 *   other notation (`\cancel`, `\fbox`, `\phase`...) has no MathML Core form, and Chromium does not
 *   draw `menclose` at all, so it is refused by name rather than stored as something else.
 * - **Column alignment arrives as classes**, `tml-left` and `tml-right` on a table's cells, which
 *   Temml's own stylesheet reads and the reader removes with every other class. It becomes
 *   `columnalign` on the cell, which the reader keeps. Temml writes alignment on nothing but a cell -
 *   `cases`, `aligned`, `align`, `multline` and an array's column specification all go through its
 *   table builder, which sets these classes on `mtd` alone.
 *
 * Four more things Temml writes are refused here rather than lost there: `\boxed` and `\fcolorbox`,
 * a row whose box is drawn only by its inline style; `\cancelto`, whose arrow is only a class; and an
 * equation number, `\tag` or an unstarred numbered environment such as `align`, since a block
 * equation's number is the product's (the block's **Numbered**, and `number`'s label beside it when
 * published), never text inside the maths. And a **line break outside an environment**: Temml writes
 * one as a table of lines inside a line of text, and draws it in a display equation as an empty
 * operator, dropping the break without a word - for several lines, an environment such as `aligned`
 * says where each begins, and keeps them.
 *
 * The result is the reader's own: the tree is read by the reader's parser, changed, written back and
 * read again by `sanitiseMathml`, so nothing here can store a form the reader would not write, and
 * the reader itself is exactly as strict as before for every other caller - a `menclose` reaching it
 * by paste or import is still removed and reported. Anything the reader would then remove with its
 * content, an element or text, refuses the equation too: Temml's classes and styles are its own
 * stylesheet's and are dropped as colour is (CNT-065), but content never is.
 */
export type TemmlAdmission = { readonly ok: true; readonly mathml: string } | TemmlRefusal;

/**
 * Why an equation is refused. `construct` names the LaTeX command where Temml's output says which,
 * and otherwise the MathML it could not keep (`<menclose notation="radical">`); `number` is an equation
 * number drawn inside the maths; `lineBreak` a line broken outside an environment; `unkept` is
 * what the reader would refuse or remove with its content, naming it as the reader does.
 */
export type TemmlRefusal =
  | { readonly ok: false; readonly reason: 'construct'; readonly construct: string }
  | { readonly ok: false; readonly reason: 'number' }
  | { readonly ok: false; readonly reason: 'lineBreak' }
  | { readonly ok: false; readonly reason: 'unkept'; readonly detail: string };

/**
 * U+203E OVERLINE, stretched across the content. MathML Core's operator dictionary gives it the
 * inline stretch axis and makes it stretchy in the postfix form an `mover`'s script takes, as it does
 * U+00AF MACRON; it is the character MathML's own `&OverBar;` names, and the one Temml already writes
 * for `\bar` - unstretched there, stretchy here, so a converter reading the stored form tells an
 * overline from a bar by `stretchy` alone. The pinned maths face, STIX Two Math, carries a horizontal
 * assembly for it. U+0305 COMBINING OVERLINE was rejected: it is not in Core's inline stretch axis, and
 * a combining mark standing alone in an operator is written by the reader as a reference.
 */
const OVERLINE = '\u{203E}';

/**
 * U+005F LOW LINE, stretched under the content: the `munder` counterpart, in Core's dictionary on the
 * same terms as the overline, the character MathML's `&UnderBar;` names, and assembled horizontally by
 * STIX Two Math. U+0332 COMBINING LOW LINE is in Core's inline stretch axis but not stretchy by the
 * dictionary, and is a combining mark, rejected for the same reasons as U+0305.
 */
const LOW_LINE = '_';

/** Every other notation Temml 0.13.5 writes, by the command that writes it. */
const refusedNotations: ReadonlyMap<string, string> = new Map([
  ['updiagonalstrike', '\\cancel'],
  ['downdiagonalstrike', '\\bcancel'],
  ['updiagonalstrike downdiagonalstrike', '\\xcancel'],
  ['horizontalstrike', '\\sout'],
  ['box', '\\fbox'],
  ['circle', '\\textcircled'],
  ['phasorangle', '\\phase'],
  ['longdiv', '\\longdiv'],
  ['actuarial', '\\angl'],
]);

/** The classes Temml marks an equation number with: a row, a `\tag`'s text, an automatic number. */
const numberClasses = new Set(['tml-tageqn', 'tml-tag', 'tml-eqn']);

const alignmentClasses: ReadonlyMap<string, string> = new Map([
  ['tml-left', 'left'],
  ['tml-right', 'right'],
]);

/** A border drawn by an inline style: how Temml draws `\boxed` and `\fcolorbox`. */
const BORDER = /(?:^|;)[ \t\n\r]*border(?:-[a-z]+)*[ \t\n\r]*:/i;

class Refused extends Error {
  constructor(readonly refusal: TemmlRefusal) {
    super(refusal.reason);
  }
}

export function admitTemmlMathml(output: string): TemmlAdmission {
  const tree = readMathmlTree(output);
  if (!tree.ok) return { ok: false, reason: 'unkept', detail: tree.failure };

  let rewritten: MathElement;
  try {
    rewritten = rewrite(tree.root);
  } catch (error) {
    if (error instanceof Refused) return error.refusal;
    throw error;
  }

  const result = sanitiseMathml(writeMathmlTree(rewritten));
  if (!result.ok) return { ok: false, reason: 'unkept', detail: result.failure };
  const lost = result.findings.find(
    ({ subject }) => subject === 'mathElement' || subject === 'script' || subject === 'mathText',
  );
  if (lost !== undefined) return { ok: false, reason: 'unkept', detail: lost.detail };
  return { ok: true, mathml: result.mathml };
}

function rewrite(element: MathElement): MathElement {
  const classes = classesOf(element);
  if (classes.some((name) => numberClasses.has(name))) {
    throw new Refused({ ok: false, reason: 'number' });
  }
  if (classes.includes('tml-cancelto')) throw refusedAs('\\cancelto');
  // Seen only in what Temml writes for a line of text: in a display equation the same \\ is an empty
  // `mo` with nothing to tell it from \pmod's \allowbreak, which is why the editor finds a break in
  // the LaTeX itself before it asks this (`breaksALine` in apps/web's latex.ts; equations 1's final
  // review, M1). This stays as the second of the two for a line of text.
  if (element.name === 'mo' && attributeOf(element, 'linebreak') === 'newline') {
    throw new Refused({ ok: false, reason: 'lineBreak' });
  }
  if (element.name === 'mrow' && BORDER.test(attributeOf(element, 'style') ?? '')) {
    throw refusedAs(
      attributeOf(element, 'mathbackground') === undefined ? '\\boxed' : '\\fcolorbox',
    );
  }
  // A rule is a space filled by its background, which the reader drops as it drops any colour, so a
  // visible mark would be stored as a blank. A rule of no width or no height - a strut - Temml writes
  // with no background, and it is kept: it draws nothing either way (equations 1's final review, L2).
  if (element.name === 'mspace' && attributeOf(element, 'mathbackground') !== undefined) {
    throw refusedAs('\\rule');
  }

  const children = element.children.map((child) =>
    typeof child === 'string' ? child : rewrite(child),
  );
  // A box moved up or down, which the three commands write alike. The reader keeps `voffset`, and
  // Chromium draws it wherever its value says, outside the equation's line and over whatever stands
  // there - the lines above, or the editor's own controls - and equations 2's converter has no such
  // offset to write (publishing.md's EQ-C). Its content is read first, so that a raised rule is
  // named as the rule it is (equations 1's final review, L3).
  if (element.name === 'mpadded' && attributeOf(element, 'voffset') !== undefined) {
    throw refusedAs('\\raisebox, \\raise or \\lower');
  }
  if (element.name === 'menclose') return enclosure(element, children);
  if (element.name === 'mtd') return aligned(element, classes, children);
  return { ...element, children };
}

/**
 * A line over or under the content becomes the script of an `mover` or `munder` marked as an accent,
 * so it sits against the content as a line does rather than a gap above it; the rest is refused. The
 * content becomes the base as it is where it is one element, and an `mrow` of it otherwise, since
 * `menclose` holds any number of children and `mover` exactly two. Text between its children is kept
 * where it was, for the reader to find and refuse.
 */
function enclosure(element: MathElement, children: MathNode[]): MathElement {
  const notation = attributeOf(element, 'notation');
  const line = notation === 'top' ? OVERLINE : notation === 'bottom' ? LOW_LINE : undefined;
  if (line === undefined) {
    const command = notation === undefined ? undefined : refusedNotations.get(notation);
    throw refusedAs(
      command ?? (notation === undefined ? '<menclose>' : `<menclose notation="${notation}">`),
    );
  }

  const content = children.filter(
    (child) => typeof child !== 'string' || child.replace(/[ \t\n\r]/g, '') !== '',
  );
  const base: MathNode =
    content.length === 1 && typeof content[0] !== 'string'
      ? content[0]!
      : { name: 'mrow', attributes: [], children: content };
  const script: MathElement = { name: 'mo', attributes: [['stretchy', 'true']], children: [line] };
  return line === OVERLINE
    ? { name: 'mover', attributes: [['accent', 'true']], children: [base, script] }
    : { name: 'munder', attributes: [['accentunder', 'true']], children: [base, script] };
}

/**
 * A cell's alignment class becomes its `columnalign`, unless Temml wrote one itself. Where a cell had
 * both, the later class is the one Temml's stylesheet applies, and the one kept.
 */
function aligned(element: MathElement, classes: string[], children: MathNode[]): MathElement {
  const alignment = classes
    .map((name) => alignmentClasses.get(name))
    .filter((value) => value !== undefined)
    .at(-1);
  if (alignment === undefined || attributeOf(element, 'columnalign') !== undefined) {
    return { ...element, children };
  }
  return {
    ...element,
    attributes: [...element.attributes, ['columnalign', alignment]],
    children,
  };
}

function refusedAs(construct: string): Refused {
  return new Refused({ ok: false, reason: 'construct', construct });
}

function attributeOf(element: MathElement, name: string): string | undefined {
  return element.attributes.find(([attribute]) => attribute === name)?.[1];
}

function classesOf(element: MathElement): string[] {
  return (attributeOf(element, 'class') ?? '').split(/[ \t\n\r]+/).filter((name) => name !== '');
}
