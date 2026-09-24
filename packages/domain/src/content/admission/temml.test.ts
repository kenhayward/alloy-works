import { describe, expect, it } from 'vitest';

import { isKeptMathml, MATHML_NAMESPACE, sanitiseMathml } from './mathml.js';
import { temmlOutput, type TemmlFixture as Fixture } from './temml.fixture.js';
import { admitTemmlMathml } from './temml.js';

const OVERLINE = '\u{203E}';
const LOW_LINE = '_';

const fixture = (name: string): Fixture => {
  const found = temmlOutput().find((each) => each.name === name);
  if (found === undefined) throw new Error(`no fixture named ${name}`);
  return found;
};

/** Both of a fixture's outputs, a display-only one's block alone. */
const outputsOf = (name: string): string[] => {
  const { inline, block } = fixture(name);
  return inline === undefined ? [block] : [inline, block];
};

const readerAlone = (source: string): string => {
  const result = sanitiseMathml(source);
  if (!result.ok) throw new Error(`the reader refused a fixture: ${result.failure}`);
  return result.mathml;
};

const admitted = (source: string): string => {
  const result = admitTemmlMathml(source);
  if (!result.ok) throw new Error(`expected it admitted, got: ${JSON.stringify(result)}`);
  return result.mathml;
};

const math = (inner: string, attributes = '') =>
  `<math xmlns="${MATHML_NAMESPACE}"${attributes}>${inner}</math>`;

const overlined = (base: string) =>
  `<mover accent="true">${base}<mo stretchy="true">${OVERLINE}</mo></mover>`;

/** What the reader would have kept had Temml written its alignment as MathML rather than classes. */
const asIfAligned = (source: string) =>
  readerAlone(
    source
      .replaceAll('class="tml-left"', 'columnalign="left"')
      .replaceAll('class="tml-right"', 'columnalign="right"'),
  );

const changedByTheRewrite = new Set([
  'underbrace',
  'overline',
  'underline',
  'overline twice',
  'cases',
  'aligned',
  'cases alone',
  'aligned alone',
  'array lr',
  'subarray',
]);

const refusedConstructs: Record<string, string> = {
  cancel: '\\cancel',
  bcancel: '\\bcancel',
  xcancel: '\\xcancel',
  sout: '\\sout',
  fbox: '\\fbox',
  textcircled: '\\textcircled',
  phase: '\\phase',
  longdiv: '\\longdiv',
  angl: '\\angl',
  boxed: '\\boxed',
  fcolorbox: '\\fcolorbox',
  cancelto: '\\cancelto',
  rule: '\\rule',
  'raised rule': '\\rule',
  raisebox: '\\raisebox, \\raise or \\lower',
  lower: '\\raisebox, \\raise or \\lower',
};

const numbered = new Set(['tag', 'align']);

const brokenLines = new Set(['line break', 'line break in text']);

