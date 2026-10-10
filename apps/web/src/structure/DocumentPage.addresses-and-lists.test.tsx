import { readFileSync } from 'node:fs';
import {
  assemble,
  DEFAULT_CATALOGUES_BY_VERSION,
  DEFAULT_THEME,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  readTheme,
  type OutlineNode,
  type OutlineViewNode,
  type PublishedNode,
} from '@alloy-works/domain';
import { TEXT_CLASS } from '@alloy-works/editor';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shimRangeMeasurement } from '../test/range.js';
import { DocumentList } from './DocumentList.js';
import { DOCK_KEY, DocumentPage } from './DocumentPage.js';
import { documentAddress } from './links.js';
import { LINK_WAITS_MS } from './position.js';
import { NewDocument } from './NewDocument.js';
import { DEFAULT_PRESENTATION } from '../theme/presentation.fixture.js';
import {
  client,
  outline,
  open,
  section,
  DOCUMENT,
  SPACE,
  ADA,
  PRINTER,
  INTRODUCTION,
  SCOPE,
  METHOD,
  RESULTS,
  LAYOUT_V1,
  LAYOUT_V2,
  reference,
  layoutView,
  service,
  upperRomanLayout,
  SPACES,
  item,
  json,
  previewLinks,
  settled,
  SOMEBODY_ELSE,
  sum,
  openAt,
  nodeIn,
  SECRET,
  listed,
  AGAIN,
  referenceTo,
  HIDDEN,
  tray,
  parts,
  aside,
} from './test/documentPage.js';

// A section's title is a ProseMirror view since equations 3, which scrolls its selection into view.
shimRangeMeasurement();

// The panel beside the text a test chose is not the next test's (LG6c).
afterEach(() => window.localStorage.removeItem(DOCK_KEY));

describe('New document', () => {
  const made = {
    id: DOCUMENT,
    space: { id: SPACE, name: 'General' },
    version: {
      id: 'dddddddd-0000-4000-8000-000000000001',
      number: '0.1',
      author: ADA,
      createdAt: '2026-09-18T09:00:00.000Z',
      note: null,
    },
    outline: {
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      title: 'The dosing report',
      language: 'fr-CA',
      direction: 'rtl',
      nodes: [],
    },
    mayEdit: true,
    mayPublish: false,
  };

  function spaces(answers: Record<string, unknown>, status: Record<string, number> = {}) {
    const sent: { url: string; body: unknown }[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url).pathname;
      const body = request.method === 'GET' ? undefined : await request.clone().json();
      sent.push({ url, body });
      if (status[url] !== undefined) {
        return json(status[url], { code: 'refused', message: 'No.', traceId: 't' });
      }
      return url in answers ? json(200, answers[url]) : json(500, {});
    }) as typeof globalThis.fetch;
    return { fetch, sent };
  }

  it('offers only the spaces the caller may create in, and sends a title, a language and a direction', async () => {
    const { fetch, sent } = spaces({
      '/v1/spaces': SPACES,
      [`/v1/spaces/${SPACE}/documents`]: made,
    });
    const onCreated = vi.fn();
    render(
      <StrictMode>
        <NewDocument client={client(fetch)} onCreated={onCreated} />
      </StrictMode>,
    );

    const where = await screen.findByLabelText('Where');
    expect([...where.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'General',
      'Regulatory',
    ]);
    expect(screen.queryByLabelText('Component type')).toBeNull();
    await userEvent.type(screen.getByLabelText('Title'), 'The dosing report');
    await userEvent.clear(screen.getByLabelText('Language'));
    await userEvent.type(screen.getByLabelText('Language'), 'fr-CA');
    await userEvent.selectOptions(screen.getByLabelText('Direction'), 'rtl');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(DOCUMENT));
    expect(sent.at(-1)).toEqual({
      url: `/v1/spaces/${SPACE}/documents`,
      body: { title: 'The dosing report', language: 'fr-CA', direction: 'rtl' },
    });
  });

  it('shows nothing at all where there is nowhere the caller may create', async () => {
    const { fetch } = spaces({ '/v1/spaces': { items: [SPACES.items[1]], next: null } });
    const { container } = render(<NewDocument client={client(fetch)} onCreated={vi.fn()} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('will not send a title that is empty or a language that is not a tag, and says which', async () => {
    const { fetch, sent } = spaces({ '/v1/spaces': SPACES });
    render(<NewDocument client={client(fetch)} onCreated={vi.fn()} />);
    await screen.findByLabelText('Where');

    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByRole('status')).toHaveTextContent('A document needs a title.');

    await userEvent.type(screen.getByLabelText('Title'), 'The dosing report');
    await userEvent.clear(screen.getByLabelText('Language'));
    await userEvent.type(screen.getByLabelText('Language'), 'english');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByRole('status')).toHaveTextContent('A language tag looks like en-GB.');

    expect(sent.filter((request) => request.url.endsWith('/documents'))).toEqual([]);
  });

  it('says so when the service refuses, and keeps what was typed', async () => {
    const { fetch } = spaces({ '/v1/spaces': SPACES }, { [`/v1/spaces/${SPACE}/documents`]: 403 });
    render(<NewDocument client={client(fetch)} onCreated={vi.fn()} />);
    await screen.findByLabelText('Where');
    await userEvent.type(screen.getByLabelText('Title'), 'The dosing report');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'You may not create a document here.',
    );
    expect(screen.getByLabelText('Title')).toHaveValue('The dosing report');
  });

  const TEMPLATE = 'ee000000-0000-4000-8000-000000000001';
  const TEMPLATES = {
    items: [
      {
        id: TEMPLATE,
        name: 'Report',
        space: { id: SPACE, name: 'General' },
        version: { id: 'ee000000-0000-4000-8000-0000000000a1', number: '0.3' },
      },
    ],
    next: null,
  };

  it('offers Blank and the templates the caller may read, and sends the one chosen', async () => {
    const { fetch, sent } = spaces({
      '/v1/spaces': SPACES,
      '/v1/templates': TEMPLATES,
      [`/v1/spaces/${SPACE}/documents`]: made,
    });
    const onCreated = vi.fn();
    render(<NewDocument client={client(fetch)} onCreated={onCreated} />);

    const template = await screen.findByLabelText('Template');
    await waitFor(() =>
      expect([...template.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
        'Blank',
        'Report (General)',
      ]),
    );
    // Blank is chosen until another is: a document made from nothing sends no template.
    expect(template).toHaveValue('');
    await userEvent.selectOptions(template, 'Report (General)');
    await userEvent.type(screen.getByLabelText('Title'), 'The dosing report');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(DOCUMENT));
    expect(sent.at(-1)).toEqual({
      url: `/v1/spaces/${SPACE}/documents`,
      body: { title: 'The dosing report', language: 'en-GB', direction: 'ltr', template: TEMPLATE },
    });
  });

  it('still offers Blank when the templates cannot be read, and says they could not', async () => {
    const { fetch } = spaces({ '/v1/spaces': SPACES });
    render(<NewDocument client={client(fetch)} onCreated={vi.fn()} />);
    expect(await screen.findByText('The templates could not be loaded.')).toBeInTheDocument();
    const template = screen.getByLabelText('Template');
    expect([...template.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'Blank',
    ]);
  });

  it('says a template that no longer resolves cannot be used, and keeps the choice', async () => {
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url).pathname;
      if (url === '/v1/spaces') return json(200, SPACES);
      if (url === '/v1/templates') return json(200, TEMPLATES);
      return json(400, {
        code: 'template_unresolved',
        message: 'No.',
        traceId: 't',
        unresolved: [{ reference: 'layout', id: SPACE }],
      });
    }) as typeof globalThis.fetch;
    render(<NewDocument client={client(fetch)} onCreated={vi.fn()} />);
    const template = await screen.findByLabelText('Template');
    await screen.findByRole('option', { name: 'Report (General)' });
    await userEvent.selectOptions(template, 'Report (General)');
    await userEvent.type(screen.getByLabelText('Title'), 'The dosing report');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'This template refers to something that no longer exists, so a document cannot be made from it. Choose another, or Blank.',
    );
    expect(template).toHaveValue(TEMPLATE);
  });

  it('says the caller is signed out on a 401, rather than asking them to try again', async () => {
    const { fetch } = spaces({ '/v1/spaces': SPACES }, { [`/v1/spaces/${SPACE}/documents`]: 401 });
    render(<NewDocument client={client(fetch)} onCreated={vi.fn()} />);
    await screen.findByLabelText('Where');
    await userEvent.type(screen.getByLabelText('Title'), 'The dosing report');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'You are signed out. Sign in again to create a document.',
    );
  });
});

