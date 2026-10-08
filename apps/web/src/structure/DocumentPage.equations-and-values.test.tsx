import { DEFAULT_CATALOGUE_VERSIONS, defaultLayout, type OutlineNode } from '@alloy-works/domain';
import {
  createEditorState,
  fromEditor,
  insertEquation,
  mountEditor,
  NodeSelection,
  openFootnote,
  Selection,
  toEditor,
  type EditorView,
} from '@alloy-works/editor';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { shimRangeMeasurement } from '../test/range.js';
import { DocumentPage } from './DocumentPage.js';
import { DEFAULT_PRESENTATION } from '../theme/presentation.fixture.js';
import {
  client,
  outline,
  open,
  section,
  described,
  type ProseMirrorNode,
  DOCUMENT,
  SPACE,
  ADA,
  PRINTER,
  INTRODUCTION,
  METHOD,
  RESULTS,
  layoutView,
  service,
  item,
  COMPONENTS,
  json,
  titleField,
  shownTitle,
  selectInTitle,
  typeTitle,
  OUTLINE_URL,
  SOMEBODY_ELSE,
  referenceTo,
} from './test/documentPage.js';

// A section's title is a ProseMirror view since equations 3, which scrolls its selection into view.
shimRangeMeasurement();

describe("a section's title holding an equation (equations 3)", () => {
  const NS = 'http://www.w3.org/1998/Math/MathML';
  const stored = (inner: string, alternative: string | null) =>
    `<math xmlns="${NS}"${alternative === null ? '' : ` alttext="${alternative}"`}>${inner}</math>`;
  const SQUARED = stored('<msup><mi>x</mi><mn>2</mn></msup>', 'x squared');
  /** What the engine says of this fraction in English: the same in jsdom as in a browser. */
  const FRACTION = '<mfrac><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mi>c</mi></mfrac>';
  const SPOKEN = 'the fraction with numerator a plus b and denominator c';
  const words = (value: string) => ({ type: 'text' as const, value, marks: [] });
  const squared = { type: 'equation' as const, mathml: SQUARED, latex: 'x^2' };
  const titled = (id: string, title: unknown[]): OutlineNode =>
    ({ ...section(id, 'unused'), title }) as OutlineNode;

  const opens = () => screen.findByRole('dialog', { name: 'Equation' });
  /**
   * LaTeX given as an author pastes it, since userEvent reads a brace it types as a key's name, and
   * then the description the dialog asks the speech engine for, however long the engine takes.
   */
  const write = async (dialog: HTMLElement, latex: string) => {
    await userEvent.clear(within(dialog).getByLabelText('LaTeX'));
    await userEvent.paste(latex);
    await described();
  };

  it('retitles a section whose title holds an equation, keeping it, and draws it as MathML in the field and on the page', async () => {
    const fake = service(
      outline([titled(METHOD, [words('Growth as '), squared, words(' rises')])]),
    );
    open(fake.fetch);
    // Named by its words wherever a name must be words: the equation read as its alternative.
    await userEvent.click(
      await screen.findByRole('treeitem', { name: 'Growth as x squared rises' }),
    );

    const math = titleField().querySelector('math')!;
    expect(math.namespaceURI).toBe(NS);
    expect(math.getAttribute('aria-label')).toBe('x squared');
    await typeTitle(' fast{Enter}');

    expect(
      await screen.findByRole('treeitem', { name: 'Growth as x squared rises fast' }),
    ).toBeInTheDocument();
    expect(fake.edits().map((request) => request.body)).toEqual([
      {
        openedFrom: 'dddddddd-0000-4000-8000-000000000001',
        operation: {
          operation: 'retitle',
          node: METHOD,
          title: [words('Growth as '), squared, words(' rises fast')],
        },
      },
    ]);
    // The field keeps what it sent, equation and all.
    expect(titleField().querySelector('math')).not.toBeNull();
    // The document's heading draws the equation as the component's text draws one: MathML elements.
    const text = screen.getByRole('region', { name: "The document's text" });
    const heading = text.querySelector(`[data-node="${METHOD}"] h3`)!;
    expect(heading).toHaveTextContent(/Growth as/);
    const drawn = heading.querySelector('math')!;
    expect(drawn.namespaceURI).toBe(NS);
    expect(drawn.querySelector('msup')!.namespaceURI).toBe(NS);
    expect(drawn.getAttribute('aria-label')).toBe('x squared');
  });

  it('gives way to another title with the same words and another equation, since titles are compared by what they hold', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        titled(METHOD, [words('Growth as '), squared]),
      ]),
    );
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('treeitem', { name: 'Growth as x squared' }));

    // Grace corrects the exponent and not its words, from another window: the same words, another
    // equation. Ada's next act is refused against it, and the page shows Grace's outline.
    const cubed = stored('<msup><mi>x</mi><mn>3</mn></msup>', 'x squared');
    fake.theirs({
      operation: 'retitle',
      node: METHOD,
      title: [words('Growth as '), { type: 'equation', mathml: cubed, latex: 'x^3' }],
    });
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'page');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(SOMEBODY_ELSE));

    // The field gives way to it, rather than keeping the equation the words could not tell apart.
    await waitFor(() => expect(titleField().querySelector('mn')).toHaveTextContent('3'));
  });

  it('keeps the read-only field for a title holding formatting or a cross-reference, saying which', async () => {
    const fake = service(
      outline([
        titled(INTRODUCTION, [
          { type: 'text', value: 'Introduction', marks: [{ type: 'strong', id: 'm1' }] },
        ]),
        titled(METHOD, [
          words('Method, after '),
          {
            type: 'crossReference',
            id: 'r1',
            target: { kind: 'node', node: INTRODUCTION },
            display: 'number',
          },
        ]),
      ]),
    );
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('treeitem', { name: 'Introduction' }));
    expect(screen.getByLabelText('Title')).toBeDisabled();
    expect(screen.getByLabelText('Title')).toHaveValue('Introduction');
    expect(
      screen.getByText(
        'This title has formatting this field cannot keep, so it is not changed here.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Equation' })).toBeNull();

    await userEvent.click(screen.getByRole('treeitem', { name: /^Method, after/ }));
    expect(screen.getByLabelText('Title')).toBeDisabled();
    expect(
      screen.getByText('This title holds a cross-reference, so it is not changed here.'),
    ).toBeInTheDocument();
  });

  it('refuses an equation on its own as a title, says so, and keeps the equation to write words beside', async () => {
    const fake = service(outline([titled(METHOD, [words('Growth as '), squared])]));
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('treeitem', { name: 'Growth as x squared' }));

    // The words taken out, the equation left.
    const field = titleField();
    field.focus();
    const typed = field.firstChild!;
    document.getSelection()!.setBaseAndExtent(typed, 0, typed, 'Growth as '.length);
    document.dispatchEvent(new Event('selectionchange'));
    await userEvent.keyboard('{Backspace}');
    expect(shownTitle()).not.toMatch(/Growth/);
    await typeTitle('{Enter}');

    expect(screen.getByRole('status')).toHaveTextContent(
      "A section's title needs words as well as an equation.",
    );
    expect(fake.edits()).toEqual([]);
    expect(titleField().querySelector('math')).not.toBeNull();
  });

  it('places an equation from Equation beside the field, in the document language, at the caret, and commits it', async () => {
    const fake = service(outline([section(METHOD, 'Method')]));
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('treeitem', { name: 'Method' }));
    await typeTitle(' as ');

    const button = screen.getByRole('button', { name: 'Equation' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    await userEvent.click(button);
    const dialog = await opens();
    // Only inline: a title has nowhere for a block to stand.
    expect(within(dialog).queryByRole('group', { name: 'Place as' })).toBeNull();
    await write(dialog, '\\frac{a+b}{c}');
    // Written in the document's language, which is English here.
    expect(within(dialog).getByLabelText('Description')).toHaveValue(SPOKEN);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));

    expect(
      await screen.findByRole('treeitem', { name: `Method as ${SPOKEN}` }),
    ).toBeInTheDocument();
    // One act: leaving the field for its own dialog is not leaving it.
    expect(fake.edits().map((request) => request.body)).toEqual([
      {
        openedFrom: 'dddddddd-0000-4000-8000-000000000001',
        operation: {
          operation: 'retitle',
          node: METHOD,
          title: [
            words('Method as '),
            { type: 'equation', mathml: stored(FRACTION, SPOKEN), latex: '\\frac{a+b}{c}' },
          ],
        },
      },
    ]);
    // Back in the field, with the equation it placed.
    expect(titleField()).toHaveFocus();
    expect(titleField().querySelector('mfrac')).not.toBeNull();
  });

  it('opens the dialog from its shortcut in the field, and on an equation selected whole by Enter, to change it', async () => {
    const fake = service(outline([titled(METHOD, [words('Growth as '), squared])]));
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('treeitem', { name: 'Growth as x squared' }));

    // Mod-Shift-E asks for a new one; cancelled, nothing is sent and the focus is back in the field.
    selectInTitle(false);
    fireEvent.keyDown(titleField(), { key: 'E', keyCode: 69, ctrlKey: true, shiftKey: true });
    let dialog = await opens();
    expect(within(dialog).getByRole('button', { name: 'Insert' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(titleField()).toHaveFocus();

    // The arrow from the end selects the equation whole, and Enter opens it.
    fireEvent.keyDown(titleField(), { key: 'ArrowLeft', keyCode: 37 });
    fireEvent.keyDown(titleField(), { key: 'Enter', keyCode: 13 });
    dialog = await opens();
    expect(within(dialog).getByLabelText('LaTeX')).toHaveValue('x^2');
    await write(dialog, 'x^3');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change' }));

    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    const [edit] = fake.edits();
    const title = (edit!.body as { operation: { title: { mathml?: string; latex?: string }[] } })
      .operation.title;
    expect(title[0]).toEqual(words('Growth as '));
    expect(title[1]).toMatchObject({ type: 'equation', latex: 'x^3' });
    expect(title[1]!.mathml).toContain('<mn>3</mn>');
  });

  it('gives the focus to the field when the dialog closes, whoever opened it, so leaving retries a title that was not saved', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    // Chosen in the tree, and Equation clicked straight after: the focus is on the tree item, and the
    // button leaves it there, as a toolbar's button leaves the caret.
    await userEvent.click(await screen.findByRole('treeitem', { name: 'Method' }));
    expect(item('Method')).toHaveFocus();

    fake.refuse(OUTLINE_URL, 500);
    await userEvent.click(screen.getByRole('button', { name: 'Equation' }));
    const dialog = await opens();
    await write(dialog, 'x^2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'The change was not saved. Try it again.',
      ),
    );
    // The field, not the tree item the dialog was opened from: leaving it is the retry.
    expect(titleField()).toHaveFocus();
    expect(titleField().querySelector('math')).not.toBeNull();

    fake.restore(OUTLINE_URL);
    await userEvent.click(item('Introduction'));
    await waitFor(() => expect(fake.edits()).toHaveLength(2));
    const [first, retry] = fake.edits().map((request) => request.body);
    expect(retry).toEqual(first);
    expect(retry).toMatchObject({
      operation: {
        operation: 'retitle',
        node: METHOD,
        title: [words('Method'), { type: 'equation', latex: 'x^2' }],
      },
    });
    // Saved this time: the tree names Method by its words and the equation read as its alternative.
    expect(await screen.findByRole('treeitem', { name: /^Method.+/ })).toBeInTheDocument();
  });

  it('closes the dialog, placing nothing, when the field gives way to another title while it is open, and says so', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        titled(METHOD, [words('Growth as '), squared]),
      ]),
    );
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('treeitem', { name: 'Growth as x squared' }));

    // An act in flight, and Grace retitles Method while it is: the act will be refused against hers.
    const release = fake.hold();
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'page');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    fake.theirs({
      operation: 'retitle',
      node: METHOD,
      title: [
        words('Growth at '),
        {
          type: 'equation',
          mathml: stored('<msup><mi>x</mi><mn>3</mn></msup>', 'x cubed'),
          latex: 'x^3',
        },
      ],
    });

    // Ada opens her own equation, x^2, to change it.
    selectInTitle(false);
    fireEvent.keyDown(titleField(), { key: 'ArrowLeft', keyCode: 37 });
    fireEvent.keyDown(titleField(), { key: 'Enter', keyCode: 13 });
    const dialog = await opens();
    expect(within(dialog).getByLabelText('LaTeX')).toHaveValue('x^2');

    // The refusal gives the field Grace's title: the equation the dialog was opened on is not there.
    release();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent(SOMEBODY_ELSE);
    expect(screen.getByRole('status')).toHaveTextContent(
      'The title changed while the Equation dialog was open, so nothing was placed.',
    );
    expect(titleField().querySelector('mn')).toHaveTextContent('3');
    expect(titleField()).toHaveFocus();
    // Nothing more was sent: Grace's equation is hers still.
    expect(fake.edits()).toHaveLength(1);
    await userEvent.click(item('Introduction'));
    expect(fake.edits()).toHaveLength(1);
  });

  it('closes the dialog, placing nothing, when its section goes while it is open, and says so', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('treeitem', { name: 'Method' }));

    // An act in flight, and Grace removes Method while it is: the act will be refused against hers.
    const release = fake.hold();
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'page');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    fake.theirs({ operation: 'remove', node: METHOD });
    selectInTitle(false);
    fireEvent.keyDown(titleField(), { key: 'E', keyCode: 69, ctrlKey: true, shiftKey: true });
    await opens();

    // The page shows Grace's outline, and Method's field goes with it: there is no title to place into.
    release();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent(SOMEBODY_ELSE);
    expect(screen.getByRole('status')).toHaveTextContent(
      'The title changed while the Equation dialog was open, so nothing was placed.',
    );
    expect(screen.queryByRole('treeitem', { name: 'Method' })).toBeNull();
    // With no field to go back to, the focus goes to the node chosen now, never to the page's body.
    expect(item('Introduction')).toHaveFocus();
    expect(fake.edits()).toHaveLength(1);
  });
});

