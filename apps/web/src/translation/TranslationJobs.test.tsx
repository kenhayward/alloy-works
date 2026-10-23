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
  it('LOC-033 lists each job with what it sent and why any was not, sends one, and closes it', async () => {
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
