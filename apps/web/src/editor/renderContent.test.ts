import { renderContent } from '@alloy-works/editor';
import { describe, expect, it } from 'vitest';

const content = {
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    {
      type: 'paragraph',
      id: 'b1',
      style: 'body',
      content: [
        { type: 'text', value: 'Unbox it ', marks: [] },
        { type: 'text', value: 'carefully', marks: [{ type: 'strong', id: 'm1' }] },
        { type: 'text', value: '.', marks: [] },
      ],
    },
    {
      type: 'list',
      id: 'l1',
      kind: 'unordered',
      items: [
        {
          content: [
            {
              type: 'paragraph',
              id: 'b2',
              style: 'body',
              content: [{ type: 'text', value: 'Plug it in.', marks: [] }],
            },
          ],
        },
      ],
    },
  ],
};

describe('a component rendered as text', () => {
  it("renders a component's content as markup, marks and lists included, without a view", () => {
    const rendered = renderContent(content, document);
    if (rendered === null) throw new Error('Expected markup');
    const host = document.createElement('div');
    host.append(rendered);

    expect(host.querySelector('strong')).toHaveTextContent('carefully');
    expect(host.querySelector('ul li')).toHaveTextContent('Plug it in.');
    expect(host.querySelector('[contenteditable]')).toBeNull();
  });

  it("shows a footnote's text where its mark stands, and a table's note beneath the table (footnotes 1)", () => {
    const para = (id: string, value: string) => ({
      type: 'paragraph',
      id,
      style: 'body',
      content: [{ type: 'text', value, marks: [] }],
    });
    const rendered = renderContent(
      {
        ...content,
        content: [
          {
            type: 'paragraph',
            id: 'b1',
            style: 'body',
            content: [
              { type: 'text', value: 'Unbox it', marks: [] },
              {
                type: 'footnote',
                id: 'f1',
                anchor: { kind: 'span' },
                content: [para('fp1', 'Twice.')],
              },
            ],
          },
          {
            type: 'table',
            id: 't1',
            style: 'table',
            caption: [{ type: 'text', value: 'Readings', marks: [] }],
            headerRows: 0,
            headerColumns: 0,
            rows: [{ cells: [{ content: [para('d1', 'York')], colspan: 1, rowspan: 1 }] }],
            note: [{ type: 'text', value: 'Estimated.', marks: [] }],
          },
        ],
      },
      document,
    );
    if (rendered === null) throw new Error('Expected markup');
    const host = document.createElement('div');
    host.append(rendered);
    expect(host.querySelector('.aw-footnote-text')).toHaveTextContent('Twice.');
    expect(host.querySelector('.aw-table-note')).toHaveTextContent('Estimated.');
  });

  it('shows what each cross-reference will print, from a context where it is given one (cross-references 1)', () => {
    const para = (id: string, ...inline: unknown[]) => ({
      type: 'paragraph',
      id,
      style: 'body',
      content: inline,
    });
    const reference = (id: string, block: string) => ({
      type: 'crossReference',
      id,
      target: { kind: 'block', block },
      display: 'number',
    });
    const withReferences = {
      ...content,
      content: [
        {
          type: 'table',
          id: 't1',
          style: 'table',
          caption: [{ type: 'text', value: 'Readings', marks: [] }],
          headerRows: 0,
          headerColumns: 0,
          rows: [{ cells: [{ content: [para('d1')], colspan: 1, rowspan: 1 }] }],
        },
        para(
          'b1',
          { type: 'text', value: 'See ', marks: [] },
          reference('x1', 't1'),
          {
            type: 'footnote',
            id: 'f1',
            anchor: { kind: 'span' },
            content: [para('fp1', reference('x2', 't1'))],
          },
          reference('x3', 'gone'),
        ),
      ],
    };
    const shown = (context?: Parameters<typeof renderContent>[2]) => {
      const rendered = renderContent(withReferences, document, context);
      if (rendered === null) throw new Error('Expected markup');
      const host = document.createElement('div');
      host.append(rendered);
      return [...host.querySelectorAll('span[data-reference]')].map((span) => ({
        text: span.textContent,
        broken: span.classList.contains('aw-reference-broken'),
      }));
    };

    // With no context, as a component on its own shows them: its kind and caption.
    expect(shown()).toEqual([
      { text: 'Table: Readings', broken: false },
      { text: 'Table: Readings', broken: false },
      { text: 'Broken reference', broken: true },
    ]);
    const readings = {
      target: { kind: 'block', block: 't1' },
      kind: 'table',
      label: 'Table 1.1',
      title: 'Readings',
      relative: null,
    } as const;
    expect(shown({ targets: [readings] })).toEqual([
      { text: 'Table 1.1', broken: false },
      { text: 'Table 1.1', broken: false },
      { text: 'Broken reference', broken: true },
    ]);
  });

  it('draws each equation as MathML, a block in display style with its numbering, and one with no alternative marked (equations 1)', () => {
    const NS = 'http://www.w3.org/1998/Math/MathML';
    const squared = `<math xmlns="${NS}" alttext="x squared"><msup><mi>x</mi><mn>2</mn></msup></math>`;
    const unspoken = `<math xmlns="${NS}"><mi>E</mi><mo>=</mo><mi>m</mi></math>`;
    const para = (id: string, ...inline: unknown[]) => ({
      type: 'paragraph',
      id,
      style: 'body',
      content: inline,
    });
    const rendered = renderContent(
      {
        ...content,
        content: [
          para(
            'b1',
            { type: 'text', value: 'Where ', marks: [] },
            { type: 'equation', mathml: squared, latex: 'x^2' },
            {
              type: 'footnote',
              id: 'f1',
              anchor: { kind: 'span' },
              content: [para('fp1', { type: 'equation', mathml: unspoken })],
            },
          ),
          { type: 'equation', id: 'e1', mathml: squared, latex: 'x^2', numbered: true },
          { type: 'equation', id: 'e2', mathml: unspoken, numbered: false },
        ],
      },
      document,
    );
    if (rendered === null) throw new Error('Expected markup');
    const host = document.createElement('div');
    host.append(rendered);

    const drawn = [...host.querySelectorAll<HTMLElement>('[data-equation], [data-equation-block]')];
    expect(drawn).toHaveLength(4);
    for (const holder of drawn) expect(holder.querySelector('math')!.namespaceURI).toBe(NS);
    const [inText, inFootnote, numbered, unnumbered] = drawn.map((holder) => ({
      alttext: holder.querySelector('math')!.getAttribute('alttext'),
      display: holder.querySelector('math')!.getAttribute('display'),
      undescribed: holder.classList.contains('aw-equation-undescribed'),
      marker: holder.querySelector('.aw-equation-number')?.textContent ?? null,
      words: holder.querySelector('.aw-equation-undescribed-marker')?.textContent ?? null,
    }));
    expect(inText).toEqual({
      alttext: 'x squared',
      display: null,
      undescribed: false,
      marker: null,
      words: null,
    });
    expect(inFootnote).toEqual({
      alttext: null,
      display: null,
      undescribed: true,
      marker: null,
      words: 'No description',
    });
    expect(numbered).toEqual({
      alttext: 'x squared',
      display: 'block',
      undescribed: false,
      marker: '(#)',
      words: null,
    });
    expect(unnumbered).toEqual({
      alttext: null,
      display: 'block',
      undescribed: true,
      marker: null,
      words: 'No description',
    });
  });

  it('answers null for content it cannot read', () => {
    expect(renderContent({ title: 'Not content' }, document)).toBeNull();
  });
});
