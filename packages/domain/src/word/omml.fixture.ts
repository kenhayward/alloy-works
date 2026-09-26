/**
 * **An equation holding every kind of maths node at once** (Word 4, task 2): stored MathML as the
 * strict reader keeps it, whose tree (`mathsTree`) has every `MathsNode` kind, every identifier
 * variant and every attachment mode, the operand rule's cases among them - a sum and an integral each
 * followed by what they take, a named operator with a limit, one without, and the sine Temml groups
 * with its space. Set as an aligned equation of nine rows, so that the PDF, which does not keep a
 * displayed equation to its line, sets it within the page as Word does.
 *
 * Read by the converter's tests and by the worker's, which validate it in a document with the Open
 * XML SDK and compile it through template 13, so the two outputs are compared from one source.
 */

const cell = (content: string) => `<mtd><mrow>${content}</mrow></mtd>`;
const row = (left: string, right: string) => `<mtr>${cell(left)}${cell(right)}</mtr>`;
const APPLY = '<mo>\u{2061}</mo>';

export const EVERY_KIND_MATHML =
  '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">' +
  '<mtable displaystyle="true" columnalign="right left">' +
  // Identifiers in every variant; a number, text and a space.
  row(
    '<mi>x</mi><mi mathvariant="normal">d</mi><mi mathvariant="bold">v</mi>' +
      '<mi mathvariant="bold-italic">w</mi><mi mathvariant="double-struck">R</mi>' +
      '<mi mathvariant="script">L</mi><mi mathvariant="fraktur">g</mi>' +
      '<mi mathvariant="sans-serif">s</mi><mi mathvariant="monospace">m</mi>',
    '<mo>=</mo><mn>2.5</mn><mtext> if </mtext><mspace width="1em"/><mi>y</mi>' +
      '<mo>&gt;</mo><mn>0</mn>',
  ) +
  // A sum whose limits move (limits-display) and an integral's beside it (scripts), each followed by
  // its operand; a large union, marked large, with a limit under it.
  row(
    '<munderover><mo movablelimits="true">\u{2211}</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow>' +
      '<mi>n</mi></munderover><msub><mi>x</mi><mi>i</mi></msub>',
    '<mo>=</mo><msubsup><mo>\u{222B}</mo><mn>0</mn><mn>1</mn></msubsup><mi>f</mi>' +
      '<mspace width="0.1667em"/><mi>d</mi><mi>x</mi><mo>+</mo>' +
      '<munder><mo largeop="true" movablelimits="true">\u{22C3}</mo><mi>k</mi></munder>' +
      '<msub><mi>A</mi><mi>k</mi></msub>',
  ) +
  // A named operator with a limit under it always (limits), taking a fraction whose numerator is a
  // sine grouped with its space, as Temml writes it; a fraction without a line and a binomial.
  row(
    `<munder><mi>lim</mi><mrow><mi>x</mi><mo>\u{2192}</mo><mn>0</mn></mrow></munder>${APPLY}` +
      `<mfrac><mrow><mrow><mi>sin</mi>${APPLY}<mspace width="0.1667em"/></mrow><mi>x</mi></mrow>` +
      '<mi>x</mi></mfrac>',
    '<mo>=</mo><mfrac linethickness="0"><mi>a</mi><mi>b</mi></mfrac><mo>+</mo>' +
      '<mrow><mo>(</mo><mfrac linethickness="0"><mi>n</mi><mi>k</mi></mfrac><mo>)</mo></mrow>',
  ) +
  // Roots; scripts, prescripts on both sides and on one.
  row(
    '<msqrt><mi>x</mi><mo>+</mo><mn>1</mn></msqrt><mo>+</mo><mroot><mi>x</mi><mn>3</mn></mroot>',
    '<mo>=</mo><msubsup><mi>x</mi><mi>i</mi><mn>2</mn></msubsup><mo>+</mo>' +
      '<msup><mi>e</mi><mi>t</mi></msup><mo>+</mo>' +
      '<mmultiscripts><mi>C</mi><none/><none/><mprescripts/><mn>6</mn><mn>14</mn></mmultiscripts>' +
      '<mo>+</mo><mmultiscripts><mi>X</mi><mprescripts/><none/><mi>a</mi></mmultiscripts>',
  ) +
  // An accent, lines over and under, and braces with a label and without.
  row(
    '<mover accent="true"><mi>x</mi><mo>\u{2C6}</mo></mover><mo>+</mo>' +
      '<mover><mrow><mi>x</mi><mo>+</mo><mi>y</mi></mrow><mo>\u{203E}</mo></mover><mo>+</mo>' +
      '<munder><mrow><mi>x</mi><mo>+</mo><mi>y</mi></mrow><mo>_</mo></munder>',
    '<mo>=</mo><mover><mover><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mo>\u{23DE}</mo></mover>' +
      '<mi>n</mi></mover><mo>+</mo><munder><mi>c</mi><mo>\u{23DF}</mo></munder>',
  ) +
  // Fences with a separator between them, and with an empty side; a matrix in brackets, its columns
  // aligned left and right.
  row(
    '<mrow><mo>\u{27E8}</mo><mi>a</mi><mo stretchy="true">|</mo><mi>b</mi><mo>\u{27E9}</mo></mrow>' +
      '<mo>+</mo><mrow><mo></mo><mfrac><mrow><mi>d</mi><mi>f</mi></mrow><mrow><mi>d</mi><mi>x</mi>' +
      '</mrow></mfrac><mo>|</mo></mrow>',
    '<mo>=</mo><mrow><mo>[</mo><mtable columnalign="left right"><mtr><mtd><mi>a</mi></mtd>' +
      '<mtd><mi>b</mi><mi>b</mi></mtd></mtr><mtr><mtd><mi>c</mi><mi>c</mi></mtd><mtd><mi>d</mi>' +
      '</mtd></mtr></mtable><mo>]</mo></mrow>',
  ) +
  // Cases, and a matrix standing bare.
  row(
    '<mi>f</mi><mrow><mo stretchy="false">(</mo><mi>x</mi><mo stretchy="false">)</mo></mrow>',
    '<mo>=</mo><mrow><mo>{</mo><mtable columnalign="left left"><mtr><mtd><mi>x</mi><mo>,</mo></mtd>' +
      '<mtd><mi>x</mi><mo>\u{2265}</mo><mn>0</mn></mtd></mtr><mtr><mtd><mo>\u{2212}</mo><mi>x</mi>' +
      '<mo>,</mo></mtd><mtd><mtext>otherwise</mtext></mtd></mtr></mtable><mo></mo></mrow>' +
      '<mo>+</mo><mtable><mtr><mtd><mi>p</mi></mtd><mtd><mi>q</mi></mtd></mtr><mtr><mtd><mi>r</mi>' +
      '</mtd><mtd><mi>s</mi></mtd></mtr></mtable>',
  ) +
  // A phantom and primes; content in the inline style and the display style, a script level smaller
  // and two, standing in running maths.
  row(
    '<mphantom><mi>a</mi><mo>+</mo><mi>b</mi></mphantom><mi>c</mi><mo>+</mo>' +
      '<msup><mi>f</mi><mrow><mo>\u{2032}</mo><mo>\u{2032}</mo></mrow></msup>',
    '<mo>=</mo><mstyle displaystyle="false"><mfrac><mn>1</mn><mn>2</mn></mfrac></mstyle><mo>+</mo>' +
      '<mstyle displaystyle="true"><munder><mo movablelimits="true">\u{2211}</mo><mi>j</mi></munder>' +
      '<mi>y</mi></mstyle><mo>+</mo><mstyle scriptlevel="1"><mi>y</mi><mo>+</mo><mi>z</mi></mstyle>' +
      '<mo>+</mo><mstyle scriptlevel="2"><mi>y</mi><mo>+</mo><mi>z</mi></mstyle>',
  ) +
  // A substack a script level smaller in a sum's limit, which Word already sets at that size.
  row(
    '<munder><mo movablelimits="true">\u{2211}</mo><mstyle scriptlevel="1"><mtable><mtr><mtd>' +
      '<mi>i</mi><mo>&lt;</mo><mi>n</mi></mtd></mtr><mtr><mtd><mi>i</mi><mo>&gt;</mo><mn>0</mn>' +
      '</mtd></mtr></mtable></mstyle></munder><msub><mi>a</mi><mi>i</mi></msub>',
    '<mo>=</mo><mn>1</mn>',
  ) +
  '</mtable></math>';
