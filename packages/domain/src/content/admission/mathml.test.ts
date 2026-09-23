import { describe, expect, it } from 'vitest';

import { equationAlternative, isKeptMathml, MATHML_NAMESPACE, sanitiseMathml } from './mathml.js';

const math = (inner: string, attributes = '') =>
  `<math xmlns="${MATHML_NAMESPACE}"${attributes}>${inner}</math>`;

const readable = (source: string) => {
  const result = sanitiseMathml(source);
  if (!result.ok) throw new Error(`expected readable MathML, got: ${result.failure}`);
  return result;
};

const unreadable = (source: string) => {
  const result = sanitiseMathml(source);
  if (result.ok) throw new Error(`expected unreadable MathML, got: ${result.mathml}`);
  return result.failure;
};

describe('an equation written in one form', () => {
  it('declares the namespace once, orders attributes, and drops whitespace between elements', () => {
    const result = readable(
      `<math display="block" alttext="x equals two">\n  <mi> x </mi>\n  <mo>=</mo>\n  <mn>2</mn>\n</math>`,
    );
    expect(result).toEqual({
      ok: true,
      mathml: math('<mi>x</mi><mo>=</mo><mn>2</mn>', ' alttext="x equals two" display="block"'),
      findings: [],
    });
  });

  it('writes two spellings of one equation as one string', () => {
    const a = readable(
      `<math xmlns="${MATHML_NAMESPACE}"><mfrac linethickness="0" ><mi>a</mi><mi>b</mi></mfrac></math>`,
    );
    const b = readable(`<math><mfrac   linethickness='0'>\n<mi>a</mi>\n<mi>b</mi></mfrac></math>`);
    expect(a.mathml).toBe(b.mathml);
  });

  it('is unchanged by a second pass', () => {
    const once = readable(math('<msup><mi>e</mi><mrow><mi>i</mi><mi>&#x3C0;</mi></mrow></msup>'));
    expect(sanitiseMathml(once.mathml)).toEqual(once);
  });

  it('decodes references and escapes only what markup needs', () => {
    expect(readable(math('<mo>&lt;</mo><mi>&#x3B1;</mi><mtext>A &amp; B</mtext>')).mathml).toBe(
      math('<mo>&lt;</mo><mi>\u{3B1}</mi><mtext>A &amp; B</mtext>'),
    );
  });

  it('self-closes an empty element', () => {
    expect(readable(math('<mspace width="1em"></mspace>')).mathml).toBe(
      math('<mspace width="1em"/>'),
    );
  });

  it('puts text in NFC', () => {
    expect(readable(math('<mi>e\u{301}</mi>')).mathml).toBe(math('<mi>\u{E9}</mi>'));
  });

  it('keeps a non-breaking space inside a token, unlike XML whitespace', () => {
    expect(readable(math('<mtext>&#xA0;</mtext>')).mathml).toBe(math('<mtext>\u{A0}</mtext>'));
  });
});