describe('the documents', () => {
  function listing(answer: { status: number; body: unknown }) {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url).pathname;
      if (url === '/v1/documents') return json(answer.status, answer.body);
      if (url === '/v1/spaces') return json(200, { items: [], next: null });
      return json(500, {});
    }) as typeof globalThis.fetch;
  }

  it('lists the documents the caller may read, each a link that opens it, and ignores what is malformed', async () => {
    const fetch = listing({
      status: 200,
      body: {
        items: [
          {
            id: DOCUMENT,
            title: 'The dosing report',
            space: { id: SPACE, name: 'General' },
            version: '0.4',
          },
          { id: 7, title: null },
        ],
        next: null,
      },
    });
    render(<DocumentList client={client(fetch)} onOpen={vi.fn()} />);

    const link = await screen.findByRole('link', { name: 'The dosing report' });
    expect(link).toHaveAttribute('href', `#/documents/${DOCUMENT}`);
    // A row of the table since interface slice 7, its space and version in their own cells.
    const row = link.closest('tr')!;
    expect(within(row).getByRole('cell', { name: 'General' })).toBeInTheDocument();
    expect(within(row).getByRole('cell', { name: '0.4' })).toBeInTheDocument();
    expect(row.parentElement!.querySelectorAll('tr')).toHaveLength(1);
  });

  it('says so when there are no documents to read', async () => {
    render(
      <DocumentList
        client={client(listing({ status: 200, body: { items: [], next: null } }))}
        onOpen={vi.fn()}
      />,
    );
    expect(await screen.findByText('There are no documents you may read.')).toBeInTheDocument();
  });

  it('says the caller is signed out on a 401, and that the documents could not be loaded otherwise', async () => {
    const { unmount } = render(
      <DocumentList
        client={client(listing({ status: 401, body: { code: 'unauthenticated' } }))}
        onOpen={vi.fn()}
      />,
    );
    expect(
      await screen.findByText('You are signed out. Sign in again to see your documents.'),
    ).toBeInTheDocument();
    unmount();

    render(<DocumentList client={client(listing({ status: 500, body: {} }))} onOpen={vi.fn()} />);
    expect(await screen.findByText('The documents could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('the address of every node', () => {
  // Choosing a node rewrites the address; put it back so no later test starts somewhere else.
  afterEach(() => window.history.replaceState(null, '', '#'));

  it('STR-044 gives every node an address naming its document and itself, which opens the document at that node', async () => {
    // Every kind of node: sections at the top level and nested, and a component reference.
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction', [reference(RESULTS, 'latest')]),
        section(METHOD, 'Method', [section(SCOPE, 'Scope')]),
      ]),
    );
    const first = open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Install the printer, latest' });
    await screen.findByRole('treeitem', { name: 'Scope' });
    let copied = '';
    for (const [id, choice, name] of [
      [INTRODUCTION, 'Introduction', 'Introduction'],
      [RESULTS, 'Install the printer, latest', 'Install the printer'],
      [METHOD, 'Method', 'Method'],
      [SCOPE, 'Scope', 'Scope'],
    ] as const) {
      await userEvent.click(item(choice));
      const field = screen.getByRole('textbox', { name: `Link to ${name}` }) as HTMLInputElement;
      expect(field.value).toBe(
        `${window.location.origin}${window.location.pathname}#/documents/${DOCUMENT}/nodes/${id}`,
      );
      // The address follows what is chosen, so a reload or a copy of it comes back here.
      expect(window.location.hash).toBe(`#/documents/${DOCUMENT}/nodes/${id}`);
      copied = field.value;
    }
    first.unmount();

    // Somebody else, given Scope's address as it was shown: it names this document and Scope, and
    // the document opens there with Scope chosen, focused and marked.
    expect(documentAddress(new URL(copied).hash)).toEqual({
      kind: 'document',
      document: DOCUMENT,
      node: SCOPE,
    });
    openAt(fake.fetch, nodeIn(copied));
    await waitFor(() => expect(item('Scope')).toHaveFocus());
    expect(item('Scope')).toHaveAttribute('aria-selected', 'true');
    expect(within(item('Scope')).getByText('Scope').closest('mark')).not.toBeNull();
    // And shows them the same address for it.
    expect((screen.getByRole('textbox', { name: 'Link to Scope' }) as HTMLInputElement).value).toBe(
      copied,
    );
  });

  it('STR-046 keeps a node at its address when the outline is reordered around it', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        section(METHOD, 'Method', [section(SCOPE, 'Scope')]),
      ]),
    );
    const page = openAt(fake.fetch, SCOPE);
    await waitFor(() => expect(item('Scope')).toHaveFocus());
    const before = (screen.getByRole('textbox', { name: 'Link to Scope' }) as HTMLInputElement)
      .value;
    expect(item('Scope')).toHaveAccessibleDescription('2.1');

    // Method, and Scope with it, moves to the front: Scope's number and position both change.
    await userEvent.click(item('Method'));
    // Choosing another node ends the mark the link left.
    expect(within(item('Scope')).getByText('Scope').closest('mark')).toBeNull();
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await waitFor(() => expect(item('Scope')).toHaveAccessibleDescription('1.1'));
    await settled();
    // The arrival was taken once: the act that came back does not pull the reader back to Scope.
    expect(item('Method')).toHaveAttribute('aria-selected', 'true');

    // The same address, arriving again, still finds Scope; and Scope's address has not changed.
    page.arriveAgain(nodeIn(before), 1);
    await waitFor(() => expect(item('Scope')).toHaveFocus());
    expect(item('Scope')).toHaveAttribute('aria-selected', 'true');
    expect(within(item('Scope')).getByText('Scope').closest('mark')).not.toBeNull();
    expect((screen.getByRole('textbox', { name: 'Link to Scope' }) as HTMLInputElement).value).toBe(
      before,
    );
  });

  it('follows the selection to the first node when the chosen one is gone, rather than naming a node that is not there', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));
    expect(window.location.hash).toBe(`#/documents/${DOCUMENT}/nodes/${METHOD}`);

    // Grace removes Method; Ada's next act is refused, and the page shows Grace's outline.
    fake.theirs({ operation: 'remove', node: METHOD });
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(SOMEBODY_ELSE));
    expect(screen.queryByRole('treeitem', { name: 'Method' })).toBeNull();
    expect(item('Introduction')).toHaveAttribute('aria-selected', 'true');
    await waitFor(() =>
      expect(window.location.hash).toBe(`#/documents/${DOCUMENT}/nodes/${INTRODUCTION}`),
    );
  });

  it('says so when the address names nothing this document holds, and keeps the first node chosen', async () => {
    const fake = service(outline([section(INTRODUCTION, 'Introduction')]));
    openAt(fake.fetch, SCOPE);
    expect(await screen.findByText('The linked part is not in this document.')).toBeInTheDocument();
    expect(item('Introduction')).toHaveAttribute('aria-selected', 'true');
  });

  describe('the document as one scroll (document-view.md)', () => {
    const SECTION = 'ssssssssssssssssssssssssss';
    const REFERENCE = 'kkkkkkkkkkkkkkkkkkkkkkkkkk';
    const printer = {
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
    /** A section holding one component, in the environment's theme. */
    async function openOneScroll() {
      const fake = service(
        outline([section(SECTION, 'Setting up', [reference(REFERENCE, 'latest')])]),
      );
      const fetching = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(String(input), init);
        const path = new URL(request.url).pathname;
        if (path === `/v1/documents/${DOCUMENT}/presentation`) {
          return json(200, DEFAULT_PRESENTATION);
        }
        if (path === `/v1/documents/${DOCUMENT}/texts`) {
          return json(200, {
            document: DOCUMENT,
            version: { id: 'dddddddd-0000-4000-8000-000000000001', number: '0.1' },
            occurrences: [
              {
                node: REFERENCE,
                version: 'vvvvvvvv-0000-4000-8000-000000000001',
                mayEdit: false,
                lock: null,
              },
            ],
            versions: [{ id: 'vvvvvvvv-0000-4000-8000-000000000001', content: printer }],
          });
        }
        return fake.fetch(request);
      }) as typeof globalThis.fetch;
      render(<DocumentPage client={client(fetching)} id={DOCUMENT} principalId={ADA} />);
      const text = await screen.findByRole('region', { name: "The document's text" });
      await within(text).findByText('Unbox the printer.');
      await waitFor(() => expect(text).toHaveClass('aw-canvas'));
      return text;
    }
    // By a name in a variable: Vite rewrites a literal one into the stylesheet's served address.
    const STYLESHEET = './DocumentText.module.css';
    const stylesheet = () =>
      readFileSync(new URL(STYLESHEET, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    /** The declarations of the stylesheet's rule for exactly this selector. */
    const ruleOf = (selector: string) => {
      const found = [...stylesheet().matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((match) =>
        match[1]!.split(',').some((each) => each.trim() === selector),
      );
      return found?.[2] ?? null;
    };

    it('CNT-072 sets the whole document on one canvas, its sections and components headed in the theme, with no card around a component', async () => {
      const text = await openOneScroll();
      // One canvas, holding every heading and every component's text: the text itself, and none
      // inside it.
      expect(text).toHaveClass('aw-canvas');
      expect(text.querySelectorAll('.aw-canvas')).toHaveLength(0);
      // Each heading in the theme's role for its depth: the section's first, the component's second.
      const section = within(text).getByRole('heading', { name: /Setting up/ });
      const component = within(text).getByRole('heading', { name: /Install the printer/ });
      expect(section).toHaveAttribute('data-role', 'heading1');
      expect(component).toHaveAttribute('data-role', 'heading2');
      expect(getComputedStyle(section).fontSize).toBe('calc(16pt * var(--aw-zoom))');
      expect(getComputedStyle(component).fontSize).toBe('calc(13pt * var(--aw-zoom))');
      // Nothing draws a box round a component: no border, no fill.
      const box = ruleOf('.component');
      expect(box).not.toBeNull();
      expect(box).not.toMatch(/border|background/);
      expect(text.querySelector('[data-component]')).not.toBeNull();
    });

    it("CNT-073 shows a component's edges and label on hover, on focus and under Show boundaries, and never otherwise", async () => {
      const text = await openOneScroll();
      // The label is there for a screen reader and the keyboard, and seen only when asked for.
      const label = within(text).getByText('You may read this component but not edit it.');
      expect(label.closest('[data-label]')).not.toBeNull();
      expect(ruleOf('.label')).toMatch(/opacity: 0/);
      // Inside its own component's box, at the top: never over the component above it, and never
      // outside the canvas, whose sideways scrolling clips what stands above its top.
      expect(ruleOf('.label')).toMatch(/top: 0/);
      expect(ruleOf('.label')).not.toMatch(/bottom:/);
      for (const shown of [
        '.component:hover > .label',
        '.component:focus-within > .label',
        ".text[data-boundaries='shown'] .label",
      ]) {
        expect(ruleOf(shown), shown).toMatch(/opacity: 1/);
      }
      for (const edged of [
        '.component:hover',
        '.component:focus-within',
        ".text[data-boundaries='shown'] .component",
      ]) {
        expect(ruleOf(edged), edged).toMatch(/outline: 1px solid/);
      }
      // Show boundaries shows them all, and is kept for this reader.
      expect(text).not.toHaveAttribute('data-boundaries');
      await userEvent.click(screen.getByLabelText('Show boundaries'));
      expect(text).toHaveAttribute('data-boundaries', 'shown');
      expect(window.localStorage.getItem('alloy-works.boundaries')).toBe('shown');
      await userEvent.click(screen.getByLabelText('Show boundaries'));
      expect(text).not.toHaveAttribute('data-boundaries');
      window.localStorage.removeItem('alloy-works.boundaries');
    });
  });

  describe('Reading and Authoring (document-view.md, "Modes")', () => {
    const REFERENCE = 'kkkkkkkkkkkkkkkkkkkkkkkkkk';
    const printer = {
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
    afterEach(() => {
      try {
        window.localStorage.removeItem('alloy-works.mode');
      } catch {
        // Storage refused: nothing was kept.
      }
    });
    /** The document, whose outline the reader may or may not change, placing one component they may or may not edit. */
    async function openAs(may: { document: boolean; component: boolean; publish?: boolean }) {
      const fake = service(outline([reference(REFERENCE, 'latest')]), {
        mayEdit: may.document,
        mayPublish: may.publish ?? false,
      });
      const fetching = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(String(input), init);
        const path = new URL(request.url).pathname;
        if (path === `/v1/documents/${DOCUMENT}/texts`) {
          return json(200, {
            document: DOCUMENT,
            version: { id: 'dddddddd-0000-4000-8000-000000000001', number: '0.1' },
            occurrences: [
              {
                node: REFERENCE,
                version: 'vvvvvvvv-0000-4000-8000-000000000001',
                mayEdit: may.component,
                lock: null,
              },
            ],
            versions: [{ id: 'vvvvvvvv-0000-4000-8000-000000000001', content: printer }],
          });
        }
        return fake.fetch(request);
      }) as typeof globalThis.fetch;
      const shown = render(
        <DocumentPage client={client(fetching)} id={DOCUMENT} principalId={ADA} />,
      );
      const text = await screen.findByRole('region', { name: "The document's text" });
      await within(text).findByText('Unbox the printer.');
      return { text, shown };
    }
    const modeOf = () => screen.getByRole('radiogroup', { name: 'Mode' });

    it('CNT-154 CNT-105 is in Reading or in Authoring, says which, and lets an author drop to Reading on purpose, kept for them', async () => {
      const { shown } = await openAs({ document: true, component: true });
      // An author opens in Authoring, the switch saying so.
      expect(within(modeOf()).getByRole('radio', { name: 'Authoring' })).toBeChecked();
      expect(within(modeOf()).getByRole('radio', { name: 'Reading' })).not.toBeChecked();
      // And the page says it in its own name, where a screen reader arrives.
      expect(screen.getByRole('article', { name: /in Authoring$/ })).toBeInTheDocument();
      await userEvent.click(within(modeOf()).getByRole('radio', { name: 'Reading' }));
      expect(within(modeOf()).getByRole('radio', { name: 'Reading' })).toBeChecked();
      expect(screen.getByRole('article', { name: /in Reading$/ })).toBeInTheDocument();
      // Kept: the next document opens as they left this one.
      shown.unmount();
      await openAs({ document: true, component: true });
      expect(within(modeOf()).getByRole('radio', { name: 'Reading' })).toBeChecked();
    });

    it('CNT-105 IAM-080 offers Authoring to whoever may change the document or a component it places, and to nobody else', async () => {
      // Neither: no switch at all, and the page reads.
      const { shown } = await openAs({ document: false, component: false });
      expect(screen.queryByRole('radiogroup', { name: 'Mode' })).toBeNull();
      expect(screen.getByText('Reading')).toBeInTheDocument();
      shown.unmount();
      // A component they may edit, in a document they may not restructure: Authoring is theirs.
      const second = await openAs({ document: false, component: true });
      expect(within(modeOf()).getByRole('radio', { name: 'Authoring' })).toBeChecked();
      second.shown.unmount();
      // A document they may restructure, placing nothing they may edit: Authoring too.
      await openAs({ document: true, component: false });
      expect(within(modeOf()).getByRole('radio', { name: 'Authoring' })).toBeChecked();
    });

    it('CNT-156 offers in Reading moving through the document and nothing that changes it, and in Authoring its editing', async () => {
      window.localStorage.setItem(DOCK_KEY, 'publishing');
      const { text } = await openAs({ document: true, component: true, publish: true });
      const body = () => within(text).getByText('Unbox the printer.').closest('[data-opens]');
      // Authoring: the outline's acts, and the text opens its editor.
      expect(screen.getByRole('button', { name: 'Add section' })).toBeInTheDocument();
      expect(body()).toHaveAttribute('data-opens', 'true');
      await userEvent.click(within(modeOf()).getByRole('radio', { name: 'Reading' }));
      // Reading: the outline to move through, and nothing that changes the document.
      expect(screen.queryByRole('button', { name: 'Add section' })).toBeNull();
      expect(body()).toBeNull();
      expect(screen.getByRole('tree', { name: 'Outline' })).toBeInTheDocument();
      // Publishing changes nothing in the document, and stays for whoever may publish (DV-D).
      expect(screen.getByRole('button', { name: /^Publish as/ })).toBeInTheDocument();
    });
  });

  describe('which version each component is (document-view.md, "Versions")', () => {
    const FOLLOWING = 'aaaaaaaaaaaaaaaaaaaaaaaaaa';
    const PINNED = 'bbbbbbbbbbbbbbbbbbbbbbbbbb';
    const APPROVED = 'cccccccccccccccccccccccccc';
    const WITHHELD = 'dddddddddddddddddddddddddd';
    const SECRET = 'cccccccc-0000-4000-8000-000000000009';
    const V1 = 'bbbbbbbb-0000-4000-8000-000000000001';
    const V2 = 'bbbbbbbb-0000-4000-8000-000000000002';
    const V3 = 'bbbbbbbb-0000-4000-8000-000000000003';
    const NUMBERS: Record<string, string> = { [V1]: '0.1', [V2]: '0.2', [V3]: '0.3' };
    const printer = (words: string) => ({
      schemaVersion: 1,
      title: 'Install the printer',
      language: 'en-GB',
      direction: 'ltr',
      content: [
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [{ type: 'text', value: words, marks: [] }],
        },
      ],
    });
    const placed = (
      id: string,
      component: string,
      mode: Extract<OutlineNode, { type: 'reference' }>['mode'],
    ): OutlineNode => ({ ...reference(id, 'latest'), component, mode }) as OutlineNode;
    afterEach(() => {
      try {
        window.localStorage.removeItem('alloy-works.mode');
      } catch {
        // Storage refused: nothing was kept.
      }
    });

    /**
     * A document placing the printer at its latest, pinned to 0.1 and waiting on revisions, and a
     * component the reader may not read. The texts route resolves each as the service does, from the
     * outline as it now stands - the latest is 0.3 - and the versions route lists the printer's three,
     * or answers as `versions` says for the cursor it was sent.
     */
    const listedVersion = (id: string) => ({
      id,
      number: NUMBERS[id],
      createdAt: '2026-09-20T09:00:00.000Z',
      author: { id: ADA, name: 'Ada' },
      note: null,
    });
    async function openVersions(
      may: { document: boolean },
      versions: (cursor: string | null) => Response = () =>
        json(200, { items: [V3, V2, V1].map(listedVersion), next: null }),
    ) {
      const fake = service(
        outline([
          placed(FOLLOWING, PRINTER, { kind: 'latest' }),
          placed(PINNED, PRINTER, { kind: 'pinned', version: V1 }),
          placed(APPROVED, PRINTER, { kind: 'approved' }),
          placed(WITHHELD, SECRET, { kind: 'latest' }),
        ]),
        { mayEdit: may.document, mayRead: (component) => component !== SECRET },
      );
      const listed: string[] = [];
      const fetching = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(String(input), init);
        const path = new URL(request.url).pathname;
        if (path === `/v1/documents/${DOCUMENT}/texts`) {
          const occurrences: unknown[] = [];
          const resolved = new Set<string>();
          const walk = (nodes: readonly OutlineViewNode[]) => {
            for (const node of nodes) {
              if (node.type === 'reference') {
                const version =
                  node.component === null || node.mode.kind === 'approved'
                    ? null
                    : node.mode.kind === 'pinned'
                      ? node.mode.version
                      : V3;
                if (version !== null) resolved.add(version);
                occurrences.push({
                  node: node.id,
                  version,
                  mayEdit: node.component !== null,
                  lock: null,
                });
              }
              walk(node.children);
            }
          };
          const now = fake.latest();
          walk(now.outline.nodes as readonly OutlineViewNode[]);
          return json(200, {
            document: DOCUMENT,
            version: { id: now.version.id, number: now.version.number },
            occurrences,
            versions: [...resolved].map((id) => ({
              id,
              number: NUMBERS[id],
              content: printer(`The printer at ${NUMBERS[id]}.`),
            })),
          });
        }
        if (path === `/v1/components/${PRINTER}/versions`) {
          listed.push(path);
          return versions(new URL(request.url).searchParams.get('cursor'));
        }
        return fake.fetch(request);
      }) as typeof globalThis.fetch;
      const shown = render(
        <DocumentPage client={client(fetching)} id={DOCUMENT} principalId={ADA} />,
      );
      const text = await screen.findByRole('region', { name: "The document's text" });
      await within(text).findByText('The printer at 0.3.');
      return { fake, text, shown, listed };
    }
    const labelOf = (text: HTMLElement, node: string) =>
      text.querySelector<HTMLElement>(`[data-node="${node}"] [data-label]`)!;

    it('CNT-162 shows in each label the version a reference resolves to, and whether it is pinned or at the latest', async () => {
      const { text } = await openVersions({ document: false });
      await waitFor(() =>
        expect(labelOf(text, FOLLOWING)).toHaveTextContent('Version 0.3, latest'),
      );
      expect(labelOf(text, PINNED)).toHaveTextContent('Version 0.1, pinned');
      // Approved resolves to nothing until revisions exist, and says so as the outline does (DV-G).
      expect(labelOf(text, APPROVED)).toHaveTextContent('waiting on revisions');
      expect(labelOf(text, APPROVED)).not.toHaveTextContent(/Version/);
      // A component the reader may not read shows neither which version nor how it is placed.
      const withheld = labelOf(text, WITHHELD);
      expect(withheld).toHaveTextContent('Not yours to read');
      expect(withheld).not.toHaveTextContent(/Version|latest|pinned/);
      // Shown, not offered: the reader may not restructure this document.
      expect(within(text).queryByRole('button', { name: /^Version/ })).toBeNull();
    });

    it('CNT-158 lets an author choose, in Authoring, the version a component reference shows, from its label, and shows it chosen', async () => {
      const { fake, text, listed } = await openVersions({ document: true });
      const label = () => labelOf(text, FOLLOWING);
      const chooser = await within(label()).findByRole('button', {
        name: /^Version 0\.3, latest/,
      });
      expect(chooser).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(chooser);
      const menu = await within(label()).findByRole('menu');
      const items = await within(menu).findAllByRole('menuitemradio');
      // Always the latest, then each version, newest first; never approved (DV-G).
      expect(items.map((each) => each.textContent)).toEqual([
        'Always the latest',
        expect.stringMatching(/^Version 0\.3/),
        expect.stringMatching(/^Version 0\.2/),
        expect.stringMatching(/^Version 0\.1/),
      ]);
      expect(items[0]).toHaveAttribute('aria-checked', 'true');
      expect(items[0]).toHaveFocus();
      // The keyboard moves through it, and Escape closes it with the focus back on the version.
      await userEvent.keyboard('{ArrowDown}');
      expect(items[1]).toHaveFocus();
      await userEvent.keyboard('{Escape}');
      expect(within(label()).queryByRole('menu')).toBeNull();
      expect(chooser).toHaveFocus();
      // Reopened from the keyboard, and 0.1 chosen: the outline's own act, pinned to that version.
      await userEvent.keyboard('{Enter}');
      const again = await within(label()).findByRole('menu');
      await userEvent.click(within(again).getByRole('menuitemradio', { name: /^Version 0\.1/ }));
      await waitFor(() => expect(fake.edits()).toHaveLength(1));
      expect(fake.edits()[0]!.body).toMatchObject({
        operation: { operation: 'set', node: FOLLOWING, mode: { kind: 'pinned', version: V1 } },
      });
      // The texts are read again, and the label shows what it now is.
      await waitFor(() => expect(label()).toHaveTextContent('Version 0.1, pinned'));
      expect(listed.length).toBeGreaterThan(0);
      // And back to the latest, from the pinned one.
      await userEvent.click(within(label()).getByRole('button', { name: /^Version 0\.1, pinned/ }));
      const third = await within(label()).findByRole('menu');
      await userEvent.click(
        within(third).getByRole('menuitemradio', { name: 'Always the latest' }),
      );
      await waitFor(() => expect(fake.edits()).toHaveLength(2));
      expect(fake.edits()[1]!.body).toMatchObject({
        operation: { operation: 'set', node: FOLLOWING, mode: { kind: 'latest' } },
      });
      await waitFor(() => expect(label()).toHaveTextContent('Version 0.3, latest'));
    });

    it('CNT-158 offers the choice only in Authoring, and only to whoever may restructure the document', async () => {
      const { text, shown } = await openVersions({ document: true });
      await within(labelOf(text, FOLLOWING)).findByRole('button', { name: /^Version 0\.3/ });
      await userEvent.click(
        within(screen.getByRole('radiogroup', { name: 'Mode' })).getByRole('radio', {
          name: 'Reading',
        }),
      );
      expect(within(text).queryByRole('button', { name: /^Version/ })).toBeNull();
      expect(labelOf(text, FOLLOWING)).toHaveTextContent('Version 0.3, latest');
      shown.unmount();
      window.localStorage.removeItem('alloy-works.mode');
      // In Authoring, for the components they may edit, but not the document: shown, not offered.
      const other = await openVersions({ document: false });
      expect(screen.getByRole('radio', { name: 'Authoring' })).toBeChecked();
      await waitFor(() =>
        expect(labelOf(other.text, FOLLOWING)).toHaveTextContent('Version 0.3, latest'),
      );
      expect(within(other.text).queryByRole('button', { name: /^Version/ })).toBeNull();
      expect(other.listed).toEqual([]);
    });

    it('reads the versions a page at a time, and again after a failure, the focus kept in the list', async () => {
      let answered = 0;
      const { text } = await openVersions({ document: true }, (cursor) => {
        answered += 1;
        if (answered === 1) return json(500, { code: 'internal', message: 'x', traceId: 't' });
        return cursor === null
          ? json(200, { items: [V3, V2].map(listedVersion), next: 'b2xkZXI' })
          : json(200, { items: [V1].map(listedVersion), next: null });
      });
      const label = () => labelOf(text, FOLLOWING);
      await userEvent.click(await within(label()).findByRole('button', { name: /^Version 0\.3/ }));
      const menu = await within(label()).findByRole('menu');
      await within(menu).findByText('The versions could not be read.');
      const latest = within(menu).getByRole('menuitemradio', { name: 'Always the latest' });
      expect(latest).toHaveFocus();
      await userEvent.click(within(menu).getByRole('menuitem', { name: 'Try again' }));
      await within(menu).findByRole('menuitemradio', { name: /^Version 0\.2/ });
      expect(latest).toHaveFocus();
      expect(within(menu).queryByRole('menuitemradio', { name: /^Version 0\.1/ })).toBeNull();
      // The older page, asked for from the list's end: its first version takes the focus.
      await userEvent.click(within(menu).getByRole('menuitem', { name: 'Older versions' }));
      const oldest = await within(menu).findByRole('menuitemradio', { name: /^Version 0\.1/ });
      await waitFor(() => expect(oldest).toHaveFocus());
      expect(within(menu).queryByRole('menuitem', { name: 'Older versions' })).toBeNull();
      expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(4);
    });
  });

  describe('moving through the document (document-view.md, "Navigation")', () => {
    const FIRST = 'aaaaaaaaaaaaaaaaaaaaaaaaaa';
    const SECOND = 'bbbbbbbbbbbbbbbbbbbbbbbbbb';
    /** Each node's top edge, as the page lays it out; jsdom lays nothing out. */
    const tops = new Map<string, number>();
    const scrolledTo: string[] = [];
    const treeScrolled: string[] = [];
    let seen: (() => void) | null = null;
    const original = {
      rect: Element.prototype.getBoundingClientRect,
      scroll: Element.prototype.scrollIntoView,
      observer: window.IntersectionObserver,
    };
    beforeEach(() => {
      tops.clear();
      scrolledTo.length = 0;
      treeScrolled.length = 0;
      seen = null;
      Element.prototype.getBoundingClientRect = function (this: Element) {
        // A tree item's own row is drawn where its node is.
        const node = this.hasAttribute('data-row')
          ? this.closest('[data-node]')?.getAttribute('data-node')
          : this.getAttribute('data-node');
        const top = tops.get(node ?? '') ?? 0;
        return {
          top,
          bottom: top + 40,
          left: 0,
          right: 600,
          width: 600,
          height: 40,
          x: 0,
          y: top,
          toJSON: () => ({}),
        } as DOMRect;
      };
      Element.prototype.scrollIntoView = function (this: Element) {
        const node = this.getAttribute('data-node');
        if (node !== null && this.closest('[aria-label="The document\'s text"]'))
          scrolledTo.push(node);
        // An element in the tree scrolled into view moves the window, since the window is what
        // scrolls the page - and with it the text, whose node in view then changes (issue #336).
        if (this.closest('[role="tree"]')) treeScrolled.push(node ?? this.tagName);
      };
      // An observer by hand: it tells the page something crossed, when the test says so.
      window.IntersectionObserver = class {
        constructor(callback: () => void) {
          seen = callback;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
        root = null;
        rootMargin = '';
        thresholds = [];
      } as unknown as typeof IntersectionObserver;
    });
    afterEach(() => {
      Element.prototype.getBoundingClientRect = original.rect;
      Element.prototype.scrollIntoView = original.scroll;
      window.IntersectionObserver = original.observer;
    });
    const twoSections = () =>
      service(outline([section(FIRST, 'Unpacking'), section(SECOND, 'Setting up')]));
    const treeItem = (name: RegExp) => screen.getByRole('treeitem', { name });

    it('STR-035 marks in the outline the node whose text is at the top as the reader scrolls, and takes the text to any node chosen', async () => {
      const fake = twoSections();
      render(<DocumentPage client={client(fake.fetch)} id={DOCUMENT} principalId={ADA} />);
      await screen.findByRole('region', { name: "The document's text" });
      // The reader has scrolled past the first section's heading: the second is where they are.
      tops.set(FIRST, -400);
      tops.set(SECOND, 60);
      act(() => seen?.());
      await waitFor(() =>
        expect(treeItem(/Setting up/)).toHaveAttribute('aria-current', 'location'),
      );
      expect(treeItem(/Unpacking/)).not.toHaveAttribute('aria-current');
      // Back up to the top: the first is.
      tops.set(FIRST, 20);
      tops.set(SECOND, 500);
      act(() => seen?.());
      await waitFor(() =>
        expect(treeItem(/Unpacking/)).toHaveAttribute('aria-current', 'location'),
      );
      // Choosing a node in the outline takes the text to it.
      await userEvent.click(treeItem(/Setting up/));
      expect(scrolledTo).toContain(SECOND);
    });

    it("STR-035 keeps the node in view in the tree by scrolling the outline's own pane, never the window that scrolls the text", async () => {
      const fake = twoSections();
      // The reader starts at the first section, the second far below the reading line.
      tops.set(FIRST, 0);
      tops.set(SECOND, 600);
      render(<DocumentPage client={client(fake.fetch)} id={DOCUMENT} principalId={ADA} />);
      await screen.findByRole('region', { name: "The document's text" });
      const pane = screen.getByRole('tree', { name: 'Outline' }).closest('[role="tabpanel"]');
      if (!(pane instanceof HTMLElement)) throw new Error('The tree is in no pane');
      await waitFor(() =>
        expect(treeItem(/Unpacking/)).toHaveAttribute('aria-current', 'location'),
      );
      // Every element is laid out at 0 to 40 here but a node's, so the pane shows its first 40
      // pixels, and the second section's item is drawn at 60 to 100: below what the pane shows.
      tops.set(FIRST, -400);
      tops.set(SECOND, 60);
      act(() => seen?.());
      await waitFor(() =>
        expect(treeItem(/Setting up/)).toHaveAttribute('aria-current', 'location'),
      );
      // Brought into view in the pane alone, its foot to the pane's foot, once the page has drawn.
      await waitFor(() => expect(pane.scrollTop).toBe(60));
      expect(treeScrolled).toEqual([]);
    });

    it("STR-045 takes a reader who follows a node's link to it in the text, and marks it there until they choose another", async () => {
      const fake = twoSections();
      render(
        <DocumentPage
          client={client(fake.fetch)}
          id={DOCUMENT}
          principalId={ADA}
          linked={{ node: SECOND, arrival: 1 }}
        />,
      );
      const text = await screen.findByRole('region', { name: "The document's text" });
      await waitFor(() => expect(scrolledTo).toContain(SECOND));
      const marked = () => text.querySelector('[data-marked="true"]')?.getAttribute('data-node');
      expect(marked()).toBe(SECOND);
      // Choosing another moves the mark off, as the outline's own does.
      await userEvent.click(treeItem(/Unpacking/));
      expect(marked()).toBeUndefined();
    });

    it('keeps the outline pane between the header and the status bar, and lets it go in a window too short to hold it (issue #336)', () => {
      // jsdom lays nothing out, so where the pane stands is read from the stylesheets' own rules. By a
      // name in a variable: Vite rewrites a literal one into the stylesheet's served address.
      const sheets = { page: './DocumentPage.module.css', base: '../theme/base.css' };
      const read = (path: string) =>
        readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const PANE = ".layout > [data-panel] > [data-part='outline']";
      /** The declarations of each rule for exactly `selector` in `css`, as `property: value` pairs. */
      const declared = (css: string, selector: string) =>
        [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
          .filter((match) => match[1]!.split(',').some((each) => each.trim() === selector))
          .flatMap((match) =>
            match[2]!
              .split(';')
              .map((each) => each.trim().replace(/\s+/g, ' '))
              .filter(Boolean),
          );
      const [outside, ...media] = read(sheets.page).split('@media');
      const pane = declared(outside!, PANE);
      expect(pane).toContain('position: sticky');
      expect(pane.find((each) => each.startsWith('max-height:'))).toMatch(
        /var\(--header-height\).*var\(--status-height, 0px\)/,
      );
      // At 400% zoom a stuck pane would show a line or two of its tree: in a short window it scrolls
      // with the page instead, and keeps nothing out of reach.
      const short = media.find((each) => each.trim().startsWith('(max-height: 480px)'));
      expect(short, 'a rule for a short window').toBeDefined();
      expect(declared(short!.slice(short!.indexOf('{') + 1), PANE)).toEqual(
        expect.arrayContaining(['position: static', 'max-height: none']),
      );
      // What the window scrolls to stops above the status bar as it does below the header.
      const html = declared(read(sheets.base), 'html');
      expect(html).toContain('scroll-padding-top: var(--header-height)');
      expect(html).toContain('scroll-padding-bottom: var(--status-height, 0px)');
    });

    /** The fake's answers, the texts held until `release` - or for good, where it is never called. */
    const holdingTexts = (fake: ReturnType<typeof service>) => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(String(input), init);
        if (new URL(request.url).pathname.endsWith('/texts')) await held;
        return fake.fetch(request);
      }) as typeof globalThis.fetch;
      return { fetch, release };
    };
    /** Lets the page take what has arrived: answers read, effects run. */
    const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    const openLinked = (fetch: typeof globalThis.fetch) =>
      render(
        <DocumentPage
          client={client(fetch)}
          id={DOCUMENT}
          principalId={ADA}
          linked={{ node: SECOND, arrival: 1 }}
        />,
      );

    it('STR-045 goes to a linked node once the texts above it have arrived, not before (issue #336)', async () => {
      const { fetch, release } = holdingTexts(twoSections());
      openLinked(fetch);
      await screen.findByRole('region', { name: "The document's text" });
      await settle();
      // Every component above it is still a heading alone: going now, it would be pushed off the screen.
      expect(scrolledTo).toEqual([]);
      release();
      await waitFor(() => expect(scrolledTo).toEqual([SECOND]));
    });

    it('STR-045 still goes to a linked node when a modifier key is pressed alone while it waits, as a screen reader is silenced with Ctrl (issue #350)', async () => {
      const { fetch, release } = holdingTexts(twoSections());
      openLinked(fetch);
      const text = await screen.findByRole('region', { name: "The document's text" });
      fireEvent.keyDown(text, { key: 'Control' });
      fireEvent.keyDown(text, { key: 'Shift' });
      release();
      await waitFor(() => expect(scrolledTo).toEqual([SECOND]));
    });

    /**
     * The browser's word that the column changed size, fired by hand: jsdom lays nothing out. Only the
     * observers still watching hear it, as in the browser.
     */
    const resizing = () => {
      const watching = new Set<() => void>();
      const original = window.ResizeObserver;
      window.ResizeObserver = class {
        constructor(private readonly callback: () => void) {}
        observe() {
          watching.add(this.callback);
        }
        unobserve() {}
        disconnect() {
          watching.delete(this.callback);
        }
      } as unknown as typeof ResizeObserver;
      return {
        resize: () => act(() => [...watching].forEach((callback) => callback())),
        restore: () => {
          window.ResizeObserver = original;
        },
      };
    };

    it('STR-045 keeps going to a linked node as the text above it settles, until the reader chooses another (issue #350)', async () => {
      const { resize, restore } = resizing();
      try {
        const fake = twoSections();
        openLinked(fake.fetch);
        await screen.findByRole('region', { name: "The document's text" });
        await waitFor(() => expect(scrolledTo).toEqual([SECOND]));
        // The theme's faces arrive and the text above the node is set again: it is gone to again.
        resize();
        expect(scrolledTo).toEqual([SECOND, SECOND]);
        // The reader chooses another: the link's node is theirs no longer.
        await userEvent.click(treeItem(/Unpacking/));
        resize();
        expect(scrolledTo).toEqual([SECOND, SECOND, FIRST]);
      } finally {
        restore();
      }
    });

    it('STR-045 lets a linked node go when another is chosen by no press of the pointer, as a screen reader clicks (issue #350)', async () => {
      const { resize, restore } = resizing();
      try {
        const fake = twoSections();
        openLinked(fake.fetch);
        await screen.findByRole('region', { name: "The document's text" });
        await waitFor(() => expect(scrolledTo).toEqual([SECOND]));
        // A click alone - no pointer pressed, no key - which the hold does not hear for itself.
        act(() => {
          fireEvent.click(treeItem(/Unpacking/));
        });
        expect(scrolledTo).toEqual([SECOND, FIRST]);
        resize();
        expect(scrolledTo).toEqual([SECOND, FIRST]);
      } finally {
        restore();
      }
    });

    it('STR-045 leaves the reader where they chose to go while a link waited for the texts (issue #336)', async () => {
      const { fetch, release } = holdingTexts(twoSections());
      openLinked(fetch);
      await screen.findByRole('region', { name: "The document's text" });
      await userEvent.click(treeItem(/Unpacking/));
      expect(scrolledTo).toEqual([FIRST]);
      release();
      await settle();
      expect(scrolledTo).toEqual([FIRST]);
    });

    it('STR-045 leaves the reader where they scrolled to while a link waited for the texts (issue #336)', async () => {
      const windowScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY')!;
      const inputs: [string, (target: Element) => void][] = [
        ['the wheel', (target) => fireEvent.wheel(target, { deltaY: 100 })],
        ['a touch', (target) => fireEvent.touchMove(target)],
        ['Page Down', (target) => fireEvent.keyDown(target, { key: 'PageDown' })],
        ['the space bar', (target) => fireEvent.keyDown(target, { key: ' ' })],
        ['a press of the pointer', (target) => fireEvent.pointerDown(target)],
        [
          'the scrollbar, heard only as the scroll',
          () => {
            // The window 300 pixels down, and the node with it; nothing but the scroll says so.
            Object.defineProperty(window, 'scrollY', { configurable: true, value: 300 });
            tops.set(SECOND, -300);
            fireEvent.scroll(window);
          },
        ],
      ];
      for (const [input, scroll] of inputs) {
        scrolledTo.length = 0;
        const { fetch, release } = holdingTexts(twoSections());
        const { unmount } = openLinked(fetch);
        const text = await screen.findByRole('region', { name: "The document's text" });
        scroll(text);
        release();
        await settle();
        expect(scrolledTo, `scrolled by ${input}`).toEqual([]);
        unmount();
        Object.defineProperty(window, 'scrollY', windowScrollY);
        tops.clear();
      }
    });

    it('STR-045 goes to a linked node when the texts never answer, after waiting a few seconds (issue #336)', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
      try {
        const { fetch } = holdingTexts(twoSections());
        openLinked(fetch);
        await screen.findByRole('region', { name: "The document's text" });
        await settle();
        expect(scrolledTo).toEqual([]);
        act(() => vi.advanceTimersByTime(LINK_WAITS_MS));
        await waitFor(() => expect(scrolledTo).toEqual([SECOND]));
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("sets the document's text in the theme and layout it publishes under, as its editing surface is set", async () => {
    const REFERENCE = 'kkkkkkkkkkkkkkkkkkkkkkkkkk';
    const fake = service(outline([{ ...reference(REFERENCE, 'latest') }]));
    const quoted = {
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
        {
          type: 'blockquote',
          id: 'q1',
          content: [
            {
              type: 'paragraph',
              id: 'b2',
              style: 'body',
              content: [{ type: 'text', value: 'Keep the box.', marks: [] }],
            },
          ],
        },
      ],
    };
    const asked: string[] = [];
    const fetching = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const path = new URL(request.url).pathname;
      asked.push(path);
      if (path === `/v1/documents/${DOCUMENT}/presentation`) return json(200, DEFAULT_PRESENTATION);
      if (path === `/v1/documents/${DOCUMENT}/texts`) {
        return json(200, {
          document: DOCUMENT,
          version: { id: 'dddddddd-0000-4000-8000-000000000001', number: '0.1' },
          occurrences: [
            {
              node: REFERENCE,
              version: 'vvvvvvvv-0000-4000-8000-000000000001',
              mayEdit: true,
              lock: null,
            },
          ],
          versions: [{ id: 'vvvvvvvv-0000-4000-8000-000000000001', content: quoted }],
        });
      }
      return fake.fetch(request);
    }) as typeof globalThis.fetch;
    render(<DocumentPage client={client(fetching)} id={DOCUMENT} principalId={ADA} />);

    const text = await screen.findByRole('region', { name: "The document's text" });
    const running = await within(text).findByText('Unbox the printer.');
    // The document's own presentation - its template's theme and layout, or the environment's.
    expect(asked).toContain(`/v1/documents/${DOCUMENT}/presentation`);
    await waitFor(() => expect(running.closest('.aw-canvas')).not.toBeNull());
    const canvas = running.closest('.aw-canvas') as HTMLElement;
    expect(canvas.style.getPropertyValue('--aw-measure')).toBe('451.28pt');
    // Each component's text is the measure wide, on the one canvas the document is (W9.1).
    expect(getComputedStyle(running.closest('.aw-text')!).width).toBe(
      'calc(var(--aw-measure) * var(--aw-zoom))',
    );
    // Each paragraph by the place it stands in, as on the surface.
    expect(getComputedStyle(running).fontFamily).toBe('"aw-face-serif"');
    expect(
      getComputedStyle(within(text).getByText('Keep the box.')).getPropertyValue('margin-inline'),
    ).toBe('calc(11pt * var(--aw-zoom)) calc(11pt * var(--aw-zoom))');
    expect(screen.getByLabelText('Zoom')).toHaveValue('1');
  });

  it("reads the document's text in one call and edits one component in place at a time", async () => {
    const user = userEvent.setup();
    const REFERENCE = 'kkkkkkkkkkkkkkkkkkkkkkkkkk';
    const fake = service(outline([{ ...reference(REFERENCE, 'latest') }]));
    const printer = {
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
    let textsAsked = 0;
    const fetching = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const path = new URL(request.url).pathname;
      if (path === `/v1/documents/${DOCUMENT}/texts`) {
        textsAsked += 1;
        return json(200, {
          document: DOCUMENT,
          version: { id: 'dddddddd-0000-4000-8000-000000000001', number: '0.1' },
          occurrences: [
            {
              node: REFERENCE,
              version: 'vvvvvvvv-0000-4000-8000-000000000001',
              mayEdit: true,
              lock: null,
            },
          ],
          versions: [{ id: 'vvvvvvvv-0000-4000-8000-000000000001', content: printer }],
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
          content: printer,
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

    const text = await screen.findByRole('region', { name: "The document's text" });
    expect(await within(text).findByText('Unbox the printer.')).toBeInTheDocument();
    const reads = textsAsked;

    await user.click(within(text).getByText('Unbox the printer.'));
    // The component's own editor, in its card: the surface it edits on, and what it says to a reader.
    expect(
      await within(text).findByRole('textbox', { name: 'Content of Install the printer' }),
    ).toBeInTheDocument();
    expect(
      within(text).getByText('You may read this component but not edit it.'),
    ).toBeInTheDocument();
    expect(textsAsked).toBe(reads);

    await user.click(within(text).getByRole('button', { name: 'Done editing' }));
    expect(
      within(text).queryByRole('textbox', { name: 'Content of Install the printer' }),
    ).not.toBeInTheDocument();
    // Read again on closing, so the card shows what was saved.
    await waitFor(() => expect(textsAsked).toBeGreaterThan(reads));
    expect(await within(text).findByText('Unbox the printer.')).toBeInTheDocument();
  });

  it('CNT-074 says of each component whether the reader may edit it now, and when not, why, naming who holds it and when it is expected back; and which one is open', async () => {
    const user = userEvent.setup();
    const [FREE, READ_ONLY, HELD, LAPSED, MINE, MINE_AGAIN] = [
      'kkkkkkkkkkkkkkkkkkkkkkkkka',
      'kkkkkkkkkkkkkkkkkkkkkkkkkb',
      'kkkkkkkkkkkkkkkkkkkkkkkkkc',
      'kkkkkkkkkkkkkkkkkkkkkkkkkd',
      'kkkkkkkkkkkkkkkkkkkkkkkkke',
      'kkkkkkkkkkkkkkkkkkkkkkkkkf',
    ];
    const components = {
      [FREE]: 'cccccccc-0000-4000-8000-00000000000a',
      [READ_ONLY]: 'cccccccc-0000-4000-8000-00000000000b',
      [HELD]: 'cccccccc-0000-4000-8000-00000000000c',
      [LAPSED]: 'cccccccc-0000-4000-8000-00000000000d',
      [MINE]: 'cccccccc-0000-4000-8000-00000000000e',
      // The same component a second time, further on.
      [MINE_AGAIN]: 'cccccccc-0000-4000-8000-00000000000e',
    };
    const fake = service(
      outline(
        [FREE, READ_ONLY, HELD, LAPSED, MINE, MINE_AGAIN].map((node) =>
          referenceTo(node, components[node]!),
        ),
      ),
    );
    const text = (words: string) => ({
      schemaVersion: 1,
      title: words,
      language: 'en-GB',
      direction: 'ltr',
      content: [
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [{ type: 'text', value: words, marks: [] }],
        },
      ],
    });
    const version = (at: number) => `vvvvvvvv-0000-4000-8000-00000000000${at}`;
    const back = new Date(Date.now() + 45 * 60_000).toISOString();
    const grace = (expectedRelease: string) => ({
      holder: { id: 'grace', name: 'Grace' },
      expectedRelease,
      yours: false,
      session: null,
    });
    // Held by this reader, in a session this page did not open.
    const mine = {
      holder: { id: ADA, name: 'Ada' },
      expectedRelease: back,
      yours: true,
      session: 'ssssssss-0000-4000-8000-000000000001',
    };
    let released = false;
    const fetching = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const path = new URL(request.url).pathname;
      if (path === `/v1/documents/${DOCUMENT}/texts`) {
        return json(200, {
          document: DOCUMENT,
          version: { id: 'dddddddd-0000-4000-8000-000000000001', number: '0.1' },
          occurrences: [
            { node: FREE, version: version(1), mayEdit: true, lock: null },
            { node: READ_ONLY, version: version(2), mayEdit: false, lock: null },
            { node: HELD, version: version(3), mayEdit: true, lock: released ? null : grace(back) },
            {
              node: LAPSED,
              version: version(4),
              mayEdit: true,
              lock: grace(new Date(Date.now() - 60_000).toISOString()),
            },
            { node: MINE, version: version(5), mayEdit: true, lock: mine },
            { node: MINE_AGAIN, version: version(5), mayEdit: true, lock: mine },
          ],
          versions: [
            { id: version(1), content: text('Unbox the printer.') },
            { id: version(2), content: text('Read the manual.') },
            { id: version(3), content: text('Load the paper.') },
            { id: version(4), content: text('Close the lid.') },
            { id: version(5), content: text('Print a page.') },
          ],
        });
      }
      if (path === `/v1/components/${components[MINE]}`) {
        return json(200, {
          id: components[MINE],
          space: { id: SPACE, name: 'General' },
          version: {
            id: version(5),
            number: '0.1',
            author: ADA,
            createdAt: '2026-09-18T09:00:00.000Z',
            note: null,
          },
          content: text('Print a page.'),
          mayEdit: true,
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
    const page = await screen.findByRole('region', { name: "The document's text" });
    const card = (node: string) => page.querySelector<HTMLElement>(`[data-node="${node}"]`)!;
    await within(page).findByText('Load the paper.');
    const said = (node: string) => within(card(node)).queryByText(/this component/);

    // Before anything is opened: nothing where the reader may edit now; why not, where not - the
    // holder by name and the time on the reader's own clock, and the day where it is not today.
    const clock = new Date(back).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const day =
      new Date(back).toDateString() === new Date().toDateString()
        ? ''
        : ` on ${new Date(back).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}`;
    const graceBack = `Grace is editing this component, expected back at ${clock}${day}.`;
    expect(said(FREE)).toBeNull();
    expect(said(READ_ONLY)).toHaveTextContent('You may read this component but not edit it.');
    expect(said(HELD)).toHaveTextContent(graceBack);
    // A hold whose time has passed holds nothing: nobody is expected back at a time already gone.
    expect(said(LAPSED)).toBeNull();
    // What the reader holds elsewhere, they are told they hold.
    expect(said(MINE)).toHaveTextContent('You are editing this component in another window.');
    expect(said(MINE_AGAIN)).toHaveTextContent('You are editing this component in another window.');

    // The one the cursor goes into is the one open, in its card; the others still say theirs, but
    // of the same component open on this page, nothing more.
    await user.click(within(card(MINE)).getByText('Print a page.'));
    expect(
      await within(card(MINE)).findByRole('textbox', { name: 'Content of Print a page.' }),
    ).toBeInTheDocument();
    expect(card(MINE).querySelector('[data-editing="true"]')).not.toBeNull();
    expect(card(READ_ONLY).querySelector('[data-editing="true"]')).toBeNull();
    expect(said(MINE_AGAIN)).toBeNull();
    expect(said(HELD)).toHaveTextContent(graceBack);

    // Returning to the window hears what has changed since: Grace has let hers go.
    released = true;
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(said(HELD)).toBeNull());
    expect(said(READ_ONLY)).toHaveTextContent('You may read this component but not edit it.');
  });

  it("CNT-075 sets a component's text, read before it opens, with the editing surface's own typography", async () => {
    const user = userEvent.setup();
    const REFERENCE = 'kkkkkkkkkkkkkkkkkkkkkkkkkk';
    const fake = service(outline([{ ...reference(REFERENCE, 'latest') }]));
    const printer = {
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
    const fetching = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const path = new URL(request.url).pathname;
      if (path === `/v1/documents/${DOCUMENT}/texts`) {
        return json(200, {
          document: DOCUMENT,
          version: { id: 'dddddddd-0000-4000-8000-000000000001', number: '0.1' },
          occurrences: [
            {
              node: REFERENCE,
              version: 'vvvvvvvv-0000-4000-8000-000000000001',
              mayEdit: true,
              lock: null,
            },
          ],
          versions: [{ id: 'vvvvvvvv-0000-4000-8000-000000000001', content: printer }],
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
          content: printer,
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

    const text = await screen.findByRole('region', { name: "The document's text" });
    const read = (await within(text).findByText('Unbox the printer.')).closest(`.${TEXT_CLASS}`);
    expect(read).not.toBeNull();

    await user.click(within(text).getByText('Unbox the printer.'));
    const surface = await within(text).findByRole('textbox', {
      name: 'Content of Install the printer',
    });
    expect(surface).toHaveClass(TEXT_CLASS);

    // How text looks is the class's alone. Every rule in the editor's stylesheet or the editor's own
    // module that reaches the surface and not the class may set only what editing needs - where the
    // caret stands, what is selected, a placeholder's word - and no typography, so the read text and
    // the surface cannot differ in how either is set.
    const sheet = (path: string) =>
      readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const TYPOGRAPHY =
      /^(font|line-height|white-space|letter-spacing|word-spacing|text-|margin|padding|border|list-style|quotes|counter|background|color|width|height|tab-size|hyphens|direction)/;
    const surfaceTypography = [
      sheet('../../../../packages/editor/style.css'),
      sheet('../editor/ComponentEditor.module.css'),
    ].flatMap((css) =>
      [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].flatMap(([, selectors, body]) => {
        const surface = selectors!
          .split(',')
          .map((selector) => selector.trim())
          .filter((selector) => /\.ProseMirror(?![-\w])/.test(selector));
        // A placeholder's word and how it looks are the editing surface's own, as a caret is.
        const placeholder = surface.every((selector) => selector.endsWith('.aw-empty::before'));
        const declared = body!
          .split(';')
          .map((declaration) => declaration.split(':')[0]!.trim())
          .filter((property) => property !== '' && TYPOGRAPHY.test(property));
        return surface.length > 0 && !placeholder && declared.length > 0
          ? [`${surface.join(', ')}: ${declared.join(', ')}`]
          : [];
      }),
    );
    expect(surfaceTypography).toEqual([]);

    // And the class carries it: spaces kept as typed, no ligatures, the body's size and leading.
    const own =
      /\.aw-text\s*\{([^}]*)\}/.exec(sheet('../../../../packages/editor/style.css'))?.[1] ?? '';
    for (const declaration of [
      'white-space: break-spaces',
      'font-variant-ligatures: none',
      "font-feature-settings: 'liga' 0",
      'font-size: var(--size-14)',
      'line-height: 1.6',
    ]) {
      expect(own, declaration).toContain(declaration);
    }
  });

  it("puts the outline, the document's text and the chosen part's details in three columns", async () => {
    const user = userEvent.setup();
    const fake = service(outline([section(INTRODUCTION, 'Introduction')]));
    open(fake.fetch);
    const tree = await screen.findByRole('tree', { name: 'Outline' });
    await user.click(screen.getByRole('treeitem', { name: 'Introduction' }));

    const part = (element: HTMLElement) =>
      element.closest('[data-part]')?.getAttribute('data-part');
    expect(part(tree)).toBe('outline');
    expect(part(screen.getByRole('button', { name: 'Copy link' }))).toBe('details');
    const text = screen.getByRole('region', { name: "The document's text" });
    expect(within(text).getByRole('heading', { name: /Introduction/ })).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Resize the outline' })).toBeInTheDocument();
  });

  it('puts the outline in a tabbed panel: back, Contents and the toggle, then the document as its root', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction', [reference(SCOPE, 'latest')])]),
    );
    open(fake.fetch);
    const tree = await screen.findByRole('tree', { name: 'Outline' });

    const tabs = screen.getByRole('tablist', { name: 'Outline pane' });
    const contents = within(tabs).getByRole('tab', { name: 'Contents' });
    expect(contents).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel', { name: 'Contents' });
    expect(panel).toContainElement(tree);
    expect(
      within(tabs.parentElement!).getByRole('link', { name: 'Back to documents' }),
    ).toHaveAttribute('href', '#/documents');
    expect(
      within(tabs.parentElement!).getByRole('button', { name: 'Hide the outline pane' }),
    ).toBeInTheDocument();

    // The document is the tree's root row: its title, the page's heading, and its version number.
    const title = screen.getByRole('heading', { level: 2, name: 'The dosing report' });
    expect(panel).toContainElement(title);
    expect(within(panel).getByText('0.1')).toBeInTheDocument();

    // The acts are icons, each still named in words, which a pointer's tooltip shows.
    const toolbar = within(panel).getByRole('toolbar', { name: 'Outline' });
    for (const name of ['Add section', 'Add component', 'Undo']) {
      const button = within(toolbar).getByRole('button', { name });
      expect(button).toHaveAttribute('title', name);
      expect(button.querySelector('[data-icon]')).toHaveAttribute('aria-hidden', 'true');
    }
    // And they are one tab stop, the arrows moving along them, as every toolbar is (LG5).
    expect(
      within(toolbar)
        .getAllByRole('button')
        .filter((button) => button.tabIndex === 0),
    ).toHaveLength(1);

    // Each row is drawn with its glyph and indented by its depth, not by nested list padding.
    const row = (name: string) =>
      screen.getByRole('treeitem', { name }).querySelector<HTMLElement>('[data-row]')!;
    expect(row('Introduction').querySelector('[data-icon]')).toHaveAttribute(
      'data-icon',
      'Section',
    );
    expect(row('Introduction').style.paddingInlineStart).toBe('8px');
    const scope = screen.getAllByRole('treeitem')[1]!.querySelector<HTMLElement>('[data-row]')!;
    expect(scope.querySelector('[data-icon]')).toHaveAttribute('data-icon', 'Document');
    expect(scope.style.paddingInlineStart).toBe('26px');
  });

  it('says its notices and what it holds in the status bar, and keeps the keys for a screen reader', async () => {
    const user = userEvent.setup();
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction', [reference(SCOPE, 'latest')])]),
    );
    open(fake.fetch);
    const tree = await screen.findByRole('tree');
    const bar = screen.getByRole('contentinfo');
    expect(within(bar).getByText('1 section, 1 component')).toBeInTheDocument();
    expect(within(bar).getByText('Version 0.1 in General')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);

    await user.click(within(tree).getByRole('treeitem', { name: 'Introduction' }));
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await within(bar).findByText('Copied the link to Introduction.')).toBeInTheDocument();

    // Not shown, but still what the tree is described by.
    const help = document.getElementById(tree.getAttribute('aria-describedby') ?? '')!;
    expect(help).toHaveTextContent(/Alt and the arrow keys/);
    expect(help.className).toMatch(/hidden/);
  });

  it('hides to a rail holding the toggle and the tab turned on its side', async () => {
    const user = userEvent.setup();
    const fake = service(outline([section(INTRODUCTION, 'Introduction')]));
    open(fake.fetch);
    await screen.findByRole('tree');
    await user.click(screen.getByRole('button', { name: 'Hide the outline pane' }));
    const show = screen.getByRole('button', { name: 'Show the outline pane' });
    expect(show.querySelector('[data-icon]')).toHaveAttribute('data-icon', 'Show pane');
    expect(show.closest('[data-rail]')).toHaveTextContent('Contents');
    await user.click(show);
    expect(screen.getByRole('tab', { name: 'Contents' })).toBeInTheDocument();
  });

  it('holds the panels beside the text in a pane of their own, hidden to a rail and remembered, as the outline is', async () => {
    const user = userEvent.setup();
    const fake = service(outline([section(INTRODUCTION, 'Introduction')]));
    open(fake.fetch);
    await screen.findByRole('tree');
    const pane = screen.getByRole('complementary', { name: 'Panels beside the text' });
    // The Part panel, which the outline draws, stands in the pane under its tab.
    expect(within(pane).getByRole('tablist', { name: 'Document panels' })).toBeInTheDocument();
    expect(within(pane).getByRole('tabpanel', { name: 'Part' })).toBeInTheDocument();
    await user.click(within(pane).getByRole('button', { name: 'Hide the document panels' }));
    expect(screen.queryByRole('tablist', { name: 'Document panels' })).toBeNull();
    const show = screen.getByRole('button', { name: 'Show the document panels' });
    // On the right, the rail's arrow points back into the page.
    expect(show.querySelector('[data-icon]')).toHaveAttribute('data-icon', 'Hide pane');
    expect(show.closest('[data-rail]')).toHaveTextContent('Part');
    expect(window.localStorage.getItem('aw.document.panels.collapsed')).toBe('true');
    await user.click(show);
    expect(screen.getByRole('tablist', { name: 'Document panels' })).toBeInTheDocument();
    expect(window.localStorage.getItem('aw.document.panels.collapsed')).toBe('false');
  });

  it("copies the chosen node's address, and says it did", async () => {
    const user = userEvent.setup();
    const fake = service(outline([section(INTRODUCTION, 'Introduction')]));
    open(fake.fetch);
    await user.click(await screen.findByRole('treeitem', { name: 'Introduction' }));
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByText('Copied the link to Introduction.')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(
      `${window.location.origin}${window.location.pathname}#/documents/${DOCUMENT}/nodes/${INTRODUCTION}`,
    );
  });
});

describe('the lists of figures, tables and equations', () => {
  beforeEach(() => window.localStorage.setItem(DOCK_KEY, 'lists'));
  afterEach(() => window.history.replaceState(null, '', '#'));

  it('lists what each occurrence holds, numbered in the page, and renumbers a move without asking for a number', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction', [referenceTo(RESULTS, PRINTER)]),
        section(METHOD, 'Method', [referenceTo(AGAIN, PRINTER)]),
      ]),
      { holds: { [PRINTER]: [tray, parts, sum, aside] } },
    );
    open(fake.fetch);
    await screen.findByRole('region', { name: 'Figures' });
    const at = (node: string) => `#/documents/${DOCUMENT}/nodes/${node}`;
    expect(listed('Figures')).toEqual([
      ['Figure 1.1 The paper tray', at(RESULTS)],
      ['Figure 2.1 The paper tray', at(AGAIN)],
    ]);
    expect(listed('Tables')).toEqual([
      ['Table 1.1 Parts', at(RESULTS)],
      ['Table 2.1 Parts', at(AGAIN)],
    ]);
    // An unnumbered equation takes no number, so it is no entry.
    expect(listed('Equations')).toEqual([
      ['Equation 1', at(RESULTS)],
      ['Equation 2', at(AGAIN)],
    ]);

    // The version the move makes is asked about again; that answer is held, so what renumbers the
    // lists is the page, from the answer it already has - at once, not when the next one lands.
    const release = fake.holdContributions();
    await userEvent.click(item('Method'));
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await waitFor(() => expect(item('Method')).toHaveAccessibleDescription('1'));
    await waitFor(() =>
      expect(fake.sent.filter((request) => request.url.endsWith('/contributions'))).toHaveLength(2),
    );
    expect(fake.contributionsAnswered()).toBe(1);
    expect(listed('Figures')).toEqual([
      ['Figure 1.1 The paper tray', at(AGAIN)],
      ['Figure 2.1 The paper tray', at(RESULTS)],
    ]);
    release();
    await waitFor(() => expect(fake.contributionsAnswered()).toBe(2));
    await settled();
    expect(listed('Figures')).toEqual([
      ['Figure 1.1 The paper tray', at(AGAIN)],
      ['Figure 2.1 The paper tray', at(RESULTS)],
    ]);
    expect(fake.sent.some((request) => request.url.endsWith('/numbering'))).toBe(false);
  });

  it('IAM-073 shows a reader no number a component they may not read could have moved, and nothing it holds', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction', [
          referenceTo(RESULTS, PRINTER),
          referenceTo(HIDDEN, SECRET),
          referenceTo(AGAIN, PRINTER),
        ]),
        section(METHOD, 'Method', [referenceTo(SCOPE, PRINTER)]),
      ]),
      {
        mayRead: (component) => component !== SECRET,
        holds: {
          [PRINTER]: [tray, sum],
          [SECRET]: [{ block: 's1', sequence: 'figure', numbered: true, caption: 'The bench' }],
        },
      },
    );
    open(fake.fetch);
    await screen.findByRole('region', { name: 'Figures' });
    // The figure after the component they may not read has no number, and the next chapter's, which
    // restarts, has its own; nothing of what the unreadable component holds is shown at all.
    expect(listed('Figures').map(([text]) => text)).toEqual([
      'Figure 1.1 The paper tray',
      'Figure The paper tray',
      'Figure 2.1 The paper tray',
    ]);
    // Equations never restart in the default scheme, so every one after it is withheld, the next
    // chapter's too: withheld until the counter restarts, not only once.
    expect(listed('Equations').map(([text]) => text)).toEqual([
      'Equation 1',
      'Equation',
      'Equation',
    ]);
    expect(screen.queryByText(/The bench/)).toBeNull();
    expect(document.body.textContent).not.toContain('Figure 1.2');
    expect(document.body.textContent).not.toContain('Equation 2');
    expect(document.body.textContent).not.toContain('Equation 3');
  });

  it('STR-037 reorders the outline from the contents, by key and by pointer, and every number follows at once', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction', [referenceTo(RESULTS, PRINTER)]),
        section(METHOD, 'Method', [referenceTo(AGAIN, PRINTER)]),
        section(SCOPE, 'Scope'),
      ]),
      { holds: { [PRINTER]: [tray] } },
    );
    open(fake.fetch);
    await screen.findByRole('region', { name: 'Figures' });
    const figures = () => listed('Figures').map(([text, href]) => [text, href?.slice(-26)]);

    // By key: Method goes up, taking its component with it.
    await userEvent.click(item('Method'));
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await waitFor(() => expect(item('Method')).toHaveAccessibleDescription('1'));
    expect(item('Introduction')).toHaveAccessibleDescription('2');
    expect(figures()).toEqual([
      ['Figure 1.1 The paper tray', AGAIN],
      ['Figure 2.1 The paper tray', RESULTS],
    ]);
    await settled();

    // By pointer: Method dropped at the end of the document.
    fireEvent.dragStart(item('Method'));
    const end = await screen.findByText('Move to the end of the document');
    fireEvent.dragOver(end);
    fireEvent.drop(end);
    await waitFor(() => expect(item('Method')).toHaveAccessibleDescription('3'));
    expect(item('Introduction')).toHaveAccessibleDescription('1');
    expect(item('Scope')).toHaveAccessibleDescription('2');
    expect(figures()).toEqual([
      ['Figure 1.1 The paper tray', RESULTS],
      ['Figure 3.1 The paper tray', AGAIN],
    ]);
    expect(
      fake.edits().map((request) => (request.body as { operation: unknown }).operation),
    ).toEqual([
      { operation: 'move', node: METHOD, parent: null, position: 0 },
      { operation: 'move', node: METHOD, parent: null, position: 2 },
    ]);
  });

  it('asks for the contributions again whenever the version it holds changes, and numbers what somebody else added', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction', [referenceTo(RESULTS, PRINTER)]),
        section(METHOD, 'Method'),
      ]),
      { holds: { [PRINTER]: [tray] } },
    );
    const asked = () =>
      fake.sent.filter((request) => request.url.endsWith('/contributions')).length;
    open(fake.fetch);
    await screen.findByRole('region', { name: 'Figures' });
    expect(asked()).toBe(1);

    // Ada's own act is a new version: asked again.
    await userEvent.click(item('Method'));
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await waitFor(() => expect(asked()).toBe(2));
    await settled();

    // Grace places the component under Method; Ada's next act is refused and carries Grace's
    // version, which is asked about too, so the occurrence Grace added is listed and numbered.
    fake.theirs({
      operation: 'insert',
      parent: METHOD,
      position: 0,
      node: { type: 'reference', component: PRINTER, mode: { kind: 'latest' } },
    });
    await userEvent.click(item('Method'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(SOMEBODY_ELSE));
    const added = fake.latest().outline.nodes[0]?.children[0]?.id;
    expect(added).toBeDefined();
    await waitFor(() =>
      expect(listed('Figures')).toEqual([
        ['Figure 1.1 The paper tray', `#/documents/${DOCUMENT}/nodes/${added}`],
        ['Figure 2.1 The paper tray', `#/documents/${DOCUMENT}/nodes/${RESULTS}`],
      ]),
    );
    expect(asked()).toBe(3);
  });

  it('never numbers with an answer for a version the page no longer holds', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction', [referenceTo(RESULTS, PRINTER)]),
        section(METHOD, 'Method'),
      ]),
      { holds: { [PRINTER]: [tray] } },
    );
    // The first answer - for the version the page opens at - is held until after the next one.
    const release = fake.holdContributions();
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    expect(screen.getByText('Reading the figures, tables and equations...')).toBeInTheDocument();

    // Grace places the component under Method; Ada's act is refused and carries Grace's version,
    // whose answer arrives while the first is still held.
    fake.theirs({
      operation: 'insert',
      parent: METHOD,
      position: 0,
      node: { type: 'reference', component: PRINTER, mode: { kind: 'latest' } },
    });
    await userEvent.click(item('Method'));
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(SOMEBODY_ELSE));
    await screen.findByRole('region', { name: 'Figures' });
    const added = fake.latest().outline.nodes[1]?.children[0]?.id;
    expect(added).toBeDefined();
    const expected = [
      ['Figure 1.1 The paper tray', `#/documents/${DOCUMENT}/nodes/${RESULTS}`],
      ['Figure 2.1 The paper tray', `#/documents/${DOCUMENT}/nodes/${added}`],
    ];
    await waitFor(() => expect(listed('Figures')).toEqual(expected));
    expect(fake.contributionsAnswered()).toBe(1);

    // The first answer lands last, knowing nothing of Grace's occurrence: it is not used.
    release();
    // Once its body has been read, the page has had the stale answer in hand.
    await waitFor(() => expect(fake.contributionsRead()).toBe(2));
    expect(listed('Figures')).toEqual(expected);
  });

  it('says a document holds no figures, tables or equations, and says so when they could not be read', async () => {
    const contributions = `/v1/documents/${DOCUMENT}/contributions`;
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    fake.refuse(contributions, 500);
    open(fake.fetch);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(
      screen.getByText('The figures, tables and equations could not be read.'),
    ).toBeInTheDocument();

    // The outline works all the same: an act lands and the section numbers move.
    await userEvent.click(item('Method'));
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await waitFor(() => expect(item('Method')).toHaveAccessibleDescription('1'));
    expect(item('Introduction')).toHaveAccessibleDescription('2');
    expect(fake.edits()).toHaveLength(1);
    await settled();
    // The act's version is asked about too, and refused the same way: Try again still stands.
    await waitFor(() =>
      expect(fake.sent.filter((request) => request.url === contributions)).toHaveLength(2),
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();

    fake.restore(contributions);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByText('This document has no figures, tables or equations.'),
    ).toBeInTheDocument();
  });
});

