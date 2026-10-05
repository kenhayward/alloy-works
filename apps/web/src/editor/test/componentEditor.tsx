// Shared by the ComponentEditor test files: fixtures, the service fake and helpers.
import { createApiClient } from '@alloy-works/api-client';
import { fromEditor, Selection, type EditorView } from '@alloy-works/editor';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { vi } from 'vitest';
import { heldSentence } from '../held.js';
import { ComponentEditor } from '../ComponentEditor.js';
import { designTiming } from '../session.js';
import { PresentationProvider } from '../../theme/presentation.js';

export const COMPONENT = '6a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';
export const SESSION = '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b';
export const ADA = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

export const content = (...texts: string[]) => ({
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

export const opened = (overrides: Record<string, unknown> = {}) => ({
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
  // The starter type, which gives a component no fields.
  type: { id: 'type-topic', name: 'Topic' },
  fields: [],
  schemas: [],
  values: {},
  ...overrides,
});

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** An answer, given by status and body, or a promise that never settles, to hold a phase in place. */
export type Answer = (body: unknown) => Response | Promise<Response>;

/** The service as the editor meets it: answers by method and path, and remembers what was asked. */
export function service(answers: Record<string, Answer>) {
  const asked: { route: string; body: unknown }[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    // An image's bytes are bytes, never JSON (figures 2): recorded by their length.
    const bytes = request.headers.get('content-type') === 'application/octet-stream';
    const text =
      request.method === 'GET' || request.method === 'DELETE' || bytes ? '' : await request.text();
    const body = bytes
      ? { bytes: (await request.arrayBuffer()).byteLength }
      : text === ''
        ? undefined
        : (JSON.parse(text) as unknown);
    const route = `${request.method} ${url.pathname.replace(COMPONENT, '{id}').replace(SESSION, '{session}')}`;
    asked.push({ route, body });
    const answer = answers[route];
    return answer ? answer(body) : json(404, { code: 'not_found', message: 'none', traceId: 't' });
  });
  const client = createApiClient({
    baseUrl: 'http://dev.acme.test',
    fetch: fetching as unknown as typeof fetch,
  });
  return { client, asked };
}

export const quick = { ...designTiming, idleMs: 10, continuousMs: 50 };

/**
 * Opens the editor. `strict` renders it inside `<StrictMode>`, which is how the application itself
 * runs it (apps/web/src/main.tsx) and which double-invokes every render: anything that keeps its
 * bearings by counting renders, rather than by comparing values, behaves differently there than it
 * does in a test that leaves StrictMode off (fix round 2, findings A-C).
 */
export function open(
  answers: Record<string, Answer>,
  timing = quick,
  strict = false,
  extra: Partial<React.ComponentProps<typeof ComponentEditor>> = {},
  /** Where given, the editor is set in this presentation, as a page sets it (themes.md, W8). */
  presentation?: unknown,
) {
  const { client, asked } = service(
    presentation === undefined
      ? answers
      : { 'GET /v1/presentation': () => json(200, presentation), ...answers },
  );
  let view: EditorView | undefined;
  const editor = (
    <ComponentEditor
      componentId={COMPONENT}
      client={client}
      principalId={ADA}
      sessionId={SESSION}
      timing={timing}
      onView={(mounted) => (view = mounted)}
      {...extra}
    />
  );
  const placed =
    presentation === undefined ? (
      editor
    ) : (
      <PresentationProvider client={client}>{editor}</PresentationProvider>
    );
  render(strict ? <StrictMode>{placed}</StrictMode> : placed);
  const surface = async () => {
    await screen.findByRole('textbox', { name: 'Content of Install the printer' });
    // ProseMirror puts the surface into the page itself, outside React, so the surface is there
    // before the render it asks for in the same breath - the header, which is state - has been
    // committed. Waiting only for the surface therefore lands inside that window often enough to
    // fail a slow machine: the article shows its fallback heading and no header fields at all, and
    // every `getByLabelText` a test runs next finds nothing. Waiting for a field the header renders
    // waits for that commit, and it is a field every component opened here has, editable or not.
    await screen.findByLabelText('Title');
    return view!;
  };
  return { asked, surface };
}

/** What a reader is told of Grace holding a component until the lock fixture's release. */
export const GRACE_EDITING = heldSentence({
  name: 'Grace',
  expectedRelease: '2026-09-16T09:15:00.000Z',
});

export const lock = {
  holder: { id: ADA, name: 'Ada' },
  expectedRelease: '2026-09-16T09:15:00.000Z',
  yours: true,
  session: SESSION,
};

/** A paste event carrying exactly these types, as a browser's `clipboardData` holds them. */
export function pasteEvent(data: Record<string, string>): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { types: Object.keys(data), getData: (type: string) => data[type] ?? '' },
  });
  return event;
}

