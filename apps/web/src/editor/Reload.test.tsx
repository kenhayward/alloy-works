import { createApiClient } from '@alloy-works/api-client';
import {
  fromEditor,
  NodeSelection,
  openFootnote,
  type EditorView,
  type Transaction,
} from '@alloy-works/editor';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComponentEditor } from './ComponentEditor.js';
import { heldSentence } from './held.js';
import { iterationLabel } from './recovery.js';
import { designTiming, type Timing } from './session.js';

const COMPONENT = '6a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';
const ADA = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const GRACE = 'f1e2d3c4-b5a6-4978-8899-aabbccddeeff';
const STEPS = `alloy-works:editing-steps:${COMPONENT}`;
const SESSION_KEY = `alloy-works:editing-session:${COMPONENT}`;

const paragraph = (id: string, text: string, ...more: unknown[]) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [...(text === '' ? [] : [{ type: 'text', value: text, marks: [] }]), ...more],
});

const document = (...blocks: unknown[]) => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: blocks,
});

const version = (id: string, number: string) => ({
  id,
  number,
  author: ADA,
  createdAt: '2026-09-28T09:00:00.000Z',
  note: null,
});

/** A component whose type gives it one field, Code, so a reload has a value to bring back too. */
const component = (overrides: Record<string, unknown>) => ({
  id: COMPONENT,
  space: { id: 's1', name: 'General' },
  mayEdit: true,
  unsaved: null,
  type: { id: 'type-protocol', name: 'Protocol' },
  fields: [
    {
      id: 'field-code',
      name: 'Code',
      dataType: 'text',
      multiplicity: 'one',
      validation: {},
      required: false,
      requiredBy: [],
      fixed: false,
      fixedBy: [],
    },
  ],
  schemas: [],
  values: { 'field-code': 'A1' },
  ...overrides,
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const lockOf = (session: string) => ({
  holder: { id: ADA, name: 'Ada' },
  expectedRelease: '2026-09-28T14:20:00.000Z',
  yours: true,
  session,
});

const GRACE_RELEASE = '2026-09-28T15:00:00.000Z';
const SAVED_AT = '2026-09-28T14:02:07.000Z';

interface Save {
  readonly session: string;
  readonly sequence: number;
  readonly body: { openedFrom: string; content: unknown; values?: Record<string, unknown> };
}

/**
 * The service across a reload: it outlives the page, keeping what it accepted from each session and
 * the version the component is at, and answering a GET that names a session its latest sequence.
 * Each page has a client of its own, and once a reload has torn a page down nothing it sends arrives,
 * as nothing a page sends as it unloads can be relied on to.
 */
function service() {
  const accepted = new Map<string, number>();
  const saves: Save[] = [];
  const claims: { session: string; move?: boolean }[] = [];
  const state = {
    /** The page now open; a request from any before it is dropped. */
    page: 0,
    version: version('v1', '0.1'),
    content: document(paragraph('b1', 'Unbox the printer.')) as unknown,
    /** Whether Grace holds the lock, over anything of Ada's. */
    grace: false,
    /** The session of Ada's holding the lock, or null where none does. */
    lock: null as string | null,
    /** Whether Ada may still edit it. */
    mayEdit: true,
    /** While true, a save waits for `release` before it is answered. */
    holding: false,
  };
  const waiting: (() => void)[] = [];
  /** Answers every save held so far, in the order they arrived. */
  const release = () => {
    state.holding = false;
    for (const each of waiting.splice(0)) each();
  };
  const answer = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = url.pathname.replace(`/v1/components/${COMPONENT}`, '');
    const body =
      request.method === 'GET' || request.method === 'DELETE'
        ? undefined
        : (JSON.parse(await request.text()) as Record<string, unknown>);
    if (request.method === 'GET' && path === '') {
      const session = url.searchParams.get('session');
      return json(
        200,
        component({
          version: state.version,
          content: state.content,
          mayEdit: state.mayEdit,
          lock: state.grace
            ? {
                holder: { id: GRACE, name: 'Grace' },
                expectedRelease: GRACE_RELEASE,
                yours: false,
                session: null,
              }
            : state.lock === null
              ? null
              : lockOf(state.lock),
          sequence: session === null ? null : (accepted.get(session) ?? null),
          // What was saved from the version that opens and never made a version (RC-F).
          unsaved: saves.some((each) => each.body.openedFrom === state.version.id)
            ? { savedAt: SAVED_AT }
            : null,
        }),
      );
    }
    if (request.method === 'POST' && path === '/lock') {
      const claim = body as { session: string; move?: boolean };
      claims.push(claim);
      // Held by Grace, or by another of Ada's sessions that this claim does not move it from.
      if (state.grace || (state.lock !== null && state.lock !== claim.session && !claim.move)) {
        return json(409, {
          code: 'lock_held',
          message: 'held',
          traceId: 't',
          holder: state.grace ? { id: GRACE, name: 'Grace' } : { id: ADA, name: 'Ada' },
          expectedRelease: GRACE_RELEASE,
        });
      }
      state.lock = claim.session;
      return json(200, { lock: lockOf(claim.session) });
    }
    const saving = /^\/iterations\/([0-9a-f-]{36})\/(\d+)$/.exec(path);
    if (request.method === 'PUT' && saving) {
      if (state.holding) await new Promise<void>((resolve) => waiting.push(resolve));
      const session = saving[1]!;
      const sequence = Number(saving[2]);
      const latest = accepted.get(session) ?? 0;
      if (sequence <= latest) {
        return json(409, { code: 'iteration_stale', message: 'stale', traceId: 't', latest });
      }
      accepted.set(session, sequence);
      saves.push({ session, sequence, body: body as Save['body'] });
      return json(200, { sequence, lock: lockOf(session) });
    }
    if (request.method === 'POST' && path === '/versions') {
      const last = saves.at(-1)!;
      state.version = version('v2', '0.2');
      state.content = last.body.content;
      return json(200, { outcome: 'cut', version: state.version });
    }
    // Done editing with nothing to cut: the text is the version's again.
    if (request.method === 'DELETE' && path === '/lock') {
      state.lock = null;
      return json(200, { outcome: 'unchanged', version: state.version });
    }
    // Recovery's two reads, newest first, each save named by where it stands and saved a minute apart.
    const savedAt = (at: number) => `2026-09-28T14:${String(at).padStart(2, '0')}:00.000Z`;
    if (request.method === 'GET' && path === '/iterations') {
      return json(200, {
        items: saves
          .map((each, at) => ({
            id: `i${at}`,
            session: each.session,
            sequence: each.sequence,
            createdAt: savedAt(at),
            openedFrom: { id: each.body.openedFrom, number: '0.1' },
          }))
          .reverse(),
        next: null,
      });
    }
    const reading = /^\/iterations\/i(\d+)$/.exec(path);
    if (request.method === 'GET' && reading) {
      const at = Number(reading[1]);
      const saved = saves[at]!;
      return json(200, {
        id: `i${at}`,
        session: saved.session,
        sequence: saved.sequence,
        createdAt: savedAt(at),
        openedFrom: { id: saved.body.openedFrom, number: '0.1' },
        content: saved.body.content,
        values: saved.body.values ?? {},
      });
    }
    return json(404, { code: 'not_found', message: 'none', traceId: 't' });
  };
  /** A client for the page now open. */
  const client = () => {
    const page = state.page;
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (page !== state.page) return new Promise<Response>(() => {});
      return answer(input instanceof Request ? input : new Request(String(input), init));
    });
    return createApiClient({
      baseUrl: 'http://dev.acme.test',
      fetch: fetching as unknown as typeof fetch,
    });
  };
  /** How many saves are waiting to be answered. */
  const held = () => waiting.length;
  return { client, state, saves, claims, accepted, release, held };
}

