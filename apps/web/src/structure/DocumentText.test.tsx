import {
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  type OutlineView,
  type OutlineViewNode,
} from '@alloy-works/domain';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';

import { DocumentText, labelFits } from './DocumentText.js';

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

  it("never leaves a component's text empty while it is drawn again, so nothing measuring the page meanwhile finds it short (issue #384)", () => {
    // The outline pane's effects run between the text's, in the same flush: it reveals the reader's
    // node in its pane by measuring, and a page measured with every card emptied is short enough
    // for the browser to pull the window up to it - away from a linked node, or from wherever the
    // reader had scrolled. The probe stands where the pane does, before the text, and measures too.
    const seen: number[] = [];
    function Probe({ tick }: { tick: number }) {
      useEffect(() => {
        const body = document.querySelector(`[data-node="${PRINTER_NODE}"] .aw-text`);
        if (tick > 0) seen.push(body?.childNodes.length ?? -1);
      }, [tick]);
      return null;
    }
    const names = new Map([[PRINTER, 'Install the printer']]);
    const shown = (tick: number, content: unknown) => (
      <>
        <Probe tick={tick} />
        <DocumentText
          outline={outline}
          scheme={defaultLayout.scheme}
          names={names}
          texts={new Map([[PRINTER_NODE, content]])}
        />
      </>
    );
    const { rerender } = render(shown(0, printerText));
    expect(screen.getByText('Unbox the printer.')).toBeInTheDocument();

    // The same text read again, as a returning window or a closed editor reads it: drawn afresh.
    rerender(shown(1, { ...printerText }));

    expect(seen, 'what the card held while the outline measured').toEqual([1]);
    expect(screen.getByText('Unbox the printer.')).toBeInTheDocument();
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

  describe('a cross-reference in the text (cross-references 1)', () => {
    /** The printer's text with a table of readings, and a paragraph referring to it and to a section. */
    const referring = {
      ...printerText,
      content: [
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [
            { type: 'text', value: 'See ', marks: [] },
            {
              type: 'crossReference',
              id: 'x1',
              target: { kind: 'block', block: 't1' },
              display: 'number',
            },
            { type: 'text', value: ' and ', marks: [] },
            {
              type: 'crossReference',
              id: 'x2',
              target: { kind: 'node', node: 'aaaaaaaaaaaaaaaaaaaaaaaaaa' },
              display: 'numberAndTitle',
            },
            { type: 'text', value: '.', marks: [] },
          ],
        },
        {
          type: 'table',
          id: 't1',
          style: 'table',
          caption: [{ type: 'text', value: 'Readings', marks: [] }],
          headerRows: 0,
          headerColumns: 0,
          rows: [
            {
              cells: [
                {
                  content: [
                    {
                      type: 'paragraph',
                      id: 'c1',
                      style: 'body',
                      content: [{ type: 'text', value: 'York', marks: [] }],
                    },
                  ],
                  colspan: 1,
                  rowspan: 1,
                },
              ],
            },
          ],
        },
      ],
    };
    const texts = new Map<string, unknown>([[PRINTER_NODE, referring]]);
    const names = new Map([[PRINTER, 'Install the printer']]);

    it('shows what each reference will print, numbered by the page as a publish numbers it', () => {
      render(
        <DocumentText
          outline={outline}
          scheme={defaultLayout.scheme}
          names={names}
          texts={texts}
          contributions={
            new Map([
              [
                PRINTER_NODE,
                [{ block: 't1', sequence: 'table', numbered: true, caption: 'Readings' }],
              ],
            ])
          }
        />,
      );
      const shown = [...document.querySelectorAll('[data-reference]')].map(
        (each) => each.textContent,
      );
      expect(shown).toEqual(['Table 2.1', '1 Introduction']);
    });

    it('numbers each reference again when the outline changes under the same identifiers', () => {
      // The contexts are kept per outline, their targets computed when first asked (W13.3): an
      // outline moved under the same nodes must not be shown against the one before it.
      const contributions = new Map([
        [PRINTER_NODE, [{ block: 't1', sequence: 'table', numbered: true, caption: 'Readings' }]],
      ]);
      const props = {
        scheme: defaultLayout.scheme,
        names,
        texts,
        contributions,
      } as const;
      const { rerender } = render(<DocumentText outline={outline} {...props} />);
      const shown = () =>
        [...document.querySelectorAll('[data-reference]')].map((each) => each.textContent);
      expect(shown()).toEqual(['Table 2.1', '1 Introduction']);

      const moved: OutlineView = { ...outline, nodes: [outline.nodes[1]!, outline.nodes[0]!] };
      rerender(<DocumentText outline={moved} {...props} />);
      expect(shown()).toEqual(['Table 1.1', '2 Introduction']);
    });

    it('shows a reference naming its own component, as a paste from another leaves it, as the block of its own it is', () => {
      const [first, ...rest] = referring.content;
      const pasted = {
        ...referring,
        content: [
          {
            ...first,
            content: [
              {
                type: 'crossReference',
                id: 'x1',
                target: { kind: 'component', component: PRINTER, block: 't1' },
                display: 'number',
              },
            ],
          },
          ...rest,
        ],
      };
      render(
        <DocumentText
          outline={outline}
          scheme={defaultLayout.scheme}
          names={names}
          texts={new Map([[PRINTER_NODE, pasted]])}
          contributions={
            new Map([
              [
                PRINTER_NODE,
                [{ block: 't1', sequence: 'table', numbered: true, caption: 'Readings' }],
              ],
            ])
          }
        />,
      );
      const shown = [...document.querySelectorAll('[data-reference]')].map(
        (each) => each.textContent,
      );
      expect(shown).toEqual(['Table 2.1']);
    });

    it('shows the table by its kind and caption until the page has heard what the component holds', () => {
      render(
        <DocumentText
          outline={outline}
          scheme={defaultLayout.scheme}
          names={names}
          texts={texts}
        />,
      );
      const shown = [...document.querySelectorAll('[data-reference]')].map(
        (each) => each.textContent,
      );
      expect(shown).toEqual(['Table: Readings', '1 Introduction']);
    });

    it('hands the editor opened in place the same context the text is shown with', () => {
      const contexts: unknown[] = [];
      render(
        <DocumentText
          outline={outline}
          scheme={defaultLayout.scheme}
          names={names}
          texts={texts}
          editing={PRINTER_NODE}
          onEdit={() => undefined}
          editor={(_component, place) => {
            contexts.push(place.referenceContext);
            return null;
          }}
        />,
      );
      expect(contexts.at(-1)).toMatchObject({
        targets: [
          {
            target: { kind: 'node', node: 'aaaaaaaaaaaaaaaaaaaaaaaaaa' },
            label: '1',
            title: 'Introduction',
          },
          {
            target: { kind: 'node', node: 'bbbbbbbbbbbbbbbbbbbbbbbbbb' },
            label: '2',
            title: 'Method',
          },
        ],
      });
    });

    it('opens the editor with the caret where a click after a reference landed, not past it by its words', () => {
      const places: (number | undefined)[] = [];
      const shown = (editing: string | null) => (
        <DocumentText
          outline={outline}
          scheme={defaultLayout.scheme}
          names={names}
          texts={texts}
          editing={editing}
          onEdit={() => undefined}
          editor={(_component, place) => {
            places.push(place.openAt);
            return null;
          }}
        />
      );
      const { rerender } = render(shown(null));
      // jsdom cannot say where a point is, so the browser's answer is given: just before "and",
      // after the reference drawn _Table: Readings_.
      const and = [...document.querySelectorAll('[data-reference]')][0]!.nextSibling!;
      expect(and.textContent).toBe(' and ');
      Object.defineProperty(document, 'caretPositionFromPoint', {
        configurable: true,
        value: () => ({ offsetNode: and, offset: 1 }),
      });
      try {
        fireEvent.click(and.parentElement!);
      } finally {
        Reflect.deleteProperty(document, 'caretPositionFromPoint');
      }
      rerender(shown(PRINTER_NODE));
      // "See " and the space: the reference counts as the one position it takes, with no text.
      expect(places.at(-1)).toBe(5);
    });
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

describe("a component's label", () => {
  it('stands beside the text only where the column leaves it room, and above it otherwise (zoomed in)', () => {
    // A 900px column, the text 600px of it: a 250px label fits beside, with its gap.
    expect(labelFits({ column: 900, text: 600, label: 250 })).toBe(true);
    // Zoomed in, the text 800px: the label would stand on it.
    expect(labelFits({ column: 900, text: 800, label: 250 })).toBe(false);
    // Room for the label but not its gap.
    expect(labelFits({ column: 900, text: 645, label: 250 })).toBe(false);
  });
});
