import { createApiClient } from '@alloy-works/api-client';
import {
  applyOutlineOperation,
  assemble,
  canonicaliseOutline,
  defaultLayout,
  OUTLINE_SCHEMA_VERSION,
  outlineOperationSchema,
  parseLayout,
  withholdComponents,
  type Layout,
  type OutlineDocument,
  type OutlineNode,
  type OutlineOperation,
  type PublishedNode,
} from '@alloy-works/domain';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useLayoutEffect, useRef, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DocumentList } from './DocumentList.js';
import { DocumentPage } from './DocumentPage.js';
import { documentAddress } from './links.js';
import { NewDocument } from './NewDocument.js';
import { OutlinePanel } from './OutlinePanel.js';

const DOCUMENT = 'eeeeeeee-0000-4000-8000-000000000001';
const SPACE = 'aaaaaaaa-0000-4000-8000-000000000001';
const ADA = 'ffffffff-0000-4000-8000-000000000001';
const PRINTER = 'cccccccc-0000-4000-8000-000000000001';
const INTRODUCTION = 'iiiiiiiiiiiiiiiiiiiiiiiiii';
const SCOPE = 'ssssssssssssssssssssssssss';
const METHOD = 'mmmmmmmmmmmmmmmmmmmmmmmmmm';
const RESULTS = 'rrrrrrrrrrrrrrrrrrrrrrrrrr';
const PREFACE = 'pppppppppppppppppppppppppp';

const LAYOUT = 'llllllll-0000-4000-8000-000000000001';
const LAYOUT_V1 = { id: 'llllllll-0000-4000-8000-000000000002', number: '0.1' };
const LAYOUT_V2 = { id: 'llllllll-0000-4000-8000-000000000003', number: '0.2' };

/**
 * The environment's layout as `DocumentView` carries it (publishing.md, "The layout"): its id, the
 * version read, the language its generated words are in, and that version's numbering scheme.
 */
const layoutView = (scheme: unknown, version = LAYOUT_V1) => ({
  id: LAYOUT,
  version,
  language: defaultLayout.language,
  scheme,
});

/**
 * A second version of the environment's layout, numbering the body's sections in upper roman and
 * calling a figure `Fig.` - what task 9's numbering test records against the database, and what this
 * suite's service answers instead. Its scheme is named apart from the default's, because STR-031 keys
 * a numbering by that id.
 */
const upperRomanLayout: Layout = (() => {
  const sequences = defaultLayout.scheme.sequences;
  const section = sequences['section']!;
  const figure = sequences['figure']!;
  return parseLayout({
    ...defaultLayout,
    scheme: {
      id: 'upper-roman/1',
      sequences: {
        ...sequences,
        section: { ...section, body: { ...section.body, format: ['upperRoman', 'decimal'] } },
        figure: { ...figure, body: { ...figure.body, label: 'Fig.' } },
      },
    },
  });
})();

const SPACES = {
  items: [
    { id: SPACE, name: 'General', mayCreate: true },
    { id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Quality', mayCreate: false },
    { id: 'aaaaaaaa-0000-4000-8000-000000000003', name: 'Regulatory', mayCreate: true },
  ],
};

const COMPONENTS = {
  items: [
    {
      id: PRINTER,
      title: 'Install the printer',
      space: { id: SPACE, name: 'General' },
      version: '0.3',
    },
  ],
  next: null,
};

function section(id: string, title: string, children: OutlineNode[] = []): OutlineNode {
  return {
    type: 'section',
    id,
    title: [{ type: 'text', value: title, marks: [] }],
    numbered: true,
    matter: 'body',
    pageBreak: 'none',
    values: {},
    children,
  };
}

function reference(id: string, mode: 'latest' | 'approved'): OutlineNode {
  return {
    type: 'reference',
    id,
    component: PRINTER,
    mode: { kind: mode },
    numbered: true,
    matter: 'body',
    pageBreak: 'none',
    values: {},
    children: [],
  };
}

function outline(nodes: OutlineNode[]): OutlineDocument {
  return {
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'The dosing report',
    language: 'en-GB',
    direction: 'ltr',
    nodes,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

const PUBLISH_REQUEST = '99999999-0000-4000-8000-000000000001';
/** A publish asked for from the page, as `GET /v1/publication-requests/{id}` answers it once failed. */
const publishRequest = {
  id: PUBLISH_REQUEST,
  document: DOCUMENT,
  state: 'failed',
  failures: [],
  publication: null,
};

/**
 * The service, as a model rather than a table of canned answers (pre-flight S23): it keeps the
 * document's version chain and applies each operation with the domain's own `applyOutlineOperation`,
 * after parsing the body with the route's own schema - so a body the renderer sends that the route
 * would refuse is refused here too, and the position convention the panel uses is the one the service
 * applies. It answers the way `apps/service/src/documents.ts` does: a stale `openedFrom` is `409
 * version_precondition` carrying the document as it now stands, an act that changes nothing is `200`
 * at the same version (decision K), and one refused against the latest is `400 outline_invalid`.
 * `theirs` records a version as somebody else, and `refuse` answers a path with a bare status.
 *
 * Built on the house shape (`NewComponent.test.tsx`): `openapi-fetch` calls `fetch` with a `Request`.
 */
function service(
  start: OutlineDocument,
  options: {
    mayEdit?: boolean;
    mayPublish?: boolean;
    /** What a publish asked for from this page is answered with, once the job has run: it failed. */
    publishFailures?: unknown[];
    components?: unknown;
    /** Whether the caller may read a component: one they may not is withheld, as the service does. */
    mayRead?: (component: string) => boolean;
    /** The layout every answer carries; the environment's own, at its first version, by default. */
    layout?: unknown;
    /** What each component's head contributes, by component; nothing where it is not named. */
    holds?: Record<
      string,
      { block: string; sequence: string; numbered: boolean; caption: string | null }[]
    >;
  } = {},
) {
  const sent: { url: string; body: unknown }[] = [];
  const refusals = new Map<
    string,
    { status: number; body?: unknown; once?: boolean } | 'network'
  >();
  // An outline request waits on this before it is answered, so a test can act while one is in flight.
  let gate: Promise<void> = Promise.resolve();
  // A bare status for the outline request that arrives n-th, counted from the first.
  const numbered = new Map<number, number>();
  let outlineRequests = 0;
  let unchangedNext = false;
  // The next contributions request, once held, waits on this; the answer is what stood when it arrived.
  let contributionsGate: Promise<void> | null = null;
  let contributionsAnswered = 0;
  // How many contributions answers the page has read the body of, counted once the body resolves.
  let contributionsRead = 0;
  const chain: { id: string; number: string; outline: OutlineDocument }[] = [
    { id: 'dddddddd-0000-4000-8000-000000000001', number: '0.1', outline: start },
  ];
  let allocated = 0;
  const newIdentifier = () => {
    allocated += 1;
    return `nnnnnnnnnnnnnnnnnnnnnnnn${BASE32[Math.floor(allocated / 32)]}${BASE32[allocated % 32]}`;
  };
  const latest = () => chain[chain.length - 1]!;
  const view = (version = latest()) => ({
    id: DOCUMENT,
    space: { id: SPACE, name: 'General' },
    version: {
      id: version.id,
      number: version.number,
      author: ADA,
      createdAt: '2026-09-18T09:00:00.000Z',
      note: null,
    },
    // As the service shows it: the stored outline, with what the caller may not read withheld.
    outline: withholdComponents(version.outline, options.mayRead ?? (() => true)),
    mayEdit: options.mayEdit ?? true,
    mayPublish: options.mayPublish ?? false,
    layout: options.layout ?? layoutView(defaultLayout.scheme),
  });
  const record = (next: OutlineDocument) => {
    const count = chain.length + 1;
    chain.push({
      id: `dddddddd-0000-4000-8000-${String(count).padStart(12, '0')}`,
      number: `0.${count}`,
      outline: next,
    });
  };

  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url).pathname;
    const body = request.method === 'GET' ? undefined : await request.clone().json();
    sent.push({ url, body });
    // An outline answer waits on the gate first, whatever it is going to be.
    if (url.endsWith('/outline')) {
      outlineRequests += 1;
      const arrived = outlineRequests;
      await gate;
      const status = numbered.get(arrived);
      if (status !== undefined)
        return json(status, { code: 'refused', message: 'No.', traceId: 't' });
    }
    const refused = refusals.get(url);
    if (refused === 'network') throw new TypeError('Failed to fetch');
    if (refused !== undefined) {
      if (refused.once) refusals.delete(url);
      return json(
        refused.status,
        refused.body ?? { code: 'refused', message: 'No.', traceId: 't' },
      );
    }
    if (url === '/v1/components') return json(200, options.components ?? COMPONENTS);
    if (url === `/v1/documents/${DOCUMENT}/publications`) {
      if (request.method === 'GET') return json(200, { items: [] });
      return json(200, { ...publishRequest, state: 'queued' });
    }
    if (url === `/v1/publication-requests/${PUBLISH_REQUEST}`) {
      return json(200, { ...publishRequest, failures: options.publishFailures ?? [] });
    }
    if (url === `/v1/documents/${DOCUMENT}`) return json(200, view());
    if (url === `/v1/documents/${DOCUMENT}/contributions`) {
      // As `getContributions` answers: every reference of the latest version, in outline order, and
      // a version the caller may read named once with what it holds - never one they may not.
      const occurrences: { node: string; version: string | null }[] = [];
      const versions = new Map<string, unknown>();
      const walk = (nodes: readonly OutlineNode[]) => {
        for (const node of nodes) {
          if (node.type === 'reference') {
            const readable = (options.mayRead ?? (() => true))(node.component);
            const version = readable ? `vvvvvvvv${node.component.slice(8)}` : null;
            occurrences.push({ node: node.id, version });
            if (version !== null) {
              versions.set(version, {
                id: version,
                contributions: options.holds?.[node.component] ?? [],
              });
            }
          }
          walk(node.children);
        }
      };
      walk(latest().outline.nodes);
      const answer = {
        document: DOCUMENT,
        version: { id: latest().id, number: latest().number },
        occurrences,
        versions: [...versions.values()],
      };
      const held = contributionsGate;
      contributionsGate = null;
      if (held !== null) await held;
      contributionsAnswered += 1;
      // The client reads a body without a length as text, so that is what is counted.
      const response = json(200, answer);
      const body = response.text.bind(response);
      response.text = async () => {
        const read = await body();
        contributionsRead += 1;
        return read;
      };
      return response;
    }
    if (url === `/v1/documents/${DOCUMENT}/outline`) {
      if (unchangedNext) {
        unchangedNext = false;
        return json(200, view());
      }
      const { openedFrom, operation } = body as { openedFrom: string; operation: unknown };
      const parsed = outlineOperationSchema.safeParse(operation);
      if (!parsed.success)
        return json(400, { code: 'invalid_request', message: 'x', traceId: 't' });
      if (openedFrom !== latest().id) {
        return json(409, {
          code: 'version_precondition',
          message: 'This document has a newer version than the one this page opened.',
          traceId: 't',
          current: view(),
        });
      }
      const result = applyOutlineOperation(latest().outline, parsed.data, newIdentifier);
      if (!result.applied) {
        return json(400, {
          code: 'outline_invalid',
          message: 'This change does not apply to the outline as it stands.',
          traceId: 't',
          reason: result.reason,
        });
      }
      if (canonicaliseOutline(result.outline) !== canonicaliseOutline(latest().outline)) {
        record(result.outline);
      }
      return json(200, view());
    }
    return json(500, { code: 'internal', message: 'x', traceId: 't' });
  }) as typeof globalThis.fetch;

  return {
    fetch,
    sent,
    edits: () => sent.filter((request) => request.url.endsWith('/outline')),
    refuse: (url: string, status: number, body?: unknown) => refusals.set(url, { status, body }),
    /** No answer at all: the request fails the way a dropped connection does. */
    fail: (url: string) => refusals.set(url, 'network'),
    /** A bare status for the outline request that arrives n-th, counting every one so far. */
    refuseRequest: (n: number, status: number) => numbered.set(n, status),
    /** A bare status for the next request to this path only. */
    refuseNext: (url: string, status: number) => refusals.set(url, { status, once: true }),
    /** What was recorded last, as the service would now answer it. */
    latest: () => view(),
    restore: (url: string) => refusals.delete(url),
    /** Holds every outline answer until the returned function is called. */
    /**
     * Holds the next contributions request - only that one - until the returned function is called,
     * and answers it then with what stood when it arrived.
     */
    holdContributions: () => {
      let release = () => {};
      contributionsGate = new Promise((resolve) => (release = resolve));
      return release;
    },
    /** How many contributions requests have been answered so far. */
    contributionsAnswered: () => contributionsAnswered,
    /** How many contributions answers have had their body read, once each body has resolved. */
    contributionsRead: () => contributionsRead,
    hold: () => {
      let release = () => {};
      gate = new Promise((resolve) => (release = resolve));
      return release;
    },
    /** Answers the next act at the same version, as the service does for one that changes nothing. */
    unchanged: () => {
      unchangedNext = true;
    },
    /** Somebody else's act, recorded straight into the chain. */
    theirs: (operation: OutlineOperation) => {
      const result = applyOutlineOperation(latest().outline, operation, newIdentifier);
      if (!result.applied) throw new Error(result.reason);
      record(result.outline);
    },
  };
}

