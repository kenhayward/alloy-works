import {
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  type OutlineView,
  type OutlineViewNode,
} from '@alloy-works/domain';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

const PRINTER_NODE = 'cccccccccccccccccccccccccc';

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

  it("shows each component's text in its card, and opens its editor in place when the text is clicked", async () => {
    const texts = new Map<string, unknown>([[PRINTER_NODE, printerText]]);
    const asked: (string | null)[] = [];
    const places: { number?: string | undefined; openAt?: number | undefined }[] = [];
    const names = new Map([[PRINTER, 'Install the printer']]);
    const shown = (editing: string | null) => (
      <DocumentText
        outline={outline}
        scheme={defaultLayout.scheme}
        names={names}
        texts={texts}
        editing={editing}
        onEdit={(node) => asked.push(node)}
        editor={(component, place) => {
          places.push({ number: place.number, openAt: place.openAt });
          return (
            <button type="button" onClick={place.onDone}>
              the editor for {component}
            </button>
          );
        }}
      />
    );
    const { rerender } = render(shown(null));

    // No Edit button: the text itself is the way in (interface slice 13).
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    await userEvent.click(screen.getByText('Unbox the printer.'));
    expect(asked).toEqual([PRINTER_NODE]);

    rerender(shown(PRINTER_NODE));
    expect(screen.getByText(`the editor for ${PRINTER}`)).toBeInTheDocument();
    expect(screen.queryByText('Unbox the printer.')).not.toBeInTheDocument();
    // The editor's strip carries the number and the title, so the card's own head is not shown.
    expect(screen.queryByRole('link', { name: 'Open Install the printer' })).toBeNull();
    expect(places.at(-1)?.number).toBe('2.1');
    expect(typeof places.at(-1)?.openAt).toBe('number');

    await userEvent.click(screen.getByRole('button', { name: `the editor for ${PRINTER}` }));
    expect(asked.at(-1)).toBeNull();
  });

  it('opens a card from the keyboard, with Enter on its text, the caret at the start', async () => {
    const texts = new Map<string, unknown>([[PRINTER_NODE, printerText]]);
    const asked: (string | null)[] = [];
    let openAt: number | undefined;
    const { rerender } = render(
      <DocumentText
        outline={outline}
        scheme={defaultLayout.scheme}
        names={null}
        texts={texts}
        editing={null}
        onEdit={(node) => asked.push(node)}
        editor={() => null}
      />,
    );
    const body = screen.getByText('Unbox the printer.').closest('[tabindex="0"]') as HTMLElement;
    body.focus();
    await userEvent.keyboard('{Enter}');
    expect(asked).toEqual([PRINTER_NODE]);
    rerender(
      <DocumentText
        outline={outline}
        scheme={defaultLayout.scheme}
        names={null}
        texts={texts}
        editing={PRINTER_NODE}
        onEdit={(node) => asked.push(node)}
        editor={(_component, place) => {
          openAt = place.openAt;
          return null;
        }}
      />,
    );
    expect(openAt).toBe(0);
  });

  it('opens nothing where the click ended a selection of the text', () => {
    const texts = new Map<string, unknown>([[PRINTER_NODE, printerText]]);
    const asked: (string | null)[] = [];
    render(
      <DocumentText
        outline={outline}
        scheme={defaultLayout.scheme}
        names={null}
        texts={texts}
        editing={null}
        onEdit={(node) => asked.push(node)}
        editor={() => null}
      />,
    );
    const words = screen.getByText('Unbox the printer.');
    const range = document.createRange();
    range.selectNodeContents(words);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.click(words);
    expect(asked).toEqual([]);
    window.getSelection()!.removeAllRanges();
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
