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

  it('answers null for content it cannot read', () => {
    expect(renderContent({ title: 'Not content' }, document)).toBeNull();
  });
});