type Service = ReturnType<typeof service>;

/** Opens the component in a page of its own, as a tab does, over the one service and this window's storage. */
async function openPage(stack: Service, timing: Timing = designTiming, principal = ADA) {
  let view: EditorView | undefined;
  render(
    <ComponentEditor
      componentId={COMPONENT}
      client={stack.client()}
      principalId={principal}
      timing={timing}
      onView={(mounted) => (view = mounted)}
    />,
  );
  await screen.findByRole('textbox', { name: 'Content of Install the printer' });
  // The header commits after ProseMirror mounts: wait for it, as every editor test does.
  await screen.findByLabelText('Title');
  return view!;
}

/**
 * Reloads the page: it is hidden and goes, with nothing it sends arriving, and comes back over the
 * same storage - `meanwhile` run on it between, as whatever else a reload finds changed.
 */
async function reload(
  stack: Service,
  timing: Timing = designTiming,
  { principal = ADA, meanwhile }: { principal?: string; meanwhile?: () => void } = {},
) {
  stack.state.page += 1;
  window.dispatchEvent(new Event('pagehide'));
  cleanup();
  meanwhile?.();
  return openPage(stack, timing, principal);
}

/** The kept record, changed by `change`, as another build or a broken record would leave it. */
const rewriteKept = (change: (kept: Record<string, unknown>) => Record<string, unknown>) =>
  sessionStorage.setItem(
    STEPS,
    JSON.stringify(change(JSON.parse(sessionStorage.getItem(STEPS)!) as Record<string, unknown>)),
  );