describe('what an equation may not carry', () => {
  it('removes a script element and everything in it', () => {
    const result = readable(math('<mi>x</mi><script>alert(1)</script>'));
    expect(result.mathml).toBe(math('<mi>x</mi>'));
    expect(result.findings).toEqual([{ subject: 'script', detail: 'script' }]);
  });

  it('removes an event handler attribute, naming it', () => {
    const result = readable(math('<mi onclick="alert(1)" ONMOUSEOVER="alert(2)">x</mi>'));
    expect(result.mathml).toBe(math('<mi>x</mi>'));
    expect(result.findings).toEqual([
      { subject: 'eventHandler', detail: 'onclick' },
      { subject: 'eventHandler', detail: 'ONMOUSEOVER' },
    ]);
  });

  it('removes a link, in either spelling, naming the target it had', () => {
    const result = readable(
      math('<mi href="javascript:alert(1)">x</mi><mi xlink:href="https://example.test/">y</mi>'),
    );
    expect(result.mathml).toBe(math('<mi>x</mi><mi>y</mi>'));
    expect(result.findings).toEqual([
      { subject: 'hyperlink', detail: 'javascript:alert(1)' },
      { subject: 'hyperlink', detail: 'https://example.test/' },
    ]);
  });

  it('removes colour, size, style and identity attributes', () => {
    const result = readable(
      math('<mi mathcolor="red" mathsize="2em" style="color: red" class="big" id="x1">x</mi>'),
    );
    expect(result.mathml).toBe(math('<mi>x</mi>'));
    expect(result.findings).toEqual([
      { subject: 'mathAttribute', detail: 'mathcolor' },
      { subject: 'mathAttribute', detail: 'mathsize' },
      { subject: 'mathAttribute', detail: 'style' },
      { subject: 'mathAttribute', detail: 'class' },
      { subject: 'mathAttribute', detail: 'id' },
    ]);
  });

  it('removes an annotation carrying HTML, and the markup inside it', () => {
    const result = readable(
      math(
        '<semantics><mi>x</mi><annotation-xml encoding="text/html"><img src="x" onerror="alert(1)"/></annotation-xml></semantics>',
      ),
    );
    expect(result.mathml).toBe(math('<semantics><mi>x</mi></semantics>'));
    expect(result.findings).toEqual([{ subject: 'mathElement', detail: 'annotation-xml' }]);
  });

  it('removes an element that is not MathML Core, and a math element nested in another', () => {
    const result = readable(math('<maction actiontype="toggle"><mi>x</mi></maction><math/>'));
    expect(result.mathml).toBe(`<math xmlns="${MATHML_NAMESPACE}"/>`);
    expect(result.findings).toEqual([
      { subject: 'mathElement', detail: 'maction' },
      { subject: 'mathElement', detail: 'math' },
    ]);
  });

  it('removes an element inside a token, where only text belongs', () => {
    const result = readable(math('<mtext>a<b>bold</b></mtext>'));
    expect(result.mathml).toBe(math('<mtext>a</mtext>'));
    expect(result.findings).toEqual([{ subject: 'mathElement', detail: 'b' }]);
  });

  it('removes text standing outside any token', () => {
    const result = readable(math('stray<mi>x</mi>'));
    expect(result.mathml).toBe(math('<mi>x</mi>'));
    expect(result.findings).toEqual([{ subject: 'mathText', detail: 'stray' }]);
  });

  it('reports a non-breaking space standing outside any token, unlike XML whitespace', () => {
    const result = readable(math('<mrow>\u{A0}<mi>x</mi></mrow>'));
    expect(result.mathml).toBe(math('<mrow><mi>x</mi></mrow>'));
    expect(result.findings).toEqual([{ subject: 'mathText', detail: '\u{A0}' }]);
  });

  it('writes a combining mark as a reference, so NFC cannot fuse it with the tag before it', () => {
    // `>` followed by U+0338 composes to U+226F under NFC. Written raw, the tag's `>` would be eaten
    // and the text after it read by a browser as attributes of <mi>.
    const result = readable(math('<mi>\u{338} onmouseover=alert(1) x=</mi>'));
    expect(result.mathml).toBe(math('<mi>&#x338; onmouseover=alert(1) x=</mi>'));
    expect(result.mathml.normalize('NFC')).toBe(result.mathml);
    expect(sanitiseMathml(result.mathml.normalize('NFC'))).toEqual(result);
  });
});

