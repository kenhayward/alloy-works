import { createApiClient } from '@alloy-works/api-client';
import type { EditorView } from '@alloy-works/editor';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { shimRangeMeasurement } from '../test/range.js';
import { ComponentEditor } from './ComponentEditor.js';
import { heldSentence } from './held.js';
import { iterationLabel, savedTime, sentenceCase, unsavedSentence } from './recovery.js';
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
  // Handing the lock back, with nothing of this session's to cut.
  'DELETE /v1/components/{id}/lock': () =>
    json(200, {
      outcome: 'unchanged',
      version: { id: 'v1', number: '0.1', author: ADA, createdAt: 't', note: null },
    }),
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
const panel = () => screen.findByRole('dialog', { name: 'Saved text' });
/** The editor's one live region, outside the article: the fields form has a status of its own. */
const editorStatus = () =>
  screen.getAllByRole('status').find((each) => each.closest('article') === null)!;
/** A saved iteration's row, which chooses it. */
const rowOf = (at: number) =>
  screen.getByRole('button', { name: sentenceCase(iterationLabel(SAVED[at]!.createdAt)) });
/** Chooses a row, then Recover: what Restore on the row was before the dialog (the R1 plan). */
const recoverAt = async (at: number) => {
  await userEvent.click(rowOf(at));
  await userEvent.click(
    within(screen.getByRole('dialog', { name: 'Saved text' })).getByRole('button', {
      name: 'Recover',
    }),
  );
};
const unsaved = { savedAt: SAVED[0]!.createdAt };