/** Saves after a hundredth of a second without a change, so a test can wait for them. */
const quick = { ...designTiming, idleMs: 10, continuousMs: 50 };

/** Types at `pos`, a second after the last change, so each is an undo event of its own. */
let clock = Date.now();
const type = (view: EditorView, text: string, pos: number) =>
  act(() => {
    clock += 1_000;
    view.dispatch(view.state.tr.insertText(text, pos).setTime(clock));
  });
/** Deletes from `from` to `to`, a tenth of a second after the last change: joined to it, as typing is. */
const deleteSoon = (view: EditorView, from: number, to: number) =>
  act(() => {
    clock += 100;
    view.dispatch(view.state.tr.delete(from, to).setTime(clock));
  });
const dispatch = (view: EditorView, tr: Transaction) => act(() => view.dispatch(tr));

const press = (view: EditorView, key: 'z' | 'y') =>
  act(() => {
    fireEvent.keyDown(view.dom, { key, keyCode: key === 'z' ? 90 : 89, ctrlKey: true });
  });

const textOf = (view: EditorView) => view.state.doc.textContent;
const editing = () =>
  waitFor(() => expect(screen.getByRole('button', { name: 'Save version' })).not.toBeDisabled());
const code = () =>
  within(screen.getByRole('region', { name: 'Fields of Protocol' })).getByRole('textbox', {
    name: /^Code/,
  });
const editorStatus = () =>
  screen.getAllByRole('status').find((each) => each.closest('article') === null)!;