describe("Temml's output, admitted as the one form an equation is stored in", () => {
  it('keeps an overline as a mover of its content under a stretchy overline, and keeps the content', () => {
    const { inline, block } = fixture('overline');
    expect(admitted(inline!)).toBe(math(overlined('<mi>z</mi>')));
    expect(admitted(block)).toBe(math(overlined('<mi>z</mi>'), ' display="block"'));
  });

  it('keeps an underline as a munder of its content over a stretchy low line', () => {
    expect(admitted(fixture('underline').inline!)).toBe(
      math(
        `<munder accentunder="true"><mrow><mi>x</mi><mo>+</mo><mi>y</mi></mrow><mo stretchy="true">${LOW_LINE}</mo></munder>`,
      ),
    );
  });

  it('rewrites an overline inside another, and one standing beside other content, changing nothing else', () => {
    expect(admitted(fixture('overline twice').inline!)).toBe(
      math(overlined(overlined('<mi>x</mi>'))),
    );
    for (const source of outputsOf('underbrace')) {
      const beside = source.replace(
        '<menclose notation="top" class="tml-overline"><mi>z</mi></menclose>',
        overlined('<mi>z</mi>'),
      );
      expect(beside).not.toBe(source);
      expect(admitted(source)).toBe(readerAlone(beside));
    }
  });

  it("keeps a cases block's left alignment as columnalign on every cell", () => {
    for (const name of ['cases', 'cases alone']) {
      for (const source of outputsOf(name)) {
        const kept = admitted(source);
        expect(kept).toBe(asIfAligned(source));
        const cells = kept.match(/<mtd\b/g)!.length;
        expect(cells).toBeGreaterThan(0);
        expect(kept.match(/<mtd columnalign="left"/g)!.length).toBe(cells);
      }
    }
  });

  it("keeps aligned's right-then-left columns, and an array's declared ones", () => {
    for (const name of ['aligned', 'aligned alone', 'array lr']) {
      for (const source of outputsOf(name)) {
        expect(admitted(source)).toBe(asIfAligned(source));
      }
    }
    expect(admitted(fixture('aligned alone').inline!)).toContain(
      '<mtr><mtd columnalign="right"><mi>x</mi></mtd><mtd columnalign="left"><mrow><mo>=</mo><mn>1</mn></mrow></mtd></mtr>',
    );
    expect(admitted(fixture('array lr').inline!)).toContain(
      '<mtr><mtd columnalign="left"><mi>a</mi></mtd><mtd columnalign="right"><mrow><mi>b</mi><mi>b</mi></mrow></mtd></mtr>',
    );
  });

  it('refuses \\cancel, \\boxed and everything else it cannot keep or draw, naming the command', () => {
    for (const [name, construct] of Object.entries(refusedConstructs)) {
      for (const source of outputsOf(name)) {
        expect(admitTemmlMathml(source), name).toEqual({
          ok: false,
          reason: 'construct',
          construct,
        });
      }
    }
  });

  it('refuses a filled rule and a box moved off its line, naming them, and a strut alone, which draws nothing', () => {
    // The reader drops a rule's colour, as it drops any colour, and would store a filled box as an
    // empty space; and it keeps an offset, which draws a raised box wherever its value says - over the
    // lines above, or the editor's own controls (equations 1's final review, L2 and L3).
    for (const name of ['rule', 'raised rule']) {
      for (const source of outputsOf(name)) {
        expect(admitTemmlMathml(source), name).toEqual({
          ok: false,
          reason: 'construct',
          construct: '\\rule',
        });
      }
    }
    for (const name of ['raisebox', 'lower']) {
      for (const source of outputsOf(name)) {
        expect(admitTemmlMathml(source), name).toEqual({
          ok: false,
          reason: 'construct',
          construct: '\\raisebox, \\raise or \\lower',
        });
      }
    }
    // A strut is kept inside an equation (the integral's root holds one), but alone it is an equation
    // that draws nothing (the final review of equations 2, M1).
    for (const source of outputsOf('strut')) {
      expect(admitTemmlMathml(source)).toEqual({ ok: false, reason: 'empty' });
    }
    expect(fixture('integral').block).toContain('<mspace width="0pt" height="0.5em"></mspace>');
    expect(admitTemmlMathml(fixture('integral').block).ok).toBe(true);
  });

  it('refuses an equation that draws nothing, which would carry its words in a publication to no one', () => {
    // As Temml writes an empty group or empty text, a thin space, a fraction or a root of nothing, an
    // empty matrix, and a phantom (the final review of equations 2, M1): nothing an equation shows, so
    // nothing a publication tags to carry the words it is spoken by.
    for (const inner of [
      '<mrow></mrow>',
      '<mspace width="0.1667em"></mspace>',
      '<mtext> </mtext>',
      '<mfrac><mrow></mrow><mrow></mrow></mfrac>',
      '<msqrt><mrow></mrow></msqrt>',
      '<mtable></mtable>',
      '<mphantom><mi>x</mi></mphantom>',
    ]) {
      for (const display of ['', ' display="block"']) {
        expect(admitTemmlMathml(math(inner, display)), inner).toEqual({
          ok: false,
          reason: 'empty',
        });
      }
    }
    // One thing that shows is enough.
    expect(
      admitTemmlMathml(math('<mrow><mspace width="0.1667em"></mspace><mi>x</mi></mrow>')).ok,
    ).toBe(true);
  });

  it("refuses an equation number Temml drew, since a block's number is the product's to set", () => {
    for (const name of numbered) {
      expect(admitTemmlMathml(fixture(name).block), name).toEqual({ ok: false, reason: 'number' });
    }
  });

  it('refuses a line break Temml drew outside an environment, which a block would lose without a word', () => {
    for (const name of brokenLines) {
      expect(admitTemmlMathml(fixture(name).inline!), name).toEqual({
        ok: false,
        reason: 'lineBreak',
      });
    }
    // A display equation draws the same break as an empty operator, and so does \pmod's \allowbreak:
    // nothing in a block's output tells them apart, so the editor finds the break in the LaTeX.
    const broken = fixture('line break').block;
    expect(broken).toContain('<mi>a</mi><mo></mo><mi>b</mi>');
    expect(fixture('pmod').block).toContain('<mi>a</mi><mo></mo><mspace');
    expect(admitted(broken)).toBe(readerAlone(broken));
  });

  it('gives every other sample exactly what the reader alone gives', () => {
    const others = temmlOutput().filter(
      ({ name }) =>
        !changedByTheRewrite.has(name) &&
        !(name in refusedConstructs) &&
        !numbered.has(name) &&
        !brokenLines.has(name) &&
        name !== 'strut',
    );
    expect(others).toHaveLength(22);
    for (const { name } of others) {
      for (const source of outputsOf(name)) {
        expect(admitted(source), name).toBe(readerAlone(source));
      }
    }
  });

  it('writes what the reader keeps exactly as it is, for every sample it admits', () => {
    let seen = 0;
    for (const { name } of temmlOutput()) {
      for (const source of outputsOf(name)) {
        const result = admitTemmlMathml(source);
        if (!result.ok) continue;
        seen += 1;
        expect(isKeptMathml(result.mathml), name).toBe(true);
        expect(admitTemmlMathml(result.mathml), name).toEqual(result);
      }
    }
    expect(seen).toBeGreaterThan(50);
  });

  it('refuses an enclosure whose notation it does not know, naming the notation', () => {
    expect(admitTemmlMathml(math('<menclose notation="radical"><mi>x</mi></menclose>'))).toEqual({
      ok: false,
      reason: 'construct',
      construct: '<menclose notation="radical">',
    });
    expect(admitTemmlMathml(math('<menclose notation="top bottom"><mi>x</mi></menclose>'))).toEqual(
      { ok: false, reason: 'construct', construct: '<menclose notation="top bottom">' },
    );
  });

  it('refuses rather than store an equation the reader would lose content from, or cannot read', () => {
    expect(admitTemmlMathml(math('<maction actiontype="toggle"><mi>x</mi></maction>'))).toEqual({
      ok: false,
      reason: 'unkept',
      detail: 'maction',
    });
    expect(admitTemmlMathml(math('<mrow>x</mrow>'))).toEqual({
      ok: false,
      reason: 'unkept',
      detail: 'x',
    });
    expect(admitTemmlMathml('<math><mi>x</mi>')).toEqual({
      ok: false,
      reason: 'unkept',
      detail: '<math> is never closed',
    });
  });

  it('leaves the reader as strict as it was: an overline reaching it by any other route is removed and reported', () => {
    const source = fixture('overline').inline!;
    const result = sanitiseMathml(source);
    expect(result).toEqual({
      ok: true,
      mathml: `<math xmlns="${MATHML_NAMESPACE}"/>`,
      findings: [{ subject: 'mathElement', detail: 'menclose' }],
    });
  });
});