describe('an equation in every context (equations 3)', () => {
  const NS = 'http://www.w3.org/1998/Math/MathML';
  /** One equation per context, each its own letter, so what is stored says which context it is. */
  const letter = (name: string) => `<math xmlns="${NS}" alttext="${name}"><mi>${name}</mi></math>`;
  const choice = (name: string) => ({
    display: 'inline' as const,
    mathml: letter(name),
    latex: name,
  });
  const words = (value: string) => ({ type: 'text', value, marks: [] });
  const paragraph = (id: string, ...content: unknown[]) => ({
    type: 'paragraph',
    id,
    style: 'body',
    content,
  });
  /** A component with running text, a table with a caption and a cell, and a footnote. */
  const component = {
    schemaVersion: 1,
    title: 'Readings',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      paragraph('b1', words('Where it grows.')),
      {
        type: 'table',
        id: 't1',
        style: 'table',
        caption: [words('Readings')],
        headerRows: 0,
        headerColumns: 0,
        rows: [
          {
            cells: [{ content: [paragraph('c1', words('Tray'))], colspan: 1, rowspan: 1 }],
          },
        ],
      },
      paragraph(
        'b2',
        words('Measured'),
        {
          type: 'footnote',
          id: 'f1',
          anchor: { kind: 'span' },
          content: [paragraph('fp1', words('At the bench.'))],
        },
        words(' twice.'),
      ),
    ],
  };

  /** Where the first node answering `match` starts, and the node. */
  function find(view: EditorView, match: (node: ProseMirrorNode) => boolean) {
    let found: { pos: number; node: ProseMirrorNode } | null = null;
    view.state.doc.descendants((node, pos) => {
      if (found === null && match(node)) found = { pos, node };
      return found === null;
    });
    if (found === null) throw new Error('not there');
    return found as { pos: number; node: ProseMirrorNode };
  }
  /** The caret at the end of the textblock `match` finds, as a click at its end puts it. */
  function caretAtEndOf(view: EditorView, match: (node: ProseMirrorNode) => boolean) {
    const { pos, node } = find(view, match);
    const end = view.state.doc.resolve(pos + node.nodeSize - 1);
    view.dispatch(view.state.tr.setSelection(Selection.near(end, -1)));
  }
  /** Placed by the command the Equation dialog answers with, where the caret is. */
  const placeIn = (view: EditorView, name: string) =>
    expect(insertEquation(choice(name))(view.state, view.dispatch.bind(view))).toBe(true);
  /** The letter of every equation in a list of inline runs. */
  const lettersIn = (runs: readonly unknown[]) =>
    (runs as readonly { type: string; latex?: string }[])
      .filter((run) => run.type === 'equation')
      .map((run) => run.latex);

  it('CNT-046 places an equation in running text, a heading, a table cell, a footnote and a caption, and stores each', async () => {
    // Running text, a table's cell, a table's caption and a footnote: on a component's surface,
    // mounted as the component editor mounts one.
    const opened = toEditor(component as never);
    if (!opened.editable) throw new Error(opened.unsupported.join(', '));
    let next = 0;
    const newIdentifier = () => `n${(next += 1)}`;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = mountEditor(host, {
      state: createEditorState({ doc: opened.doc, newIdentifier }),
      label: 'Content of Readings',
      editable: () => true,
      dispatch: (tr, target) => target.updateState(target.state.apply(tr)),
      pasted: () => undefined,
      refused: () => undefined,
      newIdentifier,
    });
    caretAtEndOf(view, (node) => node.attrs['id'] === 'b1');
    placeIn(view, 'a');
    caretAtEndOf(view, (node) => node.attrs['id'] === 'c1');
    placeIn(view, 'b');
    caretAtEndOf(view, (node) => node.type.name === 'tableCaption');
    placeIn(view, 'c');
    const footnote = find(view, (node) => node.type.name === 'footnote').pos;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, footnote)));
    const note = openFootnote(view)!;
    caretAtEndOf(note, (node) => node.type.name === 'footnoteParagraph');
    placeIn(note, 'd');

    // Stored as the model holds it, through its own parse.
    const stored = fromEditor(view.state.doc) as unknown as {
      content: [
        { content: { type: string }[] },
        {
          caption: { type: string }[];
          rows: [{ cells: [{ content: [{ content: { type: string }[] }] }] }];
        },
        { content: { type: string; content?: [{ content: { type: string }[] }] }[] },
      ];
    };
    const [text, table, noted] = stored.content;
    expect(lettersIn(text.content)).toEqual(['a']);
    expect(lettersIn(table.rows[0].cells[0].content[0].content)).toEqual(['b']);
    expect(lettersIn(table.caption)).toEqual(['c']);
    const held = noted.content.find((run) => run.type === 'footnote')!;
    expect(lettersIn(held.content![0].content)).toEqual(['d']);
    view.destroy();
    host.remove();

    // A heading: a section's title, through its field in the outline panel and the Equation dialog.
    const fake = service(outline([section(METHOD, 'Method')]));
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('treeitem', { name: 'Method' }));
    await typeTitle(' as ');
    await userEvent.click(screen.getByRole('button', { name: 'Equation' }));
    const dialog = await screen.findByRole('dialog', { name: 'Equation' });
    await userEvent.clear(within(dialog).getByLabelText('LaTeX'));
    await userEvent.paste('e');
    await described();
    expect(within(dialog).getByLabelText('Description')).not.toHaveValue('');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Insert' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Stored as the service records it: the outline's next version holds it in the section's title.
    await waitFor(() => expect(fake.latest().version.number).toBe('0.2'));
    const [retitled] = fake.latest().outline.nodes;
    expect(retitled?.type === 'section' && lettersIn(retitled.title)).toEqual(['e']);
  });
});

