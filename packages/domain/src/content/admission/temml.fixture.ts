/**
 * Temml's own output, kept as strings, which the domain's tests of `admitTemmlMathml` read and the
 * renderer's drift test (`apps/web/src/editor/latex.test.ts`) renders again with the Temml the
 * renderer pins, and compares (equations 1).
 *
 * Every fixture is Temml 0.13.5's output, called as the editor calls it (ruling R1):
 * `xml: true`, `throwOnError: true`, `annotate: false`, once inline and once as a block. They are
 * strings rather than calls because the domain does not depend on Temml, and so that a change of
 * Temml's version changes these tests only when somebody regenerates them and reads the difference -
 * which the drift test makes them do, since it fails the moment the pinned Temml writes anything
 * else. Every character outside ASCII is written as an escape, because Temml writes invisible ones -
 * U+2061 FUNCTION APPLICATION after an operator's name - that would not survive being retyped.
 *
 * A module of its own, beside the tests rather than inside one, so that one list serves both packages
 * and the two can never be compared against different copies of it. It is excluded from the domain's
 * build (`tsconfig.build.json`): nothing but a test reads it.
 */

/** The Temml release these were written by: the one `apps/web` pins. */
export const TEMML_VERSION = '0.13.5';

export type TemmlFixture = {
  readonly name: string;
  readonly tex: string;
  /** Absent for what only a display equation may hold, such as a tag's number. */
  readonly inline?: string;
  readonly block: string;
};

/**
 * Temml 0.13.5's output. The first sixteen are the equations spike's samples; the rest are what
 * equations 1 and 2 needed besides. Regenerate them from the pinned Temml, never by hand.
 */
