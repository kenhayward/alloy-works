import {
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  type OutlineView,
  type OutlineViewNode,
} from '@alloy-works/domain';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DocumentText } from './DocumentText.js';

const PRINTER = '6a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';

const common = { numbered: true, matter: 'body', pageBreak: 'none', values: {} } as const;

const section = (id: string, title: string, children: OutlineViewNode[] = []): OutlineViewNode => ({
  ...common,
  type: 'section',
  id,
  title: [{ type: 'text', value: title, marks: [] }],
  children,
});

const reference = (id: string, component: string | null): OutlineViewNode =>
  ({
    ...common,
    type: 'reference',
    id,
    component,
    mode: { kind: 'latest' },
    children: [],
  }) as OutlineViewNode;

const outline: OutlineView = {
  schemaVersion: OUTLINE_SCHEMA_VERSION,
  title: 'The dosing report',
  language: 'en-GB',
  direction: 'ltr',
  nodes: [
    section('aaaaaaaaaaaaaaaaaaaaaaaaaa', 'Introduction'),
    section('bbbbbbbbbbbbbbbbbbbbbbbbbb', 'Method', [
      reference('cccccccccccccccccccccccccc', PRINTER),
      reference('dddddddddddddddddddddddddd', null),
    ]),
  ],
};

describe("the document's text", () => {
  it('sets out the document in reading order: numbered sections, and each component reference under its number with a link to open it', () => {
    render(
      <DocumentText
        outline={outline}
        scheme={defaultLayout.scheme}
        names={new Map([[PRINTER, 'Install the printer']])}
      />,
    );

    const text = screen.getByRole('region', { name: "The document's text" });
    const headings = within(text).getAllByRole('heading');
    expect(headings.map((heading) => heading.textContent)).toEqual([
      '1 Introduction',
      '2 Method',
      '2.1 Install the printer',
      '2.2 A component',
    ]);
    expect(within(text).getByRole('link', { name: 'Open Install the printer' })).toHaveAttribute(
      'href',
      `#/components/${PRINTER}`,
    );
    // Withheld from this reader: named neutrally, marked, and nothing to open.
    expect(within(text).getByText('Not yours to read')).toBeInTheDocument();
    expect(within(text).getAllByRole('link')).toHaveLength(1);
  });

  it('numbers nothing when the scheme could not be read', () => {
    render(<DocumentText outline={outline} scheme={null} names={null} />);
    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      'Introduction',
      'Method',
      'A component',
      'A component',
    ]);
  });
});