describe('an equation that cannot be read', () => {
  it.each([
    ['an element left open', math('<mi>x')],
    ['a closing tag that closes nothing open', math('<mi>x</mo>')],
    ['a stray closing tag', `${math('<mi>x</mi>')}</math>`],
    ['an unquoted attribute', math('<mi class=x>x</mi>')],
    ['an attribute with no value', math('<mi hidden>x</mi>')],
    ['a repeated attribute', math('<mi dir="ltr" dir="rtl">x</mi>')],
    ['an attribute value holding <', math('<mi alttext="<script>">x</mi>')],
    ['a bare ampersand', math('<mtext>A & B</mtext>')],
    ['a named entity XML does not define', math('<mi>&alpha;</mi>')],
    ['a named entity that names an inherited object member', math('<mi>&constructor;</mi>')],
    ['a named entity that names the prototype itself', math('<mi>&__proto__;</mi>')],
    [
      'a named entity that names an inherited object member, in an attribute value',
      math('<mi alttext="&toString;">x</mi>'),
    ],
    ['a reference to a character XML does not allow', math('<mi>&#0;</mi>')],
    ['a comment', math('<!-- note --><mi>x</mi>')],
    ['CDATA', math('<mtext><![CDATA[<script>alert(1)</script>]]></mtext>')],
    ['a declaration', `<!DOCTYPE math>${math('<mi>x</mi>')}`],
    ['a processing instruction', `<?xml version="1.0"?>${math('<mi>x</mi>')}`],
    ['two roots', `${math('<mi>x</mi>')}${math('<mi>y</mi>')}`],
    ['text beside the root', `x${math('<mi>x</mi>')}`],
    ['a non-breaking space beside the root, unlike XML whitespace', `\u{A0}${math('<mi>x</mi>')}`],
    ['a root that is not math', '<mrow><mi>x</mi></mrow>'],
    ['another namespace', '<math xmlns="http://www.w3.org/1999/xhtml"><mi>x</mi></math>'],
    ['a NUL character', math('<mi>\u{0}</mi>')],
    ['a < that starts no element', math('<mi>1 < 2</mi>')],
  ])('refuses %s', (_, source) => {
    expect(unreadable(source)).toMatch(/\S/);
  });

  it('refuses nesting deeper than the limit without exhausting the stack', () => {
    const deep = `<math>${'<mrow>'.repeat(100_000)}<mi>x</mi>${'</mrow>'.repeat(100_000)}</math>`;
    expect(unreadable(deep)).toMatch(/nested more than 64 deep/);
  });
});

describe('MathML kept exactly as it stands', () => {
  it('is everything the reader writes', () => {
    for (const source of [
      `<math display="block" alttext="x equals two">\n  <mi> x </mi>\n  <mo>=</mo>\n  <mn>2</mn>\n</math>`,
      math('<mo>&lt;</mo><mo>></mo><mi>&#x3B1;</mi><mtext>A &amp; "B"</mtext>'),
      math('<mspace width="1em"></mspace>'),
      math('<mi>e\u{301}</mi><mi>q\u{301}</mi>'),
      math('<mi>\u{338} onmouseover=alert(1) x=</mi>'),
      math('<mi alttext="a&#9;&quot;b&quot;">x</mi>'),
      math('<mi onclick="alert(1)">x</mi><script>alert(2)</script>'),
    ]) {
      const written = readable(source).mathml;
      expect(isKeptMathml(written), written).toBe(true);
    }
  });

  it('is nothing the reader would rewrite, remove anything from, or refuse', () => {
    for (const source of [
      '<math><mi>x</mi></math>',
      math('\n<mi>x</mi>\n'),
      math(`<mi xmlns="${MATHML_NAMESPACE}">x</mi>`),
      math('<mi>x</mi>', ' display="block" alttext="x"'),
      math('<mspace width="1em"></mspace>'),
      math('<mo>></mo>'),
      math('<mi>e\u{301}</mi>'),
      math('<mi>\u{338}</mi>'),
      math('<mi onclick="alert(1)">x</mi>'),
      math('<mi>x</mi><script>alert(1)</script>'),
      math('<mi mathcolor="red">x</mi>'),
      math('<mi>x</mi>stray'),
      math('<mi>x'),
      '',
    ]) {
      expect(isKeptMathml(source), JSON.stringify(source)).toBe(false);
    }
  });
});

describe('the alternative an equation is spoken by', () => {
  it('is the alttext on its math element, read as the reader reads it', () => {
    // A combining mark with no precomposed form, so NFC leaves it be and the reader writes it as a
    // character reference, which comes back as the mark.
    const stored = readable(
      math('<mi>x</mi>', ' alttext="x &amp; &quot;y&quot; q\u{301} &lt; 2"'),
    ).mathml;
    expect(stored).toContain('q&#x301;');
    expect(equationAlternative(stored)).toBe('x & "y" q\u{301} < 2');
  });

  it('is none where the math element has none, says nothing, or cannot be read', () => {
    expect(equationAlternative(math('<mi>x</mi>'))).toBeNull();
    expect(equationAlternative(math('<mi>x</mi>', ' alttext=""'))).toBeNull();
    expect(equationAlternative(math('<mi>x</mi>', ' alttext="  "'))).toBeNull();
    // An alttext on anything but the root is not the equation's.
    expect(equationAlternative(math('<mi alttext="x">x</mi>'))).toBeNull();
    expect(equationAlternative('<math><mi>x')).toBeNull();
  });
});