const client = (fetch: typeof globalThis.fetch) =>
  createApiClient({ baseUrl: 'http://acme.example.test', fetch });

/**
 * Inside `<StrictMode>`, always: the application runs under it (apps/web/src/main.tsx), and editor 2
 * learned the hard way that a field reconciled by counting renders passes a bare render and eats
 * keystrokes in the real application.
 */
function open(fetch: typeof globalThis.fetch) {
  return render(
    <StrictMode>
      <DocumentPage client={client(fetch)} id={DOCUMENT} />
    </StrictMode>,
  );
}

const item = (name: RegExp | string) => screen.getByRole('treeitem', { name });

/** Undo stays focusable when there is nothing to undo, so it says so through `aria-disabled`. */
const undoable = () =>
  screen.getByRole('button', { name: 'Undo' }).getAttribute('aria-disabled') !== 'true';

/** Waits for the act in flight to be answered: the tree says it is busy until then. */
const settled = () =>
  waitFor(() => expect(screen.getByRole('tree')).toHaveAttribute('aria-busy', 'false'));

describe('the outline panel', () => {
  it('STR-008 moves a node with its whole subtree, as one action undo takes back', async () => {
    // Method, then Introduction with Scope beneath it.
    const fake = service(
      outline([
        section(METHOD, 'Method'),
        section(INTRODUCTION, 'Introduction', [section(SCOPE, 'Scope')]),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    // One act, from the keymap alone: Alt+Right demotes Introduction under the sibling before it.
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}');

    // The subtree travelled: Scope is still under Introduction, which is now under Method.
    const method = await screen.findByRole('treeitem', { name: 'Method' });
    await waitFor(() =>
      expect(within(method).getByRole('treeitem', { name: 'Introduction' })).toBeInTheDocument(),
    );
    expect(
      within(item('Introduction')).getByRole('treeitem', { name: 'Scope' }),
    ).toBeInTheDocument();
    // One operation was sent, and it named the node, its new parent and its position - not its
    // subtree: nothing in it mentions Scope.
    expect(fake.edits()).toHaveLength(1);
    expect(fake.edits()[0]?.body).toEqual({
      openedFrom: 'dddddddd-0000-4000-8000-000000000001',
      operation: { operation: 'move', node: INTRODUCTION, parent: METHOD, position: 0 },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Moved Introduction under Method.');

    // And it is a single undoable action: one Ctrl+Z, one operation, and the node and its subtree
    // are back at the top level where they were.
    await userEvent.keyboard('{Control>}z{/Control}');
    await waitFor(() =>
      expect(within(item('Method')).queryByRole('treeitem', { name: 'Introduction' })).toBeNull(),
    );
    expect(fake.edits()).toHaveLength(2);
    expect(fake.edits()[1]?.body).toEqual({
      openedFrom: 'dddddddd-0000-4000-8000-000000000002',
      operation: { operation: 'move', node: INTRODUCTION, parent: null, position: 1 },
    });
    expect(item('Introduction')).toHaveAttribute('aria-level', '1');
    expect(
      within(item('Introduction')).getByRole('treeitem', { name: 'Scope' }),
    ).toBeInTheDocument();
    expect(undoable()).toBe(false);
  });

  it('moves by pointer with the same position convention the service applies', async () => {
    // A drop at the end of the document sends the first of three to position 2, counted after it
    // has left its siblings, and the service's answer lands it last (packages/domain's `move`).
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        section(METHOD, 'Method'),
        section(RESULTS, 'Results'),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    fireEvent.dragStart(item('Introduction'));
    const end = await screen.findByText('Move to the end of the document');
    fireEvent.dragOver(end);
    fireEvent.drop(end);

    await waitFor(() =>
      expect(screen.getByRole('tree')).toHaveTextContent(/Method[\s\S]*Results[\s\S]*Introduction/),
    );
    expect(fake.edits().map((request) => request.body)).toEqual([
      {
        openedFrom: 'dddddddd-0000-4000-8000-000000000001',
        operation: { operation: 'move', node: INTRODUCTION, parent: null, position: 2 },
      },
    ]);

    // A drop onto a node makes the dragged node its last child.
    fireEvent.dragStart(item('Introduction'));
    await screen.findByText('Move to the end of the document');
    fireEvent.dragOver(screen.getByText('Method'));
    fireEvent.drop(screen.getByText('Method'));
    await waitFor(() =>
      expect(
        within(item('Method')).getByRole('treeitem', { name: 'Introduction' }),
      ).toBeInTheDocument(),
    );
    expect(fake.edits().at(-1)?.body).toMatchObject({
      operation: { operation: 'move', node: INTRODUCTION, parent: METHOD, position: 0 },
    });
  });

  it('walks the nodes with the arrow keys from one tab stop', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction', [section(SCOPE, 'Scope')]),
        section(METHOD, 'Method'),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    const stops = screen.getAllByRole('treeitem').filter((each) => each.tabIndex === 0);
    expect(stops).toEqual([item('Introduction')]);

    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{ArrowDown}');
    expect(item('Scope')).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(item('Method')).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{ArrowLeft}');
    expect(item('Introduction')).toHaveFocus();
    expect(screen.getAllByRole('treeitem').filter((each) => each.tabIndex === 0)).toEqual([
      item('Introduction'),
    ]);
    expect(fake.edits()).toEqual([]);
  });

  it('inserts a section after the selected one, sending one operation and showing what came back', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(RESULTS, 'Results')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    await userEvent.click(item('Introduction'));
    await userEvent.click(screen.getByRole('button', { name: 'Add section' }));
    await userEvent.type(screen.getByLabelText('New section title'), 'Method{Enter}');

    await waitFor(() =>
      expect(screen.getByRole('tree')).toHaveTextContent(/Introduction[\s\S]*Method[\s\S]*Results/),
    );
    expect(fake.edits().map((request) => request.body)).toEqual([
      {
        openedFrom: 'dddddddd-0000-4000-8000-000000000001',
        operation: {
          operation: 'insert',
          parent: null,
          position: 1,
          node: { type: 'section', title: [{ type: 'text', value: 'Method', marks: [] }] },
        },
      },
    ]);
    expect(screen.getByText('Version 0.2 in General')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Added Method.');
    // The new section is the one selected, with focus, so the keymap carries on from it.
    await waitFor(() => expect(item('Method')).toHaveFocus());
  });

  it('inserts a sibling from the keymap with Enter, and will not send a section with no title', async () => {
    const fake = service(outline([section(INTRODUCTION, 'Introduction')]));
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Enter}');
    expect(screen.getByLabelText('New section title')).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByText('A section needs a title.')).toBeInTheDocument();
    expect(fake.edits()).toEqual([]);

    // The hint is about the field as it stands, so it goes the moment the field is fine.
    await userEvent.keyboard('Method');
    expect(screen.queryByText('A section needs a title.')).toBeNull();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('treeitem', { name: 'Method' });
    expect(fake.edits()).toHaveLength(1);
  });

  it('inserts a component reference, with latest, named by the component', async () => {
    const fake = service(outline([section(METHOD, 'Method')]));
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });

    await userEvent.click(screen.getByRole('button', { name: 'Add component' }));
    await userEvent.selectOptions(await screen.findByLabelText('Component'), PRINTER);
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(
      await screen.findByRole('treeitem', { name: 'Install the printer, latest' }),
    ).toBeInTheDocument();
    expect(fake.edits().map((request) => request.body)).toEqual([
      {
        openedFrom: 'dddddddd-0000-4000-8000-000000000001',
        operation: {
          operation: 'insert',
          parent: null,
          position: 1,
          node: { type: 'reference', component: PRINTER, mode: { kind: 'latest' } },
        },
      },
    ]);
  });

  it('retitles a section as one operation when the field is committed, and undo brings the old title back into the field', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });

    await userEvent.click(item('Method'));
    const title = screen.getByLabelText('Title');
    expect(title).toHaveValue('Method');
    await userEvent.clear(title);
    // Typed one key at a time under StrictMode, and nothing is sent until the field is committed.
    await userEvent.type(title, 'Methods and materials ');
    expect(title).toHaveValue('Methods and materials ');
    expect(fake.edits()).toEqual([]);
    await userEvent.keyboard('{Enter}');

    await screen.findByRole('treeitem', { name: 'Methods and materials' });
    expect(fake.edits().map((request) => request.body)).toEqual([
      {
        openedFrom: 'dddddddd-0000-4000-8000-000000000001',
        operation: {
          operation: 'retitle',
          node: METHOD,
          title: [{ type: 'text', value: 'Methods and materials', marks: [] }],
        },
      },
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await screen.findByRole('treeitem', { name: 'Method' });
    // The field follows the outline back, rather than keeping the text the undo just took away.
    await userEvent.click(item('Method'));
    expect(screen.getByLabelText('Title')).toHaveValue('Method');
    expect(fake.edits()).toHaveLength(2);
  });

  it('puts an emptied title back when the field is left, and sends nothing', async () => {
    const fake = service(outline([section(METHOD, 'Method')]));
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });

    await userEvent.click(item('Method'));
    await userEvent.clear(screen.getByLabelText('Title'));
    await userEvent.click(item('Method'));

    expect(screen.getByLabelText('Title')).toHaveValue('Method');
    expect(screen.getByRole('status')).toHaveTextContent('A section needs a title.');
    expect(fake.edits()).toEqual([]);
  });

  it('sets where a node starts as one operation, and says what it now does', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(RESULTS, 'Results')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Results' });

    await userEvent.click(item('Results'));
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'page');

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Results now starts on a new page.'),
    );
    expect(fake.edits().map((request) => request.body)).toEqual([
      {
        openedFrom: 'dddddddd-0000-4000-8000-000000000001',
        operation: { operation: 'set', node: RESULTS, pageBreak: 'page' },
      },
    ]);
    expect(screen.getByLabelText('Starts on')).toHaveValue('page');
  });

  it('removes a node and its subtree as one operation, once asked, and says it cannot be undone', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        section(METHOD, 'Method', [section(SCOPE, 'Scope')]),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });

    // Introduction moved first, so there is something on the undo stack for the removal to clear.
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await waitFor(() => expect(undoable()).toBe(true));

    await userEvent.click(item('Method'));
    await userEvent.keyboard('{Delete}');
    expect(
      screen.getByText(
        'Remove Method and everything beneath it? This cannot be undone, and nothing before it can be undone afterwards.',
      ),
    ).toBeInTheDocument();
    expect(fake.edits()).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(screen.queryByRole('treeitem', { name: 'Method' })).toBeNull());
    expect(screen.queryByRole('treeitem', { name: 'Scope' })).toBeNull();
    expect(fake.edits().at(-1)?.body).toEqual({
      openedFrom: 'dddddddd-0000-4000-8000-000000000002',
      operation: { operation: 'remove', node: METHOD },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Removed Method.');
    expect(undoable()).toBe(false);
  });

  it('keeps the node when the removal is not confirmed', async () => {
    const fake = service(outline([section(METHOD, 'Method')]));
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });

    await userEvent.click(item('Method'));
    await userEvent.click(screen.getByRole('button', { name: 'Remove section' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));

    expect(item('Method')).toHaveFocus();
    expect(fake.edits()).toEqual([]);
  });

  it('STR-059 surfaces a conflicting act against the outline as it now stands, and clears the undo stack so nothing overwrites it', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    // Ada moves Introduction below Method: one act, on her undo stack.
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() =>
      expect(screen.getByRole('tree')).toHaveTextContent(/Method[\s\S]*Introduction/),
    );
    expect(undoable()).toBe(true);

    // Grace renames Method and moves Introduction back to the top, from another window.
    fake.theirs({
      operation: 'retitle',
      node: METHOD,
      title: [{ type: 'text', value: 'Methods', marks: [] }],
    });
    fake.theirs({ operation: 'move', node: INTRODUCTION, parent: null, position: 0 });

    // Ada, still looking at her own outline, demotes Introduction under Method.
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}');

    // Refused against the current outline: the page now shows Grace's outline, not Ada's.
    expect(await screen.findByRole('treeitem', { name: 'Methods' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Somebody else changed this document. This is how it stands now.',
    );
    expect(screen.getByRole('tree')).toHaveTextContent(/Introduction[\s\S]*Methods/);
    expect(within(item('Methods')).queryByRole('treeitem')).toBeNull();
    expect(screen.getByText('Version 0.4 in General')).toBeInTheDocument();
    expect(fake.edits()[1]?.body).toMatchObject({
      openedFrom: 'dddddddd-0000-4000-8000-000000000002',
    });

    // And the undo stack is gone: Ada's earlier move cannot be undone onto Grace's outline.
    expect(undoable()).toBe(false);
    item('Introduction').focus();
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(fake.edits()).toHaveLength(2);
    expect(screen.getByRole('tree')).toHaveTextContent(/Introduction[\s\S]*Methods/);

    // The next act is made from the outline that came back, and it is recorded.
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => expect(screen.getByText('Version 0.5 in General')).toBeInTheDocument());
    expect(fake.edits()[2]?.body).toMatchObject({
      openedFrom: 'dddddddd-0000-4000-8000-000000000004',
    });
  });

  it('says a caller may not change the document on a 403, and leaves the outline as it was', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    fake.refuse(`/v1/documents/${DOCUMENT}/outline`, 403);
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('You may not change this document.'),
    );
    expect(screen.getByRole('tree')).toHaveTextContent(/Introduction[\s\S]*Method/);
    expect(screen.getByText('Version 0.1 in General')).toBeInTheDocument();
    // Nothing is offered that could only be refused again.
    expect(screen.queryByRole('button', { name: 'Add section' })).toBeNull();
  });

  it('says the caller is signed out on a 401, distinctly from a refusal or a failure', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    fake.refuse(`/v1/documents/${DOCUMENT}/outline`, 401);
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'You are signed out. Sign in again to change this document.',
      ),
    );
    expect(screen.getByRole('tree')).toHaveTextContent(/Introduction[\s\S]*Method/);
  });

  it('shows nothing as a refusal, and adds nothing to undo, when an act changes nothing', async () => {
    // Decision K: the service answers 200 at the same version when an act puts things back where
    // they were. That is not a refusal and must not read as one, and there is nothing to undo.
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    fake.unchanged();
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await settled();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByRole('tree')).toHaveTextContent(/Introduction[\s\S]*Method/);
    expect(screen.getByText('Version 0.1 in General')).toBeInTheDocument();
    expect(undoable()).toBe(false);
  });

  it('renders a reference whose mode is approved as waiting on revisions rather than a version', async () => {
    const fake = service(outline([reference(RESULTS, 'approved'), reference(SCOPE, 'latest')]));
    open(fake.fetch);

    expect(
      await screen.findByRole('treeitem', { name: 'Install the printer, waiting on revisions' }),
    ).toBeInTheDocument();
    expect(item('Install the printer, latest')).toBeInTheDocument();
    expect(screen.getByRole('tree')).not.toHaveTextContent(/version/i);
  });

  it('says a document with no nodes has no sections yet, and still takes an insert', async () => {
    const fake = service(outline([]));
    open(fake.fetch);

    expect(await screen.findByText('This document has no sections yet.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add section' }));
    await userEvent.type(screen.getByLabelText('New section title'), 'Introduction{Enter}');

    expect(await screen.findByRole('treeitem', { name: 'Introduction' })).toBeInTheDocument();
    expect(screen.queryByText('This document has no sections yet.')).toBeNull();
    expect(fake.edits()[0]?.body).toMatchObject({
      operation: { operation: 'insert', parent: null, position: 0 },
    });
  });

  it('offers a reader the outline to read and nothing to change', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
      {
        mayEdit: false,
      },
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    expect(screen.getByText('You may read this document but not change it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add section' })).toBeNull();
    expect(screen.queryByLabelText('Title')).toBeNull();
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}{Delete}{Enter}');
    expect(fake.edits()).toEqual([]);
  });

  it('sends one operation, not two, when a second key lands before the first answers', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        section(METHOD, 'Method'),
        section(RESULTS, 'Results'),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    const release = fake.hold();
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    release();

    await waitFor(() => expect(screen.getByText('Version 0.2 in General')).toBeInTheDocument());
    expect(fake.edits()).toHaveLength(1);
  });

  it('says a document is not there, or not readable, on a 404', async () => {
    const fake = service(outline([]));
    fake.refuse(`/v1/documents/${DOCUMENT}`, 404);
    open(fake.fetch);
    expect(
      await screen.findByText('There is nothing here, or nothing you may read.'),
    ).toBeInTheDocument();
  });

  it('says a document could not be opened, and opens it on Try again', async () => {
    const fake = service(outline([section(METHOD, 'Method')]));
    fake.refuse(`/v1/documents/${DOCUMENT}`, 500);
    open(fake.fetch);
    expect(await screen.findByText('The document could not be opened.')).toBeInTheDocument();

    fake.restore(`/v1/documents/${DOCUMENT}`);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('treeitem', { name: 'Method' })).toBeInTheDocument();
  });
});