beforeEach(() => sessionStorage.clear());

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('undo across a reload (component-editor.md, "Undo across a reload")', () => {
  it('CNT-069 keeps undo and redo across a reload, one undo to each event however it was grouped, back to the text the session opened from, for the component being edited alone', async () => {
    const stack = service();
    // What this window keeps for another component, which nothing here touches.
    const elsewhere = 'alloy-works:editing-steps:5c4b3a29-1807-4f6e-9d5c-4b3a29180706';
    sessionStorage.setItem(elsewhere, 'kept for another component');
    const view = await openPage(stack);
    // Two changes a tenth of a second apart, side by side: one undo event, as the history joined them.
    type(view, ' Minds', 19);
    await editing();
    deleteSoon(view, 24, 25);
    type(view, ' the cable.', 24);
    type(view, ' Keep the box.', 35);
    press(view, 'z');
    expect(textOf(view)).toBe('Unbox the printer. Mind the cable.');

    const again = await reload(stack);
    await editing();
    expect(textOf(again)).toBe('Unbox the printer. Mind the cable.');
    // What was undone before the reload is still there to redo.
    press(again, 'y');
    expect(textOf(again)).toBe('Unbox the printer. Mind the cable. Keep the box.');
    // One undo to each event, as before the reload, and none past the version it opened from.
    press(again, 'z');
    expect(textOf(again)).toBe('Unbox the printer. Mind the cable.');
    press(again, 'z');
    expect(textOf(again)).toBe('Unbox the printer. Mind');
    // The joined pair, taken by one undo.
    press(again, 'z');
    expect(textOf(again)).toBe('Unbox the printer.');
    press(again, 'z');
    expect(textOf(again)).toBe('Unbox the printer.');
    expect(sessionStorage.getItem(elsewhere)).toBe('kept for another component');
  });

  it('CNT-067 loses nothing past the last save acknowledged: what was not sent reaches the service after a reload, above its sequence, under the same session', async () => {
    const stack = service();
    const view = await openPage(stack, quick);
    type(view, ' Mind the cable.', 19);
    await waitFor(() => expect(stack.saves).toHaveLength(1));
    const [first] = stack.saves;
    // Then more, and the page goes before it is saved.
    type(view, ' Keep the box.', 35);
    fireEvent.change(code(), { target: { value: 'B2' } });

    const again = await reload(stack, quick);
    await waitFor(() => expect(stack.saves).toHaveLength(2));
    const next = stack.saves[1]!;
    expect(next.session).toBe(first!.session);
    expect(next.sequence).toBeGreaterThan(first!.sequence);
    expect(next.body).toMatchObject({
      openedFrom: 'v1',
      content: document(paragraph('b1', 'Unbox the printer. Mind the cable. Keep the box.')),
      values: { 'field-code': 'B2' },
    });
    // Claimed again under the session it had, neither afresh nor moving the lock from anywhere.
    expect(stack.claims.at(-1)).toEqual({ session: first!.session });
    expect(textOf(again)).toBe('Unbox the printer. Mind the cable. Keep the box.');
    expect(code()).toHaveValue('B2');
    await waitFor(() =>
      expect(editorStatus()).toHaveTextContent('You are editing this component.'),
    );
  });

  it('sends nothing again after a reload where the service already has everything', async () => {
    const stack = service();
    const view = await openPage(stack, quick);
    type(view, ' Mind the cable.', 19);
    await waitFor(() => expect(stack.saves).toHaveLength(1));
    // Acknowledged, and nothing changed since.
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());

    const again = await reload(stack, quick);
    await editing();
    expect(textOf(again)).toBe('Unbox the printer. Mind the cable.');
    expect(stack.saves).toHaveLength(1);
    // And the next change goes on above what was saved, under the same session.
    type(again, ' Keep the box.', 35);
    await waitFor(() => expect(stack.saves).toHaveLength(2));
    expect(stack.saves[1]).toMatchObject({
      session: stack.saves[0]!.session,
      sequence: 2,
      body: {
        content: document(paragraph('b1', 'Unbox the printer. Mind the cable. Keep the box.')),
      },
    });
  });

  it('CNT-169 discards changes kept against a version since superseded, and undo reaches nothing before the version that opens', async () => {
    const stack = service();
    const view = await openPage(stack);
    type(view, ' Mind the cable.', 19);
    await editing();
    // Somebody cuts a version while this page is away.
    stack.state.version = version('v2', '0.2');
    stack.state.content = document(paragraph('b1', 'Unbox the printer carefully.'));

    const again = await reload(stack);
    expect(textOf(again)).toBe('Unbox the printer carefully.');
    press(again, 'z');
    expect(textOf(again)).toBe('Unbox the printer carefully.');
    expect(sessionStorage.getItem(STEPS)).toBeNull();
    expect(stack.saves).toHaveLength(0);
  });

  it('CNT-169 replays nothing from before a version cut in the session, after a reload as before it', async () => {
    const stack = service();
    const view = await openPage(stack);
    type(view, ' Mind the cable.', 19);
    await editing();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Save version' }));
    });
    await screen.findByText('Version 0.2 saved.');
    // The kept changes went with the cut, as the history did.
    expect(sessionStorage.getItem(STEPS)).toBeNull();
    type(view, ' Keep the box.', 35);

    const again = await reload(stack);
    await editing();
    expect(textOf(again)).toBe('Unbox the printer. Mind the cable. Keep the box.');
    press(again, 'z');
    expect(textOf(again)).toBe('Unbox the printer. Mind the cable.');
    press(again, 'z');
    expect(textOf(again)).toBe('Unbox the printer. Mind the cable.');
  });

  it('goes on under its own session after a reload straight after Save version, above the sequence the service has', async () => {
    const stack = service();
    const view = await openPage(stack, quick);
    type(view, ' Mind the cable.', 19);
    await waitFor(() => expect(stack.saves).toHaveLength(1));
    const held = stack.saves[0]!.session;
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Save version' }));
    });
    await screen.findByText('Version 0.2 saved.');
    // Nothing is kept for a reload past the cut, but the lock is still this session's.
    expect(sessionStorage.getItem(STEPS)).toBeNull();
    expect(stack.state.lock).toBe(held);

    const again = await reload(stack, quick);
    type(again, ' Keep the box.', 35);
    await waitFor(() => expect(stack.saves).toHaveLength(2));
    expect(stack.saves[1]).toMatchObject({
      session: held,
      sequence: 2,
      body: { openedFrom: 'v2' },
    });
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
    expect(screen.queryByText(/^Newer text was saved/)).toBeNull();
  });

  it('reads the component where somebody else holds it after a reload, offering the kept changes as text to copy', async () => {
    const stack = service();
    const view = await openPage(stack);
    type(view, ' Mind the cable.', 19);
    await editing();
    stack.state.grace = true;

    const again = await reload(stack);
    await waitFor(() =>
      expect(screen.getByLabelText('Text that was not saved')).toHaveValue(
        'Unbox the printer. Mind the cable.',
      ),
    );
    expect(textOf(again)).toBe('Unbox the printer.');
    expect(editorStatus()).toHaveTextContent(
      heldSentence({ name: 'Grace', expectedRelease: GRACE_RELEASE }),
    );
    expect(screen.getByRole('button', { name: 'Save version' })).toBeDisabled();
    expect(sessionStorage.getItem(STEPS)).toBeNull();
  });

  it('reads the latest version where somebody else holds it after a reload, with nothing to copy where everything kept was saved', async () => {
    const stack = service();
    const view = await openPage(stack, quick);
    type(view, ' Mind the cable.', 19);
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
    stack.state.grace = true;

    const again = await reload(stack, quick);
    await waitFor(() =>
      expect(editorStatus()).toHaveTextContent(
        heldSentence({ name: 'Grace', expectedRelease: GRACE_RELEASE }),
      ),
    );
    await waitFor(() => expect(textOf(again)).toBe('Unbox the printer.'));
    // Nothing unsaved to copy: what was replayed is in the service. Nothing is offered while Grace
    // holds it (W11.2's re-review); Try again is there for when she is done.
    expect(screen.queryByLabelText('Text that was not saved')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Recover/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(sessionStorage.getItem(STEPS)).toBeNull();
  });

  it('forgets the kept changes when saved text is restored, as the history is, so a reload replays nothing from before it', async () => {
    const stack = service();
    const view = await openPage(stack, quick);
    type(view, ' Mind', 19);
    await waitFor(() => expect(stack.saves).toHaveLength(1));
    // Another page of this same session has saved past this one: the next save is refused as stale.
    stack.accepted.set(stack.saves[0]!.session, 5);
    type(view, ' the cable.', 24);
    const recover = await screen.findByRole('button', { name: 'Recover' });
    expect(sessionStorage.getItem(STEPS)).not.toBeNull();

    act(() => {
      fireEvent.click(recover);
    });
    const first = await screen.findByRole('button', {
      name: `Restore ${iterationLabel('2026-09-28T14:00:00.000Z')}`,
    });
    act(() => {
      fireEvent.click(first);
    });
    await waitFor(() => expect(textOf(view)).toBe('Unbox the printer. Mind'));
    await waitFor(() => expect(sessionStorage.getItem(STEPS)).toBeNull());

    const again = await reload(stack, quick);
    expect(textOf(again)).toBe('Unbox the printer.');
    press(again, 'z');
    expect(textOf(again)).toBe('Unbox the printer.');
  });

  it('goes on after a reload under the session Continue started afresh, not the one it left', async () => {
    const stack = service();
    const view = await openPage(stack, quick);
    type(view, ' Mind', 19);
    await waitFor(() => expect(stack.saves).toHaveLength(1));
    const left = stack.saves[0]!.session;
    stack.accepted.set(left, 5);
    type(view, ' the cable.', 24);
    const going = await screen.findByRole('button', { name: 'Continue' });
    act(() => {
      fireEvent.click(going);
    });
    await waitFor(() => expect(stack.saves).toHaveLength(2));
    const started = stack.saves[1]!.session;
    expect(started).not.toBe(left);
    type(view, ' Keep the box.', 35);

    const again = await reload(stack, quick);
    await waitFor(() => expect(stack.saves).toHaveLength(3));
    expect(stack.claims.at(-1)).toEqual({ session: started });
    expect(stack.saves[2]!.sequence).toBeGreaterThan(stack.saves[1]!.sequence);
    expect(stack.saves[2]).toMatchObject({
      session: started,
      body: {
        content: document(paragraph('b1', 'Unbox the printer. Mind the cable. Keep the box.')),
      },
    });
    expect(textOf(again)).toBe('Unbox the printer. Mind the cable. Keep the box.');
  });

  it('claims nothing after a reload once Done editing has released the component, though nothing was cut', async () => {
    const stack = service();
    const view = await openPage(stack, quick);
    type(view, ' Mind', 19);
    await editing();
    press(view, 'z');
    await waitFor(() => expect(stack.saves.at(-1)?.body.content).toEqual(stack.state.content));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Done editing' }));
    });
    await screen.findByText('Nothing has changed since version 0.1.');
    const claimed = stack.claims.length;

    await reload(stack, quick);
    expect(stack.claims).toHaveLength(claimed);
    expect(screen.getByRole('button', { name: 'Save version' })).toBeDisabled();
    expect(sessionStorage.getItem(STEPS)).toBeNull();
  });

  it('opens as a stale save does, sending nothing and claiming nothing, where the service holds a later save under the session than this window sent', async () => {
    const stack = service();
    const view = await openPage(stack, quick);
    type(view, ' Mind', 19);
    await waitFor(() => expect(stack.saves).toHaveLength(1));
    const held = stack.saves[0]!.session;
    type(view, ' the cable.', 24);
    // Another page holding the same session - a duplicated tab - has saved past this one.
    const again = await reload(stack, quick, { meanwhile: () => stack.accepted.set(held, 5) });
    const claimed = stack.claims.length;
    const saved = stack.saves.length;

    await screen.findByText(/^Newer text was saved from another window/);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recover' })).toBeInTheDocument();
    expect(textOf(again)).toBe('Unbox the printer. Mind the cable.');
    expect(screen.getByLabelText('Text from before this page opened')).toHaveValue(
      'Unbox the printer. Mind the cable.',
    );
    expect(stack.claims).toHaveLength(claimed);
    expect(stack.saves).toHaveLength(saved);

    // Continuing starts a new session from what is on screen, over nothing the service holds.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    await waitFor(() => expect(stack.saves).toHaveLength(saved + 1));
    expect(stack.saves.at(-1)).toMatchObject({
      sequence: 1,
      body: { content: document(paragraph('b1', 'Unbox the printer. Mind the cable.')) },
    });
    expect(stack.saves.at(-1)!.session).not.toBe(held);
    // What was offered is offered still, though the claim that went on from it succeeded.
    expect(screen.getByLabelText('Text from before this page opened')).toHaveValue(
      'Unbox the printer. Mind the cable.',
    );
  });

  it('goes on above the last sequence this window sent under the session where nothing was kept to replay, whatever the service had yet', async () => {
    const stack = service();
    const view = await openPage(stack, quick);
    type(view, ' Mind', 19);
    await waitFor(() => expect(stack.saves).toHaveLength(1));
    const held = stack.saves[0]!.session;
    // The next save is on the wire as the page goes, and arrives only after the next page has asked.
    stack.state.holding = true;
    type(view, ' the cable.', 24);
    await waitFor(() => expect(stack.held()).toBe(1));
    // And nothing is kept to replay: storage filled, say, and the record went.
    const again = await reload(stack, quick, {
      meanwhile: () => sessionStorage.removeItem(STEPS),
    });
    stack.release();
    await waitFor(() => expect(stack.saves).toHaveLength(2));

    type(again, ' Go.', 19);
    await waitFor(() => expect(stack.saves).toHaveLength(3));
    expect(stack.saves[2]).toMatchObject({ session: held, sequence: 3 });
    expect(screen.queryByText(/^Newer text was saved/)).toBeNull();
  });

  it("takes its own page's last save, sent as it went, for its own after a reload, not for somebody else's", async () => {
    const stack = service();
    const view = await openPage(stack, quick);
    stack.state.holding = true;
    type(view, ' Mind', 19);
    await waitFor(() => expect(stack.held()).toBe(1));
    // More typed while that save is on the wire, and the page goes: its last save waits behind it.
    type(view, ' the cable.', 24);
    cleanup();
    stack.release();
    await waitFor(() => expect(stack.saves).toHaveLength(2));

    const again = await reload(stack, quick);
    await editing();
    expect(screen.queryByText(/^Newer text was saved/)).toBeNull();
    expect(textOf(again)).toBe('Unbox the printer. Mind the cable.');
    // The service has everything: nothing is sent again.
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
    expect(stack.saves).toHaveLength(2);
  });

  it('CNT-069 replays and goes on after a crash, which fires no pagehide, as after any reload', async () => {
    const stack = service();
    const view = await openPage(stack);
    type(view, ' Mind', 19);
    await editing();
    type(view, ' the cable.', 24);
    const held = stack.state.lock!;
    // Written a moment after the change, before the tab crashed.
    await waitFor(() =>
      expect(JSON.parse(sessionStorage.getItem(STEPS) ?? '{}')).toMatchObject({ revision: 2 }),
    );
    // The tab crashes, or is discarded, and is brought back: no pagehide, nothing the page sends
    // arrives, and whatever it left in session storage stays - a mark it never took off among it,
    // left under an id no later page has, since each page is a page of its own.
    stack.state.page += 1;
    cleanup();
    sessionStorage.setItem('alloy-works:editing-page', 'the page that crashed');

    const again = await openPage(stack);
    await editing();
    expect(textOf(again)).toBe('Unbox the printer. Mind the cable.');
    expect(stack.claims.at(-1)).toEqual({ session: held });
    expect(screen.queryByLabelText(/^Text/)).toBeNull();
    press(again, 'z');
    expect(textOf(again)).toBe('Unbox the printer. Mind');
    press(again, 'z');
    expect(textOf(again)).toBe('Unbox the printer.');
  });

  it('replays nothing for somebody else signed in on the same tab, and forgets what was kept', async () => {
    const stack = service();
    const view = await openPage(stack);
    type(view, ' Mind the cable.', 19);
    await editing();
    const claimed = stack.claims.length;

    const again = await reload(stack, designTiming, {
      principal: GRACE,
      // Ada's lock lapsed meanwhile, so nobody holds the component.
      meanwhile: () => (stack.state.lock = null),
    });
    expect(textOf(again)).toBe('Unbox the printer.');
    expect(screen.queryByLabelText(/^Text /)).toBeNull();
    expect(stack.claims).toHaveLength(claimed);
    expect(sessionStorage.getItem(STEPS)).toBeNull();
  });

  it('keeps what was typed at once when the page is hidden or goes, not only a moment after', async () => {
    const stack = service();
    const view = await openPage(stack);
    type(view, ' Mind', 19);
    expect(sessionStorage.getItem(STEPS)).toBeNull();
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(JSON.parse(sessionStorage.getItem(STEPS)!)).toMatchObject({ revision: 1 });

    type(view, ' the cable.', 24);
    // `document` here is the fixture's: the page's is the window's.
    const page = window.document;
    const visibility = vi.spyOn(page, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      page.dispatchEvent(new Event('visibilitychange'));
    });
    expect(JSON.parse(sessionStorage.getItem(STEPS)!)).toMatchObject({ revision: 2 });
    visibility.mockRestore();
  });

  it('offers what an older build kept as text to copy, and opens as a page opened afresh does', async () => {
    const stack = service();
    const view = await openPage(stack);
    type(view, ' Mind the cable.', 19);
    await editing();

    const again = await reload(stack, designTiming, {
      meanwhile: () => rewriteKept((kept) => ({ ...kept, format: 1 })),
    });
    await waitFor(() =>
      expect(screen.getByLabelText('Text from before this page opened')).toHaveValue(
        'Unbox the printer. Mind the cable.',
      ),
    );
    expect(textOf(again)).toBe('Unbox the printer.');
    expect(sessionStorage.getItem(STEPS)).toBeNull();
    expect(screen.getByRole('button', { name: 'Save version' })).toBeDisabled();
  });

  it('keeps offering the text it offered on opening until the author dismisses it: through typing, a claim, a save and a reload', async () => {
    const stack = service();
    const view = await openPage(stack, quick);
    type(view, ' Mind the cable.', 19);
    await waitFor(() => expect(stack.saves).toHaveLength(1));
    const offered = () => screen.queryByLabelText('Text from before this page opened');

    // What an older build kept: offered, not replayed.
    let again = await reload(stack, quick, {
      meanwhile: () => rewriteKept((kept) => ({ ...kept, format: 1 })),
    });
    await waitFor(() => expect(offered()).toHaveValue('Unbox the printer. Mind the cable.'));
    // Typed over, claimed and saved: the only copy of what was offered is still there.
    type(again, ' Go.', 19);
    await waitFor(() => expect(stack.saves).toHaveLength(2));
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
    expect(offered()).toHaveValue('Unbox the printer. Mind the cable.');

    // And after another reload, which replays the typing and offers the same text still.
    again = await reload(stack, quick);
    await editing();
    expect(textOf(again)).toBe('Unbox the printer. Go.');
    expect(offered()).toHaveValue('Unbox the printer. Mind the cable.');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    });
    expect(offered()).toBeNull();
    await reload(stack, quick);
    await editing();
    expect(offered()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('offers what was kept as text to copy where it will not replay, and opens as a page opened afresh does', async () => {
    const stack = service();
    const view = await openPage(stack);
    type(view, ' Mind the cable.', 19);
    await editing();

    const again = await reload(stack, designTiming, {
      // A record whose grouping the history does not reproduce.
      meanwhile: () =>
        rewriteKept((kept) => ({
          ...kept,
          changes: (kept.changes as Record<string, unknown>[]).map((change) => ({
            ...change,
            history: 'none',
          })),
        })),
    });
    await waitFor(() =>
      expect(screen.getByLabelText('Text from before this page opened')).toHaveValue(
        'Unbox the printer. Mind the cable.',
      ),
    );
    expect(textOf(again)).toBe('Unbox the printer.');
    expect(screen.getByRole('button', { name: 'Save version' })).toBeDisabled();
  });

  it('says so where what was kept cannot be read at all, rather than dropping it unsaid', async () => {
    const stack = service();
    const view = await openPage(stack);
    type(view, ' Mind the cable.', 19);
    await editing();

    await reload(stack, designTiming, {
      meanwhile: () =>
        rewriteKept((kept) => ({ ...kept, format: 1, changes: [{ history: 'new' }] })),
    });
    await screen.findByText('What you typed before this page opened could not be brought back.');
    expect(screen.queryByLabelText(/^Text /)).toBeNull();
  });

  it('replays nothing where the author may no longer edit the component, offering it as text to copy', async () => {
    const stack = service();
    const view = await openPage(stack);
    type(view, ' Mind the cable.', 19);
    await editing();
    const claimed = stack.claims.length;

    const again = await reload(stack, designTiming, {
      meanwhile: () => {
        stack.state.mayEdit = false;
        stack.state.lock = null;
      },
    });
    await waitFor(() =>
      expect(screen.getByLabelText('Text from before this page opened')).toHaveValue(
        'Unbox the printer. Mind the cable.',
      ),
    );
    expect(textOf(again)).toBe('Unbox the printer.');
    expect(stack.claims).toHaveLength(claimed);
  });

  it('discards what does not parse, and opens as a page opened afresh does', async () => {
    const stack = service();
    sessionStorage.setItem(SESSION_KEY, '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b');
    sessionStorage.setItem(STEPS, '{"session": "not one"');
    const view = await openPage(stack);
    expect(textOf(view)).toBe('Unbox the printer.');
    expect(sessionStorage.getItem(STEPS)).toBeNull();
    expect(stack.claims).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Save version' })).toBeDisabled();
  });

  it('takes back a change to the title after a reload, as it would have before', async () => {
    const stack = service();
    await openPage(stack);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Install the scanner' } });
    await editing();

    const again = await reload(stack);
    await editing();
    expect(screen.getByLabelText('Title')).toHaveValue('Install the scanner');
    press(again, 'z');
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Install the printer'));
    expect(again.state.doc.attrs.title).toBe('Install the printer');
  });

  it("replays what was typed in a footnote, which the footnote's own undo takes back after a reload", async () => {
    const stack = service();
    stack.state.content = document(
      paragraph('b1', 'Unbox the printer', {
        type: 'footnote',
        id: 'f1',
        anchor: { kind: 'span' },
        content: [paragraph('fp1', 'Twice.')],
      }),
    );
    const view = await openPage(stack);
    let at = -1;
    view.state.doc.descendants((node, pos) => {
      if (at === -1 && node.type.name === 'footnote') at = pos;
      return at === -1;
    });
    dispatch(view, view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)));
    act(() => {
      const inner = openFootnote(view)!;
      inner.dispatch(inner.state.tr.insertText(' At least.', inner.state.doc.content.size - 1));
    });
    await editing();
    const footnoteText = (surface: EditorView) =>
      (
        (fromEditor(surface.state.doc).content[0] as { content: unknown[] }).content[1] as {
          content: { content: { value: string }[] }[];
        }
      ).content[0]!.content[0]!.value;
    expect(footnoteText(view)).toBe('Twice. At least.');

    const again = await reload(stack);
    await editing();
    expect(footnoteText(again)).toBe('Twice. At least.');
    dispatch(again, again.state.tr.setSelection(NodeSelection.create(again.state.doc, at)));
    act(() => {
      fireEvent.keyDown(openFootnote(again)!.dom, { key: 'z', keyCode: 90, ctrlKey: true });
    });
    expect(footnoteText(again)).toBe('Twice.');
  });
});
