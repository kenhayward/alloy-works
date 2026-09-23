import { inlineNodeSchema } from '@alloy-works/domain';
import temml from 'temml';
import { describe, expect, it } from 'vitest';

// The one list of Temml's output the domain's tests of `admitTemmlMathml` hold, read from where they
// hold it rather than copied here: two copies could drift apart, and then each would pass against its
// own. It is a module of plain strings with no imports, excluded from the domain's build.
import {
  TEMML_VERSION,
  temmlOutput,
} from '../../../../packages/domain/src/content/admission/temml.fixture.js';
import { latexToMathml, renderTemml } from './latex.js';

/** Whether the stored model takes it as an equation's MathML: the reader's one form, and nothing else. */
const storable = (mathml: string) =>
  inlineNodeSchema.safeParse({ type: 'equation', mathml }).success;

const NS = 'http://www.w3.org/1998/Math/MathML';

describe('LaTeX made into an equation (equations 1, ruling R1)', () => {
  it("renders every sample the domain's tests hold exactly as they hold it, with the Temml pinned here", () => {
    // A Temml release that writes anything else fails here, loudly, rather than leaving the domain's
    // tests passing against output the editor no longer produces.
    expect(temml.version).toBe(TEMML_VERSION);
    const samples = temmlOutput();
    expect(samples.length).toBeGreaterThan(40);
    for (const { name, tex, inline, block } of samples) {
      if (inline !== undefined) expect(renderTemml(tex, 'inline'), name).toBe(inline);
      expect(renderTemml(tex, 'block'), name).toBe(block);
    }
  });

  it('stores the MathML Temml writes in the one form the reader keeps, inline and as a block', () => {
    const inline = latexToMathml('\\frac{a+b}{c}', 'inline');
    expect(inline).toEqual({
      ok: true,
      mathml: `<math xmlns="${NS}"><mfrac><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mi>c</mi></mfrac></math>`,
    });
    const block = latexToMathml('\\overline{z}', 'block');
    expect(block.ok && block.mathml).toBe(
      `<math xmlns="${NS}" display="block"><mover accent="true"><mi>z</mi><mo stretchy="true">\u{203E}</mo></mover></math>`,
    );
    for (const each of [inline, block]) expect(each.ok && storable(each.mathml)).toBe(true);
  });

  it("says what is wrong with LaTeX Temml cannot read in Temml's own words, and where", () => {
    expect(latexToMathml('\\foo x', 'inline')).toEqual({
      ok: false,
      said: 'At character 1: Unsupported function name: \\foo',
    });
    expect(latexToMathml('\\frac{a', 'block')).toEqual({
      ok: false,
      said: "At the end: Unexpected end of input in a macro argument, expected '}'",
    });
    // Temml fails on this with a programming error rather than a ParseError, and says nothing useful.
    expect(latexToMathml('x^', 'inline')).toEqual({
      ok: false,
      said: 'That LaTeX could not be read. Check that nothing is missing from it.',
    });
  });

  it('refuses what the reader could not keep, naming the command, and a number written in the LaTeX', () => {
    expect(latexToMathml('\\cancel{x}', 'inline')).toEqual({
      ok: false,
      said: 'An equation here cannot keep \\cancel. Write it another way.',
    });
    expect(latexToMathml('\\tag{3} x', 'block')).toEqual({
      ok: false,
      said: "An equation's number is not written in its LaTeX. Make it a block and choose Numbered, and use a starred environment such as align*.",
    });
  });

  it('refuses a line broken outside an environment, which a block would lose, and not one inside one', () => {
    const said =
      'A line cannot be broken with \\\\ on its own. For several lines, use an environment such as aligned.';
    expect(latexToMathml('a \\\\ b', 'block')).toEqual({ ok: false, said });
    expect(latexToMathml('a \\\\ b', 'inline')).toEqual({ ok: false, said });
    expect(latexToMathml('\\text{a \\\\ b}', 'block')).toEqual({ ok: false, said });
    // Rows of an environment are lines it keeps, and \pmod's break in a block is written exactly as
    // a line break is there: only the same LaTeX written inline tells the two apart.
    for (const latex of ['\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}', 'a \\pmod{2}']) {
      expect(latexToMathml(latex, 'block').ok, latex).toBe(true);
    }
  });
});