describe("the layout's scheme in the page", () => {
  beforeEach(() => window.localStorage.setItem(DOCK_KEY, 'lists'));
  afterEach(() => window.history.replaceState(null, '', '#'));

  it('STR-036 numbers the outline with the scheme of the layout the document is published under', async () => {
    const sections = outline([
      section(INTRODUCTION, 'Introduction', [section(SCOPE, 'Scope')]),
      section(METHOD, 'Method'),
    ]);
    const fake = service(sections, { layout: layoutView(upperRomanLayout.scheme, LAYOUT_V2) });
    const { unmount } = open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Scope' });
    expect(item('Introduction')).toHaveAccessibleDescription('I');
    expect(item('Method')).toHaveAccessibleDescription('II');
    expect(item('Scope')).toHaveAccessibleDescription('I.1');
    // Never the product's default scheme, which numbers this same outline 1, 1.1 and 2.
    for (const shown of ['1', '1.1', '2']) expect(screen.queryByText(shown)).toBeNull();

    // And these are the numbers a publish made under that layout prints: `assemble` is the one
    // function the job composes with, and over the same outline and the same layout it gives every
    // node the number the panel has just shown - so the author is never guessing what a section
    // will be called. Under the product's default theme, which every request is made under until a
    // template binds another.
    const theme = readTheme(DEFAULT_THEME, DEFAULT_CATALOGUES_BY_VERSION);
    if (!theme.ok) throw new Error(theme.refusals.map((each) => each.code).join(', '));
    const published = assemble({
      formats: ['pdf'],
      outline: sections,
      occurrences: new Map(),
      refused: [],
      layout: upperRomanLayout,
      theme: theme.theme,
      revision: '0.1',
      covers: () => true,
      assets: new Map(),
    });
    const printed = new Map<string, string | null>();
    const walk = (nodes: readonly PublishedNode[]) => {
      for (const node of nodes) {
        printed.set(node.id, node.number);
        walk(node.children);
      }
    };
    if (!published.ok) throw new Error(published.failures.map((each) => each.code).join(', '));
    walk(published.document.nodes);
    expect([...printed]).toEqual([
      [INTRODUCTION, 'I'],
      [SCOPE, 'I.1'],
      [METHOD, 'II'],
    ]);
    unmount();

    // The generated lists take their words and their numbers from that same scheme.
    const withFigures = service(
      outline([section(METHOD, 'Method', [referenceTo(RESULTS, PRINTER)])]),
      { layout: layoutView(upperRomanLayout.scheme, LAYOUT_V2), holds: { [PRINTER]: [tray] } },
    );
    open(withFigures.fetch);
    await screen.findByRole('region', { name: 'Figures' });
    expect(listed('Figures')).toEqual([
      ['Fig. I.1 The paper tray', `#/documents/${DOCUMENT}/nodes/${RESULTS}`],
    ]);
  });

  it('numbers nothing, and says so, when the scheme it would number with does not read', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction', [referenceTo(RESULTS, PRINTER)]),
        section(METHOD, 'Method'),
      ]),
      { layout: layoutView({ id: 'broken/1', sequences: {} }), holds: { [PRINTER]: [tray] } },
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    expect(
      await screen.findByText("This document's numbering could not be read."),
    ).toBeInTheDocument();
    // No number the author could take for a publication's, and no list, rather than a fallback
    // scheme printing numbers no publish under this layout could produce.
    expect(item('Introduction')).not.toHaveAccessibleDescription();
    expect(item('Method')).not.toHaveAccessibleDescription();
    expect(screen.queryByRole('region', { name: 'Figures' })).toBeNull();
    // The outline is still the author's to restructure.
    expect(screen.getByRole('button', { name: 'Add section' })).toBeInTheDocument();
  });
});

