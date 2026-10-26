import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TranslationJobsButton } from './TranslationJobs.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const DOCUMENT = 'dddddddd-0000-4000-8000-000000000001';
const JOB = 'aaaaaaaa-0000-4000-8000-000000000001';
const ADA = 'bbbbbbbb-0000-4000-8000-000000000001';

const job = (closed: boolean) => ({
  id: JOB,
  language: 'fr-FR',
  vendor: 'Babel Ltd',
  by: ADA,
  at: '2026-10-23T09:00:00.000Z',
  closed: closed ? { by: ADA, at: '2026-10-23T10:00:00.000Z' } : null,
  items: [
    {
      component: { id: 'cccccccc-0000-4000-8000-000000000001', title: 'Sampling' },
      line: 'eeeeeeee-0000-4000-8000-000000000001',
      source: { id: 'ffffffff-0000-4000-8000-000000000001', number: '1.0' },
      notSent: null,
      outcome: null,
    },
    {
      component: { id: 'cccccccc-0000-4000-8000-000000000002', title: 'Equipment' },
      line: null,
      source: null,
      notSent: 'needs_revision',
      outcome: null,
    },
  ],
});

function service() {
  const asked: { method: string; path: string; body: unknown }[] = [];
  let closed = false;
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const text = request.method === 'GET' ? '' : await request.text();
    asked.push({
      method: request.method,
      path: url.pathname,
      body: text === '' ? undefined : (JSON.parse(text) as unknown),
    });
    const jobs = `/v1/documents/${DOCUMENT}/translation-jobs`;
    if (url.pathname === jobs && request.method === 'GET') {
      return json(200, { jobs: [job(closed)] });
    }
    if (url.pathname === jobs && request.method === 'POST') return json(200, job(false));
    if (url.pathname === `${jobs}/${JOB}/close`) {
      closed = true;
      return json(200, job(true));
    }
    return json(404, {});
  }) as unknown as typeof fetch;
  return {
    client: createApiClient({ baseUrl: 'http://jobs.test', fetch: fetching }),
    asked,
  };
}