describe("a document's fields and its sections'", () => {
  const REVIEWER = 'f1e1d000-0000-4000-8000-000000000001';
  const reviewer = {
    id: REVIEWER,
    name: 'Reviewer',
    dataType: 'text',
    multiplicity: 'one',
    validation: {},
    required: true,
    requiredBy: ['schema-review'],
    fixed: false,
    fixedBy: [],
  };

  /** A document made from a template applying Review at both levels, answering what it is sent. */
  function templated(options: { refuseSet?: boolean } = {}) {
    const sent: { url: string; method: string; body: unknown }[] = [];
    let version = 1;
    let values: Record<string, unknown> = {};
    let nodes: OutlineNode[] = [section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')];
    const view = () => ({
      id: DOCUMENT,
      space: { id: SPACE, name: 'General' },
      version: {
        id: `dddddddd-0000-4000-8000-${String(version).padStart(12, '0')}`,
        number: `0.${version}`,
        author: ADA,
        createdAt: '2026-09-18T09:00:00.000Z',
        note: null,
      },
      outline: outline(nodes),
      values,
      fields: { document: [reviewer], section: [{ ...reviewer, required: false, requiredBy: [] }] },
      schemas: [{ id: 'schema-review', name: 'Review' }],
      template: null,
      mayEdit: true,
      mayPublish: false,
      layout: layoutView(defaultLayout.scheme),
    });
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url).pathname;
      const body = request.method === 'GET' ? undefined : await request.clone().json();
      sent.push({ url, method: request.method, body });
      if (url === `/v1/documents/${DOCUMENT}` && request.method === 'GET') return json(200, view());
      if (url === `/v1/documents/${DOCUMENT}/values`) {
        values = (body as { values: Record<string, unknown> }).values;
        version += 1;
        return json(200, view());
      }
      if (url === `/v1/documents/${DOCUMENT}/outline`) {
        if (options.refuseSet) {
          return json(400, {
            code: 'values_invalid',
            message: 'A value does not fit its field.',
            traceId: 't',
            failures: [],
          });
        }
        const { operation } = body as {
          operation: { node: string; values?: Record<string, unknown> };
        };
        nodes = nodes.map((node) =>
          node.id === operation.node ? { ...node, values: operation.values ?? node.values } : node,
        );
        version += 1;
        return json(200, view());
      }
      if (url === '/v1/components') return json(200, COMPONENTS);
      if (url === '/v1/people') return json(200, { items: [], next: null });
      if (url.endsWith('/contributions')) {
        return json(200, {
          document: DOCUMENT,
          version: view().version,
          occurrences: [],
          versions: [],
        });
      }
      if (url.endsWith('/publications')) return json(200, { items: [], next: null });
      if (url.endsWith('/texts')) return json(200, { items: [] });
      return json(404, { code: 'not_found', message: 'none', traceId: 't' });
    }) as typeof globalThis.fetch;
    return { fetch, sent };
  }

  it("shows the document's fields, each as it arises, and saves what is typed as its next version", async () => {
    const { fetch, sent } = templated();
    open(fetch);
    const fields = await screen.findByRole('region', { name: 'Fields of this document' });
    const field = within(fields).getByRole('textbox', { name: /^Reviewer/ });
    expect(field).toHaveAccessibleDescription(/Reviewer is required/);
    await userEvent.type(field, 'Ada');
    await waitFor(() =>
      expect(sent.find((each) => each.url.endsWith('/values'))?.body).toEqual({
        openedFrom: 'dddddddd-0000-4000-8000-000000000001',
        values: { [REVIEWER]: 'Ada' },
      }),
    );
    // Saved once, a pause after the last key, rather than once a key.
    expect(sent.filter((each) => each.url.endsWith('/values'))).toHaveLength(1);
    expect(field).toHaveValue('Ada');
  });

  it("shows the chosen section's fields, and saves them with the outline's set", async () => {
    const { fetch, sent } = templated();
    open(fetch);
    await userEvent.click(await screen.findByRole('treeitem', { name: /Introduction/ }));
    const fields = await screen.findByRole('region', { name: 'Fields of Introduction' });
    await userEvent.type(within(fields).getByRole('textbox', { name: /^Reviewer/ }), 'Grace');
    await waitFor(() =>
      expect(sent.find((each) => each.url.endsWith('/outline'))?.body).toMatchObject({
        operation: { operation: 'set', node: INTRODUCTION, values: { [REVIEWER]: 'Grace' } },
      }),
    );
  });

  it('saves what was typed into a section before another is chosen', async () => {
    const { fetch, sent } = templated();
    open(fetch);
    await userEvent.click(await screen.findByRole('treeitem', { name: /Introduction/ }));
    const fields = await screen.findByRole('region', { name: 'Fields of Introduction' });
    await userEvent.type(within(fields).getByRole('textbox', { name: /^Reviewer/ }), 'Grace');
    // Chosen at once, inside the pause: what was typed goes all the same.
    await userEvent.click(screen.getByRole('treeitem', { name: /Method/ }));
    await waitFor(() =>
      expect(sent.find((each) => each.url.endsWith('/outline'))?.body).toMatchObject({
        operation: { operation: 'set', node: INTRODUCTION, values: { [REVIEWER]: 'Grace' } },
      }),
    );
  });

  it("says what the service said of a section's value it refused", async () => {
    const { fetch } = templated({ refuseSet: true });
    open(fetch);
    await userEvent.click(await screen.findByRole('treeitem', { name: /Introduction/ }));
    const fields = await screen.findByRole('region', { name: 'Fields of Introduction' });
    await userEvent.type(within(fields).getByRole('textbox', { name: /^Reviewer/ }), 'Grace');
    expect(await screen.findByText('A value does not fit its field.')).toBeInTheDocument();
  });
});

