import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
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

  it('shows the publication itself in the page, and what it was made from beside it', async () => {
    const VIEW = 'http://store.example.test/t_acme/sha256/abc?X-Amz-Signature=v';
    open(
      json(200, {
        ...record,
        outputs: [
          {
            format: 'pdf',
            bytes: 30_000,
            sha256: 'a'.repeat(64),
            standard: 'ua-1',
            download: LINK,
            view: VIEW,
          },
        ],
      }),
    );
    const frame = await screen.findByTitle('The dosing report');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', VIEW);
    const record_ = screen.getByRole('complementary', { name: 'What it was made from' });
    expect(record_).toHaveTextContent(/Version 0\.3, published by Ada/);
    expect(record_).toHaveTextContent('Typst 0.15.1');
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

  const WORD = 'http://store.example.test/t_acme/sha256/def?X-Amz-Signature=w';
  const VIEW = 'http://store.example.test/t_acme/sha256/abc?X-Amz-Signature=v';
  const pdfOutput = {
    format: 'pdf',
    bytes: 30_000,
    sha256: 'a'.repeat(64),
    standard: 'ua-1',
    producer: 'typst',
    producerVersion: '13',
    report: [],
    download: LINK,
    view: VIEW,
  };
  const wordOutput = (report: unknown[]) => ({
    format: 'docx',
    bytes: 20_480,
    sha256: 'b'.repeat(64),
    standard: null,
    producer: 'word',
    producerVersion: 'word/1',
    report,
    download: WORD,
    view: null,
  });

  it('offers each output to save, shows only the PDF in the page, and says what the Word document could not carry', async () => {
    open(
      json(200, {
        ...record,
        formats: ['pdf', 'docx'],
        template: { name: 'publication', version: 13 },
        pipeline: '13',
        outputs: [
          pdfOutput,
          wordOutput([
            { kind: 'face_substituted', family: 'STIX Two Math', wordFamily: 'Cambria Math' },
            { kind: 'pages_cite_the_pdf' },
          ]),
        ],
      }),
    );
    const aside = await screen.findByRole('complementary', { name: 'What it was made from' });
    expect(within(aside).getByRole('link', { name: 'Download the PDF' })).toHaveAttribute(
      'href',
      LINK,
    );
    expect(within(aside).getByRole('link', { name: 'Download the Word document' })).toHaveAttribute(
      'href',
      WORD,
    );
    expect(aside).toHaveTextContent('Download the Word document (20 KB)');
    // Shown in the page: the PDF, and only the PDF, whose view link is its alone.
    expect(screen.getByTitle('The dosing report')).toHaveAttribute('src', VIEW);
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
    expect(aside).toHaveTextContent('Made with Typst 0.15.1 and publication template 13.');
    // The writer's version as the template's is named, a number, never the stored `word/1` (the final
    // review of Word 1, M7).
    expect(aside).toHaveTextContent('The Word document was written by the Word writer, version 1.');
    expect(aside).not.toHaveTextContent('word/1');
    // Each entry of its report, one sentence each.
    const report = within(aside).getByRole('list', { name: 'About the Word document' });
    expect([...report.querySelectorAll('li')].map((each) => each.textContent)).toEqual([
      'The typeface STIX Two Math cannot be embedded in a Word document, so Word shows its text in Cambria Math.',
      "Word lays out its own pages, so its page numbers can differ from the PDF's. A page number cited from this publication is the PDF's.",
    ]);
  });

  it('reads a publication in Word alone, which no PDF engine or template made, and offers it to save', async () => {
    open(
      json(200, {
        ...record,
        formats: ['docx'],
        engine: null,
        template: null,
        pipeline: '13',
        outputs: [wordOutput([{ kind: 'no_page_cited_output' }, { kind: 'pages_cite_the_pdf' }])],
      }),
    );
    expect(await screen.findByRole('heading', { name: 'The dosing report' })).toBeInTheDocument();
    expect(screen.queryByText('The publication could not be opened.')).toBeNull();
    expect(screen.getByText(/^Not approved\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download the Word document' })).toHaveAttribute(
      'href',
      WORD,
    );
    expect(screen.queryByRole('link', { name: 'Download the PDF' })).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    expect(
      screen.getByText('A Word document is not shown in the page. Download it to open it in Word.'),
    ).toBeInTheDocument();
    const aside = screen.getByRole('complementary', { name: 'What it was made from' });
    expect(aside).not.toHaveTextContent('Typst');
    expect(within(aside).getByRole('list', { name: 'About the Word document' })).toHaveTextContent(
      'This publication has no PDF, so nothing in it can be cited by page number.',
    );
  });
});
