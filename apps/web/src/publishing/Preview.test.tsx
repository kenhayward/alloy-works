import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';

import { failureWords } from './failures.js';
import { PreviewButton, PreviewPane, PreviewSaid, usePreview } from './Preview.js';

const DOCUMENT = 'aaaaaaaa-0000-4000-8000-000000000001';
const VERSION = 'dddddddd-0000-4000-8000-000000000003';
const REQUEST = 'eeeeeeee-0000-4000-8000-000000000001';
const SECOND = 'eeeeeeee-0000-4000-8000-000000000002';
const HIDDEN = 'hhhhhhhhhhhhhhhhhhhhhhhhhh';
const CALIBRATION = 'cccccccccccccccccccccccccc';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** An answer with a status other than 200. */
class Status {
  constructor(
    readonly status: number,
    readonly body: unknown = { code: 'refused', message: 'No.', traceId: 't' },
  ) {}
}

/** No answer at all: the request fails the way a dropped connection does. */
const DROPPED = Symbol('dropped');

/**
 * Canned answers by method and path, as `Publishing.test.tsx` has them: a list is answered in turn, its
 * last answer repeating; a function answers by state, and may take its time. A `Status` is answered
 * with its status, and `DROPPED` not at all.
 */
function service(answers: Record<string, unknown[] | (() => unknown)>) {
  const sent: { method: string; url: string; body: unknown }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url).pathname;
    const body = request.method === 'GET' ? undefined : await request.clone().json();
    sent.push({ method: request.method, url, body });
    const answer = answers[`${request.method} ${url}`];
    if (typeof answer !== 'function' && (!answer || answer.length === 0)) {
      return json(500, { code: 'internal', message: 'x', traceId: 't' });
    }
    const given: unknown =
      typeof answer === 'function'
        ? await answer()
        : answer.length > 1
          ? answer.shift()
          : answer[0];
    if (given === DROPPED) throw new TypeError('Failed to fetch');
    if (given instanceof Status) return json(given.status, given.body);
    return json(200, given);
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

/** The page's parts of a preview - the button, what is said beside it, and the pane - over one hook. */
function Previewed({
  fetch,
  followMs,
  followed,
  stubbed = true,
}: {
  fetch: typeof globalThis.fetch;
  followMs: number;
  followed: string[];
  /** False to follow a download as the page does, not into `followed`. */
  stubbed?: boolean;
}) {
  const preview = usePreview({
    client: createApiClient({ baseUrl: 'http://acme.example.test', fetch }),
    document: DOCUMENT,
    version: { id: VERSION, number: '0.3' },
    title: 'The dosing report',
    followMs,
    ...(stubbed ? { follow: (url: string) => void followed.push(url) } : {}),
  });
  return (
    <>
      <PreviewButton preview={preview} />
      <PreviewSaid preview={preview} />
      <PreviewPane
        preview={preview}
        placeOf={(node) => (node === HIDDEN ? '1.2 A component' : '1.1 Calibration')}
      />
    </>
  );
}

const open = (fetch: typeof globalThis.fetch, followMs = 0, stubbed = true) => {
  const followed: string[] = [];
  const shown = render(
    <StrictMode>
      <Previewed fetch={fetch} followMs={followMs} followed={followed} stubbed={stubbed} />
    </StrictMode>,
  );
  return { ...shown, followed };
};

const EXPIRES = '2026-09-27T14:02:00.000Z';
const links = (n: number) => ({
  view: `https://store.example.test/r-${n}.pdf?view`,
  download: `https://store.example.test/r-${n}.pdf?download`,
  expiresAt: EXPIRES,
});
const queued = (id = REQUEST) => ({
  id,
  document: DOCUMENT,
  kind: 'preview',
  state: 'queued',
  failures: [],
  publication: null,
  preview: null,
});
const done = (n: number, id = REQUEST) => ({ ...queued(id), state: 'done', preview: links(n) });

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pane = () => screen.getByRole('region', { name: 'Preview' });