const OUTLINE_URL = `/v1/documents/${DOCUMENT}/outline`;
const SOMEBODY_ELSE = 'Somebody else changed this document. This is how it stands now.';

describe('the outline panel, answered', () => {
  it('gives a refused retitle back to the outline, so leaving the field does not send it again', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    // Grace changes something unrelated - Introduction's page break - so Method's title stays as it was.
    fake.theirs({ operation: 'set', node: INTRODUCTION, pageBreak: 'page' });
    await userEvent.clear(screen.getByLabelText('Title'));
    await userEvent.type(screen.getByLabelText('Title'), 'Methods{Enter}');

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(SOMEBODY_ELSE));
    expect(item('Method')).toBeInTheDocument();
    // The field gives way to the outline it was refused against, rather than holding the refused text.
    expect(screen.getByLabelText('Title')).toHaveValue('Method');

    // Leaving the field sends nothing: the act she was told was refused does not go through.
    await userEvent.click(screen.getByRole('button', { name: 'Add section' }));
    expect(fake.edits()).toHaveLength(1);
    expect(screen.queryByRole('treeitem', { name: 'Methods' })).toBeNull();
  });

  it('keeps every key typed while an act is in flight, and every control focusable', async () => {
    const fake = service(outline([section(METHOD, 'Method')]));
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    const release = fake.hold();
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'page');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    expect(screen.getByRole('tree')).toHaveAttribute('aria-busy', 'true');
    // Nothing that may hold focus is disabled under the author while the answer is awaited.
    expect(screen.getByLabelText('Starts on')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Undo' })).not.toBeDisabled();
    await userEvent.type(screen.getByLabelText('Title'), 's');
    expect(screen.getByLabelText('Title')).toHaveValue('Methods');

    release();
    await settled();
    expect(screen.getByRole('status')).toHaveTextContent('Method now starts on a new page.');
    expect(screen.getByLabelText('Title')).toHaveValue('Methods');
    expect(fake.edits()).toHaveLength(1);
  });

  it('keeps a retitle that was not saved, so the next Enter is the retry the page asks for', async () => {
    const fake = service(outline([section(METHOD, 'Method')]));
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    fake.refuse(OUTLINE_URL, 500);
    await userEvent.type(screen.getByLabelText('Title'), ' and materials{Enter}');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'The change was not saved. Try it again.',
      ),
    );
    // Nothing else is shown in its place, so the text is still there to try again with.
    expect(screen.getByLabelText('Title')).toHaveValue('Method and materials');

    fake.restore(OUTLINE_URL);
    await settled();
    await userEvent.type(screen.getByLabelText('Title'), '{Enter}');
    expect(
      await screen.findByRole('treeitem', { name: 'Method and materials' }),
    ).toBeInTheDocument();
    expect(fake.edits().map((request) => request.body)).toEqual([
      {
        openedFrom: 'dddddddd-0000-4000-8000-000000000001',
        operation: {
          operation: 'retitle',
          node: METHOD,
          title: [{ type: 'text', value: 'Method and materials', marks: [] }],
        },
      },
      {
        openedFrom: 'dddddddd-0000-4000-8000-000000000001',
        operation: {
          operation: 'retitle',
          node: METHOD,
          title: [{ type: 'text', value: 'Method and materials', marks: [] }],
        },
      },
    ]);
  });

  it('sends a retitle committed with Enter while another act is in flight, once that act is answered', async () => {
    const fake = service(outline([section(METHOD, 'Method')]));
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    const release = fake.hold();
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'page');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await userEvent.type(screen.getByLabelText('Title'), 's{Enter}');
    expect(fake.edits()).toHaveLength(1);

    release();
    expect(await screen.findByRole('treeitem', { name: /^Methods/ })).toBeInTheDocument();
    // Sent from the version the first act made, so it is not refused as a conflict with itself.
    expect(fake.edits()[1]?.body).toEqual({
      openedFrom: 'dddddddd-0000-4000-8000-000000000002',
      operation: {
        operation: 'retitle',
        node: METHOD,
        title: [{ type: 'text', value: 'Methods', marks: [] }],
      },
    });
    expect(screen.getByLabelText('Title')).toHaveValue('Methods');
  });

  it('sends a retitle left behind while another act is in flight, even once its field has gone', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    const release = fake.hold();
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'page');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await userEvent.type(screen.getByLabelText('Title'), 's');
    // Leaving for another node blurs the field, and the field goes with the selection.
    await userEvent.click(item('Introduction'));
    expect(screen.getByLabelText('Title')).toHaveValue('Introduction');
    expect(fake.edits()).toHaveLength(1);

    release();
    expect(await screen.findByRole('treeitem', { name: /^Methods/ })).toBeInTheDocument();
    expect(fake.edits()).toHaveLength(2);
    expect(screen.getByText('Version 0.3 in General')).toBeInTheDocument();
  });

  it('drops a held retitle when the act in flight is refused because Grace renamed the same section', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    const release = fake.hold();
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'page');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await userEvent.type(screen.getByLabelText('Title'), 's{Enter}');
    fake.theirs({
      operation: 'retitle',
      node: METHOD,
      title: [{ type: 'text', value: 'Approach', marks: [] }],
    });
    release();

    expect(await screen.findByRole('treeitem', { name: 'Approach' })).toBeInTheDocument();
    await settled();
    // Time for a held retitle to have gone, had it been going to.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fake.edits()).toHaveLength(1);
    expect(item('Approach')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(SOMEBODY_ELSE);
    expect(screen.getByLabelText('Title')).toHaveValue('Approach');
  });

  it('drops a held retitle when the act in flight is refused because Grace changed another section', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    const release = fake.hold();
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'page');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await userEvent.type(screen.getByLabelText('Title'), 's{Enter}');
    fake.theirs({ operation: 'set', node: INTRODUCTION, pageBreak: 'page' });
    release();

    expect(
      await screen.findByRole('treeitem', { name: 'Introduction, starts on a new page' }),
    ).toBeInTheDocument();
    await settled();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fake.edits()).toHaveLength(1);
    expect(item('Method')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(SOMEBODY_ELSE);
    expect(screen.getByLabelText('Title')).toHaveValue('Method');
  });

  it('sends a held retitle anyway when the act in flight was not saved, since nothing it could overwrite was shown', async () => {
    const fake = service(outline([section(METHOD, 'Method')]));
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    fake.refuseNext(OUTLINE_URL, 500);
    const release = fake.hold();
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'page');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await userEvent.type(screen.getByLabelText('Title'), 's{Enter}');
    release();

    expect(await screen.findByRole('treeitem', { name: 'Methods' })).toBeInTheDocument();
    expect(fake.edits()).toHaveLength(2);
    expect(fake.edits()[1]?.body).toMatchObject({
      openedFrom: 'dddddddd-0000-4000-8000-000000000001',
      operation: { operation: 'retitle', node: METHOD },
    });
    expect(screen.getByLabelText('Title')).toHaveValue('Methods');
  });

  it('sends a held retitle whose field has closed when the act in flight was not saved', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    fake.refuseNext(OUTLINE_URL, 500);
    const release = fake.hold();
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'page');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await userEvent.type(screen.getByLabelText('Title'), 's');
    await userEvent.click(item('Introduction'));
    release();

    expect(await screen.findByRole('treeitem', { name: 'Methods' })).toBeInTheDocument();
    expect(fake.edits()).toHaveLength(2);
  });

  it('names a retitle that was not saved once its field has closed, rather than losing it silently', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    fake.refuse(OUTLINE_URL, 500);
    await userEvent.type(screen.getByLabelText('Title'), 's');
    // Leaving for another node commits it, and closes its field.
    await userEvent.click(item('Introduction'));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'The title Methods was not saved. Select the section and try it again.',
      ),
    );
    expect(item('Method')).toBeInTheDocument();
    expect(fake.edits()).toHaveLength(1);
  });

  it('names a held retitle that cannot be sent because the author is signed out', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    fake.refuse(OUTLINE_URL, 401);
    const release = fake.hold();
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'page');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await userEvent.type(screen.getByLabelText('Title'), 's');
    await userEvent.click(item('Introduction'));
    release();

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'You are signed out, so the title Methods was not saved. Sign in again to change this document.',
      ),
    );
    await settled();
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Nothing is sent that could only be refused the same way.
    expect(fake.edits()).toHaveLength(1);
  });

  describe('two retitles held on two sections', () => {
    const V = (n: number) => `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const retitled = (node: string, value: string) => ({
      operation: 'retitle',
      node,
      title: [{ type: 'text', value, marks: [] }],
    });

    /**
     * The reproduction, under StrictMode: a page-break change in flight; "s" typed into the title of
     * Method and Introduction clicked, which holds "Methods"; then "x" typed into the title of
     * Introduction and Enter, which holds "Introductionx". Nothing is sent until the act in flight is
     * answered.
     */
    async function holdTwo(fake: ReturnType<typeof service>) {
      open(fake.fetch);
      await screen.findByRole('treeitem', { name: 'Method' });
      await userEvent.click(item('Method'));
      const release = fake.hold();
      await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'page');
      await waitFor(() => expect(fake.edits()).toHaveLength(1));
      await userEvent.type(screen.getByLabelText('Title'), 's');
      await userEvent.click(item('Introduction'));
      await userEvent.type(screen.getByLabelText('Title'), 'x{Enter}');
      expect(fake.edits()).toHaveLength(1);
      return release;
    }
    const twoSections = () =>
      service(outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]));

    it('sends both once the act in flight is answered, in order, each from the version the one before made', async () => {
      const fake = twoSections();
      const release = await holdTwo(fake);
      release();

      expect(await screen.findByRole('treeitem', { name: 'Introductionx' })).toBeInTheDocument();
      await settled();
      expect(item(/^Methods/)).toBeInTheDocument();
      expect(fake.edits().map((request) => request.body)).toEqual([
        { openedFrom: V(1), operation: { operation: 'set', node: METHOD, pageBreak: 'page' } },
        { openedFrom: V(2), operation: retitled(METHOD, 'Methods') },
        { openedFrom: V(3), operation: retitled(INTRODUCTION, 'Introductionx') },
      ]);
      expect(screen.getByText('Version 0.4 in General')).toBeInTheDocument();
      expect(screen.getByRole('status')).not.toHaveTextContent(/not saved/);
      expect(screen.getByLabelText('Title')).toHaveValue('Introductionx');
    });

    it('drops both behind a refused act, and names both after the conflict sentence', async () => {
      const fake = twoSections();
      const release = await holdTwo(fake);
      fake.theirs({ operation: 'set', node: INTRODUCTION, pageBreak: 'recto' });
      release();

      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(
          `${SOMEBODY_ELSE} Your titles Methods and Introductionx were not saved.`,
        ),
      );
      await settled();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(fake.edits()).toHaveLength(1);
      expect(item('Method')).toBeInTheDocument();
      expect(screen.getByLabelText('Title')).toHaveValue('Introduction');
    });

    it('sends both behind an act that was not saved, since nothing they could overwrite was shown', async () => {
      const fake = twoSections();
      fake.refuseNext(OUTLINE_URL, 500);
      const release = await holdTwo(fake);
      release();

      expect(await screen.findByRole('treeitem', { name: 'Introductionx' })).toBeInTheDocument();
      await settled();
      expect(item('Methods')).toBeInTheDocument();
      expect(fake.edits().map((request) => request.body)).toEqual([
        { openedFrom: V(1), operation: { operation: 'set', node: METHOD, pageBreak: 'page' } },
        { openedFrom: V(1), operation: retitled(METHOD, 'Methods') },
        { openedFrom: V(2), operation: retitled(INTRODUCTION, 'Introductionx') },
      ]);
    });

    it('still names a title that was not saved once its field closed, after the next one is saved', async () => {
      const fake = twoSections();
      // The page-break change is the first request, Methods the second.
      fake.refuseRequest(2, 500);
      const release = await holdTwo(fake);
      release();

      expect(await screen.findByRole('treeitem', { name: 'Introductionx' })).toBeInTheDocument();
      await settled();
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(
          'The title Methods was not saved. Select the section and try it again.',
        ),
      );
      expect(fake.edits()).toHaveLength(3);
      expect(item(/^Method, starts/)).toBeInTheDocument();
    });

    it('sends neither once the author is signed out, naming the one whose field has closed', async () => {
      const fake = twoSections();
      fake.refuse(OUTLINE_URL, 401);
      const release = await holdTwo(fake);
      release();

      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent(
          'You are signed out, so the title Methods was not saved. Sign in again to change this document.',
        ),
      );
      await settled();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(fake.edits()).toHaveLength(1);
      // Its field is still open, so what was typed is still there to send once signed in again.
      expect(screen.getByLabelText('Title')).toHaveValue('Introductionx');
    });
  });

  it('keeps what is typed after two commits to one field, whichever of them comes back first', async () => {
    const fake = service(outline([section(METHOD, 'Method')]));
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    // The first commit is sent and waits for its answer; the second is held behind it.
    const release = fake.hold();
    await userEvent.type(screen.getByLabelText('Title'), 's{Enter}');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await userEvent.type(screen.getByLabelText('Title'), 't{Enter}');
    await userEvent.type(screen.getByLabelText('Title'), 'u');
    expect(fake.edits()).toHaveLength(1);
    release();

    expect(await screen.findByRole('treeitem', { name: 'Methodst' })).toBeInTheDocument();
    await settled();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fake.edits().map((edit) => (edit.body as { operation: unknown }).operation)).toEqual([
      {
        operation: 'retitle',
        node: METHOD,
        title: [{ type: 'text', value: 'Methods', marks: [] }],
      },
      {
        operation: 'retitle',
        node: METHOD,
        title: [{ type: 'text', value: 'Methodst', marks: [] }],
      },
    ]);
    // Each title that came back was one this field sent, so nothing typed since is given away.
    expect(screen.getByLabelText('Title')).toHaveValue('Methodstu');
  });

  it('names each title a conflict took once, in one sentence', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));
    fake.theirs({ operation: 'set', node: INTRODUCTION, pageBreak: 'page' });

    // Methods is sent and waits; leaving the field after Enter commits the same text again, and
    // Introductionx is held behind it. The conflict refuses Methods, and Introductionx behind it.
    const release = fake.hold();
    await userEvent.type(screen.getByLabelText('Title'), 's{Enter}');
    await waitFor(() => expect(fake.edits()).toHaveLength(1));
    await userEvent.click(item('Introduction'));
    await userEvent.type(screen.getByLabelText('Title'), 'x{Enter}');
    release();

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/Introductionx were not saved\.$/),
    );
    await settled();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByRole('status').textContent).toBe(
      `${SOMEBODY_ELSE} Your titles Methods and Introductionx were not saved.`,
    );
    expect(fake.edits()).toHaveLength(1);
  });

  it('names the title a conflict refused, and keeps the conflict sentence', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));

    fake.theirs({ operation: 'set', node: INTRODUCTION, pageBreak: 'page' });
    await userEvent.type(screen.getByLabelText('Title'), 's{Enter}');

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        `${SOMEBODY_ELSE} Your title Methods was not saved.`,
      ),
    );
    expect(screen.getByLabelText('Title')).toHaveValue('Method');
  });

  it('says why an act does not apply, in the words the service gave', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    fake.refuse(OUTLINE_URL, 400, {
      code: 'outline_invalid',
      message: 'This change does not apply to the outline as it stands.',
      traceId: 't',
      reason: 'The position is past the end of these children',
    });
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'The position is past the end of these children.',
      ),
    );
    expect(screen.getByRole('tree')).toHaveTextContent(/Introduction[\s\S]*Method/);
    expect(screen.getByText('Version 0.1 in General')).toBeInTheDocument();
  });

  it('does not call a body the route would not take an outline that does not apply', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    fake.refuse(OUTLINE_URL, 400, { code: 'invalid_request', message: 'x', traceId: 't' });
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('The change could not be made.'),
    );
    expect(screen.getByRole('status')).not.toHaveTextContent(/does not apply|Try/);
  });

  it('clears the whole undo stack when an undo is refused as not applying', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        section(METHOD, 'Method'),
        section(RESULTS, 'Results'),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => expect(screen.getByText('Version 0.2 in General')).toBeInTheDocument());
    await settled();
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => expect(screen.getByText('Version 0.3 in General')).toBeInTheDocument());
    await settled();

    fake.refuse(OUTLINE_URL, 400, {
      code: 'outline_invalid',
      message: 'x',
      traceId: 't',
      reason: 'The node is not in this outline',
    });
    await userEvent.keyboard('{Control>}z{/Control}');

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'That change cannot be undone any more.',
      ),
    );
    // The entry beneath it was computed for a state that will now never exist, so it goes too.
    expect(undoable()).toBe(false);
    expect(fake.edits()).toHaveLength(3);
  });

  it('goes read-only, without claiming the caller may still read it, on a 404', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    fake.refuse(OUTLINE_URL, 404);
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'This document is no longer open to you.',
      ),
    );
    expect(screen.queryByRole('button', { name: 'Add section' })).toBeNull();
    expect(screen.queryByText('You may read this document but not change it.')).toBeNull();
  });

  it('says an act was not saved on a server error, and keeps an undo that did not arrive', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => expect(screen.getByText('Version 0.2 in General')).toBeInTheDocument());
    await settled();

    fake.refuse(OUTLINE_URL, 500);
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'The change was not saved. Try it again.',
      ),
    );
    expect(screen.getByRole('tree')).toHaveTextContent(/Method[\s\S]*Introduction/);

    fake.fail(OUTLINE_URL);
    await settled();
    await userEvent.keyboard('{Control>}z{/Control}');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'The change was not undone. Try it again.',
      ),
    );
    expect(undoable()).toBe(true);

    // And trying again does work, because the entry was kept.
    fake.restore(OUTLINE_URL);
    await settled();
    item('Introduction').focus();
    await userEvent.keyboard('{Control>}z{/Control}');
    await waitFor(() =>
      expect(screen.getByRole('tree')).toHaveTextContent(/Introduction[\s\S]*Method/),
    );
    expect(undoable()).toBe(false);
  });

  it('reads the document again when a conflict carries no outline it can show', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    fake.theirs({
      operation: 'retitle',
      node: METHOD,
      title: [{ type: 'text', value: 'Methods', marks: [] }],
    });
    fake.refuse(OUTLINE_URL, 409, { code: 'version_precondition', message: 'x', traceId: 't' });
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

    expect(await screen.findByRole('treeitem', { name: 'Methods' })).toBeInTheDocument();
    expect(screen.getByText('Version 0.2 in General')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(SOMEBODY_ELSE);
  });

  it('says the document cannot be read when an answer carries an outline it cannot read', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });
    fake.refuse(OUTLINE_URL, 200, {
      ...fake.latest(),
      outline: { schemaVersion: OUTLINE_SCHEMA_VERSION, nodes: 'none' },
    });
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

    expect(await screen.findByText('This document could not be read.')).toBeInTheDocument();
    expect(screen.queryByText(/Reload/)).toBeNull();
  });

  it('names a reference to a component the caller may not read "A component", and still acts on it', async () => {
    const pinned: OutlineNode = {
      type: 'reference',
      id: RESULTS,
      component: PRINTER,
      mode: { kind: 'pinned', version: 'dddddddd-0000-4000-8000-00000000abcd' },
      numbered: true,
      matter: 'body',
      pageBreak: 'none',
      values: {},
      children: [],
    };
    const fake = service(outline([section(INTRODUCTION, 'Introduction'), pinned]), {
      mayRead: () => false,
    });
    open(fake.fetch);

    const withheld = await screen.findByRole('treeitem', { name: 'A component, pinned' });
    expect(screen.queryByText(/may not read/)).toBeNull();
    // Moved, and given a page break, like any other node: its identifier is all an act needs.
    await userEvent.click(withheld);
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await settled();
    expect(screen.getByRole('tree')).toHaveTextContent(/A component.*Introduction/);
    await userEvent.selectOptions(screen.getByLabelText('Starts on'), 'A new page');
    expect(
      await screen.findByRole('treeitem', { name: 'A component, pinned, starts on a new page' }),
    ).toBeInTheDocument();
    expect(fake.edits().map((edit) => (edit.body as { operation: unknown }).operation)).toEqual([
      { operation: 'move', node: RESULTS, parent: null, position: 0 },
      { operation: 'set', node: RESULTS, pageBreak: 'page' },
    ]);
  });

  it('names a reference "A component" when the listing was cut short, never one the caller may not read', async () => {
    const fake = service(outline([reference(RESULTS, 'latest')]), {
      components: {
        items: [
          {
            id: 'cccccccc-0000-4000-8000-000000000002',
            title: 'Replace the toner',
            space: { id: SPACE, name: 'General' },
            version: '0.1',
          },
        ],
        next: 42,
      },
    });
    open(fake.fetch);
    expect(
      await screen.findByRole('treeitem', { name: 'A component, latest' }),
    ).toBeInTheDocument();
  });

  it('keeps the page as it is when a drag starts, and offers the drop places a moment later', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });

    // Chromium ends a drag whose source changes in the same task it started in.
    fireEvent.dragStart(item('Introduction'));
    expect(screen.queryByText('Move to the end of the document')).toBeNull();
    expect(await screen.findByText('Move to the end of the document')).toBeInTheDocument();
    fireEvent.dragEnd(item('Introduction'));
    await waitFor(() => expect(screen.queryByText('Move to the end of the document')).toBeNull());
  });

  it('keeps Undo focusable once there is nothing left to undo', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Introduction' });
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => expect(undoable()).toBe(true));
    await settled();

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(undoable()).toBe(false));
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Undo' })).not.toBeDisabled();
    // Pressed again with nothing to undo, it sends nothing.
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(fake.edits()).toHaveLength(2);
  });

  it('describes its keys, including what a Mac keyboard uses to remove', async () => {
    const fake = service(outline([section(INTRODUCTION, 'Introduction')]));
    open(fake.fetch);
    const tree = await screen.findByRole('tree');
    const help = document.getElementById(tree.getAttribute('aria-describedby') ?? '');
    expect(help).toHaveTextContent(/Alt and the arrow keys/);
    expect(help).toHaveTextContent(/On a Mac keyboard, remove it with the Remove button/);
  });
});

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
    const { fetch } = spaces({ '/v1/spaces': { items: [SPACES.items[1]] } });
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
      if (url === '/v1/spaces') return json(200, { items: [] });
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
      },
    });
    render(<DocumentList client={client(fetch)} onOpen={vi.fn()} />);

    const link = await screen.findByRole('link', { name: 'The dosing report' });
    expect(link).toHaveAttribute('href', `#/documents/${DOCUMENT}`);
    expect(link.closest('li')).toHaveTextContent('The dosing report - version 0.4 in General');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('says so when there are no documents to read', async () => {
    render(
      <DocumentList
        client={client(listing({ status: 200, body: { items: [] } }))}
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

describe('section numbers in the outline panel', () => {
  it('shows each numbered node its section number, and renumbers a move without asking for one', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        section(METHOD, 'Method', [section(SCOPE, 'Scope')]),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Scope' });
    // The number describes the item, and the title stays its name.
    expect(item('Introduction')).toHaveAccessibleDescription('1');
    expect(item('Method')).toHaveAccessibleDescription('2');
    expect(item('Scope')).toHaveAccessibleDescription('2.1');

    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() => expect(item('Introduction')).toHaveAccessibleDescription('2'));
    expect(item('Method')).toHaveAccessibleDescription('1');
    expect(item('Scope')).toHaveAccessibleDescription('1.1');
    // Numbered from the outline the page holds: nothing asked the service for a number.
    expect(fake.sent.some((request) => request.url.endsWith('/numbering'))).toBe(false);
  });

  it('takes a node out of the numbering, and its subtree with it, from its Numbered box', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        section(METHOD, 'Method', [section(SCOPE, 'Scope')]),
        section(RESULTS, 'Results'),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Scope' });
    await userEvent.click(item('Method'));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Numbered' }));
    await waitFor(() => expect(item('Method')).not.toHaveAccessibleDescription());
    expect(fake.edits().at(-1)?.body).toEqual({
      openedFrom: 'dddddddd-0000-4000-8000-000000000001',
      operation: { operation: 'set', node: METHOD, numbered: false },
    });
    expect(item('Scope')).not.toHaveAccessibleDescription();
    // Results takes the number Method no longer consumes.
    expect(item('Results')).toHaveAccessibleDescription('2');
    expect(screen.getByRole('status')).toHaveTextContent('Method is no longer numbered.');
    expect(screen.getByRole('checkbox', { name: 'Numbered' })).not.toBeChecked();

    // And back again, from the same box.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Numbered' }));
    await waitFor(() => expect(item('Method')).toHaveAccessibleDescription('2'));
    expect(fake.edits().at(-1)?.body).toMatchObject({
      operation: { operation: 'set', node: METHOD, numbered: true },
    });
    expect(item('Scope')).toHaveAccessibleDescription('2.1');
    expect(item('Results')).toHaveAccessibleDescription('3');
    expect(screen.getByRole('status')).toHaveTextContent('Method is now numbered.');
    expect(screen.getByRole('checkbox', { name: 'Numbered' })).toBeChecked();
  });

  it('makes a top-level node an appendix, numbered in its own scheme, and offers it nowhere else', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        section(METHOD, 'Method', [section(SCOPE, 'Scope')]),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Scope' });
    await userEvent.click(item('Scope'));
    expect(screen.getByRole('checkbox', { name: 'Numbered' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Matter' })).toBeNull();
    await userEvent.click(item('Method'));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Matter' }), 'Appendix');
    await waitFor(() => expect(item('Method')).toHaveAccessibleDescription('A'));
    expect(item('Scope')).toHaveAccessibleDescription('A.1');
    expect(fake.edits().at(-1)?.body).toMatchObject({
      operation: { operation: 'set', node: METHOD, matter: 'appendix' },
    });
    // Only the one switch: `values` is never sent from here.
    expect(fake.edits().at(-1)?.body).toEqual({
      openedFrom: 'dddddddd-0000-4000-8000-000000000001',
      operation: { operation: 'set', node: METHOD, matter: 'appendix' },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Method is now an appendix.');
    expect(screen.getByRole('combobox', { name: 'Matter' })).toHaveValue('appendix');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Matter' }), 'Body');
    await waitFor(() => expect(item('Method')).toHaveAccessibleDescription('2'));
    expect(fake.edits().at(-1)?.body).toMatchObject({
      operation: { operation: 'set', node: METHOD, matter: 'body' },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Method is now in the body.');
  });

  it('offers Front matter, Body and Appendix for a top-level node, and Front matter only before the body begins', async () => {
    const fake = service(
      outline([
        section(INTRODUCTION, 'Introduction'),
        section(METHOD, 'Method', [section(SCOPE, 'Scope')]),
        section(RESULTS, 'Results'),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Scope' });
    // Below the top level a node's matter is its top-level ancestor's, so there is nothing to set.
    await userEvent.click(item('Scope'));
    expect(screen.queryByRole('combobox', { name: 'Matter' })).toBeNull();

    await userEvent.click(item('Introduction'));
    const matter = screen.getByRole('combobox', { name: 'Matter' });
    expect(
      within(matter)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Front matter', 'Body', 'Appendix']);
    expect(matter).toHaveValue('body');

    await userEvent.selectOptions(matter, 'Front matter');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Introduction is now front matter.'),
    );
    expect(fake.edits().at(-1)?.body).toEqual({
      openedFrom: 'dddddddd-0000-4000-8000-000000000001',
      operation: { operation: 'set', node: INTRODUCTION, matter: 'front' },
    });
    expect(screen.getByRole('combobox', { name: 'Matter' })).toHaveValue('front');
    // Front matter numbers on counters of its own, so the body's first chapter is still 1.
    expect(item('Introduction')).toHaveAccessibleDescription('i');
    expect(item('Method')).toHaveAccessibleDescription('1');

    // Method is the first node that is not front matter, so nothing but front matter precedes it
    // and it may still become some.
    await userEvent.click(item('Method'));
    expect(
      within(screen.getByRole('combobox', { name: 'Matter' }))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Front matter', 'Body', 'Appendix']);

    // Results has the body before it, so it is not offered as front matter at all.
    await userEvent.click(item('Results'));
    expect(
      within(screen.getByRole('combobox', { name: 'Matter' }))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Body', 'Appendix']);
  });

  it('says front matter stays at the top level and comes first, and sends nothing', async () => {
    const fake = service(
      outline([
        { ...section(PREFACE, 'Preface'), matter: 'front' },
        { ...section(INTRODUCTION, 'Introduction'), matter: 'front' },
        section(METHOD, 'Method'),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Introduction'));

    // Alt+Right would nest it under the Preface, where the outline's parse refuses front matter.
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Front matter and appendices stay at the top level.',
      ),
    );
    expect(item('Introduction')).toHaveAttribute('aria-level', '1');

    // And Alt+Down would take it past the body, where front matter may not go.
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Front matter comes before the rest of the outline.',
      ),
    );
    expect(fake.edits()).toEqual([]);
    expect(item('Introduction')).toHaveAccessibleDescription('ii');
  });

  it('takes a Matter change back with Ctrl+Z, from the select it was made in', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Introduction'));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Matter' }), 'Front matter');
    await waitFor(() => expect(item('Introduction')).toHaveAccessibleDescription('i'));
    await settled();

    // A select has no undo of its own, so Ctrl+Z from it is the panel's, and one operation takes
    // the act back - the same shape the Numbered box and the Starts on select follow.
    screen.getByRole('combobox', { name: 'Matter' }).focus();
    await userEvent.keyboard('{Control>}z{/Control}');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Undone. Introduction is now in the body.',
      ),
    );
    expect(fake.edits()).toHaveLength(2);
    expect(fake.edits().at(-1)?.body).toMatchObject({
      operation: { operation: 'set', node: INTRODUCTION, matter: 'body' },
    });
    expect(screen.getByRole('combobox', { name: 'Matter' })).toHaveValue('body');
    expect(item('Introduction')).toHaveAccessibleDescription('1');
  });

  it('numbers a reference to a component the reader may not read like any other node', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction', [reference(RESULTS, 'latest')])]),
      { mayRead: () => false },
    );
    open(fake.fetch);
    const withheld = await screen.findByRole('treeitem', { name: /A component/ });
    expect(withheld).toHaveAccessibleDescription('1.1');
  });
});

describe('an appendix in the outline panel', () => {
  /** Method with Scope beneath it, then Results as an appendix. */
  const withAnAppendix = () =>
    outline([
      section(METHOD, 'Method', [section(SCOPE, 'Scope')]),
      { ...section(RESULTS, 'Results'), matter: 'appendix' },
    ]);

  it('sends nothing when Alt+Right would put an appendix below the top level, and says why', async () => {
    const fake = service(withAnAppendix());
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Scope' });
    expect(item('Results')).toHaveAccessibleDescription('A');
    await userEvent.click(item('Results'));
    await userEvent.keyboard('{Alt>}{ArrowRight}{/Alt}');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Front matter and appendices stay at the top level.',
      ),
    );
    expect(fake.edits()).toEqual([]);
    expect(item('Results')).toHaveAttribute('aria-level', '1');
  });

  it('offers no drop into a node for an appendix, and sends nothing on one', async () => {
    const fake = service(withAnAppendix());
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Scope' });
    fireEvent.dragStart(item('Results'));
    await screen.findByText('Move to the end of the document');
    // Not taken: a drop place the browser is not told it may drop on.
    expect(fireEvent.dragOver(screen.getByText('Method'))).toBe(true);
    fireEvent.drop(screen.getByText('Method'));
    fireEvent.dragEnd(item('Results'));
    await waitFor(() => expect(screen.queryByText('Move to the end of the document')).toBeNull());
    expect(fake.edits()).toEqual([]);
    expect(item('Results')).toHaveAttribute('aria-level', '1');
  });

  it('offers no drop before a nested node for an appendix, and sends nothing on one', async () => {
    const fake = service(withAnAppendix());
    const { container } = open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Scope' });
    fireEvent.dragStart(item('Results'));
    await screen.findByText('Move to the end of the document');
    const beforeScope = container.querySelector(`[data-drop="before:${SCOPE}"]`);
    expect(beforeScope).not.toBeNull();
    expect(fireEvent.dragOver(beforeScope!)).toBe(true);
    fireEvent.drop(beforeScope!);
    fireEvent.dragEnd(item('Results'));
    await waitFor(() => expect(screen.queryByText('Move to the end of the document')).toBeNull());
    expect(fake.edits()).toEqual([]);
    expect(item('Results')).toHaveAttribute('aria-level', '1');
  });

  it('says why a node whose own box is ticked has no number', async () => {
    const fake = service(
      outline([
        { ...section(METHOD, 'Method', [section(SCOPE, 'Scope')]), numbered: false },
        section(RESULTS, 'Results'),
      ]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Scope' });
    await userEvent.click(item('Scope'));
    const box = screen.getByRole('checkbox', { name: 'Numbered' });
    expect(box).toBeChecked();
    expect(box).toHaveAccessibleDescription('Not numbered while Method is not.');
    expect(screen.getByText('Not numbered while Method is not.')).toBeInTheDocument();

    // Nothing to say beside a node that is itself unticked, or one with a number.
    await userEvent.click(item('Method'));
    expect(screen.getByRole('checkbox', { name: 'Numbered' })).not.toHaveAccessibleDescription();
    await userEvent.click(item('Results'));
    expect(screen.getByRole('checkbox', { name: 'Numbered' })).not.toHaveAccessibleDescription();
    expect(screen.queryByText(/Not numbered while/)).toBeNull();
  });
});

describe('a drag started before the panel has settled', () => {
  /**
   * Starts a drag on the first tree item from a layout effect: after the panel's DOM is in the page,
   * and before its passive effects have run - which under `<StrictMode>` include the simulated
   * unmount React runs once on mount. Under load the scheduler defers those effects past a real
   * `dragstart` the same way (issue #131); this puts the drag there every time rather than by luck.
   * Once only, so StrictMode's replayed layout effect does not start a second drag that would hide it.
   */
  function DragOnMount({ children }: { children: ReactNode }) {
    const box = useRef<HTMLDivElement>(null);
    const started = useRef(false);
    useLayoutEffect(() => {
      if (started.current) return;
      started.current = true;
      box.current
        ?.querySelector('[role="treeitem"]')
        ?.dispatchEvent(new Event('dragstart', { bubbles: true }));
    }, []);
    return <div ref={box}>{children}</div>;
  }

  it('records a drag that starts before the panel mounts its effects', async () => {
    render(
      <StrictMode>
        <DragOnMount>
          <OutlinePanel
            outline={withholdComponents(
              outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
              () => true,
            )}
            editable
            scheme={defaultLayout.scheme}
            onOperation={vi.fn()}
            notice={null}
          />
        </DragOnMount>
      </StrictMode>,
    );
    expect(await screen.findByText('Move to the end of the document')).toBeInTheDocument();
  });
});

describe('undo from the node details', () => {
  it('undoes from a checkbox or a select, which have no undo of their own, and leaves a title field its own', async () => {
    const fake = service(
      outline([section(INTRODUCTION, 'Introduction'), section(METHOD, 'Method')]),
    );
    open(fake.fetch);
    await screen.findByRole('treeitem', { name: 'Method' });
    await userEvent.click(item('Method'));
    const box = screen.getByRole('checkbox', { name: 'Numbered' });
    await userEvent.click(box);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Method is no longer numbered.'),
    );
    await settled();
    expect(fake.edits()).toHaveLength(1);

    // A title field keeps Ctrl+Z for what is being typed in it: nothing is sent.
    screen.getByRole('textbox', { name: 'Title' }).focus();
    await userEvent.keyboard('{Control>}z{/Control}');
    expect(fake.edits()).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Method is no longer numbered.');

    // The box has no undo of its own, so the panel's takes the act back, with the focus still on it.
    screen.getByRole('checkbox', { name: 'Numbered' }).focus();
    await userEvent.keyboard('{Control>}z{/Control}');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Undone. Method is now numbered.'),
    );
    expect(fake.edits()).toHaveLength(2);
    expect(fake.edits().at(-1)?.body).toMatchObject({
      operation: { operation: 'set', node: METHOD, numbered: true },
    });
    expect(screen.getByRole('checkbox', { name: 'Numbered' })).toBeChecked();
    expect(item('Method')).toHaveAccessibleDescription('2');
    await settled();

    // And the same from the select beside it.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Starts on' }), 'page');
    await waitFor(() => expect(fake.edits()).toHaveLength(3));
    await settled();
    screen.getByRole('combobox', { name: 'Starts on' }).focus();
    await userEvent.keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(fake.edits()).toHaveLength(4));
    expect(fake.edits().at(-1)?.body).toMatchObject({
      operation: { operation: 'set', node: METHOD, pageBreak: 'none' },
    });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Undone\./));
  });
});

