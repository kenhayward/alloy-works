import { createApiClient } from '@alloy-works/api-client';
import {
  applyOutlineOperation,
  canonicaliseOutline,
  outlineOperationSchema,
  type OutlineDocument,
  type OutlineNode,
  type OutlineOperation,
} from '@alloy-works/domain';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DocumentList } from './DocumentList.js';
import { DocumentPage } from './DocumentPage.js';
import { NewDocument } from './NewDocument.js';

const DOCUMENT = 'eeeeeeee-0000-4000-8000-000000000001';
const SPACE = 'aaaaaaaa-0000-4000-8000-000000000001';
const ADA = 'ffffffff-0000-4000-8000-000000000001';
const PRINTER = 'cccccccc-0000-4000-8000-000000000001';
const INTRODUCTION = 'iiiiiiiiiiiiiiiiiiiiiiiiii';
const SCOPE = 'ssssssssssssssssssssssssss';
const METHOD = 'mmmmmmmmmmmmmmmmmmmmmmmmmm';
const RESULTS = 'rrrrrrrrrrrrrrrrrrrrrrrrrr';

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
    schemaVersion: 1,
    title: 'The dosing report',
    language: 'en-GB',
    direction: 'ltr',
    nodes,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

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
  options: { mayEdit?: boolean; components?: unknown } = {},
) {
  const sent: { url: string; body: unknown }[] = [];
  const refusals = new Map<string, { status: number; body?: unknown } | 'network'>();
  // An outline request waits on this before it is answered, so a test can act while one is in flight.
  let gate: Promise<void> = Promise.resolve();
  let unchangedNext = false;
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
    outline: version.outline,
    mayEdit: options.mayEdit ?? true,
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
    const refused = refusals.get(url);
    if (refused === 'network') throw new TypeError('Failed to fetch');
    if (refused !== undefined) {
      return json(
        refused.status,
        refused.body ?? { code: 'refused', message: 'No.', traceId: 't' },
      );
    }
    if (url === '/v1/components') return json(200, options.components ?? COMPONENTS);
    if (url === `/v1/documents/${DOCUMENT}`) return json(200, view());
    if (url === `/v1/documents/${DOCUMENT}/outline`) {
      await gate;
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
    /** What was recorded last, as the service would now answer it. */
    latest: () => view(),
    restore: (url: string) => refusals.delete(url),
    /** Holds every outline answer until the returned function is called. */
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
      outline: { schemaVersion: 1, nodes: 'none' },
    });
    await userEvent.click(item('Introduction'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

    expect(await screen.findByText('This document could not be read.')).toBeInTheDocument();
    expect(screen.queryByText(/Reload/)).toBeNull();
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
      schemaVersion: 1,
      title: 'The dosing report',
      language: 'fr-CA',
      direction: 'rtl',
      nodes: [],
    },
    mayEdit: true,
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