/** Selects from `anchor` to `head`, or puts the caret there when they are one position. */
export function selectText(view: EditorView, anchor: number, head: number): void {
  act(() =>
    view.dispatch(
      view.state.tr.setSelection(
        Selection.fromJSON(view.state.doc, { type: 'text', anchor, head }),
      ),
    ),
  );
}

/**
 * The base language field, which lives in the language chip's popover: opened first if it is not.
 * Found as an input, because the Formatting toolbar's Language mark is a button of the same name.
 */
export async function languageField(): Promise<HTMLElement> {
  const open = screen.queryByLabelText('Language', { selector: 'input' });
  if (open) return open;
  await userEvent.click(screen.getByRole('button', { name: /^Base language/ }));
  return screen.getByLabelText('Language', { selector: 'input' });
}

/** The base direction select, in the direction chip's popover, opened first if it is not. */
export async function directionField(): Promise<HTMLElement> {
  const open = screen.queryByLabelText('Direction');
  if (open) return open;
  await userEvent.click(screen.getByRole('button', { name: /^Base direction/ }));
  return await directionField();
}

/** The first paragraph's runs, as the stored model spells them and a save would send them. */
export const runsOf = (view: EditorView) => {
  const [block] = fromEditor(view.state.doc).content;
  return block?.type === 'paragraph' ? block.content : [];
};

/** A selection over the surface, as a test makes one: jsdom cannot drag across text. */
export const selectRange = (view: EditorView, anchor: number, head: number) =>
  act(() => {
    view.dispatch(
      view.state.tr.setSelection(
        Selection.fromJSON(view.state.doc, { type: 'text', anchor, head }),
      ),
    );
  });

/** One paragraph of stored content, given run by run rather than as plain text. */
export const runs = (...inlines: unknown[]) => ({
  ...content(''),
  content: [{ type: 'paragraph', id: 'b1', style: 'body', content: inlines }],
});

/** Enough acknowledged saves that a panel test is never held up by a route nobody answered. */
export const saves = Object.fromEntries(
  Array.from({ length: 8 }, (_, at) => [
    `PUT /v1/components/{id}/iterations/{session}/${at + 1}`,
    () => json(200, { sequence: at + 1, lock }),
  ]),
);

/** Just inside the block carrying that identifier, wherever the nesting has put it. */
export const inside = (view: EditorView, id: string) => {
  let at = -1;
  view.state.doc.descendants((node, pos) => {
    if (at !== -1) return false;
    if (node.attrs.id === id) at = pos + 1;
    return true;
  });
  if (at === -1) throw new Error(`no ${id} in this document`);
  return at;
};

/** Puts the cursor in the block carrying that identifier, and changes nothing else. */
export const caretIn = (view: EditorView, id: string) =>
  act(() =>
    view.dispatch(
      view.state.tr.setSelection(Selection.near(view.state.doc.resolve(inside(view, id)))),
    ),
  );

/** What a number box really holds, rather than what jest-dom makes of an empty one. */
export const shown = (box: HTMLElement) => (box as HTMLInputElement).value;

/** A stored document of whole blocks, where `content` above makes one paragraph per text. */
export const blocksOf = (...blocks: unknown[]) => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: blocks,
});

export const para = (id: string, text: string) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [{ type: 'text', value: text, marks: [] }],
});

export const listOf = (
  id: string,
  kind: 'ordered' | 'unordered',
  attrs: { start?: number; format?: string },
  ...blocks: unknown[]
) => ({ type: 'list', id, kind, ...attrs, items: blocks.map((block) => ({ content: [block] })) });

/** A bulleted list and a paragraph after it, for watching an announcement follow the caret. */
export const aListAndAParagraph = blocksOf(
  listOf('L1', 'unordered', {}, para('b1', 'Unbox the printer.')),
  para('b2', 'Keep the box.'),
);