/** The page at an address naming one of its nodes, as `Workspace` opens it. */
function openAt(fetch: typeof globalThis.fetch, node: string, arrival = 0) {
  const page = (linked: string, at: number) => (
    <StrictMode>
      <DocumentPage client={client(fetch)} id={DOCUMENT} linked={{ node: linked, arrival: at }} />
    </StrictMode>
  );
  const rendered = render(page(node, arrival));
  return {
    ...rendered,
    arriveAgain: (linked: string, at: number) => rendered.rerender(page(linked, at)),
  };
}

/** The node an address the page showed names, read the way the workspace reads its own address. */
function nodeIn(shown: string): string {
  const address = documentAddress(new URL(shown).hash);
  if (address?.kind !== 'document' || address.node === null) {
    throw new Error(`${shown} names no node`);
  }
  return address.node;
}

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

const SECRET = 'cccccccc-0000-4000-8000-000000000002';
const AGAIN = 'aaaaaaaaaaaaaaaaaaaaaaaaaa';
const HIDDEN = 'hhhhhhhhhhhhhhhhhhhhhhhhhh';

/** A reference to a named component, at latest. */
function referenceTo(id: string, component: string): OutlineNode {
  return { ...reference(id, 'latest'), component } as OutlineNode;
}

const tray = { block: 'f1', sequence: 'figure', numbered: true, caption: 'The paper tray' };
const parts = { block: 't1', sequence: 'table', numbered: true, caption: 'Parts' };
const sum = { block: 'e1', sequence: 'equation', numbered: true, caption: null };
const aside = { block: 'e2', sequence: 'equation', numbered: false, caption: null };

const listed = (heading: string) =>
  within(screen.getByRole('region', { name: heading }))
    .getAllByRole('link')
    .map((link) => [link.textContent, link.getAttribute('href')]);

describe('the lists of figures, tables and equations', () => {
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
    // will be called.
    const published = assemble({
      outline: sections,
      occurrences: new Map(),
      refused: [],
      layout: upperRomanLayout,
      revision: '0.1',
      covers: () => true,
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

describe('publishing from the document page', () => {
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
      '2 Method: This paragraph uses a style the publication template does not set.',
      'A part no longer in this document: This paragraph uses a style the publication template does not set.',
    ]);
    expect(why).not.toHaveTextContent('Install the printer');
    expect(why).not.toHaveTextContent(PRINTER);
    expect(fake.sent.find((each) => each.url.endsWith('/publications') && each.body)?.body).toEqual(
      { version: 'dddddddd-0000-4000-8000-000000000001', formats: ['pdf'] },
    );
  });
});
