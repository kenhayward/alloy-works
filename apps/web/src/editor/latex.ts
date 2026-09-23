import { admitTemmlMathml, type TemmlRefusal } from '@alloy-works/domain';
import temml from 'temml';

/**
 * How Temml is asked, and nothing else (equations 1, ruling R1; publishing.md's EQ-C):
 *
 * - `xml: true`, so the MathML declares its namespace as the reader's one form does;
 * - `throwOnError: true`, so an unknown command or a parse error is an error the dialog says, never
 *   text in red stored inside the equation - left to itself Temml writes `\foo` as `<mtext>\foo</mtext>`,
 *   which the reader would keep as though the author had meant it;
 * - `annotate: false`, so the LaTeX is not written into the MathML a second time: it is stored beside
 *   it, as the equation's `latex`, and an annotation would be one more thing the two could disagree on.
 *
 * `trust` is left false, Temml's own default, so `\href`, `\url` and `\htmlClass` are errors too.
 */
const OPTIONS = { xml: true, throwOnError: true, annotate: false } as const;

/**
 * Temml's own output for `latex`, as the editor asks for it: in display style for a block, which
 * places limits above and below and sets a fraction full size, and in text style for an equation in
 * a line of text. Throws what Temml throws. Exported for the test that holds the pinned Temml to the
 * output the domain's tests were written against.
 */
export function renderTemml(latex: string, display: 'inline' | 'block'): string {
  return temml.renderToString(latex, { ...OPTIONS, displayMode: display === 'block' });
}

/** What came of LaTeX: the MathML to store, or what the dialog says instead, in words. */
export type LatexOutcome =
  { readonly ok: true; readonly mathml: string } | { readonly ok: false; readonly said: string };

/**
 * `latex` made into the MathML an equation is stored as, or the reason it cannot be, in words
 * (ruling R1): rendered by Temml, then made into the reader's one form by `admitTemmlMathml`, which
 * keeps an overline's content and a table's alignment and refuses what it cannot keep, by name.
 *
 * **A line broken outside an environment's rows is found in the LaTeX** (`breaksALine`), in both
 * kinds, before Temml's output is looked at, since in display style that output cannot say it: Temml
 * draws such a `\\` as an empty operator, the same one `\pmod`'s `\allowbreak` makes, and the block
 * would simply be stored on one line. In a line of text Temml marks the break, and the domain refuses
 * the mark by name - an equation in a line of text stands on that line - so the scanner's answer and
 * the domain's agree there, and the domain's stays as the second of the two.
 *
 * The first draft asked the same LaTeX rendered inline instead, which failed open: anything Temml
 * draws only in display style - `align*`, `split`, `CD` - made the inline rendering throw, and a
 * break beside it was stored lost (the final whole-branch review's M1).
 */
export function latexToMathml(latex: string, display: 'inline' | 'block'): LatexOutcome {
  let output: string;
  try {
    output = renderTemml(latex, display);
  } catch (error) {
    return { ok: false, said: temmlSaid(error) };
  }
  if (breaksALine(latex)) {
    return { ok: false, said: refusalSaid({ ok: false, reason: 'lineBreak' }) };
  }
  const admitted = admitTemmlMathml(output);
  if (!admitted.ok) return { ok: false, said: refusalSaid(admitted) };
  return admitted;
}

/**
 * The environments Temml 0.13.5 has that hold a single row - `equation` and `equation*` - in which a
 * `\\` is dropped as it is outside any. Every other environment it has separates rows with `\\`.
 */
const ONE_ROW = new Set(['equation', 'equation*']);

/**
 * The commands whose argument Temml reads as rows: `\substack`, which it writes as a `subarray`
 * environment, and `\bordermatrix`, a plain TeX matrix ending at its closing brace.
 */
const ROWS_IN_ARGUMENT = new Set(['substack', 'bordermatrix']);

/**
 * A control sequence, as TeX reads one: a backslash and a run of letters (`@` among them, as Temml
 * reads them), or a backslash and any one character - so `\\\\` is two `\\`, never an escaped one.
 */
const CONTROL = /\\([A-Za-z@]+|[^]?)/y;