describe('the document page as the Ledger draws it (LG6c)', () => {
  it('heads the page with a trail back to the documents, and the mode switch beside Preview', async () => {
    const fake = service(outline([section(METHOD, 'Method')]), { mayPublish: true });
    render(<DocumentPage client={client(fake.fetch)} id={DOCUMENT} followMs={0} />);
    await screen.findByRole('treeitem', { name: 'Method' });

    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByRole('link', { name: 'Documents' })).toHaveAttribute(
      'href',
      '#/documents',
    );
    const mode = screen.getByRole('radiogroup', { name: 'Mode' });
    expect(mode.parentElement).toContainElement(screen.getByRole('button', { name: 'Preview' }));
  });

  it('sets the panels beside the text, named in words: the part, the lists and publishing', async () => {
    const fake = service(outline([section(METHOD, 'Method')]), { mayPublish: true });
    render(<DocumentPage client={client(fake.fetch)} id={DOCUMENT} followMs={0} />);
    await screen.findByRole('treeitem', { name: 'Method' });

    const tabs = screen.getByRole('tablist', { name: 'Document panels' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Part', 'Lists', 'Publishing']);
    expect(within(tabs).getByRole('tab', { name: 'Part' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tabpanel', { name: 'Part' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish as PDF' })).toBeNull();

    await userEvent.click(within(tabs).getByRole('tab', { name: 'Publishing' }));
    const publishing = screen.getByRole('tabpanel', { name: 'Publishing' });
    expect(within(publishing).getByRole('button', { name: 'Publish as PDF' })).toBeInTheDocument();
    await userEvent.click(within(tabs).getByRole('tab', { name: 'Lists' }));
    expect(screen.getByRole('tabpanel', { name: 'Lists' })).toHaveTextContent(
      'This document has no figures, tables or equations.',
    );
  });
});

describe('publishing from the document page', () => {
  beforeEach(() => window.localStorage.setItem(DOCK_KEY, 'publishing'));
  it('names a refused place by where it is in the outline, and nothing of a component the author may not read', async () => {
    const GONE = 'gggggggggggggggggggggggggg';
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction', [reference(RESULTS, 'latest')]),
        section(METHOD, 'Method'),
      ]),
      {
        mayPublish: true,
        mayRead: () => false,
        publishFailures: [
          {
            stage: 'resolve',
            code: 'occurrence_unreadable',
            node: RESULTS,
            block: null,
            detail: null,
          },
          { stage: 'compose', code: 'style_missing', node: METHOD, block: 'b1', detail: 'note' },
          { stage: 'compose', code: 'style_missing', node: GONE, block: 'b1', detail: 'note' },
        ],
      },
    );
    // Asked about at once, where the application waits a second.
    render(
      <StrictMode>
        <DocumentPage client={client(fake.fetch)} id={DOCUMENT} followMs={0} />
      </StrictMode>,
    );
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(screen.getByRole('button', { name: 'Publish as PDF' }));

    const why = await screen.findByRole('list', { name: 'Why it could not be published' });
    const said = [...why.querySelectorAll('li')].map((each) => each.textContent);
    expect(said).toEqual([
      '1.1 A component: A component you may not read is placed here. Only someone who may read every component can publish this document.',
      "2 Method: This paragraph, table or figure uses the style note, which the publication's theme does not have.",
      "A part no longer in this document: This paragraph, table or figure uses the style note, which the publication's theme does not have.",
    ]);
    expect(why).not.toHaveTextContent('Install the printer');
    expect(why).not.toHaveTextContent(PRINTER);
    expect(fake.sent.find((each) => each.url.endsWith('/publications') && each.body)?.body).toEqual(
      { version: 'dddddddd-0000-4000-8000-000000000001', formats: ['pdf'] },
    );
  });

  it('offers Word beside the PDF where the layout the document would publish under makes it, and the PDF alone where not', async () => {
    const shown = (layout: unknown) => {
      const fake = service(outline([section(METHOD, 'Method')]), { mayPublish: true, layout });
      return render(
        <StrictMode>
          <DocumentPage client={client(fake.fetch)} id={DOCUMENT} followMs={0} />
        </StrictMode>,
      );
    };
    const word = shown({ ...layoutView(defaultLayout.scheme), formats: ['pdf', 'docx'] });
    await screen.findByRole('treeitem', { name: 'Method' });
    const choice = screen.getByRole('radiogroup', { name: 'Publish as' });
    expect(within(choice).getByRole('radio', { name: 'PDF' })).toBeChecked();
    expect(within(choice).getByRole('radio', { name: 'Word' })).not.toBeChecked();
    word.unmount();

    shown({ ...layoutView(defaultLayout.scheme), formats: ['pdf'] });
    await screen.findByRole('treeitem', { name: 'Method' });
    expect(screen.getByRole('button', { name: 'Publish as PDF' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Publish as' })).toBeNull();
  });
});

describe('a preview beside the text (W10.3)', () => {
  const REFERENCE = 'kkkkkkkkkkkkkkkkkkkkkkkkkk';
  const printer = {
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
  afterEach(() => {
    try {
      window.localStorage.removeItem('alloy-works.mode');
    } catch {
      // Storage refused: nothing was kept.
    }
  });
  /**
   * The harness's service, with the text of the one component the document places, which the reader
   * may or may not edit, and the component itself as its editor reads it, read only there.
   */
  function withText(fake: ReturnType<typeof service>, mayEdit: boolean) {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const path = new URL(request.url).pathname;
      if (path === `/v1/documents/${DOCUMENT}/texts`) {
        return json(200, {
          document: DOCUMENT,
          version: { id: 'dddddddd-0000-4000-8000-000000000001', number: '0.1' },
          occurrences: [
            {
              node: REFERENCE,
              version: 'vvvvvvvv-0000-4000-8000-000000000001',
              mayEdit,
              lock: null,
            },
          ],
          versions: [{ id: 'vvvvvvvv-0000-4000-8000-000000000001', content: printer }],
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
          content: printer,
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
  }
  // By a name in a variable: Vite rewrites a literal one into the stylesheet's served address.
  const STYLESHEET = './DocumentPage.module.css';
  /** The declarations of the page's rule for exactly this selector, outside any media query. */
  const ruleOf = (selector: string) => {
    const sheet = readFileSync(new URL(STYLESHEET, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('@media')[0]!;
    const found = [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((match) =>
      match[1]!.split(',').some((each) => each.trim() === selector),
    );
    return found?.[2] ?? null;
  };

  it('CNT-150 previews the document from its page in a pane beside the text, the editor open in place kept where it was with its text', async () => {
    const user = userEvent.setup();
    const fake = service(outline([reference(REFERENCE, 'latest')]));
    render(
      <StrictMode>
        <DocumentPage
          client={client(withText(fake, true))}
          id={DOCUMENT}
          principalId={ADA}
          followMs={0}
        />
      </StrictMode>,
    );
    const text = await screen.findByRole('region', { name: "The document's text" });
    await user.click(await within(text).findByText('Unbox the printer.'));
    const editor = await within(text).findByRole('textbox', {
      name: 'Content of Install the printer',
    });
    await waitFor(() => expect(editor).toHaveTextContent('Unbox the printer.'));

    await user.click(screen.getByRole('button', { name: 'Preview' }));
    const pane = await screen.findByRole('region', { name: 'Preview' });
    // The PDF in the browser's own viewer, named for the document.
    expect(within(pane).getByTitle('Preview of The dosing report')).toHaveAttribute(
      'src',
      previewLinks.view,
    );
    // Of the version the page holds.
    expect(fake.sent.find((each) => each.url.endsWith('/previews'))?.body).toEqual({
      version: 'dddddddd-0000-4000-8000-000000000001',
    });
    // Beside the text, in the grid the text is in, in a column of its own after it: the text narrows.
    const layout = text.closest('[data-previewing]');
    expect(layout).toHaveAttribute('data-previewing', 'true');
    // A column of the grid's own, never inside another: jsdom lays nothing out, so where the columns
    // fall is read from the stylesheet's own rules.
    expect(pane.parentElement).toBe(layout);
    expect(ruleOf(".layout[data-previewing='true']")).toMatch(
      /grid-template-columns:[^;]*minmax\(0, 1fr\)\s+minmax\(0, 1fr\)\s+var\(--dock-edge\)\s+var\(--right\)/,
    );
    expect(ruleOf('.text')).toMatch(/grid-column: 3;/);
    expect(ruleOf('.preview')).toMatch(/grid-column: 4;/);
    // Without leaving the editor: the same editor, open where it was, holding its text.
    expect(within(text).getByRole('textbox', { name: 'Content of Install the printer' })).toBe(
      editor,
    );
    expect(editor).toHaveTextContent('Unbox the printer.');
    expect(screen.getByRole('article', { name: /in Authoring$/ })).toBeInTheDocument();
  });

  it('offers Preview in Reading to a reader who may not publish, where Publish is not offered', async () => {
    const fake = service(outline([reference(REFERENCE, 'latest')]), {
      mayEdit: false,
      mayPublish: false,
    });
    render(
      <StrictMode>
        <DocumentPage
          client={client(withText(fake, false))}
          id={DOCUMENT}
          principalId={ADA}
          followMs={0}
        />
      </StrictMode>,
    );
    const text = await screen.findByRole('region', { name: "The document's text" });
    await within(text).findByText('Unbox the printer.');
    expect(screen.getByRole('article', { name: /in Reading$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Publish as/ })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const pane = await screen.findByRole('region', { name: 'Preview' });
    expect(within(pane).getByTitle('Preview of The dosing report')).toHaveAttribute(
      'src',
      previewLinks.view,
    );
  });
});

describe('a cross-reference in the document page (cross-references 1)', () => {
  afterEach(() => window.history.replaceState(null, '', '#'));

  /** The printer's text: a paragraph referring to its own table, and the table. */
  const referring = {
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
          { type: 'text', value: 'Unbox the printer, as ', marks: [] },
          {
            type: 'crossReference',
            id: 'x1',
            target: { kind: 'block', block: 't1' },
            display: 'number',
          },
          { type: 'text', value: ' lists.', marks: [] },
        ],
      },
      {
        type: 'table',
        id: 't1',
        style: 'table',
        caption: [{ type: 'text', value: 'Parts', marks: [] }],
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
                    content: [{ type: 'text', value: 'Tray', marks: [] }],
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

  it("shows a reference's label in the text, and in the editor opened in place", async () => {
    const user = userEvent.setup();
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction', [referenceTo(RESULTS, PRINTER)])]),
      { holds: { [PRINTER]: [parts] } },
    );
    const fetching = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const path = new URL(request.url).pathname;
      if (path === `/v1/documents/${DOCUMENT}/texts`) {
        return json(200, {
          document: DOCUMENT,
          version: { id: 'dddddddd-0000-4000-8000-000000000001', number: '0.1' },
          occurrences: [
            {
              node: RESULTS,
              version: 'vvvvvvvv-0000-4000-8000-000000000001',
              mayEdit: true,
              lock: null,
            },
          ],
          versions: [{ id: 'vvvvvvvv-0000-4000-8000-000000000001', content: referring }],
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
          content: referring,
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

    const text = await screen.findByRole('region', { name: "The document's text" });
    await within(text).findByText(/Unbox the printer/);
    // Numbered by the page once it has heard what the occurrence holds.
    await waitFor(() =>
      expect(
        [...text.querySelectorAll('[data-reference]')].map((each) => each.textContent),
      ).toEqual(['Table 1.1']),
    );

    await user.click(within(text).getByText(/Unbox the printer/));
    const surface = await within(text).findByRole('textbox', {
      name: 'Content of Install the printer',
    });
    await waitFor(() =>
      expect(
        [...surface.querySelectorAll('[data-reference]')].map((each) => each.textContent),
      ).toEqual(['Table 1.1']),
    );
  });

  it("shows the layout's own words for above and below, in the page's text and in the editor opened in place (cross-references 2, ruling R9)", async () => {
    const user = userEvent.setup();
    /** The printer's text: a paragraph referring to its own table as above or below it. */
    const relative = {
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
            { type: 'text', value: 'See ', marks: [] },
            {
              type: 'crossReference',
              id: 'x1',
              target: { kind: 'block', block: 't1' },
              display: 'relative',
            },
            { type: 'text', value: '.', marks: [] },
          ],
        },
        {
          type: 'table',
          id: 't1',
          style: 'table',
          caption: [{ type: 'text', value: 'Parts', marks: [] }],
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
                      content: [{ type: 'text', value: 'Tray', marks: [] }],
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
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction', [referenceTo(RESULTS, PRINTER)])]),
      {
        holds: { [PRINTER]: [parts] },
        layout: layoutView(defaultLayout.scheme, LAYOUT_V1, {
          ...defaultLayout.words,
          above: 'plus haut',
          below: 'plus bas',
        }),
      },
    );
    const fetching = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const path = new URL(request.url).pathname;
      if (path === `/v1/documents/${DOCUMENT}/texts`) {
        return json(200, {
          document: DOCUMENT,
          version: { id: 'dddddddd-0000-4000-8000-000000000001', number: '0.1' },
          occurrences: [
            {
              node: RESULTS,
              version: 'vvvvvvvv-0000-4000-8000-000000000001',
              mayEdit: true,
              lock: null,
            },
          ],
          versions: [{ id: 'vvvvvvvv-0000-4000-8000-000000000001', content: relative }],
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
          content: relative,
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

    const text = await screen.findByRole('region', { name: "The document's text" });
    await within(text).findByText(/See/);
    // The table stands after the paragraph in the component's own order.
    await waitFor(() =>
      expect(
        [...text.querySelectorAll('[data-reference]')].map((each) => each.textContent),
      ).toEqual(['plus bas']),
    );

    await user.click(within(text).getByText(/See/));
    const surface = await within(text).findByRole('textbox', {
      name: 'Content of Install the printer',
    });
    await waitFor(() =>
      expect(
        [...surface.querySelectorAll('[data-reference]')].map((each) => each.textContent),
      ).toEqual(['plus bas']),
    );
  });
});
