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
 * **A block's line breaks are asked of the same LaTeX written inline.** In display style Temml draws
 * `\\` outside an environment as an empty operator, the same one `\pmod`'s `\allowbreak` makes, so the
 * block's own output cannot say the author broke a line - it would simply be stored on one. Written
 * inline, the same break carries Temml's `linebreak` mark, which the domain refuses by name, and so
 * the block is refused with the words the inline equation would be. Only that refusal is taken from
 * the second rendering: anything else it says is about text style, which a block is not in.
 */
export function latexToMathml(latex: string, display: 'inline' | 'block'): LatexOutcome {
  let output: string;
  try {
    output = renderTemml(latex, display);
  } catch (error) {
    return { ok: false, said: temmlSaid(error) };
  }
  const admitted = admitTemmlMathml(output);
  if (!admitted.ok) return { ok: false, said: refusalSaid(admitted) };
  if (display === 'block') {
    let inline: string | null;
    try {
      inline = renderTemml(latex, 'inline');
    } catch {
      inline = null;
    }
    const probe = inline === null ? null : admitTemmlMathml(inline);
    if (probe !== null && !probe.ok && probe.reason === 'lineBreak') {
      return { ok: false, said: refusalSaid(probe) };
    }
  }
  return admitted;
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