/**
 * Whether `latex` breaks a line anywhere but between an environment's rows - with `\\`, `\\[2pt]`,
 * `\newline`, or `\cr`, which Temml reads as `\\` inside an environment - since Temml drops every such
 * break from a display equation. Read from the LaTeX, which Temml has already read without an error,
 * so its groups and environments balance.
 *
 * **A break separates rows only at the depth of its environment's cells**: inside a group, a
 * fraction's part, `\text`, or `\left` and `\right` - even within the environment - it is a break in
 * that part, which Temml drops as it does one outside. `equation*` has one row, and so none to
 * separate. `\substack`'s argument is rows at the depth inside its braces. A comment is skipped to its
 * line's end, and `\verb`'s text to its closing delimiter, since neither is LaTeX.
 *
 * **It reads the LaTeX as written, not as Temml expands it**: a `\\` inside a macro of the author's
 * (`\def\nl{\\}`) is refused wherever the macro would be used, even between rows, and a break put
 * together by a macro from something other than `\\`, `\newline` or `\cr` is not seen - Temml has no
 * way to spell one otherwise.
 */
function breaksALine(latex: string): boolean {
  // Where a break separates rows, innermost last: an environment, closed by its `\end`, or a command's
  // argument, closed by its brace, each with the group depth its rows stand at.
  const open: {
    readonly by: 'environment' | 'argument';
    readonly depth: number;
    readonly rows: boolean;
  }[] = [];
  let depth = 0;
  // A command whose argument is rows has been read, and its argument's brace not yet.
  let argument = false;
  let at = 0;
  const name = (): string => {
    while (/\s/.test(latex[at] ?? '')) at += 1;
    if (latex[at] !== '{') return '';
    const end = latex.indexOf('}', at);
    const read = latex.slice(at + 1, end === -1 ? latex.length : end);
    at = end === -1 ? latex.length : end + 1;
    return read.trim();
  };
  while (at < latex.length) {
    const char = latex[at]!;
    if (char === '%') {
      const end = latex.indexOf('\n', at);
      at = end === -1 ? latex.length : end + 1;
      continue;
    }
    if (char === '{') {
      depth += 1;
      at += 1;
      if (argument) open.push({ by: 'argument', depth, rows: true });
      argument = false;
      continue;
    }
    if (char === '}') {
      const top = open.at(-1);
      if (top?.by === 'argument' && top.depth === depth) open.pop();
      depth -= 1;
      at += 1;
      continue;
    }
    if (char !== '\\') {
      if (!/\s/.test(char)) argument = false;
      at += 1;
      continue;
    }
    CONTROL.lastIndex = at;
    const control = CONTROL.exec(latex)![1]!;
    at = CONTROL.lastIndex;
    argument = ROWS_IN_ARGUMENT.has(control);
    if (control === '\\' || control === 'newline' || control === 'cr') {
      const top = open.at(-1);
      if (top === undefined || !top.rows || top.depth !== depth) return true;
    } else if (control === 'begin') {
      open.push({ by: 'environment', depth, rows: !ONE_ROW.has(name()) });
    } else if (control === 'end') {
      name();
      if (open.at(-1)?.by === 'environment') open.pop();
    } else if (control === 'left') {
      depth += 1;
    } else if (control === 'right') {
      depth -= 1;
    } else if (control === 'verb') {
      if (latex[at] === '*') at += 1;
      const end = latex.indexOf(latex[at] ?? '', at + 1);
      at = end === -1 ? latex.length : end + 1;
    }
  }
  return false;
}

/**
 * Temml's own words for a parse error, and where it is: the message it writes, without the copy of
 * the LaTeX it appends with the offending characters underlined by combining marks, which reads as
 * noise anywhere but a monospace console. The position is Temml's, counted from one, as an author
 * counts characters. Anything else Temml throws - it fails on `x^` with a programming error, not a
 * parse error - says nothing an author can use, so it is said in the dialog's own words instead.
 */
function temmlSaid(error: unknown): string {
  if (!(error instanceof temml.ParseError)) {
    return 'That LaTeX could not be read. Check that nothing is missing from it.';
  }
  const message = (error as unknown as Error).message;
  const position = (error as unknown as { position?: number }).position;
  const at = message.search(/ at (?:position \d+|end of input):/);
  const words = (at === -1 ? message : message.slice(0, at)).trim();
  if (message.includes(' at end of input:')) return `At the end: ${words}`;
  return position === undefined ? words : `At character ${position + 1}: ${words}`;
}

/** What the dialog says for each of the domain's refusals: what was refused, and what to do instead. */
function refusalSaid(refusal: TemmlRefusal): string {
  switch (refusal.reason) {
    case 'construct':
      return `An equation here cannot keep ${refusal.construct}. Write it another way.`;
    // A block's number is the product's (ruling R8's Numbered), never text inside the maths.
    case 'number':
      return "An equation's number is not written in its LaTeX. Make it a block and choose Numbered, and use a starred environment such as align*.";
    case 'lineBreak':
      return 'A line cannot be broken with \\\\ on its own. For several lines, use an environment such as aligned.';
    case 'unkept':
      return `Part of this equation could not be kept (${refusal.detail}). Write it another way.`;
  }
}
