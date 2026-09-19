import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';

import { FOLLOW_CAP_MS, nextFollow, Publishing } from './Publishing.js';

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
 * Canned answers by method and path. A list is answered in turn, its last answer repeating; a function
 * answers by state - which is what a fake needs where StrictMode reads a route twice on mounting - and
 * may take its time, answering with a promise. A `Status` is answered with its status, and `DROPPED`
 * not at all.
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
    expect(await screen.findByText('Publishing...')).toBeInTheDocument();
    // Long enough for the request to be answered and the next ask put off; well short of 200 ms.
    await pause(20);
    unmount();
    await pause(300);
    expect(asked).toBe(0);
  });

  it('waits twice as long after each answer that it is still queued, up to half a minute', async () => {
    // The schedule, from the real first wait: doubling, then held at the cap.
    const waits = [1000];
    while (waits.length < 8) waits.push(nextFollow(waits[waits.length - 1]!));
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(FOLLOW_CAP_MS).toBe(30000);

    // And the page keeps it: each ask comes at least twice as long after the last as the one before.
    const at: number[] = [];
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: () => listed([]),
      [`POST /v1/documents/${DOCUMENT}/publications`]: [queued()],
      // Queued, then no answer at all, then queued: a failed ask is waited out the same way.
      [`GET /v1/publication-requests/${REQUEST}`]: () => {
        at.push(performance.now());
        if (at.length === 2) return DROPPED;
        return at.length >= 4 ? { ...queued(), state: 'done', publication: PUBLICATION } : queued();
      },
    });
    open(fake.fetch, true, 20);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    await screen.findByRole('link', { name: 'Open the publication' });
    const gaps = at.slice(1).map((each, index) => each - at[index]!);
    // Timers never fire early by more than a rounding; they may fire late.
    expect(gaps).toHaveLength(3);
    expect(gaps[0]).toBeGreaterThanOrEqual(40 - 2);
    expect(gaps[1]).toBeGreaterThanOrEqual(80 - 2);
    expect(gaps[2]).toBeGreaterThanOrEqual(160 - 2);
  });

  it('says a publish refused because the author may not publish, and offers it again', async () => {
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: () => listed([]),
      [`POST /v1/documents/${DOCUMENT}/publications`]: [
        new Status(403, {
          code: 'forbidden',
          message: 'This needs the publish permission.',
          traceId: 't',
        }),
      ],
    });
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    expect(
      await screen.findByText('You may read this document but not publish it.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish as PDF' })).toBeEnabled();
  });

  it('says a publish refused because the document has changed, and offers it again', async () => {
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: () => listed([]),
      [`POST /v1/documents/${DOCUMENT}/publications`]: [
        new Status(409, {
          code: 'version_precondition',
          message: 'This document has a newer version than the one this page opened.',
          traceId: 't',
        }),
      ],
    });
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    expect(
      await screen.findByText(
        'This document has changed since the page opened. Reload it and publish again.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish as PDF' })).toBeEnabled();
  });

  it("says why a publish was refused at the door, in the service's words", async () => {
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: () => listed([]),
      [`POST /v1/documents/${DOCUMENT}/publications`]: [
        new Status(400, {
          code: 'layout_language',
          message:
            'This document is in fr, and its layout is written in en. It can be published only under a layout in its own language.',
          traceId: 't',
        }),
      ],
    });
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    expect(
      await screen.findByText(
        'This document is in fr, and its layout is written in en. It can be published only under a layout in its own language.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish as PDF' })).toBeEnabled();
  });

  it('says a publish could not be asked for, whether the service failed or never answered', async () => {
    for (const answer of [new Status(500), DROPPED]) {
      const fake = service({
        [`GET /v1/documents/${DOCUMENT}/publications`]: () => listed([]),
        [`POST /v1/documents/${DOCUMENT}/publications`]: [answer],
      });
      const { unmount } = open(fake.fetch);
      await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
      expect(
        await screen.findByText('The publish could not be asked for. Try again.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Publish as PDF' })).toBeEnabled();
      unmount();
    }
  });

  it('says a publish could not be followed when the service will not say how it stands', async () => {
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: () => listed([]),
      [`POST /v1/documents/${DOCUMENT}/publications`]: [queued()],
      [`GET /v1/publication-requests/${REQUEST}`]: [
        new Status(404, {
          code: 'not_found',
          message: 'There is nothing at this address.',
          traceId: 't',
        }),
      ],
    });
    open(fake.fetch);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish as PDF' }));
    expect(
      await screen.findByText('The publish could not be followed. Look for it below later.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish as PDF' })).toBeEnabled();
  });

  it('says the publications could not be read, and reads them again when asked', async () => {
    let broken = true;
    const fake = service({
      [`GET /v1/documents/${DOCUMENT}/publications`]: () =>
        broken ? new Status(500) : listed([publication]),
    });
    open(fake.fetch);
    expect(await screen.findByText('The publications could not be read.')).toBeInTheDocument();
    broken = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('link', { name: /Version 0\.3, published by Ada/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText('The publications could not be read.')).toBeNull();
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