describe('the values a document holds, in its text (the B1 plan, task 5)', () => {
  const DEFINITION = 'abcdef01-0000-4000-8000-000000000001';
  const DATASET = 'ssssssss-0000-4000-8000-000000000001';
  const DATASET_VERSION = 'ssssssss-0000-4000-8000-000000000002';
  const WAITING_VERSION = 'ssssssss-0000-4000-8000-000000000003';
  const OTHER = 'abcdef02-0000-4000-8000-000000000001';
  const CHECKSUM = '0123456789abcdef'.repeat(4);
  const decimal = { base: 'decimal', precision: 10, scale: 1 };

  /** A binding as a component holds one: a reading's depth, taken from its only row. */
  const bound = (id: string, column = 'depth') => ({
    type: 'binding',
    id,
    query: DEFINITION,
    parameters: { site: { literal: '1' } },
    mode: 'checked',
    take: { column },
  });
  /** The printer's text: the mean, with a bound value where it stands in the sentence. */
  const withValue = (...bindings: unknown[]) => ({
    schemaVersion: 1,
    title: 'Install the printer',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      {
        type: 'paragraph',
        id: 'p1',
        style: 'body',
        content: [
          { type: 'text', value: 'The mean was ', marks: [] },
          ...bindings,
          { type: 'text', value: ' m.', marks: [] },
        ],
      },
    ],
  });
  const plain = {
    schemaVersion: 1,
    title: 'Another component',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      {
        type: 'paragraph',
        id: 'p1',
        style: 'body',
        content: [{ type: 'text', value: 'Nothing bound here.', marks: [] }],
      },
    ],
  };
  const provenance = (over: Record<string, unknown> = {}) => ({
    schemaVersion: 1,
    queryDefinition: { artifact: DEFINITION, version: 'abcdef01-0000-4000-8000-000000000002' },
    connection: {
      artifact: 'cccccccc-0000-4000-8000-0000000000aa',
      version: 'cccccccc-0000-4000-8000-0000000000ab',
    },
    parameters: { site: '1' },
    ran: { sql: 'select depth from sample.reading where site = $1' },
    identity: { kind: 'service' },
    at: '2026-10-04T09:30:00.000Z',
    durationMs: 12,
    rowCount: 1,
    columns: [{ name: 'depth', from: { column: 'depth_m' }, type: decimal }],
    canonical: 1,
    checksum: CHECKSUM,
    images: {},
    ...over,
  });
  /** What the bindings view answers for one binding the document holds a value for. */
  const state = (
    binding: Record<string, unknown>,
    taken: unknown,
    over: {
      waiting?: unknown;
      definition?: unknown;
      connection?: unknown;
      redacted?: boolean;
      facts?: Record<string, unknown>;
    } = {},
  ) => ({
    node: RESULTS,
    binding,
    held: {
      dataset: DATASET,
      version: DATASET_VERSION,
      number: '0.1',
      provenance: over.redacted
        ? provenance({
            connection: null,
            ran: { sql: null },
            columns: [{ name: 'depth', from: null, type: decimal }],
          })
        : provenance(),
      name: 'Harbour readings',
      stale: false,
      taken,
      act: 'resolve',
      by: { id: ADA, displayName: 'Ada' },
      at: '2026-10-04T09:31:00.000Z',
    },
    waiting: over.waiting ?? null,
    definition:
      over.definition === undefined ? { title: 'Readings', version: '0.2' } : over.definition,
    connection: over.connection === undefined ? { name: 'Harbour source' } : over.connection,
    definitionChanged: false,
    sincePublished: null,
    mayCheck: true,
    mayResolve: true,
    ...over.facts,
  });
  const value = { value: '1234.5', column: { name: 'depth', type: decimal } };
  /** A reader who may check: what the check on opening asks of the view (B4-F). */
  const checks = { mayCheck: true };

  /**
   * The page over one document placing the printer at `RESULTS`, and `plain` at `OTHER` where asked,
   * answering the bindings view with `bindings` - or `null`, refusing it - and a stored result.
   */
  function openWithValues(options: {
    content: unknown;
    bindings: unknown[] | null;
    other?: boolean;
    rows?: number;
    presentation?: unknown;
    /** Where given, the stored result is answered only once it settles. */
    datasetGate?: Promise<void>;
    /** What a check answers, and what it changes first. */
    check?: { results: unknown[]; then?: () => void };
    /** Where given, a check is answered only once it settles. */
    checkGate?: Promise<void>;
    /** What an accept changes before it answers. */
    accepted?: () => void;
    /** What following a pending result answers (the D8 plan, D8-F). */
    pending?: unknown;
  }) {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction', [
          referenceTo(RESULTS, PRINTER),
          ...(options.other ? [referenceTo(METHOD, OTHER)] : []),
        ]),
      ]),
    );
    const asked: string[] = [];
    // Whether the check on opening has answered and the values it reads again been answered after it.
    let checkAnswered = false;
    let readAfterCheck = false;
    const fetching = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const path = new URL(request.url).pathname;
      asked.push(path);
      if (path === `/v1/documents/${DOCUMENT}/presentation`) {
        return json(200, options.presentation ?? DEFAULT_PRESENTATION);
      }
      if (path === `/v1/documents/${DOCUMENT}/texts`) {
        return json(200, {
          document: DOCUMENT,
          version: { id: 'dddddddd-0000-4000-8000-000000000001', number: '0.1' },
          occurrences: [
            {
              node: RESULTS,
              version: 'vvvvvvvv-0000-4000-8000-000000000001',
              mayEdit: false,
              lock: null,
            },
            ...(options.other
              ? [
                  {
                    node: METHOD,
                    version: 'vvvvvvvv-0000-4000-8000-000000000009',
                    mayEdit: false,
                    lock: null,
                  },
                ]
              : []),
          ],
          versions: [
            { id: 'vvvvvvvv-0000-4000-8000-000000000001', content: options.content },
            { id: 'vvvvvvvv-0000-4000-8000-000000000009', content: plain },
          ],
        });
      }
      if (path === `/v1/documents/${DOCUMENT}/bindings/check`) {
        if (options.checkGate) await options.checkGate;
        options.check?.then?.();
        checkAnswered = true;
        return json(200, { results: options.check?.results ?? [] });
      }
      if (path.startsWith('/v1/datasets/pending/') && options.pending !== undefined) {
        return json(200, options.pending);
      }
      if (path === `/v1/documents/${DOCUMENT}/bindings/accept`) {
        options.accepted?.();
        return json(200, {});
      }
      if (path === `/v1/documents/${DOCUMENT}/bindings`) {
        if (checkAnswered) readAfterCheck = true;
        return options.bindings === null
          ? json(500, { code: 'internal', message: 'x', traceId: 't' })
          : json(200, { bindings: options.bindings });
      }
      if (path === `/v1/documents/${DOCUMENT}/datasets/${DATASET_VERSION}`) {
        if (options.datasetGate) await options.datasetGate;
        const count = options.rows ?? 1;
        return json(200, {
          dataset: DATASET,
          version: DATASET_VERSION,
          name: 'Harbour readings',
          provenance: provenance({ rowCount: count }),
          result: {
            columns: [['depth', 'decimal']],
            rows: Array.from({ length: count }, (_, at) => [`${1234 + at}.5`]),
          },
        });
      }
      if (path === `/v1/components/${PRINTER}`) {
        return json(200, {
          id: PRINTER,
          space: { id: SPACE, name: 'General' },
          version: {
            id: 'vvvvvvvv-0000-4000-8000-000000000001',
            number: '0.3',
            author: ADA,
            createdAt: '2026-09-18T09:00:00.000Z',
            note: null,
          },
          content: options.content,
          mayEdit: false,
          lock: null,
          type: { id: 'type-topic', name: 'Topic' },
          fields: [],
          schemas: [],
          values: {},
        });
      }
      return fake.fetch(request);
    }) as typeof globalThis.fetch;
    render(
      <StrictMode>
        <DocumentPage client={client(fetching)} id={DOCUMENT} principalId={ADA} />
      </StrictMode>,
    );
    /**
     * Settles once the check on opening has answered and the values it reads again have landed. The
     * text is drawn again as they do, so a node taken before then is no longer the one on the page,
     * and an event sent to it reaches nothing - as no click in a browser, sent to what is under the
     * pointer, ever can.
     */
    const checked = async () => {
      await waitFor(() => expect(readAfterCheck).toBe(true));
      await act(async () => {
        await new Promise((settle) => setTimeout(settle, 0));
      });
    };
    return { asked, checked };
  }

  /** What an element shows a sighted reader: its text, without the words only a screen reader hears. */
  const seen = (element: Element) => {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('.aw-binding-hidden').forEach((each) => each.remove());
    return copy.textContent;
  };
  const textRegion = () => screen.findByRole('region', { name: "The document's text" });

  /**
   * The default theme with a value catalogue of its own: a comma for the decimal and a full stop to
   * group by, and for English a full stop for the decimal and no grouping - so a value printed by the default formats,
   * by the catalogue's own or by another language's reads differently from one printed for this
   * document, whose language is English.
   */
  const formattedPresentation = {
    ...DEFAULT_PRESENTATION,
    theme: {
      ...DEFAULT_PRESENTATION.theme,
      catalogues: DEFAULT_PRESENTATION.theme.catalogues.map(({ versionId, content }) => {
        if (versionId !== DEFAULT_CATALOGUE_VERSIONS.value) return { versionId, content };
        const formats = {
          number: { decimal: ',', group: '.', groupFrom: 4, minus: 'U+2212' },
          date: { order: 'dmy', separator: '.', pad: true },
          time: { separator: ':' },
          boolean: { true: 'Ja', false: 'Nein' },
        };
        return {
          versionId,
          content: {
            ...(content as object),
            formats,
            byLanguage: [
              {
                language: 'en',
                formats: { ...formats, number: { ...formats.number, decimal: '.', group: 'none' } },
              },
            ],
          },
        };
      }),
    },
  };

  it("DAT-027 shows in a document's text the one value the document holds, formatted by its theme, where the binding stands in the sentence", async () => {
    const user = userEvent.setup();
    const { checked } = openWithValues({
      content: withValue(bound('b1')),
      bindings: [state(bound('b1'), value)],
      presentation: formattedPresentation,
    });
    const text = await textRegion();
    await checked();
    // The text is drawn again as the values arrive, so its paragraph is read afresh each time.
    const paragraph = () =>
      within(text)
        .getByText(/The mean was/)
        .closest('p')!;
    await waitFor(() => expect(seen(paragraph())).toBe('The mean was 1234.5 m.'));
    expect(within(text).getByRole('button', { name: '1234.5, bound value' })).toBeInTheDocument();

    // And the editor opened in place shows the same value where the binding stands.
    await user.click(within(text).getByText(/The mean was/));
    const surface = await within(text).findByRole('textbox', {
      name: 'Content of Install the printer',
    });
    await waitFor(() => expect(seen(surface.querySelector('p')!)).toBe('The mean was 1234.5 m.'));
  });

  it("DAT-047 shows a failed value in place with its reason in the document's text and its open editor, and every other component as before", async () => {
    const user = userEvent.setup();
    const { checked } = openWithValues({
      content: withValue(bound('b1')),
      bindings: [state(bound('b1'), { failure: 'value_many', count: 3 })],
      other: true,
    });
    const text = await textRegion();
    await checked();
    const reason = 'No value - the query returned 3 rows';
    const paragraph = () =>
      within(text)
        .getByText(/The mean was/)
        .closest('p')!;
    await waitFor(() => expect(seen(paragraph())).toBe(`The mean was ${reason} m.`));
    const failed = paragraph().querySelector('[data-binding]')!;
    // Apart by more than colour: its own words, and the class that draws it dashed and underlined.
    expect(failed).toHaveClass('aw-binding-failed');
    expect(failed).toHaveTextContent(`${reason}, bound value, failed`);
    // Every other component as before.
    expect(within(text).getByText('Nothing bound here.')).toBeInTheDocument();

    await user.click(within(text).getByText(/The mean was/));
    const surface = await within(text).findByRole('textbox', {
      name: 'Content of Install the printer',
    });
    await waitFor(() =>
      expect(seen(surface.querySelector('p')!)).toBe(`The mean was ${reason} m.`),
    );
    expect(surface.querySelector('[data-binding]')).toHaveClass('aw-binding-failed');
    expect(within(text).getByText('Nothing bound here.')).toBeInTheDocument();
  });

  it("DAT-041 opens a value's provenance in one step from the value in the document's text, by a click or by Enter", async () => {
    const user = userEvent.setup();
    const { checked } = openWithValues({
      content: withValue(bound('b1')),
      bindings: [state(bound('b1'), value)],
    });
    const text = await textRegion();
    await checked();
    const button = await within(text).findByRole('button', { name: '1,234.5, bound value' });

    // A click opens its provenance, and never the editor.
    await user.click(button);
    const panel = await screen.findByRole('region', { name: 'Provenance' });
    expect(
      within(text).queryByRole('textbox', { name: 'Content of Install the printer' }),
    ).toBeNull();
    expect(within(panel).getByRole('heading', { name: 'Provenance' })).toHaveFocus();
    const said = panel.textContent!;
    for (const part of [
      '1,234.5',
      'Readings, version 0.2',
      'Harbour source',
      'site: 1',
      'The service account',
      '4 October 2026',
      '1 row',
      CHECKSUM.slice(0, 12),
      'Harbour readings, version 0.1',
      'Resolved by Ada',
      'Checked',
      'select depth from sample.reading where site = $1',
    ]) {
      expect(said, part).toContain(part);
    }
    expect(said).not.toContain(CHECKSUM);
    await user.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: 'Provenance' })).toBeNull();
    expect(button).toHaveFocus();

    // Enter on the value, from the keyboard alone, opens it too.
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('region', { name: 'Provenance' })).toBeInTheDocument();
    expect(
      within(text).queryByRole('textbox', { name: 'Content of Install the printer' }),
    ).toBeNull();
  });

  it("DAT-024 says in a value's provenance whose own view it is: the person, how they signed in, and who the source saw", async () => {
    const user = userEvent.setup();
    const asserted = (signInRoute: string, asSeen: string) => {
      const held = state(bound('b1'), value);
      return {
        ...held,
        held: {
          ...held.held,
          provenance: provenance({
            identity: {
              kind: 'endUser',
              mechanism: 'asserted',
              principal: ADA,
              signInRoute,
              asSeen,
            },
          }),
        },
      };
    };
    for (const [route, seen, said] of [
      ['organisation', 'ada@example.com', "signed in through the organisation's provider"],
      ['google', 'ada@example.com', 'signed in with Google'],
      ['token', 'ada', 'acting through a personal API token'],
    ] as const) {
      const { checked } = openWithValues({
        content: withValue(bound('b1')),
        bindings: [asserted(route, seen)],
      });
      const text = await textRegion();
      await checked();
      await user.click(await within(text).findByRole('button', { name: '1,234.5, bound value' }));
      const panel = await screen.findByRole('region', { name: 'Provenance' });
      const whose = within(panel).getByText('Whose view').nextElementSibling!;
      expect(whose).toHaveTextContent(`Ada's own view, ${said}, seen by the source as ${seen}`);
      cleanup();
    }
  });

  it('returns the focus to the value when the provenance is closed by Escape', async () => {
    const user = userEvent.setup();
    const { checked } = openWithValues({
      content: withValue(bound('b1')),
      bindings: [state(bound('b1'), value)],
    });
    const text = await textRegion();
    await checked();
    const button = await within(text).findByRole('button', { name: '1,234.5, bound value' });
    await user.click(button);
    await screen.findByRole('region', { name: 'Provenance' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Provenance' })).toBeNull();
    expect(button).toHaveFocus();
  });

  it('shows a held value with a newer result waiting, marked always, and the waiting value beside it in the provenance', async () => {
    const user = userEvent.setup();
    const { checked } = openWithValues({
      content: withValue(bound('b1')),
      bindings: [
        state(bound('b1'), value, {
          waiting: {
            version: WAITING_VERSION,
            provenance: provenance({ at: '2026-10-05T09:30:00.000Z' }),
            taken: { value: '1240.5', column: { name: 'depth', type: decimal } },
          },
        }),
      ],
    });
    const text = await textRegion();
    await checked();
    const button = await within(text).findByRole('button', {
      name: /^1,234\.5, bound value,/,
    });
    expect(seen(button)).toContain('revision waiting');
    await user.click(button);
    const panel = await screen.findByRole('region', { name: 'Provenance' });
    expect(panel).toHaveTextContent('A newer result is waiting: 1,240.5');
  });

  it("shows a reader who may not read the definition its value, and none of the definition's SQL or connection", async () => {
    const user = userEvent.setup();
    const { checked } = openWithValues({
      content: withValue(bound('b1')),
      bindings: [state(bound('b1'), value, { definition: null, connection: null, redacted: true })],
    });
    const text = await textRegion();
    await checked();
    await user.click(await within(text).findByRole('button', { name: '1,234.5, bound value' }));
    const panel = await screen.findByRole('region', { name: 'Provenance' });
    expect(panel).toHaveTextContent('a query definition you cannot read');
    expect(panel.textContent).not.toContain('select');
    expect(panel.textContent).not.toContain('Harbour source');
    expect(panel).toHaveTextContent('1,234.5');
  });

  it('shows the result a value was taken from, its first 200 rows and how many more', async () => {
    const user = userEvent.setup();
    const { checked } = openWithValues({
      content: withValue(bound('b1')),
      bindings: [state(bound('b1'), value)],
      rows: 250,
    });
    const text = await textRegion();
    await checked();
    await user.click(await within(text).findByRole('button', { name: '1,234.5, bound value' }));
    const panel = await screen.findByRole('region', { name: 'Provenance' });
    await user.click(within(panel).getByRole('button', { name: 'Show the result' }));
    const table = await within(panel).findByRole('table');
    // A header row and 200 rows of the 250.
    expect(within(table).getAllByRole('row')).toHaveLength(201);
    expect(within(table).getByRole('columnheader', { name: 'depth' })).toBeInTheDocument();
    expect(panel).toHaveTextContent('and 50 more rows');
  });

  it("keeps a value's provenance open, and the focus in it, where the values read again no longer answer it or cannot be read", async () => {
    const user = userEvent.setup();
    const options: Parameters<typeof openWithValues>[0] = {
      content: withValue(bound('b1')),
      bindings: [state(bound('b1'), value)],
    };
    const { checked } = openWithValues(options);
    const text = await textRegion();
    await checked();
    await user.click(await within(text).findByRole('button', { name: '1,234.5, bound value' }));
    const panel = await screen.findByRole('region', { name: 'Provenance' });
    const heading = within(panel).getByRole('heading', { name: 'Provenance' });
    expect(heading).toHaveFocus();
    const paragraph = () =>
      within(text)
        .getByText(/The mean was/)
        .closest('p')!;
    // Returning to the window reads the text, and so the values, again: now answering for another
    // binding and not this one,
    // and then failing.
    for (const [answer, shown] of [
      [[state(bound('b9'), value)], 'The mean was No value - never resolved m.'],
      [null, 'The mean was Bound value m.'],
    ] as const) {
      options.bindings = answer === null ? null : [...answer];
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });
      await waitFor(() => expect(seen(paragraph())).toBe(shown));
      expect(screen.getByRole('region', { name: 'Provenance' })).toHaveTextContent('1,234.5');
      expect(heading).toHaveFocus();
    }
  });

  it("says in a failed value's provenance why it has none, in the words the text shows", async () => {
    const user = userEvent.setup();
    const { checked } = openWithValues({
      content: withValue(bound('b1')),
      bindings: [state(bound('b1'), { failure: 'value_many', count: 3 })],
    });
    const text = await textRegion();
    await checked();
    await user.click(await within(text).findByRole('button', { name: /bound value, failed/ }));
    const panel = await screen.findByRole('region', { name: 'Provenance' });
    expect(panel).toHaveTextContent('No value - the query returned 3 rows');
  });

  it('says in an open provenance that the binding changed since it was resolved, where the values read again answer it stale', async () => {
    const user = userEvent.setup();
    const options: Parameters<typeof openWithValues>[0] = {
      content: withValue(bound('b1')),
      bindings: [state(bound('b1'), value)],
    };
    const { checked } = openWithValues(options);
    const text = await textRegion();
    await checked();
    await user.click(await within(text).findByRole('button', { name: '1,234.5, bound value' }));
    const panel = await screen.findByRole('region', { name: 'Provenance' });
    const held = state(bound('b1'), value);
    options.bindings = [{ ...held, held: { ...held.held, stale: true, taken: null } }];
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(panel).toHaveTextContent('changed since it was resolved'));
    expect(panel.textContent).not.toContain('cannot be read');
  });

  it("shows no result asked for one value once another value's provenance is open", async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const { checked } = openWithValues({
      content: withValue(bound('b1'), bound('b2')),
      bindings: [
        state(bound('b1'), value),
        state(bound('b2'), { value: '1240.5', column: { name: 'depth', type: decimal } }),
      ],
      datasetGate: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    const text = await textRegion();
    await checked();
    await user.click(await within(text).findByRole('button', { name: '1,234.5, bound value' }));
    const panel = await screen.findByRole('region', { name: 'Provenance' });
    await user.click(within(panel).getByRole('button', { name: 'Show the result' }));
    await user.click(within(text).getByRole('button', { name: '1,240.5, bound value' }));
    await waitFor(() => expect(panel).toHaveTextContent('1,240.5'));
    await act(async () => {
      release();
      await new Promise((settle) => setTimeout(settle, 20));
    });
    expect(within(panel).queryByRole('table')).toBeNull();
    expect(within(panel).getByRole('button', { name: 'Show the result' })).toBeInTheDocument();
  });

  it('shows a value whose answer cannot be read as unavailable, never as never resolved', async () => {
    openWithValues({
      content: withValue(bound('b1')),
      bindings: [{ ...state(bound('b1'), value), held: { dataset: 'not a resolution' } }],
    });
    const text = await textRegion();
    const paragraph = () =>
      within(text)
        .getByText(/The mean was/)
        .closest('p')!;
    await waitFor(() =>
      expect(seen(paragraph())).toBe('The mean was No value - the result cannot be read m.'),
    );
    // With no provenance to open.
    expect(within(text).queryByRole('button', { name: /bound value/ })).toBeNull();
  });

  it("DAT-098 draws a bound image in the document's text and as a figure from its asset version, and says in place why one has none", async () => {
    const ASSET = 'aaaaaaaa-0000-4000-8000-0000000000a1';
    const described = { base: 'image', encoding: 'binary', description: { column: 'name' } };
    const image = (description: string) => ({
      image: 'ab'.repeat(32),
      assetVersion: ASSET,
      description,
      column: { name: 'photo', type: described },
    });
    const figure = (id: string, binding: unknown) => ({
      type: 'figure',
      id,
      binding,
      imageStyle: 'figure',
      caption: [{ type: 'text', value: `Caption ${id}`, marks: [] }],
      alternative: { kind: 'inherited' },
    });
    const content = {
      ...withValue(bound('b1', 'photo')),
      content: [
        ...withValue(bound('b1', 'photo')).content,
        figure('f1', bound('b2', 'photo')),
        figure('f2', bound('b3', 'photo')),
        figure('f3', bound('b4', 'depth')),
      ],
    };
    openWithValues({
      content,
      bindings: [
        state(bound('b1', 'photo'), image('North gate')),
        state(bound('b2', 'photo'), image('South gate')),
        state(bound('b3', 'photo'), { failure: 'image_description_missing', column: 'name' }),
        // A placement the view decides, never a take's: said by its words, not as unavailable.
        state(bound('b4', 'depth'), { failure: 'value_not_image' }),
      ],
    });
    const text = await textRegion();
    const src = `/v1/asset-versions/${ASSET}/content`;
    await waitFor(() =>
      expect(within(text).getByRole('img', { name: 'North gate' })).toHaveAttribute('src', src),
    );
    // In the line, in its holder, at the inline image style.
    const inline = within(text).getByRole('img', { name: 'North gate' });
    expect(inline.closest('p')).toHaveTextContent('The mean was');
    expect(inline).toHaveAttribute('data-image-style', 'inline');
    // As a figure, above its caption.
    const drawn = within(text).getByRole('img', { name: 'South gate' });
    expect(drawn).toHaveAttribute('src', src);
    expect(drawn.closest('figure')).toHaveTextContent('Caption f1');
    // Why the others have none, in place, the rest of the document drawn.
    expect(
      within(text).getByText('No image - the row has no description in name'),
    ).toBeInTheDocument();
    expect(within(text).getByText('No image - the column is not an image')).toBeInTheDocument();
    expect(within(text).getByText('Caption f3')).toBeInTheDocument();
  });

  it('shows no values and no error where the values cannot be read', async () => {
    openWithValues({ content: withValue(bound('b1')), bindings: null });
    const text = await textRegion();
    const paragraph = () =>
      within(text)
        .getByText(/The mean was/)
        .closest('p')!;
    await waitFor(() => expect(seen(paragraph())).toBe('The mean was Bound value m.'));
    expect(within(text).queryByRole('button', { name: /bound value/ })).toBeNull();
    expect(screen.queryByText(/could not/)).toBeNull();
  });

  it('DAT-082 checks once on opening for a reader who may check, shows the revision beside the value held in the Data tab, and moves nothing until it is accepted', async () => {
    const user = userEvent.setup();
    const revised = { value: '1240.5', column: { name: 'depth', type: decimal } };
    const waiting = {
      version: 'abcdef09-0000-4000-8000-000000000009',
      provenance: provenance(),
      taken: revised,
    };
    const options: Parameters<typeof openWithValues>[0] = {
      content: withValue(bound('b1')),
      bindings: [state(bound('b1'), value, { facts: checks })],
      check: {
        results: [{ node: RESULTS, binding: 'b1', outcome: 'revision', version: waiting.version }],
        then: () => {
          options.bindings = [state(bound('b1'), value, { waiting, facts: checks })];
        },
      },
      accepted: () => {
        options.bindings = [state(bound('b1'), revised, { facts: checks })];
      },
    };
    const { asked } = openWithValues(options);
    const text = await textRegion();
    await user.click(await screen.findByRole('tab', { name: 'Data' }));
    const panel = screen.getByRole('tabpanel', { name: 'Data' });
    // The revision is shown beside the value held, which the text still shows.
    await within(panel).findByText('Waiting: 1,240.5');
    expect(within(panel).getByText('1,234.5')).toBeInTheDocument();
    expect(
      within(text).getByRole('button', { name: /^1,234\.5, bound value/ }),
    ).toBeInTheDocument();
    expect(asked.filter((path) => path.endsWith('/bindings/check'))).toHaveLength(1);

    await user.click(within(panel).getByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(
        within(text).getByRole('button', { name: '1,240.5, bound value' }),
      ).toBeInTheDocument(),
    );
    // Read again after the accept, never checked again.
    expect(asked.filter((path) => path.endsWith('/bindings/check'))).toHaveLength(1);
  });

  it('keeps the editor opened in place, with its text, while the check on opening and the values it reads again land', async () => {
    const user = userEvent.setup();
    let release = () => {};
    const checkGate = new Promise<void>((settle) => {
      release = settle;
    });
    const waiting = {
      version: 'abcdef09-0000-4000-8000-000000000009',
      provenance: provenance(),
      taken: { value: '1240.5', column: { name: 'depth', type: decimal } },
    };
    const options: Parameters<typeof openWithValues>[0] = {
      content: withValue(bound('b1')),
      bindings: [state(bound('b1'), value, { facts: checks })],
      checkGate,
      check: {
        results: [{ node: RESULTS, binding: 'b1', outcome: 'revision', version: waiting.version }],
        then: () => {
          options.bindings = [state(bound('b1'), value, { waiting, facts: checks })];
        },
      },
    };
    const { asked } = openWithValues(options);
    const text = await textRegion();
    // Opened straight after the page loads, while the check is still out.
    await within(text).findByRole('button', { name: /^1,234\.5, bound value/ });
    await waitFor(() => expect(asked).toContain(`/v1/documents/${DOCUMENT}/bindings/check`));
    await user.click(within(text).getByText(/The mean was/));
    const surface = await within(text).findByRole('textbox', {
      name: 'Content of Install the printer',
    });
    await waitFor(() => expect(seen(surface.querySelector('p')!)).toBe('The mean was 1,234.5 m.'));

    const reads = asked.filter((path) => path === `/v1/documents/${DOCUMENT}/bindings`).length;
    release();
    await waitFor(() =>
      expect(asked.filter((path) => path === `/v1/documents/${DOCUMENT}/bindings`).length).toBe(
        reads + 1,
      ),
    );
    await act(async () => {
      await new Promise((settle) => setTimeout(settle, 50));
    });
    // The same editor, never closed or drawn again, its text kept and its value told of the revision.
    expect(within(text).getByRole('textbox', { name: 'Content of Install the printer' })).toBe(
      surface,
    );
    expect(surface.isConnected).toBe(true);
    await waitFor(() =>
      expect(seen(surface.querySelector('p')!)).toMatch(
        /^The mean was 1,234\.5.*revision waiting m\.$/,
      ),
    );
  });

  it('DAT-082 never checks on opening where no binding may be checked by this reader, or every one is pinned', async () => {
    for (const binding of [
      state(bound('b1'), value, { facts: { mayCheck: false } }),
      state({ ...bound('b1'), mode: 'pinned' }, value, { facts: checks }),
    ]) {
      const { asked } = openWithValues({ content: withValue(bound('b1')), bindings: [binding] });
      await screen.findByRole('tab', { name: 'Data' });
      await act(async () => {
        await new Promise((settle) => setTimeout(settle, 50));
      });
      expect(asked).toContain(`/v1/documents/${DOCUMENT}/bindings`);
      expect(asked).not.toContain(`/v1/documents/${DOCUMENT}/bindings/check`);
      cleanup();
    }
  });

  it("lists a value the check on opening failed for as failed in the Data tab, in the check's words", async () => {
    const user = userEvent.setup();
    openWithValues({
      content: withValue(bound('b1')),
      bindings: [state(bound('b1'), value, { facts: checks })],
      check: {
        results: [
          {
            node: RESULTS,
            binding: 'b1',
            outcome: 'failed',
            failure: {
              code: 'source_unreachable',
              message: 'The source could not be reached.',
              attribution: 'source',
              definition: DEFINITION,
              binding: 'b1',
              node: RESULTS,
              document: DOCUMENT,
            },
          },
        ],
      },
    });
    await user.click(await screen.findByRole('tab', { name: 'Data' }));
    const panel = screen.getByRole('tabpanel', { name: 'Data' });
    await within(panel).findByText('The source could not be reached.');
    expect(within(panel).getByText('Failed', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('A value could not be checked. See the Data tab.')).toBeInTheDocument();
  });

  it("follows a check's result waiting on its images, and lists one whose image was refused as failed in its words", async () => {
    const user = userEvent.setup();
    const PENDING = 'abcdef09-0000-4000-8000-000000000007';
    const failure = {
      code: 'image_refused',
      attribution: 'query',
      message: 'Row 1, column photo: the image is not a PNG or a JPEG.',
      row: 1,
      column: 'photo',
      definition: DEFINITION,
      binding: 'b1',
      node: RESULTS,
      document: DOCUMENT,
    };
    const { asked } = openWithValues({
      content: withValue(bound('b1')),
      bindings: [state(bound('b1'), value, { facts: checks })],
      check: {
        results: [{ node: RESULTS, binding: 'b1', outcome: 'pending', pending: PENDING }],
      },
      pending: {
        id: PENDING,
        act: 'check',
        document: DOCUMENT,
        node: RESULTS,
        binding: 'b1',
        state: 'done',
        result: { node: RESULTS, binding: 'b1', outcome: 'failed', failure },
      },
    });
    await user.click(await screen.findByRole('tab', { name: 'Data' }));
    const panel = screen.getByRole('tabpanel', { name: 'Data' });
    await within(panel).findByText('Row 1, column photo: the image is not a PNG or a JPEG.');
    expect(asked).toContain(`/v1/datasets/pending/${PENDING}`);
    expect(screen.getByText('A value could not be checked. See the Data tab.')).toBeInTheDocument();
  });

  it('offers the Data tab only where the document holds a binding', async () => {
    openWithValues({ content: plain, bindings: [] });
    await within(await textRegion()).findByText('Nothing bound here.');
    expect(screen.queryByRole('tab', { name: 'Data' })).toBeNull();
  });

  it('asks for the values only where a text holds a binding', async () => {
    const { asked } = openWithValues({ content: plain, bindings: [] });
    await within(await textRegion()).findByText('Nothing bound here.');
    expect(asked).not.toContain(`/v1/documents/${DOCUMENT}/bindings`);
  });
});