describe('translation jobs on a document (the XL plan, XLa)', () => {
  it('lists each job with what it sent and why any was not, sends one, and closes it', async () => {
    const { client, asked } = service();
    render(<TranslationJobsButton client={client} documentId={DOCUMENT} mayEdit />);
    await userEvent.click(screen.getByRole('button', { name: 'Translation jobs' }));

    const jobs = await screen.findByRole('list', { name: 'Jobs' });
    expect(within(jobs).getByText(/fr-FR to Babel Ltd, 1 sent, open/)).toBeTruthy();
    expect(within(jobs).getByText('Sampling: version 1.0, out')).toBeTruthy();
    expect(within(jobs).getByText('Equipment: not sent: approve it first')).toBeTruthy();

    await userEvent.type(screen.getByLabelText('Language'), 'fr-FR');
    await userEvent.type(screen.getByLabelText('Vendor'), 'Babel Ltd');
    await userEvent.click(screen.getByRole('button', { name: 'Send for translation' }));
    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      'Sent: fr-FR to Babel Ltd, 1 sent, open. Download its file to send it.',
    );
    expect(asked).toContainEqual({
      method: 'POST',
      path: `/v1/documents/${DOCUMENT}/translation-jobs`,
      body: { language: 'fr-FR', vendor: 'Babel Ltd' },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Close the fr-FR job' }));
    expect(await screen.findByText(/fr-FR to Babel Ltd, 1 sent, closed/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close the fr-FR job' })).toBeNull();
  });

  it('offers a reader the jobs and nothing to send, download or close', async () => {
    const { client } = service();
    render(<TranslationJobsButton client={client} documentId={DOCUMENT} mayEdit={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Translation jobs' }));
    await screen.findByRole('list', { name: 'Jobs' });
    expect(screen.queryByRole('button', { name: 'Download the fr-FR file' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send for translation' })).toBeNull();
  });
});

describe('what comes back of a translation job (the XL plan, XLb)', () => {
  const SAMPLING = 'cccccccc-0000-4000-8000-000000000001';
  const back = (outcome: string | null, returns: unknown[]) => ({
    ...job(false),
    items: [{ ...job(false).items[0]!, outcome }],
    returns,
  });

  it('LOC-018 LOC-035 returns a file as its bytes, says what it made, and decides a held translation beside the source changes', async () => {
    const asked: { method: string; path: string; type: string | null; body: string }[] = [];
    let state: 'sent' | 'held' | 'decided' = 'sent';
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      asked.push({
        method: request.method,
        path: url.pathname,
        type: request.headers.get('content-type'),
        body: request.method === 'GET' ? '' : await request.text(),
      });
      const jobs = `/v1/documents/${DOCUMENT}/translation-jobs`;
      const read = { id: 'r1', state: 'read', failure: null, returned: 0, held: 1, refused: 0 };
      if (url.pathname === jobs) {
        return json(200, {
          jobs: [
            state === 'sent'
              ? back(null, [])
              : state === 'held'
                ? back('held', [read])
                : back('returned', [read]),
          ],
        });
      }
      if (url.pathname === `${jobs}/${JOB}/return`) {
        state = 'held';
        return json(200, back(null, [{ ...read, state: 'reading' }]));
      }
      if (url.pathname === `${jobs}/${JOB}/items/${SAMPLING}/held`) {
        return json(200, {
          component: { id: SAMPLING, title: 'Sampling' },
          sent: { id: 'ffffffff-0000-4000-8000-000000000001', number: '1.0' },
          current: { id: 'ffffffff-0000-4000-8000-000000000002', number: '2.0' },
          changes: [{ block: 'b1', change: 'changed', words: 'Twelve ponds were sampled twice.' }],
          returned: [{ block: 'b1', words: 'Douze étangs ont été échantillonnés.' }],
          offered: 'accept',
        });
      }
      if (url.pathname === `${jobs}/${JOB}/items/${SAMPLING}/decision`) {
        state = 'decided';
        return json(200, back('returned', [read]));
      }
      return json(404, {});
    }) as unknown as typeof fetch;
    const client = createApiClient({ baseUrl: 'http://jobs.test', fetch: fetching });
    render(<TranslationJobsButton client={client} documentId={DOCUMENT} mayEdit />);
    await userEvent.click(screen.getByRole('button', { name: 'Translation jobs' }));

    await userEvent.upload(
      await screen.findByLabelText('Return the fr-FR file'),
      new File(['<xliff/>'], 'job.xlf', { type: 'application/xliff+xml' }),
    );
    expect(asked).toContainEqual({
      method: 'PUT',
      path: `/v1/documents/${DOCUMENT}/translation-jobs/${JOB}/return`,
      type: 'application/octet-stream',
      body: '<xliff/>',
    });
    expect(
      await screen.findByText(
        'The returned file made 0 translated, 1 held for review and 0 refused.',
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Sampling: version 1.0, held for review/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Review Sampling' }));
    const review = await screen.findByRole('region', { name: 'Review Sampling' });
    expect(
      within(review).getByText('Translated from version 1.0; the source is at 2.0 now.'),
    ).toBeTruthy();
    expect(within(review).getByText('changed: Twelve ponds were sampled twice.')).toBeTruthy();
    expect(within(review).getByText('Douze étangs ont été échantillonnés.')).toBeTruthy();
    // The policy's offer chosen first; a person decides.
    expect(
      within(review).getByLabelText('Accept as a translation of the version sent'),
    ).toHaveProperty('checked', true);
    await userEvent.click(within(review).getByRole('button', { name: 'Decide' }));
    expect(
      await screen.findByText('Sampling: accepted as a translation of the version sent.'),
    ).toBeTruthy();
    expect(asked.at(-2)).toMatchObject({ method: 'POST', body: '{"decision":"accept"}' });
    expect(await screen.findByText(/Sampling: version 1.0, translated/)).toBeTruthy();
  });
});
