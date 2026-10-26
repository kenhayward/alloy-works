import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RangePreviewButton, RangePreviewPane, useRangePreview } from './RangePreview.js';

const DOCUMENT = '11111111-1111-4111-8111-111111111111';
const VERSION = '22222222-2222-4222-8222-222222222222';
const RANGE = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';
const NODE = 'aaaaaaaaaaaaaaaaaaaaaaaaaa';
const UNTAGGED =
  'These pages are pictures drawn as you edit, untagged, so assistive technology cannot read them. For an accessible copy, choose Preview, which makes the tagged PDF.';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The range routes as the service answers them: waiting once after each ask, then ready. */
function service(options: { failFirst?: boolean } = {}) {
  const asked: string[] = [];
  let ranges = 0;
  let made = 0;
  let wanted = 0;
  const view = () => ({
    id: RANGE,
    state: made >= wanted ? 'ready' : 'waiting',
    node: NODE,
    sequence: made,
    pages: 40,
    images: [12, 13, 14].map((page) => ({
      page,
      // The service's English, which the pane words for itself (the UI plan, UI-L).
      alternative: 'In English',
    })),
    untagged: 'In English',
    failure: null,
  });
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    asked.push(`${request.method} ${path}`);
    if (request.method === 'POST' && path === `/v1/documents/${DOCUMENT}/range-previews`) {
      ranges += 1;
      wanted += 1;
      if (options.failFirst && ranges === 1) return json(200, { ...view(), state: 'failed' });
      return json(200, view());
    }
    if (request.method === 'POST' && path.endsWith('/refresh')) {
      wanted += 1;
      return json(200, view());
    }
    if (request.method === 'GET' && path.includes('/pages/')) {
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }
    if (request.method === 'GET' && path.endsWith(`/range-previews/${RANGE}`)) {
      // Drawn by the time it is asked after.
      made = wanted;
      return json(200, view());
    }
    return json(404, { code: 'not_found', message: 'There is nothing at this address.' });
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://range.test', fetch: fetching }), asked };
}

/** The page's part of it: an occurrence open in place, and the editor's saves. */
function Harness({
  client,
  onPreview,
}: {
  client: ReturnType<typeof createApiClient>;
  onPreview: () => void;
}) {
  const [saved, setSaved] = useState<{ session: string; sequence: number } | null>(null);
  const range = useRangePreview({
    client,
    document: DOCUMENT,
    version: VERSION,
    node: NODE,
    saved,
    followMs: 1,
  });
  return (
    <>
      <RangePreviewButton range={range} />
      <button
        type="button"
        onClick={() =>
          setSaved((was) => ({ session: SESSION, sequence: (was?.sequence ?? 0) + 1 }))
        }
      >
        Save
      </button>
      <RangePreviewPane range={range} onPreview={onPreview} />
    </>
  );
}

describe('the pages as you edit (the R22 plan, R22b)', () => {
  beforeEach(() => {
    let made = 0;
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: () => `blob:range-${(made += 1)}`,
        revokeObjectURL: () => {},
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('PUB-080 says on screen and on each page that the pages are untagged, and offers Preview, which makes the tagged PDF', async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();
    const { client } = service();
    render(<Harness client={client} onPreview={onPreview} />);
    await user.click(screen.getByRole('button', { name: 'Pages as you edit' }));
    const pane = screen.getByRole('region', { name: 'Pages as you edit' });
    expect(within(pane).getByText(UNTAGGED)).toBeVisible();
    expect(within(pane).getByText('The pages appear after your next save.')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    const pages = await within(pane).findAllByRole('img');
    expect(pages).toHaveLength(3);
    expect(pages.map((page) => page.getAttribute('alt'))).toEqual(
      [12, 13, 14].map(
        (page) =>
          `Page ${page}, an untagged picture of the preview. For assistive technology, choose Preview, which makes the tagged PDF.`,
      ),
    );
    await user.click(within(pane).getByRole('button', { name: 'Preview' }));
    expect(onPreview).toHaveBeenCalledOnce();
  });

  it('CNT-186 asks for the range at the first save, draws it again after each save, and closes', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<Harness client={client} onPreview={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Pages as you edit' }));
    expect(screen.getByRole('button', { name: 'Pages as you edit' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Nothing is asked before a save names the session.
    expect(asked.filter((each) => each.startsWith('POST'))).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findAllByRole('img');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(asked.filter((each) => each.startsWith('POST'))).toEqual([
        `POST /v1/documents/${DOCUMENT}/range-previews`,
        `POST /v1/documents/${DOCUMENT}/range-previews/${RANGE}/refresh`,
      ]),
    );
    await waitFor(() => expect(screen.getByText('Showing your latest save.')).toBeVisible());
    // Each save's pages read again.
    await waitFor(() => expect(asked.filter((each) => each.includes('/pages/'))).toHaveLength(6));

    await user.click(screen.getByRole('button', { name: 'Close the pages as you edit' }));
    expect(screen.queryByRole('region', { name: 'Pages as you edit' })).toBeNull();
  });

  it('CNT-186 asks for a new range at the next save after one that failed', async () => {
    const user = userEvent.setup();
    const { client, asked } = service({ failFirst: true });
    render(<Harness client={client} onPreview={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Pages as you edit' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('The pages could not be drawn. Save again to try.'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findAllByRole('img');
    expect(asked.filter((each) => each.startsWith('POST'))).toEqual([
      `POST /v1/documents/${DOCUMENT}/range-previews`,
      `POST /v1/documents/${DOCUMENT}/range-previews`,
    ]);
  });
});