// The focus moves onto the surface, which scrolls its selection into view.
shimRangeMeasurement();

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

    await recoverAt(0);
    await waitFor(() => expect(box()).toHaveTextContent('Unbox the printer and keep the box.'));
    expect(code()).toHaveValue('B2');
    expect(screen.queryByRole('dialog', { name: 'Saved text' })).toBeNull();
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
    // The session the page first saved under, before Recover claimed afresh: still this window's.
    let firstSession = '';
    // The first save after the refusal is answered only when the test says so.
    let answerHeld: () => void = () => {};
    let holding = true;
    const { asked, surface } = open(
      recovering(opened(), {
        // The first save finds newer text saved from another window: the session is lost.
        'PUT /v1/components/{id}/iterations/{session}/{sequence}': ({ path }) => {
          const accepted = () =>
            json(200, { sequence: Number(path.split('/').at(-1)), lock: lock(OTHER_WINDOW) });
          if (!refusedOnce) {
            refusedOnce = true;
            firstSession = path.split('/')[5]!;
            return json(409, {
              code: 'iteration_stale',
              message: 'stale',
              traceId: 't',
              latest: 7,
            });
          }
          if (!holding) return accepted();
          holding = false;
          return new Promise<Response>((resolve) => {
            answerHeld = () => resolve(accepted());
          });
        },
        'GET /v1/components/{id}/iterations': ({ query }) =>
          json(200, {
            items: SAVED.slice(0, 2).map((each, at) => ({
              id: each.id,
              session: at === 0 ? firstSession : OTHER_WINDOW,
              sequence: 1,
              createdAt: each.createdAt,
              openedFrom: each.openedFrom,
            })),
            next: query.cursor === undefined ? '2' : null,
          }),
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

    // Restore is asked for while what was on screen is still being saved: nothing is read until the
    // service has acknowledged it.
    await waitFor(() =>
      expect(asked.slice(before).some((each) => each.route.startsWith('PUT'))).toBe(true),
    );
    // Chosen, its text is read to show what it changes; Recover reads it again, and only once what
    // was on screen is acknowledged.
    const reads = () =>
      asked.filter((each) => each.route === 'GET /v1/components/{id}/iterations/{iteration}')
        .length;
    await userEvent.click(rowOf(1));
    await waitFor(() => expect(reads()).toBe(1));
    await userEvent.click(within(shown).getByRole('button', { name: 'Recover' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(reads()).toBe(1);
    expect(box()).toHaveTextContent('Unbox the printer. Keep the box.');
    answerHeld();
    await waitFor(() => expect(box()).toHaveTextContent('Unbox the printer and keep'));
    expect(box()).not.toHaveTextContent('box.');
    expect(code()).toHaveValue('B');
    const after = asked.slice(before).map((each) => each.route);
    const flushed = after.indexOf('PUT /v1/components/{id}/iterations/{session}/{sequence}');
    const read = after.lastIndexOf('GET /v1/components/{id}/iterations/{iteration}');
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
    expect(document.activeElement).toBe(rowOf(2));
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
    await recoverAt(0);
    const refusal = `The text saved at ${savedTime(SAVED[0]!.createdAt, new Date(), true)} could not be read, so it was not restored.`;
    expect(await within(shown).findByText(refusal)).toBeInTheDocument();
    expect(editorStatus()).toHaveTextContent(refusal);
    expect(screen.getByRole('dialog', { name: 'Saved text' })).toBe(shown);
    expect(box()).toHaveTextContent('Unbox the printer.');
    expect(code()).toHaveValue('A1');
  });

  it('moves the focus into the list as it opens, and back to the text when it is closed', async () => {
    const { asked, surface } = open(recovering(opened({ unsaved })));
    await surface();
    await userEvent.click(screen.getByRole('button', { name: 'Recover' }));
    const shown = await panel();
    await waitFor(() => expect(shown).toHaveFocus());
    expect(editorStatus()).toHaveTextContent(
      'Your saved text is listed. Choose some to see what recovering it changes, or cancel to go on.',
    );
    // Everything in it is a button, reached by Tab.
    await within(shown).findAllByRole('listitem');
    await userEvent.tab();
    expect(document.activeElement).toBe(rowOf(0));

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Saved text' })).toBeNull());
    expect(box()).toHaveTextContent('Unbox the printer.');
    // Opened from the notice and cancelled: the lock it claimed is given back, nothing saved, and
    // the notice offers the changes again, its Recover holding the focus.
    await waitFor(() =>
      expect(asked.map((each) => each.route)).toContain('DELETE /v1/components/{id}/lock'),
    );
    expect(asked.some((each) => each.route.startsWith('PUT'))).toBe(false);
    const offer = await screen.findByText(unsavedSentence(unsaved.savedAt));
    await waitFor(() =>
      expect(within(offer.parentElement!).getByRole('button', { name: 'Recover' })).toHaveFocus(),
    );
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
    expect(screen.queryByRole('dialog', { name: 'Saved text' })).toBeNull();
    expect(asked.some((each) => each.route.startsWith('GET /v1/components/{id}/iterations'))).toBe(
      false,
    );
    // Nothing more is offered while Grace holds it; Try again is there for when she is done.
    expect(screen.queryByRole('button', { name: /^Recover/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('CNT-090 lists what was saved while editing, from Saved text, with what was just typed saved first and no second claim', async () => {
    // Saves are answered only when the test lets them be, so the listing can be seen to wait.
    const pending: (() => void)[] = [];
    const { asked, surface } = open(
      recovering(opened(), {
        'PUT /v1/components/{id}/iterations/{session}/{sequence}': ({ path }) =>
          new Promise((resolve) =>
            pending.push(() =>
              resolve(
                json(200, { sequence: Number(path.split('/').at(-1)), lock: lock(OTHER_WINDOW) }),
              ),
            ),
          ),
      }),
    );
    const view = await surface();
    const savedText = () => screen.getByRole('button', { name: 'Saved text' });
    // Offered while editing, as Save version is: reading, the lock is not this page's to list under.
    expect(savedText()).toBeDisabled();
    view.dispatch(view.state.tr.insertText(' Keep the box.', 19));
    await waitFor(() => expect(savedText()).toBeEnabled());

    await userEvent.click(savedText());
    await waitFor(() => expect(pending.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Nothing is listed while what was typed is still being saved.
    expect(asked.some((each) => each.route === 'GET /v1/components/{id}/iterations')).toBe(false);
    for (const answer of pending.splice(0)) answer();
    const shown = await panel();
    await within(shown).findAllByRole('listitem');
    const routes = asked.map((each) => each.route);
    const saved = routes.indexOf('PUT /v1/components/{id}/iterations/{session}/{sequence}');
    expect(saved).toBeGreaterThanOrEqual(0);
    expect(asked[saved]!.body).toMatchObject({
      content: content('Unbox the printer. Keep the box.'),
    });
    expect(routes.indexOf('GET /v1/components/{id}/iterations')).toBeGreaterThan(saved);
    expect(routes.filter((route) => route === 'POST /v1/components/{id}/lock')).toHaveLength(1);

    // Closed, the author goes on editing, and the focus goes back to what opened it.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Saved text' })).toBeNull());
    expect(savedText()).toHaveFocus();
    expect(box()).toHaveAttribute('contenteditable', 'true');
  });

  it('is a modal, the text behind it out of reach and the focus kept inside', async () => {
    const { surface } = open(recovering(opened({ unsaved })));
    await surface();
    await userEvent.click(screen.getByRole('button', { name: 'Recover' }));
    const shown = await panel();
    expect(shown).toHaveAttribute('aria-modal', 'true');
    await within(shown).findAllByRole('listitem');
    expect(box().closest('[inert]')).not.toBeNull();
    // Tab from the last control comes round to the first.
    within(shown).getByRole('button', { name: 'Cancel' }).focus();
    await userEvent.tab();
    expect(shown.contains(document.activeElement)).toBe(true);
  });

  it('shows what restoring a row would change, word by word, and Recover waits for a row to be chosen (the R1 plan)', async () => {
    const { surface } = open(recovering(opened({ unsaved })));
    await surface();
    await userEvent.click(screen.getByRole('button', { name: 'Recover' }));
    const shown = await panel();
    await within(shown).findAllByRole('listitem');
    const recover = within(shown).getByRole('button', { name: 'Recover' });
    expect(recover).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(rowOf(0));
    expect(rowOf(0)).toHaveAttribute('aria-pressed', 'true');
    const changes = await within(shown).findByRole('region', { name: 'What restoring it changes' });
    // On screen "Unbox the printer."; saved "Unbox the printer and keep the box."
    expect(changes).toHaveTextContent('Unbox the');
    expect(within(changes).getByText('printer.').tagName).toBe('DEL');
    expect(within(changes).getByText('printer and keep the box.').tagName).toBe('INS');
    expect(recover).toHaveAttribute('aria-disabled', 'false');
    // Looking changes nothing.
    expect(box()).toHaveTextContent('Unbox the printer.');
  });

  it('puts the notice away for this tab with Dismiss, until something newer is saved', async () => {
    const first = open(recovering(opened({ unsaved })));
    await first.surface();
    const offer = screen.getByText(unsavedSentence(unsaved.savedAt));
    await userEvent.click(within(offer.parentElement!).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(unsavedSentence(unsaved.savedAt))).toBeNull();
    expect(first.asked.some((each) => each.route === 'POST /v1/components/{id}/lock')).toBe(false);
    cleanup();

    // The same tab, opened again: still put away.
    const again = open(recovering(opened({ unsaved })));
    await again.surface();
    expect(screen.queryByText(unsavedSentence(unsaved.savedAt))).toBeNull();
    cleanup();

    // Something saved since: offered again.
    const newer = { savedAt: '2026-09-28T15:00:00.000Z' };
    const later = open(recovering(opened({ unsaved: newer })));
    await later.surface();
    expect(screen.getByText(unsavedSentence(newer.savedAt))).toBeInTheDocument();
  });

  it('says the author is editing in another window where their own other window holds it, and moves the edit here to recover', async () => {
    const { asked, surface } = open(recovering(opened({ unsaved, lock: lock(OTHER_WINDOW) })));
    await surface();
    const said = screen.getByText('You are editing this component in another window.');
    // Their saves are that window's work in progress, not work that was never made a version.
    expect(screen.queryByText(unsavedSentence(unsaved.savedAt))).toBeNull();
    expect(screen.queryByRole('button', { name: 'Recover' })).toBeNull();

    await userEvent.click(
      within(said.parentElement!).getByRole('button', { name: 'Recover here' }),
    );
    await panel();
    const claim = asked.find((each) => each.route === 'POST /v1/components/{id}/lock')!;
    expect(claim.body).toMatchObject({ move: true });
  });

  it('offers no Recover while somebody else holds the component, and says who does', async () => {
    const grace = {
      holder: { id: GRACE, name: 'Grace' },
      expectedRelease: '2026-09-28T14:20:00.000Z',
      yours: false,
      session: OTHER_WINDOW,
    };
    open(recovering(opened({ unsaved, lock: grace })));
    await screen.findByLabelText('Title');
    expect(
      screen.getByText(heldSentence({ name: 'Grace', expectedRelease: grace.expectedRelease })),
    ).toBeInTheDocument();
    expect(screen.queryByText(unsavedSentence(unsaved.savedAt))).toBeNull();
    expect(screen.queryByRole('button', { name: /^Recover/ })).toBeNull();
  });

  it('offers no Recover once a claim is refused because somebody else holds the component', async () => {
    const { surface } = open(
      recovering(opened({ unsaved }), {
        'POST /v1/components/{id}/lock': () =>
          json(409, {
            code: 'lock_held',
            message: 'held',
            traceId: 't',
            holder: { id: GRACE, name: 'Grace' },
            expectedRelease: '2026-09-28T14:20:00.000Z',
          }),
      }),
    );
    const view = await surface();
    // Offered while nobody holds it; Ada types, and her claim finds Grace there.
    expect(screen.getByRole('button', { name: 'Recover' })).toBeInTheDocument();
    view.dispatch(view.state.tr.insertText('!', 19));
    await screen.findByRole('button', { name: 'Try again' });
    expect(screen.queryByRole('button', { name: /^Recover/ })).toBeNull();
    expect(screen.queryByText(unsavedSentence(unsaved.savedAt))).toBeNull();
  });

  it("offers Recover here, and no never-made-a-version sentence, once a claim finds the author's own other window", async () => {
    const { surface } = open(
      recovering(opened({ unsaved }), {
        'POST /v1/components/{id}/lock': ({ body }) =>
          (body as { move?: boolean }).move
            ? json(200, { lock: lock((body as { session: string }).session) })
            : json(409, {
                code: 'lock_held',
                message: 'held',
                traceId: 't',
                holder: { id: ADA, name: 'Ada' },
                expectedRelease: '2026-09-28T14:20:00.000Z',
              }),
      }),
    );
    const view = await surface();
    view.dispatch(view.state.tr.insertText('!', 19));
    await screen.findByRole('button', { name: 'Continue here' });
    expect(screen.queryByText(unsavedSentence(unsaved.savedAt))).toBeNull();
    expect(screen.queryByRole('button', { name: 'Recover' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Recover here' })).toBeInTheDocument();
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
