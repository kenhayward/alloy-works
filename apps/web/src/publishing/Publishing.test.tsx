import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';

import { Publishing } from './Publishing.js';

const DOCUMENT = 'aaaaaaaa-0000-4000-8000-000000000001';
const VERSION = 'dddddddd-0000-4000-8000-000000000003';
const REQUEST = 'eeeeeeee-0000-4000-8000-000000000001';
const PUBLICATION = 'ffffffff-0000-4000-8000-000000000001';
const HIDDEN = 'hhhhhhhhhhhhhhhhhhhhhhhhhh';
const CALIBRATION = 'cccccccccccccccccccccccccc';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * Canned answers by method and path. A list is answered in turn, its last answer repeating; a function
 * answers by state - which is what a fake needs where StrictMode reads a route twice on mounting - and
 * may take its time, answering with a promise.
 */
function service(answers: Record<string, unknown[] | (() => unknown)>) {
  const sent: { method: string; url: string; body: unknown }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url).pathname;
    const body = request.method === 'GET' ? undefined : await request.clone().json();
    sent.push({ method: request.method, url, body });
    const answer = answers[`${request.method} ${url}`];
    if (typeof answer === 'function') return json(200, await answer());
    if (!answer || answer.length === 0) {
      return json(500, { code: 'internal', message: 'x', traceId: 't' });
    }
    return json(200, answer.length > 1 ? answer.shift() : answer[0]);
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

const open = (fetch: typeof globalThis.fetch, mayPublish = true, followMs = 0) =>
  render(
    <StrictMode>
      <Publishing
        client={createApiClient({ baseUrl: 'http://acme.example.test', fetch })}
        document={DOCUMENT}
        version={VERSION}
        mayPublish={mayPublish}
        placeOf={(node) => (node === HIDDEN ? '1.2 A component' : '1.1 Calibration')}
        followMs={followMs}
      />
    </StrictMode>,
  );

const listed = (items: unknown[]) => ({ items });
const publication = {
  id: PUBLICATION,
  document: DOCUMENT,
  version: { id: VERSION, number: '0.3' },
  title: 'The dosing report',
  publisher: { id: 'p', displayName: 'Ada' },
  publishedAt: '2026-09-19T09:00:00.000Z',
  approval: 'none',
  formats: ['pdf'],
};
const queued = (failures: unknown[] = []) => ({
  id: REQUEST,
  document: DOCUMENT,
  state: 'queued',
  failures,
  publication: null,
});