export function temmlOutput(): readonly TemmlFixture[] {
  return [
    {
      name: 'fraction',
      tex: '\\frac{a+b}{c}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mi>c</mi></mfrac></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mfrac><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mi>c</mi></mfrac></math>',
    },
    {
      name: 'sum with limits',
      tex: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msubsup><mo movablelimits="false">\u{2211}</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></msubsup><mi>i</mi><mo>=</mo><mfrac><mrow><mi>n</mi><mrow><mo fence="true" form="prefix" stretchy="false">(</mo><mi>n</mi><mo>+</mo><mn>1</mn><mo fence="true" form="postfix" stretchy="false">)</mo></mrow></mrow><mn>2</mn></mfrac></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><mrow><munderover><mo movablelimits="false">\u{2211}</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover></mrow><mi>i</mi><mo>=</mo><mfrac><mrow><mi>n</mi><mrow><mo fence="true" form="prefix" stretchy="false">(</mo><mi>n</mi><mo>+</mo><mn>1</mn><mo fence="true" form="postfix" stretchy="false">)</mo></mrow></mrow><mn>2</mn></mfrac></mrow></math>',
    },
    {
      name: 'integral',
      tex: '\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msubsup><mo movablelimits="false">\u{222B}</mo><mn>0</mn><mi>\u{221E}</mi></msubsup><msup><mi>e</mi><mrow class="tml-sml-pad"><mo form="prefix" stretchy="false" lspace="0em" rspace="0em">\u{2212}</mo><msup><mi>x</mi><mn class="tml-sml-pad">2</mn></msup></mrow></msup><mspace width="0.1667em"></mspace><mi>d</mi><mi>x</mi><mo>=</mo><mfrac><msqrt><mrow><mi>\u{3C0}</mi><mspace width="0pt" height="0.7143em"></mspace></mrow></msqrt><mn>2</mn></mfrac></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><msubsup><mo movablelimits="false">\u{222B}</mo><mn>0</mn><mi>\u{221E}</mi></msubsup><msup><mi>e</mi><mrow class="tml-sml-pad"><mo form="prefix" stretchy="false" lspace="0em" rspace="0em">\u{2212}</mo><msup><mi>x</mi><mn class="tml-sml-pad">2</mn></msup></mrow></msup><mspace width="0.1667em"></mspace><mi>d</mi><mi>x</mi><mo>=</mo><mfrac><msqrt><mrow><mi>\u{3C0}</mi><mspace width="0pt" height="0.5em"></mspace></mrow></msqrt><mn>2</mn></mfrac></mrow></math>',
    },
    {
      name: 'matrix',
      tex: 'A = \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>A</mi><mo>=</mo><mrow><mo fence="true" form="prefix" stretchy="true">(</mo><mtable><mtr><mtd style="padding-left:0em;padding-right:5.9776pt;"><mi>a</mi></mtd><mtd style="padding-left:5.9776pt;padding-right:0em;"><mi>b</mi></mtd></mtr><mtr><mtd style="padding-left:0em;padding-right:5.9776pt;"><mi>c</mi></mtd><mtd style="padding-left:5.9776pt;padding-right:0em;"><mi>d</mi></mtd></mtr></mtable><mo fence="true" form="postfix" stretchy="true">)</mo></mrow></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><mi>A</mi><mo>=</mo><mrow><mo fence="true" form="prefix" stretchy="true">(</mo><mtable><mtr><mtd style="padding-left:0em;padding-right:5.9776pt;"><mi>a</mi></mtd><mtd style="padding-left:5.9776pt;padding-right:0em;"><mi>b</mi></mtd></mtr><mtr><mtd style="padding-left:0em;padding-right:5.9776pt;"><mi>c</mi></mtd><mtd style="padding-left:5.9776pt;padding-right:0em;"><mi>d</mi></mtd></mtr></mtable><mo fence="true" form="postfix" stretchy="true">)</mo></mrow></mrow></math>',
    },
    {
      name: 'cases',
      tex: 'f(x) = \\begin{cases} x & x \\ge 0 \\\\ -x & \\text{otherwise} \\end{cases}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>f</mi><mrow><mo fence="true" form="prefix" stretchy="false">(</mo><mi>x</mi><mo fence="true" form="postfix" stretchy="false">)</mo></mrow><mo>=</mo><mrow><mo fence="true" form="prefix" stretchy="true">{</mo><mtable><mtr><mtd class="tml-left" style="padding-left:0em;padding-right:0em;"><mi>x</mi></mtd><mtd class="tml-left" style="padding-left:1em;padding-right:0em;"><mrow><mi>x</mi><mo>\u{2265}</mo><mn>0</mn></mrow></mtd></mtr><mtr><mtd class="tml-left" style="padding-left:0em;padding-right:0em;"><mrow><mo form="prefix" stretchy="false">\u{2212}</mo><mi>x</mi></mrow></mtd><mtd class="tml-left" style="padding-left:1em;padding-right:0em;"><mtext>otherwise</mtext></mtd></mtr></mtable><mo fence="true" form="postfix" stretchy="true"></mo></mrow></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><mi>f</mi><mrow><mo fence="true" form="prefix" stretchy="false">(</mo><mi>x</mi><mo fence="true" form="postfix" stretchy="false">)</mo></mrow><mo>=</mo><mrow><mo fence="true" form="prefix" stretchy="true">{</mo><mtable><mtr><mtd class="tml-left" style="padding-left:0em;padding-right:0em;"><mi>x</mi></mtd><mtd class="tml-left" style="padding-left:1em;padding-right:0em;"><mrow><mi>x</mi><mo>\u{2265}</mo><mn>0</mn></mrow></mtd></mtr><mtr><mtd class="tml-left" style="padding-left:0em;padding-right:0em;"><mrow><mo form="prefix" stretchy="false">\u{2212}</mo><mi>x</mi></mrow></mtd><mtd class="tml-left" style="padding-left:1em;padding-right:0em;"><mtext>otherwise</mtext></mtd></mtr></mtable><mo fence="true" form="postfix" stretchy="true"></mo></mrow></mrow></math>',
    },
    {
      name: 'accents',
      tex: '\\hat{x} + \\bar{y} + \\vec{v} + \\dot{a} + \\tilde{n}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mover><mi>x</mi><mo stretchy="false" class="chr-sml wbk-sml-acc" style="math-depth:0;">\u{2C6}</mo></mover><mo>+</mo><mover><mi>y</mi><mo stretchy="false" class="chr-sml wbk-sml-acc" style="math-depth:0;">\u{203E}</mo></mover><mo>+</mo><mover><mi>v</mi><mo stretchy="false" class="tml-vec chr-sml wbk-sml-vec">\u{2192}</mo></mover><mo>+</mo><mover><mi>a</mi><mo stretchy="false" class="wbk-acc" style="math-depth:0;">\u{2D9}</mo></mover><mo>+</mo><mover><mi>n</mi><mo stretchy="false" style="math-depth:0;">~</mo></mover></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><mover><mi>x</mi><mo stretchy="false" class="chr-sml wbk-sml-acc" style="math-depth:0;">\u{2C6}</mo></mover><mo>+</mo><mover><mi>y</mi><mo stretchy="false" class="chr-sml wbk-sml-acc" style="math-depth:0;">\u{203E}</mo></mover><mo>+</mo><mover><mi>v</mi><mo stretchy="false" class="tml-vec chr-sml wbk-sml-vec">\u{2192}</mo></mover><mo>+</mo><mover><mi>a</mi><mo stretchy="false" class="wbk-acc" style="math-depth:0;">\u{2D9}</mo></mover><mo>+</mo><mover><mi>n</mi><mo stretchy="false" style="math-depth:0;">~</mo></mover></mrow></math>',
    },
    {
      name: 'text',
      tex: 'x = 1 \\text{ if } y > 0',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>x</mi><mo>=</mo><mn>1</mn><mtext>\u{A0}if\u{A0}</mtext><mi>y</mi><mo>&gt;</mo><mn>0</mn></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><mi>x</mi><mo>=</mo><mn>1</mn><mtext>\u{A0}if\u{A0}</mtext><mi>y</mi><mo>&gt;</mo><mn>0</mn></mrow></math>',
    },
    {
      name: 'operatorname',
      tex: '\\operatorname{argmax}_{x} f(x) + \\sin x + \\lim_{n \\to \\infty} a_n',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msub><mi>argmax</mi><mi>x</mi></msub><mo>\u{2061}</mo><mspace width="0.1667em"></mspace><mi>f</mi><mrow><mo fence="true" form="prefix" stretchy="false">(</mo><mi>x</mi><mo fence="true" form="postfix" stretchy="false">)</mo></mrow><mo>+</mo><mrow><mi>sin</mi><mo>\u{2061}</mo><mspace width="0.1667em"></mspace></mrow><mi>x</mi><mo>+</mo><msub><mi>lim</mi><mrow><mi>n</mi><mo>\u{2192}</mo><mi>\u{221E}</mi></mrow></msub><mo>\u{2061}</mo><mspace width="0.1667em"></mspace><msub><mi>a</mi><mi>n</mi></msub></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><msub><mi>argmax</mi><mi>x</mi></msub><mo>\u{2061}</mo><mspace width="0.1667em"></mspace><mi>f</mi><mrow><mo fence="true" form="prefix" stretchy="false">(</mo><mi>x</mi><mo fence="true" form="postfix" stretchy="false">)</mo></mrow><mo>+</mo><mrow><mi>sin</mi><mo>\u{2061}</mo><mspace width="0.1667em"></mspace></mrow><mi>x</mi><mo>+</mo><munder><mi>lim</mi><mrow><mi>n</mi><mo>\u{2192}</mo><mi>\u{221E}</mi></mrow></munder><mo>\u{2061}</mo><mspace width="0.1667em"></mspace><msub><mi>a</mi><mi>n</mi></msub></mrow></math>',
    },
    {
      name: 'left right',
      tex: '\\left( \\frac{x}{y} \\right)^2 + \\left\\{ a \\middle| b \\right\\}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msup><mrow><mo fence="true" form="prefix" stretchy="true">(</mo><mfrac><mi>x</mi><mi>y</mi></mfrac><mo fence="true" form="postfix" stretchy="true">)</mo></mrow><mn>2</mn></msup><mo>+</mo><mrow><mo fence="true" form="prefix" stretchy="true">{</mo><mi>a</mi><mo stretchy="true" form="infix" lspace="0.05em" rspace="0.05em">|</mo><mi>b</mi><mo fence="true" form="postfix" stretchy="true">}</mo></mrow></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><msup><mrow><mo fence="true" form="prefix" stretchy="true">(</mo><mfrac><mi>x</mi><mi>y</mi></mfrac><mo fence="true" form="postfix" stretchy="true">)</mo></mrow><mn>2</mn></msup><mo>+</mo><mrow><mo fence="true" form="prefix" stretchy="true">{</mo><mi>a</mi><mo stretchy="true" form="infix" lspace="0.05em" rspace="0.05em">|</mo><mi>b</mi><mo fence="true" form="postfix" stretchy="true">}</mo></mrow></mrow></math>',
    },
    {
      name: 'primes',
      tex: "f'(x) + g''(x)",
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msup><mi>f</mi><mo lspace="0em" rspace="0em" class="tml-prime tml-lrg-pad">\u{2032}</mo></msup><mrow><mo fence="true" form="prefix" stretchy="false">(</mo><mi>x</mi><mo fence="true" form="postfix" stretchy="false">)</mo></mrow><mo>+</mo><msup><mi>g</mi><mrow class="tml-sml-pad"><mo lspace="0em" rspace="0em" class="tml-prime">\u{2032}</mo><mo lspace="0em" rspace="0em" class="tml-prime">\u{2032}</mo></mrow></msup><mrow><mo fence="true" form="prefix" stretchy="false">(</mo><mi>x</mi><mo fence="true" form="postfix" stretchy="false">)</mo></mrow></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><msup><mi>f</mi><mo lspace="0em" rspace="0em" class="tml-prime tml-lrg-pad">\u{2032}</mo></msup><mrow><mo fence="true" form="prefix" stretchy="false">(</mo><mi>x</mi><mo fence="true" form="postfix" stretchy="false">)</mo></mrow><mo>+</mo><msup><mi>g</mi><mrow class="tml-sml-pad"><mo lspace="0em" rspace="0em" class="tml-prime">\u{2032}</mo><mo lspace="0em" rspace="0em" class="tml-prime">\u{2032}</mo></mrow></msup><mrow><mo fence="true" form="prefix" stretchy="false">(</mo><mi>x</mi><mo fence="true" form="postfix" stretchy="false">)</mo></mrow></mrow></math>',
    },
    {
      name: 'mathbb',
      tex: 'x \\in \\mathbb{R}, \\; \\mathcal{A} \\subseteq \\mathbb{N}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>x</mi><mo>\u{2208}</mo><mi>\u{211D}</mi><mo separator="true">,</mo><mspace width="0.2778em"></mspace><mi class="mathcal">\u{1D49C}</mi><mo>\u{2286}</mo><mi>\u{2115}</mi></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><mi>x</mi><mo>\u{2208}</mo><mi>\u{211D}</mi><mo separator="true">,</mo><mspace width="0.2778em"></mspace><mi class="mathcal">\u{1D49C}</mi><mo>\u{2286}</mo><mi>\u{2115}</mi></mrow></math>',
    },
    {
      name: 'root',
      tex: '\\sqrt[3]{x} + \\sqrt{x^2+1}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mroot><mrow><mi>x</mi><mspace width="0pt" height="0.5em"></mspace></mrow><mn>3</mn></mroot><mo>+</mo><msqrt><mrow><msup><mi>x</mi><mn class="tml-sml-pad">2</mn></msup><mo>+</mo><mn>1</mn></mrow></msqrt></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><mroot><mrow><mi>x</mi><mspace width="0pt" height="0.5em"></mspace></mrow><mn>3</mn></mroot><mo>+</mo><msqrt><mrow><msup><mi>x</mi><mn class="tml-sml-pad">2</mn></msup><mo>+</mo><mn>1</mn></mrow></msqrt></mrow></math>',
    },
    {
      name: 'binom',
      tex: '\\binom{n}{k}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mo fence="true">(</mo><mfrac linethickness="0px"><mi>n</mi><mi>k</mi></mfrac><mo fence="true">)</mo></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><mo fence="true">(</mo><mfrac linethickness="0px"><mi>n</mi><mi>k</mi></mfrac><mo fence="true">)</mo></mrow></math>',
    },
    {
      name: 'underbrace',
      tex: '\\underbrace{a+b}_{n} + \\overline{z}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mrow><munder><munder><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mo stretchy="true" style="math-depth:0;">\u{23DF}</mo></munder><mi>n</mi></munder></mrow><mo>+</mo><menclose notation="top" class="tml-overline"><mi>z</mi></menclose></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><mrow><munder><munder><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mo stretchy="true" style="math-depth:0;">\u{23DF}</mo></munder><mi>n</mi></munder></mrow><mo>+</mo><menclose notation="top" class="tml-overline"><mi>z</mi></menclose></mrow></math>',
    },
    {
      name: 'aligned',
      tex: '\\begin{aligned} a &= b + c \\\\ d &= e \\end{aligned}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mtable displaystyle="true" class="tml-jot"><mtr><mtd class="tml-right" style="padding-left:0em;padding-right:0em;"><mi>a</mi></mtd><mtd class="tml-left" style="padding-left:0em;padding-right:0em;"><mrow><mo>=</mo><mi>b</mi><mo>+</mo><mi>c</mi></mrow></mtd></mtr><mtr><mtd class="tml-right" style="padding-left:0em;padding-right:0em;"><mi>d</mi></mtd><mtd class="tml-left" style="padding-left:0em;padding-right:0em;"><mrow><mo>=</mo><mi>e</mi></mrow></mtd></mtr></mtable></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mtable displaystyle="true" class="tml-jot"><mtr><mtd class="tml-right" style="padding-left:0em;padding-right:0em;"><mi>a</mi></mtd><mtd class="tml-left" style="padding-left:0em;padding-right:0em;"><mrow><mo>=</mo><mi>b</mi><mo>+</mo><mi>c</mi></mrow></mtd></mtr><mtr><mtd class="tml-right" style="padding-left:0em;padding-right:0em;"><mi>d</mi></mtd><mtd class="tml-left" style="padding-left:0em;padding-right:0em;"><mrow><mo>=</mo><mi>e</mi></mrow></mtd></mtr></mtable></math>',
    },
    {
      name: 'subsup',
      tex: 'x_i^2 + {}_{a}^{b}X',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msubsup><mi>x</mi><mi>i</mi><mn class="tml-sml-pad">2</mn></msubsup><mo>+</mo><msubsup><mrow></mrow><mi>a</mi><mi>b</mi></msubsup><mi>X</mi></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><msubsup><mi>x</mi><mi>i</mi><mn class="tml-sml-pad">2</mn></msubsup><mo>+</mo><msubsup><mrow></mrow><mi>a</mi><mi>b</mi></msubsup><mi>X</mi></mrow></math>',
    },
    {
      name: 'overline',
      tex: '\\overline{z}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><menclose notation="top" class="tml-overline"><mi>z</mi></menclose></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><menclose notation="top" class="tml-overline"><mi>z</mi></menclose></math>',
    },
    {
      name: 'underline',
      tex: '\\underline{x+y}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><menclose notation="bottom" class="tml-underline"><mrow><mi>x</mi><mo>+</mo><mi>y</mi></mrow></menclose></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><menclose notation="bottom" class="tml-underline"><mrow><mi>x</mi><mo>+</mo><mi>y</mi></mrow></menclose></math>',
    },
    {
      name: 'overline twice',
      tex: '\\overline{\\overline{x}}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><menclose notation="top" class="tml-overline"><menclose notation="top" class="tml-overline"><mi>x</mi></menclose></menclose></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><menclose notation="top" class="tml-overline"><menclose notation="top" class="tml-overline"><mi>x</mi></menclose></menclose></math>',
    },
    {
      name: 'cancel',
      tex: '\\cancel{x}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><menclose notation="updiagonalstrike"><mi>x</mi><mrow class="tml-cancel upstrike"></mrow></menclose></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><menclose notation="updiagonalstrike"><mi>x</mi><mrow class="tml-cancel upstrike"></mrow></menclose></math>',
    },
    {
      name: 'boxed',
      tex: '\\boxed{x}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow scriptlevel="0" displaystyle="true" style="padding:3pt;border:1px solid;"><mi>x</mi></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow scriptlevel="0" displaystyle="true" style="padding:3pt;border:1px solid;"><mi>x</mi></mrow></math>',
    },
    {
      name: 'cases alone',
      tex: '\\begin{cases} 1 & x > 0 \\\\ 0 & \\text{otherwise} \\end{cases}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mo fence="true" form="prefix" stretchy="true">{</mo><mtable><mtr><mtd class="tml-left" style="padding-left:0em;padding-right:0em;"><mn>1</mn></mtd><mtd class="tml-left" style="padding-left:1em;padding-right:0em;"><mrow><mi>x</mi><mo>&gt;</mo><mn>0</mn></mrow></mtd></mtr><mtr><mtd class="tml-left" style="padding-left:0em;padding-right:0em;"><mn>0</mn></mtd><mtd class="tml-left" style="padding-left:1em;padding-right:0em;"><mtext>otherwise</mtext></mtd></mtr></mtable><mo fence="true" form="postfix" stretchy="true"></mo></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><mo fence="true" form="prefix" stretchy="true">{</mo><mtable><mtr><mtd class="tml-left" style="padding-left:0em;padding-right:0em;"><mn>1</mn></mtd><mtd class="tml-left" style="padding-left:1em;padding-right:0em;"><mrow><mi>x</mi><mo>&gt;</mo><mn>0</mn></mrow></mtd></mtr><mtr><mtd class="tml-left" style="padding-left:0em;padding-right:0em;"><mn>0</mn></mtd><mtd class="tml-left" style="padding-left:1em;padding-right:0em;"><mtext>otherwise</mtext></mtd></mtr></mtable><mo fence="true" form="postfix" stretchy="true"></mo></mrow></math>',
    },
    {
      name: 'aligned alone',
      tex: '\\begin{aligned} x &= 1 \\\\ y + z &= 22 \\end{aligned}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mtable displaystyle="true" class="tml-jot"><mtr><mtd class="tml-right" style="padding-left:0em;padding-right:0em;"><mi>x</mi></mtd><mtd class="tml-left" style="padding-left:0em;padding-right:0em;"><mrow><mo>=</mo><mn>1</mn></mrow></mtd></mtr><mtr><mtd class="tml-right" style="padding-left:0em;padding-right:0em;"><mrow><mi>y</mi><mo>+</mo><mi>z</mi></mrow></mtd><mtd class="tml-left" style="padding-left:0em;padding-right:0em;"><mrow><mo>=</mo><mn>22</mn></mrow></mtd></mtr></mtable></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mtable displaystyle="true" class="tml-jot"><mtr><mtd class="tml-right" style="padding-left:0em;padding-right:0em;"><mi>x</mi></mtd><mtd class="tml-left" style="padding-left:0em;padding-right:0em;"><mrow><mo>=</mo><mn>1</mn></mrow></mtd></mtr><mtr><mtd class="tml-right" style="padding-left:0em;padding-right:0em;"><mrow><mi>y</mi><mo>+</mo><mi>z</mi></mrow></mtd><mtd class="tml-left" style="padding-left:0em;padding-right:0em;"><mrow><mo>=</mo><mn>22</mn></mrow></mtd></mtr></mtable></math>',
    },
    {
      name: 'array lr',
      tex: '\\begin{array}{lr} a & bb \\\\ ccc & d \\end{array}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mtable><mtr><mtd class="tml-left" style="padding-left:0pt;padding-right:5.9776pt;"><mi>a</mi></mtd><mtd class="tml-right" style="padding-left:5.9776pt;padding-right:0pt;"><mrow><mi>b</mi><mi>b</mi></mrow></mtd></mtr><mtr><mtd class="tml-left" style="padding-left:0pt;padding-right:5.9776pt;"><mrow><mi>c</mi><mi>c</mi><mi>c</mi></mrow></mtd><mtd class="tml-right" style="padding-left:5.9776pt;padding-right:0pt;"><mi>d</mi></mtd></mtr></mtable></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mtable><mtr><mtd class="tml-left" style="padding-left:0pt;padding-right:5.9776pt;"><mi>a</mi></mtd><mtd class="tml-right" style="padding-left:5.9776pt;padding-right:0pt;"><mrow><mi>b</mi><mi>b</mi></mrow></mtd></mtr><mtr><mtd class="tml-left" style="padding-left:0pt;padding-right:5.9776pt;"><mrow><mi>c</mi><mi>c</mi><mi>c</mi></mrow></mtd><mtd class="tml-right" style="padding-left:5.9776pt;padding-right:0pt;"><mi>d</mi></mtd></mtr></mtable></math>',
    },
    {
      name: 'bar',
      tex: '\\bar{x}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mover><mi>x</mi><mo stretchy="false" class="chr-sml wbk-sml-acc" style="math-depth:0;">\u{203E}</mo></mover></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mover><mi>x</mi><mo stretchy="false" class="chr-sml wbk-sml-acc" style="math-depth:0;">\u{203E}</mo></mover></math>',
    },
    {
      name: 'hat',
      tex: '\\hat{x}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mover><mi>x</mi><mo stretchy="false" class="chr-sml wbk-sml-acc" style="math-depth:0;">\u{2C6}</mo></mover></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mover><mi>x</mi><mo stretchy="false" class="chr-sml wbk-sml-acc" style="math-depth:0;">\u{2C6}</mo></mover></math>',
    },
    {
      name: 'vec',
      tex: '\\vec{v}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mover><mi>v</mi><mo stretchy="false" class="tml-vec chr-sml wbk-sml-vec">\u{2192}</mo></mover></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mover><mi>v</mi><mo stretchy="false" class="tml-vec chr-sml wbk-sml-vec">\u{2192}</mo></mover></math>',
    },
    {
      name: 'colorbox',
      tex: '\\colorbox{red}{x}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow mathbackground="#ff0000" style="padding:0.3em;"><mtext>x</mtext></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow mathbackground="#ff0000" style="padding:0.3em;"><mtext>x</mtext></mrow></math>',
    },
    {
      name: 'bcancel',
      tex: '\\bcancel{x}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><menclose notation="downdiagonalstrike"><mi>x</mi><mrow class="tml-cancel downstrike"></mrow></menclose></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><menclose notation="downdiagonalstrike"><mi>x</mi><mrow class="tml-cancel downstrike"></mrow></menclose></math>',
    },
    {
      name: 'xcancel',
      tex: '\\xcancel{x}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><menclose notation="updiagonalstrike downdiagonalstrike"><mi>x</mi><mrow class="tml-cancel tml-xcancel"></mrow></menclose></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><menclose notation="updiagonalstrike downdiagonalstrike"><mi>x</mi><mrow class="tml-cancel tml-xcancel"></mrow></menclose></math>',
    },
    {
      name: 'sout',
      tex: '\\sout{x}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><menclose notation="horizontalstrike"><mi>x</mi><mrow class="tml-cancel sout"></mrow></menclose></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><menclose notation="horizontalstrike"><mi>x</mi><mrow class="tml-cancel sout"></mrow></menclose></math>',
    },
    {
      name: 'fbox',
      tex: '\\fbox{x}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><menclose notation="box" class="tml-fbox"><mstyle scriptlevel="0" displaystyle="false"><mtext>x</mtext></mstyle></menclose></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><menclose notation="box" class="tml-fbox"><mstyle scriptlevel="0" displaystyle="false"><mtext>x</mtext></mstyle></menclose></math>',
    },
    {
      name: 'textcircled',
      tex: '\\textcircled{a}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><menclose notation="circle" class="circle-pad"><mtext>a</mtext><mrow class="textcircle"></mrow></menclose></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><menclose notation="circle" class="circle-pad"><mtext>a</mtext><mrow class="textcircle"></mrow></menclose></math>',
    },
    {
      name: 'phase',
      tex: '\\phase{x}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><menclose notation="phasorangle" class="phasor-bottom"><mi>x</mi><mrow class="phasor-angle"></mrow></menclose></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><menclose notation="phasorangle" class="phasor-bottom"><mi>x</mi><mrow class="phasor-angle"></mrow></menclose></math>',
    },
    {
      name: 'longdiv',
      tex: '\\longdiv{x}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><menclose notation="longdiv" class="longdiv-top"><mi>x</mi><mrow class="longdiv-arc"></mrow></menclose></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><menclose notation="longdiv" class="longdiv-top"><mi>x</mi><mrow class="longdiv-arc"></mrow></menclose></math>',
    },
    {
      name: 'angl',
      tex: '\\angl{n}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><menclose notation="actuarial" class="actuarial"><mi>n</mi></menclose></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><menclose notation="actuarial" class="actuarial"><mi>n</mi></menclose></math>',
    },
    {
      name: 'cancelto',
      tex: '\\cancelto{0}{x}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mrow><mrow class="menclose"><mrow class="ff-narrow"><mi>x</mi><mspace height="0.85em"></mspace></mrow><mrow class="tml-cancelto" style="color:undefined;left:0.1em;width:90%;"><mphantom style="padding:0.5ex 0.1em 0 0;"><mi>x</mi></mphantom></mrow></mrow><mover><mspace height="1em"></mspace><mpadded width="0.1px"><mn style="color:undefined;">0</mn></mpadded></mover></mrow><mrow class="ff-nudge-left"></mrow></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><mrow><mrow class="menclose"><mrow class="ff-narrow"><mi>x</mi><mspace height="0.85em"></mspace></mrow><mrow class="tml-cancelto" style="color:undefined;left:0.1em;width:90%;"><mphantom style="padding:0.5ex 0.1em 0 0;"><mi>x</mi></mphantom></mrow></mrow><mover><mspace height="1em"></mspace><mpadded width="0.1px"><mn style="color:undefined;">0</mn></mpadded></mover></mrow><mrow class="ff-nudge-left"></mrow></mrow></math>',
    },
    {
      name: 'fcolorbox',
      tex: '\\fcolorbox{red}{blue}{x}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow mathbackground="#0000FF" style="padding:0.3em;border:0.0667em solid #ff0000;"><mtext>x</mtext></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow mathbackground="#0000FF" style="padding:0.3em;border:0.0667em solid #ff0000;"><mtext>x</mtext></mrow></math>',
    },
    {
      name: 'tag',
      tex: '\\tag{3} x',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mtable displaystyle="true" style="width:100%;"><mtr class="tml-tageqn"><mtd style="padding:0;width:50%;"></mtd><mtd><mrow><mi>x</mi></mrow></mtd><mtd style="padding:0;width:50%;"><mtext class="tml-tag">(3)</mtext></mtd></mtr></mtable></math>',
    },
    {
      name: 'align',
      tex: '\\begin{align} a &= b \\\\ c &= d \\end{align}',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mtable displaystyle="true" class="tml-jot" style="width:100%;"><mtr><mtd class="tml-right" style="padding:0;width:50%;padding-left:0em;padding-right:0em;"></mtd><mtd class="tml-right" style="padding-left:1em;padding-right:0em;"><mi>a</mi></mtd><mtd class="tml-left" style="padding-left:0em;padding-right:0em;"><mrow><mo>=</mo><mi>b</mi></mrow></mtd><mtd style="padding:0;width:50%;padding-left:1em;padding-right:0em;"><mtext><span class="tml-eqn"></span></mtext></mtd></mtr><mtr><mtd class="tml-right" style="padding:0;width:50%;padding-left:0em;padding-right:0em;"></mtd><mtd class="tml-right" style="padding-left:1em;padding-right:0em;"><mi>c</mi></mtd><mtd class="tml-left" style="padding-left:0em;padding-right:0em;"><mrow><mo>=</mo><mi>d</mi></mrow></mtd><mtd style="padding:0;width:50%;padding-left:1em;padding-right:0em;"><mtext><span class="tml-eqn"></span></mtext></mtd></mtr></mtable></math>',
    },
    // A line break outside an environment, which only the inline output shows as one: the block's
    // is an empty operator, written exactly as `\pmod`'s `\allowbreak` is (equations 1, task 4).
    {
      name: 'line break',
      tex: 'a \\\\ b',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mtable columnalign="left" rowspacing="0em"><mtr><mtd style="text-align:left;"><mrow><mi>a</mi></mrow><mo linebreak="newline"></mo></mtd></mtr><mtr><mtd style="text-align:left;"><mrow><mi>b</mi></mrow></mtd></mtr></mtable></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><mi>a</mi><mo></mo><mi>b</mi></mrow></math>',
    },
    {
      name: 'line break in text',
      tex: '\\text{a \\\\ b}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mtext>a\u{A0}</mtext><mo linebreak="newline"></mo><mtext>\u{A0}b</mtext></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><mtext>a\u{A0}</mtext><mo></mo><mtext>\u{A0}b</mtext></mrow></math>',
    },
    {
      name: 'pmod',
      tex: 'a \\pmod{2}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>a</mi><mo></mo><mspace width="0.4444em"></mspace><mrow><mo fence="true" form="prefix" stretchy="false">(</mo><mpadded lspace="0"><mi>mod</mi></mpadded><mspace width="0.3333em"></mspace><mn>2</mn><mo fence="true" form="postfix" stretchy="false">)</mo></mrow></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><mi>a</mi><mo></mo><mspace width="1em"></mspace><mrow><mo fence="true" form="prefix" stretchy="false">(</mo><mpadded lspace="0"><mi>mod</mi></mpadded><mspace width="0.3333em"></mspace><mn>2</mn><mo fence="true" form="postfix" stretchy="false">)</mo></mrow></mrow></math>',
    },
    // A rule, which Temml draws as a space filled by its background, and a box moved up or down,
    // which it draws with an offset the reader keeps (equations 1's final review, L2 and L3). A rule
    // of no width is a strut, and draws nothing.
    {
      name: 'rule',
      tex: '\\rule{1em}{1em}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mspace mathbackground="black" width="1em" height="1em"></mspace></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mspace mathbackground="black" width="1em" height="1em"></mspace></math>',
    },
    {
      name: 'raised rule',
      tex: '\\rule[1ex]{2em}{1pt}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mpadded height="+0.431em" voffset="0.431em"><mspace mathbackground="black" width="2em" height="0.9963pt"></mspace></mpadded></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mpadded height="+0.431em" voffset="0.431em"><mspace mathbackground="black" width="2em" height="0.9963pt"></mspace></mpadded></math>',
    },
    {
      name: 'strut',
      tex: '\\rule{0pt}{2ex}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mspace width="0pt" height="0.862em"></mspace></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mspace width="0pt" height="0.862em"></mspace></math>',
    },
    {
      name: 'raisebox',
      tex: '\\raisebox{1em}{x}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mpadded voffset="1em" style="padding:1em 0 0 0;"><mstyle scriptlevel="0" displaystyle="false"><mtext>x</mtext></mstyle></mpadded></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mpadded voffset="1em" style="padding:1em 0 0 0;"><mstyle scriptlevel="0" displaystyle="false"><mtext>x</mtext></mstyle></mpadded></math>',
    },
    {
      name: 'lower',
      tex: '\\lower{1em}{x}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mpadded voffset="-1em" style="padding:0 0 1em 0;"><mi>x</mi></mpadded></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mpadded voffset="-1em" style="padding:0 0 1em 0;"><mi>x</mi></mpadded></math>',
    },
    // What Temml sets a script level smaller - `\substack`, `smallmatrix` and `subarray`, each an
    // `mstyle` with `scriptlevel="1"` and no display style - and the two styles that set a level
    // explicitly, which equations 2's converter maps to the engine's script sizes (its final review, I2).
    {
      name: 'substack',
      tex: '\\sum_{\\substack{i < n \\\\ i > 0}} a_i',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msub><mo movablelimits="false">\u{2211}</mo><mstyle scriptlevel="1"><mtable class="tml-small"><mtr><mtd style="padding-left:0em;padding-right:0em;"><mrow><mi>i</mi><mo>&lt;</mo><mi>n</mi></mrow></mtd></mtr><mtr><mtd style="padding-left:0em;padding-right:0em;"><mrow><mi>i</mi><mo>&gt;</mo><mn>0</mn></mrow></mtd></mtr></mtable></mstyle></msub><msub><mi>a</mi><mi>i</mi></msub></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><mrow><munder><mo movablelimits="false">\u{2211}</mo><mstyle scriptlevel="1"><mtable class="tml-small"><mtr><mtd style="padding-left:0em;padding-right:0em;"><mrow><mi>i</mi><mo>&lt;</mo><mi>n</mi></mrow></mtd></mtr><mtr><mtd style="padding-left:0em;padding-right:0em;"><mrow><mi>i</mi><mo>&gt;</mo><mn>0</mn></mrow></mtd></mtr></mtable></mstyle></munder></mrow><msub><mi>a</mi><mi>i</mi></msub></mrow></math>',
    },
    {
      name: 'smallmatrix',
      tex: '\\left(\\begin{smallmatrix} a & b \\\\ c & d \\end{smallmatrix}\\right)',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mo fence="true" form="prefix" stretchy="true">(</mo><mstyle scriptlevel="1"><mtable class="tml-small"><mtr><mtd style="padding-left:0em;padding-right:0.1389em;"><mi>a</mi></mtd><mtd style="padding-left:0.1389em;padding-right:0em;"><mi>b</mi></mtd></mtr><mtr><mtd style="padding-left:0em;padding-right:0.1389em;"><mi>c</mi></mtd><mtd style="padding-left:0.1389em;padding-right:0em;"><mi>d</mi></mtd></mtr></mtable></mstyle><mo fence="true" form="postfix" stretchy="true">)</mo></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><mo fence="true" form="prefix" stretchy="true">(</mo><mstyle scriptlevel="1"><mtable class="tml-small"><mtr><mtd style="padding-left:0em;padding-right:0.1389em;"><mi>a</mi></mtd><mtd style="padding-left:0.1389em;padding-right:0em;"><mi>b</mi></mtd></mtr><mtr><mtd style="padding-left:0em;padding-right:0.1389em;"><mi>c</mi></mtd><mtd style="padding-left:0.1389em;padding-right:0em;"><mi>d</mi></mtd></mtr></mtable></mstyle><mo fence="true" form="postfix" stretchy="true">)</mo></mrow></math>',
    },
    {
      name: 'subarray',
      tex: '\\sum_{\\begin{subarray}{l} i < n \\\\ j > 0 \\end{subarray}} a_{ij}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><msub><mo movablelimits="false">\u{2211}</mo><mstyle scriptlevel="1"><mtable class="tml-small"><mtr><mtd class="tml-left" style="padding-left:0em;padding-right:0em;"><mrow><mi>i</mi><mo>&lt;</mo><mi>n</mi></mrow></mtd></mtr><mtr><mtd class="tml-left" style="padding-left:0em;padding-right:0em;"><mrow><mi>j</mi><mo>&gt;</mo><mn>0</mn></mrow></mtd></mtr></mtable></mstyle></msub><msub><mi>a</mi><mrow><mi>i</mi><mi>j</mi></mrow></msub></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><mrow><munder><mo movablelimits="false">\u{2211}</mo><mstyle scriptlevel="1"><mtable class="tml-small"><mtr><mtd class="tml-left" style="padding-left:0em;padding-right:0em;"><mrow><mi>i</mi><mo>&lt;</mo><mi>n</mi></mrow></mtd></mtr><mtr><mtd class="tml-left" style="padding-left:0em;padding-right:0em;"><mrow><mi>j</mi><mo>&gt;</mo><mn>0</mn></mrow></mtd></mtr></mtable></mstyle></munder></mrow><msub><mi>a</mi><mrow><mi>i</mi><mi>j</mi></mrow></msub></mrow></math>',
    },
    {
      name: 'scriptstyle',
      tex: 'x + {\\scriptstyle y + z}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>x</mi><mo>+</mo><mstyle scriptlevel="1" displaystyle="false"><mi>y</mi><mo>+</mo><mi>z</mi></mstyle></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><mi>x</mi><mo>+</mo><mstyle scriptlevel="1" displaystyle="false"><mi>y</mi><mo>+</mo><mi>z</mi></mstyle></mrow></math>',
    },
    {
      name: 'scriptscriptstyle',
      tex: 'x + {\\scriptscriptstyle y + z}',
      inline:
        '<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>x</mi><mo>+</mo><mstyle scriptlevel="2" displaystyle="false"><mi>y</mi><mo>+</mo><mi>z</mi></mstyle></mrow></math>',
      block:
        '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" class="tml-display" style="display:block math;"><mrow><mi>x</mi><mo>+</mo><mstyle scriptlevel="2" displaystyle="false"><mi>y</mi><mo>+</mo><mi>z</mi></mstyle></mrow></math>',
    },
  ];
}
