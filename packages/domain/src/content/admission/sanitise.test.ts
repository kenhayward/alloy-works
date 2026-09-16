import { describe, expect, it } from 'vitest';

import { MATHML_NAMESPACE } from './mathml.js';
import { createReport } from './report.js';
import { sanitise } from './sanitise.js';

const text = (value: string, marks: unknown[] = []) => ({ type: 'text', value, marks });
const paragraph = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  type: 'paragraph',
  content,
  ...extra,
});
const candidate = (content: unknown[]) => ({ schemaVersion: 1, content });

const run = (value: unknown) => {
  const report = createReport();
  const output = sanitise(value, report);
  return { output, entries: report.entries.map(({ message: _, ...entry }) => entry) };
};

describe('the sanitise stage', () => {
  it('passes content with nothing to remove through unchanged, and reports nothing', () => {
    const clean = candidate([
      paragraph([
        text('See the ', []),
        text('guide', [{ type: 'hyperlink', href: 'https://example.test/guide' }]),
      ]),
    ]);
    expect(run(clean)).toEqual({ output: clean, entries: [] });
  });

  it('removes a script wherever a node can stand, naming what the reader called it', () => {
    const { output, entries } = run(
      candidate([
        { type: 'script', name: 'script' },
        paragraph([text('Before'), { type: 'script', name: 'script' }, text('after')]),
      ]),
    );
    expect(output).toEqual(candidate([paragraph([text('Before'), text('after')])]));
    expect(entries).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'script', detail: 'script' },
      { stage: 'sanitise', action: 'discarded', subject: 'script', detail: 'script' },
    ]);
  });

  it('removes an embedded object and anything inside it', () => {
    const { output, entries } = run(
      candidate([
        { type: 'embeddedObject', name: 'iframe', content: [paragraph([text('Fallback')])] },
      ]),
    );
    expect(output).toEqual(candidate([]));
    expect(entries).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'embeddedObject', detail: 'iframe' },
    ]);
  });

  it('removes event handlers from any node or mark, one entry for each', () => {
    const { output, entries } = run(
      candidate([
        paragraph([text('Click', [{ type: 'strong', handlers: ['onmouseover'] }])], {
          handlers: ['onclick', 'onfocus'],
        }),
      ]),
    );
    expect(output).toEqual(candidate([paragraph([text('Click', [{ type: 'strong' }])])]));
    expect(entries).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onmouseover' },
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onclick' },
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onfocus' },
    ]);
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    '/relative/path',
    'not a url',
  ])('removes a link to %j, keeps its text, and names the target it had', (href) => {
    const { output, entries } = run(
      candidate([
        paragraph([text('Read this', [{ type: 'strong' }, { type: 'hyperlink', href }])]),
      ]),
    );
    expect(output).toEqual(candidate([paragraph([text('Read this', [{ type: 'strong' }])])]));
    expect(entries).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'hyperlink', detail: href },
    ]);
  });

  it('removes a link with no target at all', () => {
    const { output, entries } = run(candidate([paragraph([text('x', [{ type: 'hyperlink' }])])]));
    expect(output).toEqual(candidate([paragraph([text('x', [])])]));
    expect(entries).toEqual([{ stage: 'sanitise', action: 'discarded', subject: 'hyperlink' }]);
  });

  it('keeps a web or email target exactly as it arrived', () => {
    for (const href of [
      'https://example.test',
      'http://example.test/a?b=c#d',
      'mailto:ada@example.test',
    ]) {
      const value = candidate([paragraph([text('x', [{ type: 'hyperlink', href }])])]);
      const { output, entries } = run(value);
      expect(output).toEqual(value);
      expect(entries).toEqual([]);
    }
  });

  it('rewrites a target the URL parser reads differently from what it says, naming what it had', () => {
    const href = 'https://example.test/\tpath\n';
    const { output, entries } = run(
      candidate([paragraph([text('x', [{ type: 'hyperlink', href, title: 'Guide' }])])]),
    );
    expect(output).toEqual(
      candidate([
        paragraph([
          text('x', [{ type: 'hyperlink', href: 'https://example.test/path', title: 'Guide' }]),
        ]),
      ]),
    );
    expect(entries).toEqual([
      { stage: 'sanitise', action: 'rewritten', subject: 'hyperlink', detail: href },
    ]);
  });

  it('reports formatting that could run code as a script, and leaves the rest for normalise', () => {
    const { output, entries } = run(
      candidate([
        paragraph([text('x')], {
          presentation: {
            typeface: 'Leeds Sans',
            width: 'expression(alert(1))',
            background: 'expr\\65 ssion(alert(2))',
            border: 'url("javascript:alert(3)")',
            colour: 'red /* expression( */',
            behavior: 'url(evil.htc)',
            filter: 'ex/**/pression(alert(4))',
          },
        }),
      ]),
    );
    expect(output).toEqual(
      candidate([
        paragraph([text('x')], {
          presentation: { typeface: 'Leeds Sans', colour: 'red /* expression( */' },
        }),
      ]),
    );
    expect(entries.map((entry) => [entry.subject, entry.detail])).toEqual([
      ['executableStyle', 'width'],
      ['executableStyle', 'background'],
      ['executableStyle', 'border'],
      ['executableStyle', 'behavior'],
      ['executableStyle', 'filter'],
    ]);
  });

  it('keeps quoted comment markers as text, so a hidden expression cannot escape detection', () => {
    const { output, entries } = run(
      candidate([
        paragraph([text('x')], {
          presentation: { width: '"/*" expression(alert(1)) "*/"' },
        }),
      ]),
    );
    expect(output).toEqual(candidate([paragraph([text('x')], { presentation: {} })]));
    expect(entries).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'executableStyle', detail: 'width' },
    ]);
  });

  it('finds a hostile target hidden behind quoted comment markers', () => {
    const { output, entries } = run(
      candidate([
        paragraph([text('x')], {
          presentation: { background: '"/*" url(javascript:alert(1)) "*/"' },
        }),
      ]),
    );
    expect(output).toEqual(candidate([paragraph([text('x')], { presentation: {} })]));
    expect(entries).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'executableStyle', detail: 'background' },
    ]);
  });

  it('removes a presentation that is a bare string carrying an expression, not just a record of properties', () => {
    const { output, entries } = run(
      candidate([paragraph([text('x')], { presentation: 'expression(alert(1))' })]),
    );
    expect(output).toEqual(candidate([paragraph([text('x')])]));
    expect(entries).toEqual([
      {
        stage: 'sanitise',
        action: 'discarded',
        subject: 'executableStyle',
        detail: 'expression(alert(1))',
      },
    ]);
  });

  it('finds an expression nested inside a presentation propertys own value, not only at the top level', () => {
    const { output, entries } = run(
      candidate([
        paragraph([text('x')], {
          presentation: { typeface: 'Leeds Sans', border: { style: 'expression(alert(1))' } },
        }),
      ]),
    );
    expect(output).toEqual(
      candidate([paragraph([text('x')], { presentation: { typeface: 'Leeds Sans' } })]),
    );
    expect(entries).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'executableStyle', detail: 'border' },
    ]);
  });

  it('sanitises an equation, reporting each thing removed and the rewrite once', () => {
    const { output, entries } = run(
      candidate([
        {
          type: 'equation',
          numbered: false,
          mathml: '<math><mi onclick="alert(1)">x</mi><script>alert(2)</script></math>',
        },
        paragraph([
          { type: 'equation', mathml: `<math xmlns="${MATHML_NAMESPACE}"><mi>y</mi></math>` },
        ]),
      ]),
    );
    expect(output).toEqual(
      candidate([
        {
          type: 'equation',
          numbered: false,
          mathml: `<math xmlns="${MATHML_NAMESPACE}"><mi>x</mi></math>`,
        },
        paragraph([
          { type: 'equation', mathml: `<math xmlns="${MATHML_NAMESPACE}"><mi>y</mi></math>` },
        ]),
      ]),
    );
    expect(entries).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onclick' },
      { stage: 'sanitise', action: 'discarded', subject: 'script', detail: 'script' },
      { stage: 'sanitise', action: 'rewritten', subject: 'equation', count: 1 },
    ]);
  });

  it('removes an equation that cannot be read, saying why', () => {
    const { output, entries } = run(
      candidate([
        paragraph([text('a'), { type: 'equation', mathml: '<math><mi>x</math>' }, text('b')]),
      ]),
    );
    expect(output).toEqual(candidate([paragraph([text('a'), text('b')])]));
    expect(entries).toEqual([
      {
        stage: 'sanitise',
        action: 'discarded',
        subject: 'equation',
        detail: '</math> closes an element that is not open',
      },
    ]);
  });

  it('keeps an own __proto__ member as a data property, leaving the objects prototype alone', () => {
    const arrived = JSON.parse(
      '{"schemaVersion":1,"content":[{"type":"paragraph","content":[],"__proto__":{"polluted":true}}]}',
    ) as unknown;
    const { output, entries } = run(arrived);
    const node = (output as { content: unknown[] }).content[0] as Record<string, unknown>;
    expect(Object.getPrototypeOf(node)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(node, '__proto__')).toBe(true);
    expect(node['__proto__']).toEqual({ polluted: true });
    expect(entries).toEqual([]);
  });

  it('leaves the reader output it was given untouched', () => {
    const arrived = candidate([
      paragraph([text('x', [{ type: 'hyperlink', href: 'javascript:alert(1)' }])], {
        handlers: ['onclick'],
      }),
      paragraph([text('y', [{ type: 'hyperlink', href: 'https://example.test/\tpath\n' }])]),
      { type: 'equation', mathml: '<math><mi onclick="alert(1)">z</mi></math>' },
    ]);
    const copy = structuredClone(arrived);
    const { output, entries } = run(arrived);
    expect(arrived).toEqual(copy);
    expect(output).toEqual(
      candidate([
        paragraph([text('x', [])]),
        paragraph([text('y', [{ type: 'hyperlink', href: 'https://example.test/path' }])]),
        { type: 'equation', mathml: `<math xmlns="${MATHML_NAMESPACE}"><mi>z</mi></math>` },
      ]),
    );
    expect(entries).toEqual([
      {
        stage: 'sanitise',
        action: 'discarded',
        subject: 'hyperlink',
        detail: 'javascript:alert(1)',
      },
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onclick' },
      {
        stage: 'sanitise',
        action: 'rewritten',
        subject: 'hyperlink',
        detail: 'https://example.test/\tpath\n',
      },
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onclick' },
      { stage: 'sanitise', action: 'rewritten', subject: 'equation', count: 1 },
    ]);
  });
});