/** A publish that is asked for, then answered as failed with these failures. */
const failing = (failures: unknown[]) =>
  service({
    [`GET /v1/documents/${DOCUMENT}/publications`]: [listed([])],
    [`POST /v1/documents/${DOCUMENT}/publications`]: [queued()],
    [`GET /v1/publication-requests/${REQUEST}`]: [{ ...queued(failures), state: 'failed' }],
  });

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('publishing from the document page', () => {
  it('publishes the version on screen, follows the request, and lists the new publication', async () => {
    let asked = 0;
    let done = false;
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: () => listed(done ? [publication] : []),
      [`POST /v1/documents/${DOCUMENT}/publications`]: [queued()],
      // Still queued the first time it is asked about, and made the second.
      [`GET /v1/publication-requests/${REQUEST}`]: () => {
        asked += 1;
        done = asked > 1;
        return done ? { ...queued(), state: 'done', publication: PUBLICATION } : queued();
      },
    });
    open(fake.fetch);
    expect(
      await screen.findByText('Nothing has been published from this document.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Publish as PDF' }));
    expect(await screen.findByRole('link', { name: 'Open the publication' })).toHaveAttribute(
      'href',
      `#/publications/${PUBLICATION}`,
    );
    expect(
      await screen.findByRole('link', { name: /Version 0\.3, published by Ada/ }),
    ).toHaveAttribute('href', `#/publications/${PUBLICATION}`);
    expect(fake.sent.find((each) => each.method === 'POST')?.body).toEqual({
      version: VERSION,
      formats: ['pdf'],
    });
  });

  it('names every failure by its place, and a component the author may not read as nothing more than that', async () => {
    const failures = [
      { stage: 'resolve', code: 'occurrence_unreadable', node: HIDDEN, block: null, detail: null },
      {
        stage: 'compose',
        code: 'block_not_publishable',
        node: CALIBRATION,
        block: 'b1',
        detail: 'table',
      },
      { stage: 'compose', code: 'glyph_missing', node: CALIBRATION, block: 'b2', detail: 'U+0627' },
    ];
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: [listed([])],
      [`POST /v1/documents/${DOCUMENT}/publications`]: [queued(failures.slice(0, 1))],
      [`GET /v1/publication-requests/${REQUEST}`]: [{ ...queued(failures), state: 'failed' }],
    });
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    const why = await screen.findByRole('list', { name: 'Why it could not be published' });
    expect(why).toHaveTextContent('1.2 A component: A component you may not read is placed here.');
    expect(why).toHaveTextContent('1.1 Calibration: A table cannot be published yet.');
    expect(why).toHaveTextContent(
      '1.1 Calibration: The character U+0627 is in no typeface this publication can use.',
    );
  });

  it('names a language the publication cannot take, and what a publication takes', async () => {
    const takes =
      'a publication takes a language of two or three letters and, if any, a region of two, such as en-GB.';
    const fake = failing([
      {
        stage: 'compose',
        code: 'language_not_publishable',
        node: null,
        block: null,
        detail: 'en-Latn-GB',
      },
      {
        stage: 'compose',
        code: 'language_not_publishable',
        node: CALIBRATION,
        block: null,
        detail: 'x-klingon',
      },
    ]);
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    const why = await screen.findByRole('list', { name: 'Why it could not be published' });
    expect(why).toHaveTextContent(`The language en-Latn-GB cannot be published: ${takes}`);
    expect(why).toHaveTextContent(
      `1.1 Calibration: The language x-klingon cannot be published: ${takes}`,
    );
    expect(why).not.toHaveTextContent('The publication could not be made');
  });

  it('says a failure of the engine or the store is nothing in the document, and to publish again', async () => {
    for (const [stage, code, words] of [
      ['engine', 'engine_failed', 'The publication could not be made. Publish again.'],
      ['store', 'store_failed', 'The publication could not be stored. Publish again.'],
    ] as const) {
      const fake = failing([{ stage, code, node: null, block: null, detail: null }]);
      const { unmount } = open(fake.fetch);
      await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
      const why = await screen.findByRole('list', { name: 'Why it could not be published' });
      expect(why).toHaveTextContent(words);
      expect(
        screen.getByText(
          'The publication could not be made, and nothing in the document caused it. Publish again later.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Put these right/)).toBeNull();
      unmount();
    }
  });

  it("still asks the author to put the document right when one failure is the document's and one the engine's", async () => {
    const fake = failing([
      { stage: 'compose', code: 'style_missing', node: CALIBRATION, block: 'b1', detail: 'note' },
      { stage: 'engine', code: 'engine_failed', node: null, block: null, detail: null },
    ]);
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    await screen.findByRole('list', { name: 'Why it could not be published' });
    expect(
      screen.getByText('The document could not be published. Put these right and publish again:'),
    ).toBeInTheDocument();
  });

  it('asks about a waiting publish one request at a time under StrictMode, and not once it is made', async () => {
    let asked = 0;
    let waiting = 0;
    let most = 0;
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: () => listed([]),
      [`POST /v1/documents/${DOCUMENT}/publications`]: [queued()],
      // Each answer takes a little while, so two pollers running at once would be seen overlapping.
      [`GET /v1/publication-requests/${REQUEST}`]: async () => {
        asked += 1;
        waiting += 1;
        most = Math.max(most, waiting);
        const made = asked >= 4;
        await pause(5);
        waiting -= 1;
        return made ? { ...queued(), state: 'done', publication: PUBLICATION } : queued();
      },
    });
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    await screen.findByRole('link', { name: 'Open the publication' });
    await pause(50);
    expect(most).toBe(1);
    expect(asked).toBe(4);
  });

  it('stops asking about a waiting publish once the page is closed with an answer on its way', async () => {
    let asked = 0;
    let answer = () => {};
    const held = new Promise<void>((resolve) => (answer = resolve));
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: () => listed([]),
      [`POST /v1/documents/${DOCUMENT}/publications`]: [queued()],
      // Never made: a queue with no worker. The third ask is still on its way when the page closes.
      [`GET /v1/publication-requests/${REQUEST}`]: async () => {
        asked += 1;
        if (asked === 3) await held;
        return queued();
      },
    });
    const { unmount } = open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    expect(await screen.findByText('Publishing...')).toBeInTheDocument();
    await waitFor(() => expect(asked).toBe(3));
    unmount();
    answer();
    await pause(100);
    expect(asked).toBe(3);
  });

  it('asks nothing once the page is closed while it waits to ask again', async () => {
    let asked = 0;
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: () => listed([]),
      [`POST /v1/documents/${DOCUMENT}/publications`]: [queued()],
      [`GET /v1/publication-requests/${REQUEST}`]: () => {
        asked += 1;
        return queued();
      },
    });
    // Asked about 200 ms after the request is made: the page closes well inside that.
    const { unmount } = open(fake.fetch, true, 200);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    await waitFor(() => expect(fake.sent.some((each) => each.method === 'POST')).toBe(true));
    await pause(20);
    unmount();
    await pause(300);
    expect(asked).toBe(0);
  });

  it('offers no Publish to somebody who may only read, and still lists what was published', async () => {
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: [listed([publication])],
    });
    open(fake.fetch, false);
    expect(
      await screen.findByRole('link', { name: /Version 0\.3, published by Ada/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish as PDF' })).toBeNull();
  });
});
