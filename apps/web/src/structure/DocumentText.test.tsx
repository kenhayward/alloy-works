import {
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  type OutlineView,
  type OutlineViewNode,
} from '@alloy-works/domain';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it("shows each component's text in its card, and a component's editor in place of its text when asked", async () => {
    const printerText = {
      schemaVersion: 1,
      title: 'Install the printer',
      language: 'en-GB',
      direction: 'ltr',
      content: [
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [{ type: 'text', value: 'Unbox the printer.', marks: [] }],
        },
      ],
    };
    const texts = new Map<string, unknown>([['cccccccccccccccccccccccccc', printerText]]);
    const asked: (string | null)[] = [];
    const names = new Map([[PRINTER, 'Install the printer']]);
    const { rerender } = render(
      <DocumentText
        outline={outline}
        scheme={defaultLayout.scheme}
        names={names}
        texts={texts}
        editing={null}
        onEdit={(node) => asked.push(node)}
        editor={(component) => <p>the editor for {component}</p>}
      />,
    );

    expect(screen.getByText('Unbox the printer.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit Install the printer' }));
    expect(asked).toEqual(['cccccccccccccccccccccccccc']);
    // Nothing to edit where the component is withheld.
    expect(screen.getAllByRole('button', { name: /^Edit / })).toHaveLength(1);

    rerender(
      <DocumentText
        outline={outline}
        scheme={defaultLayout.scheme}
        names={names}
        texts={texts}
        editing="cccccccccccccccccccccccccc"
        onEdit={(node) => asked.push(node)}
        editor={(component) => <p>the editor for {component}</p>}
      />,
    );
    expect(screen.getByText(`the editor for ${PRINTER}`)).toBeInTheDocument();
    expect(screen.queryByText('Unbox the printer.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close Install the printer' }));
    expect(asked.at(-1)).toBeNull();
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