describe('a preview on the document page (W10.3)', () => {
  it('asks for a preview of the version held, says it is being made, and shows it in a pane named for the document with when it was made', async () => {
    let asked = 0;
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const fake = service({
      [`POST /v1/documents/${DOCUMENT}/previews`]: [queued()],
      // Queued the first time it is asked about, and held; made the second.
      [`GET /v1/publication-requests/${REQUEST}`]: async () => {
        asked += 1;
        if (asked === 1) {
          await held;
          return queued();
        }
        return done(1);
      },
    });
    open(fake.fetch);
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    // Said while it runs, politely, and the button waits.
    const said = await screen.findByText('Making a preview...');
    expect(said.closest('[aria-live="polite"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
    expect(screen.queryByRole('region', { name: 'Preview' })).toBeNull();
    release();

    const frame = await within(await screen.findByRole('region', { name: 'Preview' })).findByTitle(
      'Preview of The dosing report',
    );
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', links(1).view);
    // Made an hour before it expires, and said in local time, from the moment itself.
    expect(
      within(pane())
        .getByText(/made at/)
        .querySelector('time'),
    ).toHaveAttribute('datetime', '2026-09-27T13:02:00.000Z');
    expect(pane()).toHaveTextContent('Version 0.3');
    expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled();
    expect(screen.getByText('The preview is shown beside the text.')).toBeInTheDocument();
    // The version the page holds, and nothing else: a preview is the PDF alone.
    expect(fake.sent.find((each) => each.method === 'POST')?.body).toEqual({ version: VERSION });
  });

  it("lists a failed preview's failures in the pane, each at its place and in Publish's words", async () => {
    const failures = [
      { stage: 'resolve', code: 'occurrence_unreadable', node: HIDDEN, block: null, detail: null },
      { stage: 'compose', code: 'glyph_missing', node: CALIBRATION, block: 'b2', detail: 'U+0627' },
      { stage: 'compose', code: 'style_missing', node: null, block: null, detail: 'note' },
    ];
    const fake = service({
      [`POST /v1/documents/${DOCUMENT}/previews`]: [queued()],
      [`GET /v1/publication-requests/${REQUEST}`]: [{ ...queued(), state: 'failed', failures }],
    });
    open(fake.fetch);
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const why = await within(await screen.findByRole('region', { name: 'Preview' })).findByRole(
      'list',
      { name: 'Why the preview could not be made' },
    );
    expect([...why.querySelectorAll('li')].map((each) => each.textContent)).toEqual([
      `1.2 A component: ${failureWords(failures[0]!)}`,
      `1.1 Calibration: ${failureWords(failures[1]!)}`,
      failureWords(failures[2]!),
    ]);
    expect(why).toHaveTextContent('1.1 Calibration: The character U+0627 is in no typeface');
    expect(pane()).toHaveTextContent('Put these right and preview it again');
    expect(pane().querySelector('iframe')).toBeNull();
  });

  it('names a heading nested too deep for a PDF without offering Word, since a preview is always a PDF (W14.2)', async () => {
    const failures = [
      { stage: 'compose', code: 'heading_too_deep', node: CALIBRATION, block: null, detail: null },
    ];
    const fake = service({
      [`POST /v1/documents/${DOCUMENT}/previews`]: [queued()],
      [`GET /v1/publication-requests/${REQUEST}`]: [{ ...queued(), state: 'failed', failures }],
    });
    open(fake.fetch);
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const why = await within(await screen.findByRole('region', { name: 'Preview' })).findByRole(
      'list',
      { name: 'Why the preview could not be made' },
    );
    expect(why).toHaveTextContent(
      '1.1 Calibration: This heading is nested more than six levels deep, which a PDF cannot tag as a heading. Move it up a level.',
    );
    expect(why).not.toHaveTextContent('Word');
  });

  it('says a failure of the engine or the store is nothing in the document', async () => {
    const failures = [
      { stage: 'engine', code: 'engine_failed', node: null, block: null, detail: null },
    ];
    const fake = service({
      [`POST /v1/documents/${DOCUMENT}/previews`]: [queued()],
      [`GET /v1/publication-requests/${REQUEST}`]: [{ ...queued(), state: 'failed', failures }],
    });
    open(fake.fetch);
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(
      await within(await screen.findByRole('region', { name: 'Preview' })).findByText(
        'The preview could not be made, and nothing in the document caused it. Preview it again later.',
      ),
    ).toBeInTheDocument();
  });

  it("answers a preview refused at the door in Publish's words for the same answers, and offers it again", async () => {
    const answers: [Status | typeof DROPPED, string][] = [
      [
        new Status(409, {
          code: 'version.precondition',
          message: 'This document has a newer version than the one this page opened.',
          traceId: 't',
        }),
        'This document has changed since the page opened. Reload it and preview it again.',
      ],
      [
        new Status(400, {
          code: 'layout.language',
          message:
            'This document is in fr, and its layout is written in en. It can be published only under a layout in its own language.',
          traceId: 't',
        }),
        'This document is in fr, and its layout is written in en. It can be published only under a layout in its own language.',
      ],
      [new Status(404), 'This document is no longer open to you.'],
      [new Status(500), 'The preview could not be asked for. Try again.'],
      [DROPPED, 'The preview could not be asked for. Try again.'],
    ];
    for (const [answer, words] of answers) {
      const fake = service({ [`POST /v1/documents/${DOCUMENT}/previews`]: [answer] });
      const { unmount } = open(fake.fetch);
      await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
      const said = await screen.findByText(words);
      expect(said.closest('[aria-live="polite"]')).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled();
      expect(screen.queryByRole('region', { name: 'Preview' })).toBeNull();
      unmount();
    }
  });

  it('downloads the PDF by reading the request again and following the fresh link it answers', async () => {
    let asked = 0;
    const fake = service({
      [`POST /v1/documents/${DOCUMENT}/previews`]: [queued()],
      // Each answer signs the links afresh: the second is what Download follows.
      [`GET /v1/publication-requests/${REQUEST}`]: () => {
        asked += 1;
        return done(asked);
      },
    });
    const { followed } = open(fake.fetch);
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await within(await screen.findByRole('region', { name: 'Preview' })).findByTitle(
      'Preview of The dosing report',
    );
    expect(asked).toBe(1);
    await userEvent.click(within(pane()).getByRole('button', { name: 'Download the PDF' }));
    await waitFor(() => expect(followed).toEqual([links(2).download]));
    expect(asked).toBe(2);
  });

  it('says a download could not be made when the request cannot be read, and keeps the preview', async () => {
    const fake = service({
      [`POST /v1/documents/${DOCUMENT}/previews`]: [queued()],
      [`GET /v1/publication-requests/${REQUEST}`]: [done(1), new Status(503)],
    });
    const { followed } = open(fake.fetch);
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await within(await screen.findByRole('region', { name: 'Preview' })).findByTitle(
      'Preview of The dosing report',
    );
    await userEvent.click(within(pane()).getByRole('button', { name: 'Download the PDF' }));
    expect(
      await within(pane()).findByText('The PDF could not be downloaded. Try again.'),
    ).toBeInTheDocument();
    expect(followed).toEqual([]);
    expect(within(pane()).getByTitle('Preview of The dosing report')).toBeInTheDocument();
  });

  it('says a preview has expired once its request answers with none, or is gone, and makes a new one when asked', async () => {
    for (const gone of [done(1), new Status(404)]) {
      const expired = gone instanceof Status ? gone : { ...gone, preview: null };
      const fake = service({
        [`POST /v1/documents/${DOCUMENT}/previews`]: [queued(), queued(SECOND)],
        [`GET /v1/publication-requests/${REQUEST}`]: [done(1), expired],
        [`GET /v1/publication-requests/${SECOND}`]: [done(2, SECOND)],
      });
      const { followed, unmount } = open(fake.fetch);
      await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
      await within(await screen.findByRole('region', { name: 'Preview' })).findByTitle(
        'Preview of The dosing report',
      );
      await userEvent.click(within(pane()).getByRole('button', { name: 'Download the PDF' }));
      expect(
        await within(pane()).findByText('This preview has expired. A preview is kept for an hour.'),
      ).toBeInTheDocument();
      expect(pane().querySelector('iframe')).toBeNull();
      expect(followed).toEqual([]);

      await userEvent.click(within(pane()).getByRole('button', { name: 'Make a new preview' }));
      expect(await within(pane()).findByTitle('Preview of The dosing report')).toHaveAttribute(
        'src',
        links(2).view,
      );
      unmount();
    }
  });

  it('replaces the first preview with a second, and forgets it when the pane is closed', async () => {
    const fake = service({
      [`POST /v1/documents/${DOCUMENT}/previews`]: [queued(), queued(SECOND)],
      [`GET /v1/publication-requests/${REQUEST}`]: [done(1)],
      [`GET /v1/publication-requests/${SECOND}`]: [done(2, SECOND)],
    });
    open(fake.fetch);
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(
      await within(await screen.findByRole('region', { name: 'Preview' })).findByTitle(
        'Preview of The dosing report',
      ),
    ).toHaveAttribute('src', links(1).view);

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() =>
      expect(within(pane()).getByTitle('Preview of The dosing report')).toHaveAttribute(
        'src',
        links(2).view,
      ),
    );
    expect(document.querySelectorAll('iframe')).toHaveLength(1);

    await userEvent.click(within(pane()).getByRole('button', { name: 'Close the preview' }));
    expect(screen.queryByRole('region', { name: 'Preview' })).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.queryByText('The preview is shown beside the text.')).toBeNull();
  });

  it('follows a download in a hidden frame, so the page is never left and an editor never asks to stay', async () => {
    let asked = 0;
    const fake = service({
      [`POST /v1/documents/${DOCUMENT}/previews`]: [queued()],
      [`GET /v1/publication-requests/${REQUEST}`]: () => {
        asked += 1;
        return done(asked);
      },
    });
    open(fake.fetch, 0, false);
    const before = window.location.href;
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await within(await screen.findByRole('region', { name: 'Preview' })).findByTitle(
      'Preview of The dosing report',
    );
    await userEvent.click(within(pane()).getByRole('button', { name: 'Download the PDF' }));
    await waitFor(() =>
      expect(document.querySelector(`iframe[src="${links(2).download}"]`)).not.toBeNull(),
    );
    const frame = document.querySelector(`iframe[src="${links(2).download}"]`)!;
    expect(frame).toHaveAttribute('hidden');
    expect(pane().contains(frame)).toBe(false);
    expect(window.location.href).toBe(before);
    frame.remove();
  });

  it("shows and follows no link but the web's, whatever a request answers", async () => {
    const odd = {
      view: 'javascript:alert(1)',
      download: 'javascript:alert(2)',
      expiresAt: EXPIRES,
    };
    const fake = service({
      [`POST /v1/documents/${DOCUMENT}/previews`]: [queued()],
      [`GET /v1/publication-requests/${REQUEST}`]: [{ ...done(1), preview: odd }],
    });
    const { followed } = open(fake.fetch);
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(
      await screen.findByText('The preview could not be followed. Preview it again.'),
    ).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
    expect(followed).toEqual([]);
  });

  it('drops a download answered after its preview was closed or replaced', async () => {
    for (const then of ['close', 'replace'] as const) {
      let release: (answer: unknown) => void = () => {};
      let asked = 0;
      const fake = service({
        [`POST /v1/documents/${DOCUMENT}/previews`]: [queued(), queued(SECOND)],
        // The first answer shows it; the download's read waits until the test lets it go.
        [`GET /v1/publication-requests/${REQUEST}`]: () => {
          asked += 1;
          return asked === 1 ? done(1) : new Promise((resolve) => (release = resolve));
        },
        [`GET /v1/publication-requests/${SECOND}`]: [done(2, SECOND)],
      });
      const { followed, unmount } = open(fake.fetch);
      await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
      await within(await screen.findByRole('region', { name: 'Preview' })).findByTitle(
        'Preview of The dosing report',
      );
      await userEvent.click(within(pane()).getByRole('button', { name: 'Download the PDF' }));
      await waitFor(() => expect(asked).toBe(2));
      if (then === 'close') {
        await userEvent.click(within(pane()).getByRole('button', { name: 'Close the preview' }));
      } else {
        await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
        await waitFor(() =>
          expect(within(pane()).getByTitle('Preview of The dosing report')).toHaveAttribute(
            'src',
            links(2).view,
          ),
        );
      }
      // Its answer arrives late, and says the first has expired: it moves nothing now.
      release({ ...done(1), preview: null });
      await pause(20);
      expect(followed, then).toEqual([]);
      if (then === 'close') {
        expect(screen.queryByRole('region', { name: 'Preview' }), then).toBeNull();
      } else {
        expect(within(pane()).getByTitle('Preview of The dosing report'), then).toHaveAttribute(
          'src',
          links(2).view,
        );
      }
      unmount();
    }
  });

  it('gives the focus back to Preview when the pane is closed', async () => {
    const fake = service({
      [`POST /v1/documents/${DOCUMENT}/previews`]: [queued()],
      [`GET /v1/publication-requests/${REQUEST}`]: [done(1)],
    });
    open(fake.fetch);
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await within(await screen.findByRole('region', { name: 'Preview' })).findByTitle(
      'Preview of The dosing report',
    );
    await userEvent.click(within(pane()).getByRole('button', { name: 'Close the preview' }));
    expect(screen.getByRole('button', { name: 'Preview' })).toHaveFocus();
  });

  it('asks nothing more once the page closes while it waits to ask again, or with an answer on its way', async () => {
    // Waiting to ask: the page closes well inside the 200 ms before the first ask.
    let asked = 0;
    const waiting = service({
      [`POST /v1/documents/${DOCUMENT}/previews`]: [queued()],
      [`GET /v1/publication-requests/${REQUEST}`]: () => {
        asked += 1;
        return queued();
      },
    });
    const first = open(waiting.fetch, 200);
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('Making a preview...')).toBeInTheDocument();
    await pause(20);
    first.unmount();
    await pause(300);
    expect(asked).toBe(0);

    // An answer on its way: it lands after the page closed, and nothing is asked or said after it.
    let answered = 0;
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const onItsWay = service({
      [`POST /v1/documents/${DOCUMENT}/previews`]: [queued()],
      [`GET /v1/publication-requests/${REQUEST}`]: async () => {
        answered += 1;
        await held;
        return queued();
      },
    });
    const second = open(onItsWay.fetch);
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(answered).toBe(1));
    second.unmount();
    release();
    await pause(100);
    expect(answered).toBe(1);
  });
});
