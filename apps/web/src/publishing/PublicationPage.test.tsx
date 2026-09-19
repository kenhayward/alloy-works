import { createApiClient } from '@alloy-works/api-client';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';

import { PublicationPage } from './PublicationPage.js';

const PUBLICATION = 'ffffffff-0000-4000-8000-000000000001';
const DOCUMENT = 'aaaaaaaa-0000-4000-8000-000000000001';
const LINK = 'http://store.example.test/t_acme/sha256/abc?X-Amz-Signature=s';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Answers every request with the first answer `answers` still holds, taken off by the test. */
const open = (given: Response | Response[]) => {
  const answers = Array.isArray(given) ? given : [given];
  return render(
    <StrictMode>
      <PublicationPage
        client={createApiClient({
          baseUrl: 'http://acme.example.test',
          fetch: (async () => answers[0]!.clone()) as unknown as typeof fetch,
        })}
        id={PUBLICATION}
      />
    </StrictMode>,
  );
};

const record = {
  id: PUBLICATION,
  document: DOCUMENT,
  version: { id: 'v', number: '0.3' },
  title: 'The dosing report',
  publisher: { id: 'p', displayName: 'Ada' },
  publishedAt: '2026-09-19T09:00:00.000Z',
  approval: 'none',
  formats: ['pdf'],
  engine: { name: 'typst', version: '0.15.1' },
  template: { name: 'publication', version: 1 },
  pipeline: '1',
  outputs: [],
};

describe('a publication at its own address', () => {
  it('says it is not approved, who published which version, and offers its PDF', async () => {
    open(
      json(200, {
        id: PUBLICATION,
        document: DOCUMENT,
        version: { id: 'v', number: '0.3' },
        title: 'The dosing report',
        publisher: { id: 'p', displayName: 'Ada' },
        publishedAt: '2026-09-19T09:00:00.000Z',
        approval: 'none',
        formats: ['pdf'],
        engine: { name: 'typst', version: '0.15.1' },
        template: { name: 'publication', version: 1 },
        pipeline: '1',
        outputs: [
          {
            format: 'pdf',
            bytes: 30_000,
            sha256: 'a'.repeat(64),
            standard: 'ua-1',
            download: LINK,
          },
        ],
      }),
    );
    expect(await screen.findByRole('heading', { name: 'The dosing report' })).toBeInTheDocument();
    expect(screen.getByText(/^Not approved\./)).toBeInTheDocument();
    expect(screen.getByText(/Version 0\.3, published by Ada/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download the PDF' })).toHaveAttribute('href', LINK);
    expect(screen.getByRole('link', { name: 'Open the document' })).toHaveAttribute(
      'href',
      `#/documents/${DOCUMENT}`,
    );
  });

  it('says a publication could not be opened when the store is away, and opens it when asked again', async () => {
    const answers = [
      json(503, { code: 'storage_unavailable', message: 'x', traceId: 't' }),
      json(200, record),
    ];
    open(answers);
    expect(await screen.findByText('The publication could not be opened.')).toBeInTheDocument();
    answers.shift();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'The dosing report' })).toBeInTheDocument();
    expect(screen.queryByText('The publication could not be opened.')).toBeNull();
  });

  it('says there is nothing here where the reader may not read it', async () => {
    open(
      json(404, { code: 'not_found', message: 'There is nothing at this address.', traceId: 't' }),
    );
    expect(
      await screen.findByText('There is nothing here, or nothing you may read.'),
    ).toBeInTheDocument();
  });
});
