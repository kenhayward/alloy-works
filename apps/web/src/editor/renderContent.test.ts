import { bindingDigestInput, type Binding } from '@alloy-works/domain';
import { createEditorState, mountEditor, renderContent, toEditor } from '@alloy-works/editor';
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

  it("draws an image in a line in a holder of its own, as the surface's image view does, which the theme holds its line open by (issue #331)", () => {
    const rendered = renderContent(
      {
        ...content,
        content: [
          {
            type: 'paragraph',
            id: 'b1',
            style: 'body',
            content: [
              { type: 'text', value: 'Press ', marks: [] },
              {
                type: 'image',
                asset: '0b0e8c5e-3a7d-4f5e-9c1a-6d2f4b8a1c3e',
                imageStyle: 'inline',
                alternative: { kind: 'inherited' },
              },
              { type: 'text', value: ' to start.', marks: [] },
            ],
          },
        ],
      },
      document,
    );
    if (rendered === null) throw new Error('Expected markup');
    const host = document.createElement('div');
    host.append(rendered);
    const image = host.querySelector('img.aw-inline-image');
    expect(image?.parentElement).toHaveClass('aw-inline-image-holder');
    expect(image?.parentElement?.parentElement?.tagName).toBe('P');
    expect(host.querySelector('p')).toHaveTextContent('Press to start.');
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

  it("CNT-175 exposes a component's lists, tables and footnotes to assistive technology as structure, not styling", () => {
    const text = (value: string) => ({ type: 'text', value, marks: [] });
    const para = (id: string, ...runs: unknown[]) => ({
      type: 'paragraph',
      id,
      style: 'body',
      content: runs,
    });
    const cell = (id: string, value: string) => ({
      content: [para(id, text(value))],
      colspan: 1,
      rowspan: 1,
    });
    const structured = {
      ...content,
      content: [
        {
          type: 'list',
          id: 'l1',
          kind: 'unordered',
          items: [{ content: [para('u1', text('Plug it in.'))] }],
        },
        {
          type: 'list',
          id: 'l2',
          kind: 'ordered',
          items: [{ content: [para('o1', text('Switch it on.'))] }],
        },
        {
          type: 'list',
          id: 'l3',
          kind: 'definition',
          items: [
            { term: [text('Creep')], content: [para('d1', text('Slow strain.'))] },
            {
              term: [text('Yield')],
              content: [para('d2', text('The greatest stress.')), para('d3', text('Measured.'))],
            },
          ],
        },
        {
          type: 'table',
          id: 't1',
          style: 'table',
          caption: [text('Readings')],
          headerRows: 1,
          headerColumns: 0,
          rows: [{ cells: [cell('h1', 'City')] }, { cells: [cell('c1', 'York')] }],
        },
        para('b1', text('Unbox it'), {
          type: 'footnote',
          id: 'f1',
          anchor: { kind: 'span' },
          content: [para('fp1', text('Twice.'))],
        }),
      ],
    };

    // What a list, a definition list and a table are, to anything reading the markup: elements that
    // say so, and a definition list's every group exactly one term and then its definition, holding
    // every block of the definition - never a paragraph standing beside the term.
    const exposed = (root: Element) => {
      expect(root.querySelector('ul > li')).toHaveTextContent('Plug it in.');
      expect(root.querySelector('ol > li')).toHaveTextContent('Switch it on.');
      const groups = [...root.querySelector('dl')!.children];
      expect(groups.map((group) => group.tagName)).toEqual(['DIV', 'DIV']);
      expect(groups.map((group) => [...group.children].map((child) => child.tagName))).toEqual([
        ['DT', 'DD'],
        ['DT', 'DD'],
      ]);
      expect(groups.map((group) => group.querySelector(':scope > dt')!.textContent)).toEqual([
        'Creep',
        'Yield',
      ]);
      expect(
        [...groups[1]!.querySelectorAll(':scope > dd > p')].map((block) => block.textContent),
      ).toEqual(['The greatest stress.', 'Measured.']);
      const table = root.querySelector('figure table')!;
      expect(table.closest('figure')!.querySelector('figcaption')).toHaveTextContent('Readings');
      expect(table.querySelector('th')).toHaveTextContent('City');
      expect(table.querySelector('td')).toHaveTextContent('York');
    };

    // The editor's surface, which is what CNT-175 asks of: and there a footnote is a marker named as
    // one, its text an editor of its own named as the footnote's.
    const opened = toEditor(structured as never);
    if (!opened.editable) throw new Error(opened.unsupported.join(', '));
    const place = document.createElement('div');
    document.body.appendChild(place);
    const view = mountEditor(place, {
      state: createEditorState({ doc: opened.doc, newIdentifier: () => 'x' }),
      label: 'Content',
      editable: () => true,
      dispatch: (tr, target) => target.updateState(target.state.apply(tr)),
      pasted: () => undefined,
      refused: () => undefined,
    });
    try {
      exposed(view.dom);
      expect(view.dom.querySelector('sup[role="img"]')).toHaveAttribute('aria-label', 'Footnote');
    } finally {
      view.destroy();
      place.remove();
    }

    // And the same component read on its document's page, before it is opened.
    const rendered = renderContent(structured, document);
    if (rendered === null) throw new Error('Expected markup');
    const host = document.createElement('div');
    host.append(rendered);
    exposed(host);
  });

  it('answers null for content it cannot read', () => {
    expect(renderContent({ title: 'Not content' }, document)).toBeNull();
  });

  it("draws each binding the document holds a resolution for as a button in the read text, in document order, a footnote's included, with their names (B1)", () => {
    const binding = (id: string) => ({
      type: 'binding',
      id,
      query: '00000000-0000-4000-8000-00000000d001',
      parameters: {},
      mode: 'checked',
      take: { column: 'depth' },
    });
    const digest = (id: string) => bindingDigestInput(binding(id) as Binding);
    const withBindings = {
      ...content,
      content: [
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [
            { type: 'text', value: 'The mean was ', marks: [] },
            binding('k1'),
            {
              type: 'footnote',
              id: 'f1',
              anchor: { kind: 'span' },
              content: [{ type: 'paragraph', id: 'fp1', style: 'body', content: [binding('k2')] }],
            },
            { type: 'text', value: ' and ', marks: [] },
            binding('k3'),
            binding('k4'),
          ],
        },
      ],
    };
    const rendered = renderContent(withBindings, document, null, {
      kind: 'document',
      node: 'n7',
      held: new Map([
        ['k1', { binding: digest('k1'), shown: { value: '1,234.5', waiting: false } }],
        ['k2', { binding: digest('k2'), shown: { failure: 'value_many', count: 3 } }],
        ['k3', { binding: digest('k3'), shown: { value: 'Yes', waiting: true } }],
      ]),
    });
    if (rendered === null) throw new Error('Expected markup');
    const host = document.createElement('div');
    host.append(rendered);
    const ICON = String.fromCodePoint(0x21bb);
    expect(
      [...host.querySelectorAll<HTMLElement>('[role="button"]')].map((each) => ({
        type: each.getAttribute('role'),
        tabIndex: each.tabIndex,
        binding: each.dataset.binding,
        node: each.dataset.node,
        name: each.textContent,
      })),
    ).toEqual([
      { type: 'button', tabIndex: 0, binding: 'k1', node: 'n7', name: '1,234.5, bound value' },
      {
        type: 'button',
        tabIndex: 0,
        binding: 'k2',
        node: 'n7',
        name: 'No value - the query returned 3 rows, bound value, failed',
      },
      {
        type: 'button',
        tabIndex: 0,
        binding: 'k3',
        node: 'n7',
        name: `Yes, bound value,${ICON} revision waiting`,
      },
    ]);
    // One the document holds nothing for has no provenance to open: it says so, and is no button.
    const never = host.querySelector('span.aw-binding:not([role])');
    expect(never).toHaveTextContent('No value - never resolved, bound value, failed');
    expect(never).toHaveClass('aw-binding-failed');
    expect(never).toHaveAttribute('data-binding', 'k4');
  });
});
