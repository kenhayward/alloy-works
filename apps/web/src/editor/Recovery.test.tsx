import { createApiClient } from '@alloy-works/api-client';
import type { EditorView } from '@alloy-works/editor';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ComponentEditor } from './ComponentEditor.js';
import { heldSentence } from './held.js';
import { iterationLabel, savedTime, unsavedSentence } from './recovery.js';
import { designTiming } from './session.js';

const COMPONENT = '6a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';
const ADA = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const GRACE = 'f1e2d3c4-b5a6-4978-8899-aabbccddeeff';
const OTHER_WINDOW = '5c4b3a29-1807-4f6e-9d5c-4b3a29180706';

const content = (...texts: string[]) => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: texts.map((text, index) => ({
    type: 'paragraph',
    id: `b${index + 1}`,
    style: 'body',
    content: [{ type: 'text', value: text, marks: [] }],
  })),
});

/** A component whose type gives it one field, Code, so that a restore brings back a value too. */
const opened = (overrides: Record<string, unknown> = {}) => ({
  id: COMPONENT,
  space: { id: 's1', name: 'General' },
  version: {
    id: 'v1',
    number: '0.1',
    author: ADA,
    createdAt: '2026-09-16T09:00:00.000Z',
    note: null,
  },
  content: content('Unbox the printer.'),
  mayEdit: true,
  lock: null,
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

/** Newest first, as the service lists them; the oldest written against the version before. */
const SAVED = [
  {
    id: 'i3',
    createdAt: '2026-09-28T14:02:07.000Z',
    openedFrom: { id: 'v1', number: '0.1' },
    text: 'Unbox the printer and keep the box.',
    code: 'B2',
  },
  {
    id: 'i2',
    createdAt: '2026-09-28T14:01:40.000Z',
    openedFrom: { id: 'v1', number: '0.1' },
    text: 'Unbox the printer and keep',
    code: 'B',
  },
  {
    id: 'i1',
    createdAt: '2026-09-28T13:10:00.000Z',
    openedFrom: { id: 'v0', number: '0.0' },
    text: 'Unbox it.',
    code: 'A',
  },
];

interface Asked {
  readonly route: string;
  readonly path: string;
  readonly query: Record<string, string>;
  readonly body: unknown;
}

type Answer = (asked: Asked) => Response | Promise<Response>;

/**
 * The service as the editor meets it, by method and route. A save's session and sequence, and an
 * iteration's id, are read as `{session}`, `{sequence}` and `{iteration}`: a Recover claims under a
 * session this page mints, so no fixed id can name its saves, and one entry answers every save.
 */
function service(answers: Record<string, Answer>) {
  const asked: Asked[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const text =
      request.method === 'GET' || request.method === 'DELETE' ? '' : await request.text();
    const route = `${request.method} ${url.pathname
      .replace(COMPONENT, '{id}')
      .replace(/\/iterations\/[0-9a-f-]{36}\/\d+$/, '/iterations/{session}/{sequence}')
      .replace(/\/iterations\/(?!\{)[^/]+$/, '/iterations/{iteration}')}`;
    const one: Asked = {
      route,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body: text === '' ? undefined : (JSON.parse(text) as unknown),
    };
    asked.push(one);
    const answer = answers[route];
    return answer ? answer(one) : json(404, { code: 'not_found', message: 'none', traceId: 't' });
  });
  const client = createApiClient({
    baseUrl: 'http://dev.acme.test',
    fetch: fetching as unknown as typeof fetch,
  });
  return { client, asked };
}

const lock = (session: string) => ({
  holder: { id: ADA, name: 'Ada' },
  expectedRelease: '2026-09-28T14:20:00.000Z',
  yours: true,
  session,
});

/** The iteration answered whole, by the id in its address. */
const whole: Answer = ({ path }) => {
  const saved = SAVED.find((each) => path.endsWith(`/${each.id}`));
  if (!saved) return json(404, { code: 'not_found', message: 'none', traceId: 't' });
  return json(200, {
    id: saved.id,
    session: OTHER_WINDOW,
    sequence: 1,
    createdAt: saved.createdAt,
    openedFrom: saved.openedFrom,
    content: content(saved.text),
    values: { 'field-code': saved.code },
  });
};

/**
 * Every route a Recovery needs: the claim, any save, the listing two to a page - the newest saved
 * from the session asking, the rest from another window - and each iteration read whole.
 */
const recovering = (
  component: Record<string, unknown>,
  overrides: Record<string, Answer> = {},
): Record<string, Answer> => ({
  'GET /v1/components/{id}': () => json(200, component),
  'POST /v1/components/{id}/lock': ({ body }) =>
    json(200, { lock: lock((body as { session: string }).session) }),
  'PUT /v1/components/{id}/iterations/{session}/{sequence}': ({ path }) =>
    json(200, { sequence: Number(path.split('/').at(-1)), lock: lock(OTHER_WINDOW) }),
  'GET /v1/components/{id}/iterations': ({ query }) => {
    const from = query.cursor === undefined ? 0 : Number(query.cursor);
    const page = SAVED.slice(from, from + 2);
    return json(200, {
      items: page.map((each, at) => ({
        id: each.id,
        session: at === 0 && from === 0 ? query.session : OTHER_WINDOW,
        sequence: 1,
        createdAt: each.createdAt,
        openedFrom: each.openedFrom,
      })),
      next: from + 2 < SAVED.length ? String(from + 2) : null,
    });
  },
  'GET /v1/components/{id}/iterations/{iteration}': whole,
  ...overrides,
});

const quick = { ...designTiming, idleMs: 10, continuousMs: 50 };

/** Opens the editor as a tab opened afresh does: with no session of its own in session storage. */
function open(answers: Record<string, Answer>) {
  const { client, asked } = service(answers);
  let view: EditorView | undefined;
  render(
    <ComponentEditor
      componentId={COMPONENT}
      client={client}
      principalId={ADA}
      timing={quick}
      onView={(mounted) => (view = mounted)}
    />,
  );
  const surface = async () => {
    await screen.findByRole('textbox', { name: 'Content of Install the printer' });
    // The header commits after ProseMirror mounts: wait for it, as every editor test does.
    await screen.findByLabelText('Title');
    return view!;
  };
  return { asked, surface };
}

const box = () => screen.getByRole('textbox', { name: 'Content of Install the printer' });
const code = () =>
  within(screen.getByRole('region', { name: 'Fields of Protocol' })).getByRole('textbox', {
    name: /^Code/,
  });
const panel = () => screen.findByRole('region', { name: 'Saved text' });
/** The editor's one live region, outside the article: the fields form has a status of its own. */
const editorStatus = () =>
  screen.getAllByRole('status').find((each) => each.closest('article') === null)!;
const restoreOf = (at: number) =>
  screen.getByRole('button', { name: `Restore ${iterationLabel(SAVED[at]!.createdAt)}` });
const unsaved = { savedAt: SAVED[0]!.createdAt };

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Recovery in the component editor', () => {
  it('CNT-067 offers what was saved after a closed tab, and restoring it puts the author back at that text and its values', async () => {
    const { asked, surface } = open(recovering(opened({ unsaved })));
    await surface();
    const offer = screen.getByText(unsavedSentence(unsaved.savedAt));
    expect(box()).toHaveTextContent('Unbox the printer.');
    expect(code()).toHaveValue('A1');
    // Nothing of the saved text has left the service: only its time, until the lock is held.
    expect(asked.map((each) => each.route)).toEqual(['GET /v1/components/{id}']);

    await userEvent.click(within(offer.parentElement!).getByRole('button', { name: 'Recover' }));
    await panel();
    // Claimed afresh, moving the lock from any window of Ada's own.
    const claim = asked.find((each) => each.route === 'POST /v1/components/{id}/lock')!;
    expect(claim.body).toMatchObject({ move: true });

    await userEvent.click(restoreOf(0));
    await waitFor(() => expect(box()).toHaveTextContent('Unbox the printer and keep the box.'));
    expect(code()).toHaveValue('B2');
    expect(screen.queryByRole('region', { name: 'Saved text' })).toBeNull();
    expect(editorStatus()).toHaveTextContent(`Restored ${iterationLabel(SAVED[0]!.createdAt)}.`);
    // And the author is editing again, from that text, which is sent as the next save.
    expect(box()).toHaveAttribute('contenteditable', 'true');
    await waitFor(() =>
      expect(asked.filter((each) => each.route.startsWith('PUT')).at(-1)?.body).toMatchObject({
        openedFrom: 'v1',
        content: content('Unbox the printer and keep the box.'),
        values: { 'field-code': 'B2' },
      }),
    );
    // The offer is gone: this page has a session of its own now.
    expect(screen.queryByText(unsavedSentence(unsaved.savedAt))).toBeNull();
  });

  it('CNT-090 lists the retained iterations newest first, and restores content and values only after saving what was on screen', async () => {
    let refusedOnce = false;
    const { asked, surface } = open(
      recovering(opened(), {
        // The first save finds newer text saved from another window: the session is lost.
        'PUT /v1/components/{id}/iterations/{session}/{sequence}': ({ path }) => {
          if (!refusedOnce) {
            refusedOnce = true;
            return json(409, {
              code: 'iteration_stale',
              message: 'stale',
              traceId: 't',
              latest: 7,
            });
          }
          return json(200, { sequence: Number(path.split('/').at(-1)), lock: lock(OTHER_WINDOW) });
        },
      }),
    );
    const view = await surface();
    view.dispatch(view.state.tr.insertText(' Keep the box.', 19));
    await screen.findByRole('button', { name: 'Continue' });

    // Lost, with Recovery offered beside Continue.
    const before = asked.length;
    await userEvent.click(screen.getByRole('button', { name: 'Recover' }));
    const shown = await panel();
    const rows = await within(shown).findAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining(savedTime(SAVED[0]!.createdAt, new Date(), true)),
      expect.stringContaining(savedTime(SAVED[1]!.createdAt, new Date(), true)),
    ]);
    expect(rows[0]).toHaveTextContent('This window');
    expect(rows[1]).toHaveTextContent('Another window');
    expect(rows[0]).toHaveTextContent('Version 0.1');

    await userEvent.click(restoreOf(1));
    await waitFor(() => expect(box()).toHaveTextContent('Unbox the printer and keep'));
    expect(box()).not.toHaveTextContent('box.');
    expect(code()).toHaveValue('B');
    const after = asked.slice(before).map((each) => each.route);
    const flushed = after.indexOf('PUT /v1/components/{id}/iterations/{session}/{sequence}');
    const read = after.indexOf('GET /v1/components/{id}/iterations/{iteration}');
    // What was on screen is saved first, under the session Recover claimed, and acknowledged, before
    // the saved text is read.
    expect(flushed).toBeGreaterThanOrEqual(0);
    expect(read).toBeGreaterThan(flushed);
    expect(asked[before + flushed]!.body).toMatchObject({
      content: content('Unbox the printer. Keep the box.'),
    });
    expect(asked[before + read]!.path).toBe(`/v1/components/${COMPONENT}/iterations/i2`);
    // Undo reaches nothing from before the restore: its history starts there (RC-G). `Mod-z`
    // through the key handlers the view's state was built with, as a real keydown reaches it.
    const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);
    const undone = view.someProp('handleKeyDown', (handle) =>
      handle(view, {
        key: 'z',
        keyCode: 90,
        ctrlKey: !mac,
        metaKey: mac,
        altKey: false,
        shiftKey: false,
      } as never),
    );
    expect(undone ?? false).toBe(false);
    expect(box()).toHaveTextContent('Unbox the printer and keep');
  });

  it('pages the list with Show older, and moves the focus to the first row it adds', async () => {
    const { surface } = open(recovering(opened({ unsaved })));
    await surface();
    await userEvent.click(screen.getByRole('button', { name: 'Recover' }));
    const shown = await panel();
    await within(shown).findAllByRole('listitem');
    await userEvent.click(within(shown).getByRole('button', { name: 'Show older' }));
    await waitFor(() => expect(within(shown).getAllByRole('listitem')).toHaveLength(3));
    expect(within(shown).getAllByRole('listitem')[2]).toHaveTextContent('Version 0.0');
    expect(within(shown).queryByRole('button', { name: 'Show older' })).toBeNull();
    expect(document.activeElement).toBe(restoreOf(2));
  });

  it('refuses an iteration that does not read, by name, and keeps the list open with the text as it was', async () => {
    const { surface } = open(
      recovering(opened({ unsaved }), {
        'GET /v1/components/{id}/iterations/{iteration}': () =>
          json(200, {
            id: 'i3',
            session: OTHER_WINDOW,
            sequence: 1,
            createdAt: SAVED[0]!.createdAt,
            openedFrom: SAVED[0]!.openedFrom,
            content: { schemaVersion: 1, title: 'Install the printer', content: 'not blocks' },
            values: {},
          }),
      }),
    );
    await surface();
    await userEvent.click(screen.getByRole('button', { name: 'Recover' }));
    const shown = await panel();
    await within(shown).findAllByRole('listitem');
    await userEvent.click(restoreOf(0));
    const refusal = `The text saved at ${savedTime(SAVED[0]!.createdAt, new Date(), true)} could not be read, so it was not restored.`;
    expect(await within(shown).findByText(refusal)).toBeInTheDocument();
    expect(editorStatus()).toHaveTextContent(refusal);
    expect(screen.getByRole('region', { name: 'Saved text' })).toBe(shown);
    expect(box()).toHaveTextContent('Unbox the printer.');
    expect(code()).toHaveValue('A1');
  });

  it('moves the focus into the list as it opens, and back to the text when it is closed', async () => {
    const { surface } = open(recovering(opened({ unsaved })));
    await surface();
    await userEvent.click(screen.getByRole('button', { name: 'Recover' }));
    const shown = await panel();
    await waitFor(() => expect(shown).toHaveFocus());
    expect(editorStatus()).toHaveTextContent(
      'Your saved text is listed. Restore some of it, or close the list to go on editing.',
    );
    // Everything in it is a button, reached by Tab.
    await within(shown).findAllByRole('listitem');
    await userEvent.tab();
    expect(document.activeElement).toBe(restoreOf(0));

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Saved text' })).toBeNull());
    expect(box()).toHaveFocus();
    expect(box()).toHaveAttribute('contenteditable', 'true');
    expect(box()).toHaveTextContent('Unbox the printer.');
  });

  it('says who holds the component when somebody else does, as a refused claim does', async () => {
    const grace = { name: 'Grace', expectedRelease: '2026-09-28T14:20:00.000Z' };
    const { asked, surface } = open(
      recovering(opened({ unsaved }), {
        'POST /v1/components/{id}/lock': () =>
          json(409, {
            code: 'lock_held',
            message: 'held',
            traceId: 't',
            holder: { id: GRACE, name: 'Grace' },
            expectedRelease: grace.expectedRelease,
          }),
      }),
    );
    await surface();
    await userEvent.click(screen.getByRole('button', { name: 'Recover' }));
    await waitFor(() => expect(editorStatus()).toHaveTextContent(heldSentence(grace)));
    expect(screen.queryByRole('region', { name: 'Saved text' })).toBeNull();
    expect(asked.some((each) => each.route.startsWith('GET /v1/components/{id}/iterations'))).toBe(
      false,
    );
    // Still offered, for when Grace is done.
    expect(screen.getByRole('button', { name: 'Recover' })).toBeInTheDocument();
  });

  it('offers nothing where nothing was saved, and a reader is never offered Recover', async () => {
    open(recovering(opened()));
    await screen.findByLabelText('Title');
    expect(screen.queryByRole('button', { name: 'Recover' })).toBeNull();
    cleanup();
    open(recovering(opened({ unsaved, mayEdit: false })));
    await screen.findByLabelText('Title');
    expect(screen.queryByRole('button', { name: 'Recover' })).toBeNull();
  });
});
