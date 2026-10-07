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

  it('offers provenance.json to save beside the PDF and the Word document where the publication prints a value, and shows it nowhere', async () => {
    const PROVENANCE = 'http://store.example.test/t_acme/sha256/eee?X-Amz-Signature=p';
    open(
      json(200, {
        ...record,
        formats: ['pdf', 'docx'],
        outputs: [
          pdfOutput,
          wordOutput([]),
          {
            format: 'provenance',
            bytes: 2_048,
            sha256: 'e'.repeat(64),
            standard: null,
            producer: 'pipeline',
            producerVersion: '16',
            report: [],
            download: PROVENANCE,
            view: null,
          },
        ],
      }),
    );
    const aside = await screen.findByRole('complementary', { name: 'What it was made from' });
    expect(
      within(aside).getByRole('link', { name: 'Download where its values came from' }),
    ).toHaveAttribute('href', PROVENANCE);
    expect(aside).toHaveTextContent('Download where its values came from (2 KB), provenance.json');
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
  });

  it('says what Word could not carry of each table, naming it by its label, or as a table with no number where it has none (Word 2)', async () => {
    const readings = { node: 'readingsaaaaaaaaaaaaaaaaaa', block: 't1', label: 'Table 1.1' };
    const unnumbered = { node: 'prefaceaaaaaaaaaaaaaaaaaaa', block: 't2', label: null };
    open(
      json(200, {
        ...record,
        formats: ['pdf', 'docx'],
        template: { name: 'publication', version: 13 },
        pipeline: '13',
        outputs: [
          pdfOutput,
          wordOutput([
            { kind: 'header_column_lost', ...unnumbered },
            { kind: 'header_column_lost', ...readings },
            { kind: 'header_repeated', ...readings },
            { kind: 'continuation_label_omitted', ...readings },
            // Scaled in the PDF, reflowed in Word (TB3-J).
            { kind: 'table_reflowed', ...readings },
            // One that names no table is left out rather than said wrongly.
            { kind: 'header_repeated', label: 'Table 9.9' },
            { kind: 'pages_cite_the_pdf' },
          ]),
        ],
      }),
    );
    const aside = await screen.findByRole('complementary', { name: 'What it was made from' });
    const report = within(aside).getByRole('list', { name: 'About the Word document' });
    expect([...report.querySelectorAll('li')].map((each) => each.textContent)).toEqual([
      'A table with no number has a header column, which a Word document cannot mark as one, so in Word its cells are read as ordinary cells.',
      'Table 1.1 has a header column, which a Word document cannot mark as one, so in Word its cells are read as ordinary cells.',
      'Table 1.1 repeats its header rows on every page it reaches in Word, though its table style does not: Word marks header rows only by repeating them.',
      'Table 1.1 has no continuation label in Word on the pages it continues on, since Word cannot set one.',
      'Table 1.1 is too wide for the page, so the PDF scales it down to fit; Word cannot scale a table, and fits it to the page by wrapping its text instead.',
      "Word lays out its own pages, so its page numbers can differ from the PDF's. A page number cited from this publication is the PDF's.",
    ]);
  });

  it("says of each heading and caption holding an equation that Word's rebuilt contents, lists and running heads set it as its characters in a row, naming it by its number or label (the final review of Word 4, I2)", async () => {
    open(
      json(200, {
        ...record,
        formats: ['pdf', 'docx'],
        template: { name: 'publication', version: 13 },
        pipeline: '13',
        outputs: [
          pdfOutput,
          wordOutput([
            {
              kind: 'equation_flattened',
              node: 'rateaaaaaaaaaaaaaaaaaaaaaa',
              block: null,
              label: '3',
            },
            {
              kind: 'equation_flattened',
              node: 'openingaaaaaaaaaaaaaaaaaaa',
              block: null,
              label: null,
            },
            {
              kind: 'equation_flattened',
              node: 'readingsaaaaaaaaaaaaaaaaaa',
              block: 't1',
              label: 'Table 1.1',
            },
            {
              kind: 'equation_flattened',
              node: 'readingsaaaaaaaaaaaaaaaaaa',
              block: 'f1',
              label: null,
            },
            // One that names no place is left out rather than said wrongly.
            { kind: 'equation_flattened', label: '4' },
          ]),
        ],
      }),
    );
    const aside = await screen.findByRole('complementary', { name: 'What it was made from' });
    const report = within(aside).getByRole('list', { name: 'About the Word document' });
    expect([...report.querySelectorAll('li')].map((each) => each.textContent)).toEqual([
      'The heading numbered 3 holds an equation that Word sets as its characters in a row where it rebuilds the heading, in the contents or a running head, once it updates them, so a fraction, a script or a root there reads differently from the PDF.',
      'A heading with no number holds an equation that Word sets as its characters in a row where it rebuilds the heading, in the contents or a running head, once it updates them, so a fraction, a script or a root there reads differently from the PDF.',
      "Table 1.1's caption holds an equation that Word sets as its characters in a row in the list after the contents once it updates the list, so a fraction, a script or a root there reads differently from the PDF.",
      'A caption with no number holds an equation that Word sets as its characters in a row in the list after the contents once it updates the list, so a fraction, a script or a root there reads differently from the PDF.',
    ]);
  });

  it("PUB-100 says what Word cannot carry of the PDF's structure: each numbered equation set as a table by its label; the quotations, preformatted text, definition lists, quoted phrases, inline code and descriptions in another language each once, counting their places; the maths once, its descriptions and its typeface's characters; the titles it sets as body text; and a list of figures it cannot link (W14.6)", async () => {
    const at = (block: string | null, node = 'readingsaaaaaaaaaaaaaaaaaa') => ({ node, block });
    open(
      json(200, {
        ...record,
        formats: ['pdf', 'docx'],
        template: { name: 'publication', version: 13 },
        pipeline: '13',
        outputs: [
          pdfOutput,
          wordOutput([
            { kind: 'quotation_not_structure', ...at('q1') },
            { kind: 'quoted_phrase_not_structure', ...at('p1') },
            { kind: 'inline_code_not_structure', ...at('p1') },
            { kind: 'quoted_phrase_not_structure', ...at('q1a') },
            { kind: 'quotation_not_structure', ...at('q2') },
            { kind: 'preformatted_not_structure', ...at('c1') },
            { kind: 'definition_list_not_structure', ...at('d1') },
            { kind: 'definition_list_not_structure', ...at('d2') },
            { kind: 'description_language_lost', ...at('f1') },
            { kind: 'equation_numbered_as_table', ...at('e1'), label: 'Equation 1.1' },
            { kind: 'equation_numbered_as_table', ...at('e2'), label: 'Equation 1.2' },
            { kind: 'equation_alternative_lost' },
            { kind: 'maths_coverage_unchecked', wordFamily: 'Cambria Math' },
            { kind: 'list_not_linked', sequence: 'figure' },
            { kind: 'titles_not_headings', titles: ['document', 'contents', 'lists'] },
            // One that names no place, or no label, is left out rather than said wrongly: a quoted
            // phrase's place is a block's, since a heading carries no mark.
            { kind: 'quotation_not_structure', block: 'q9' },
            { kind: 'quoted_phrase_not_structure', ...at(null, 'rateaaaaaaaaaaaaaaaaaaaaaa') },
            { kind: 'equation_numbered_as_table', ...at('e9') },
            { kind: 'titles_not_headings', titles: ['contents'] },
            { kind: 'list_not_linked', sequence: 'table' },
            { kind: 'pages_cite_the_pdf' },
          ]),
        ],
      }),
    );
    const aside = await screen.findByRole('complementary', { name: 'What it was made from' });
    const report = within(aside).getByRole('list', { name: 'About the Word document' });
    expect([...report.querySelectorAll('li')].map((each) => each.textContent)).toEqual([
      'Word has no mark for a quotation, so it sets a quotation as paragraphs in the quotation style, which a screen reader reads as ordinary text. This applies to 2 quotations.',
      'Word has no mark for a quotation, so it sets a quoted phrase in its character style alone, which a screen reader reads as ordinary text. This applies to quoted phrases in 2 places.',
      'Word has no mark for code, so it sets inline code in its character style alone, which a screen reader reads as ordinary text. This applies to inline code in one place.',
      'Word has no mark for code, so it sets preformatted text as paragraphs in its style, which a screen reader reads as ordinary text. This applies to one block of preformatted text.',
      'Word has no list of terms, so it sets a definition list as its terms and definitions in paragraphs, which a screen reader does not read as a list. This applies to 2 definition lists.',
      "Word records no language for an image's description that a screen reader is known to use: the language is written beside the image, but whether a screen reader reads the description in it has not been checked, so it may read a description in another language as if it were in the document's. This applies to descriptions in one place.",
      'Equation 1.1 is set in Word as a table of one row, the equation in one cell and its number in the other, so a screen reader announces a table; numbered equations that follow one another are one table.',
      'Equation 1.2 is set in Word as a table of one row, the equation in one cell and its number in the other, so a screen reader announces a table; numbered equations that follow one another are one table.',
      'Word reads each equation aloud by its own reading of the maths, not by the description written for it, which the PDF gives a screen reader.',
      'Word sets equations in Cambria Math, whose characters are not checked here: a character it lacks is drawn from another typeface, so it can look different from the PDF.',
      'The list of figures in Word does not link to the figures, since one of them floats, which Word would then list with no page; in the PDF each entry is a link.',
      "Word sets the document's title, the title of the contents and the titles of the lists of figures, tables and equations as ordinary paragraphs rather than headings, so that its own contents does not list them; a screen reader does not announce them as headings, as it does in the PDF.",
      "Word lays out its own pages, so its page numbers can differ from the PDF's. A page number cited from this publication is the PDF's.",
    ]);
  });

  it('PUB-100 names the titles Word sets as body text in words that read whichever of them stand: the lists with no contents before them, and the document alone (the final review of W14.6)', async () => {
    for (const [titles, words] of [
      [
        ['document', 'lists'],
        "the document's title and the titles of the lists of figures, tables and equations",
      ],
      [['document'], "the document's title"],
    ] as const) {
      const { unmount } = open(
        json(200, {
          ...record,
          formats: ['pdf', 'docx'],
          template: { name: 'publication', version: 13 },
          pipeline: '13',
          outputs: [pdfOutput, wordOutput([{ kind: 'titles_not_headings', titles }])],
        }),
      );
      const aside = await screen.findByRole('complementary', { name: 'What it was made from' });
      const report = within(aside).getByRole('list', { name: 'About the Word document' });
      expect([...report.querySelectorAll('li')].map((each) => each.textContent)).toEqual([
        `Word sets ${words} as ordinary paragraphs rather than headings, so that its own contents does not list them; a screen reader does not announce them as headings, as it does in the PDF.`,
      ]);
      unmount();
    }
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
    // veraPDF checks a PDF, and a Word document is never said to be checked or not.
    expect(aside).not.toHaveTextContent(/checked/i);
  });

  /** A PDF output, checked by veraPDF as given, or not yet, or given up on where it says so. */
  const checkedPdf = (check: unknown, checkState?: string) => ({
    format: 'pdf',
    bytes: 30_000,
    sha256: 'a'.repeat(64),
    standard: 'ua-1',
    producer: 'typst',
    producerVersion: '13',
    report: [],
    download: LINK,
    view: LINK,
    check,
    checkState:
      checkState ??
      (check === null
        ? 'pending'
        : (check as { compliant: boolean }).compliant
          ? 'passed'
          : 'failed'),
  });
  const REPORT_LINK = 'https://store.example/report?signed';
  const check = (compliant: boolean, failedRules: unknown[]) => ({
    checker: 'verapdf',
    checkerVersion: '1.30.2',
    profile: 'ua1',
    compliant,
    failedRules,
    report: { bytes: 20_480, sha256: 'b'.repeat(64), download: REPORT_LINK },
    checkedAt: '2026-09-19T09:01:00.000Z',
  });

  it("offers veraPDF's whole report to download beside what it found", async () => {
    open(
      json(200, { ...record, outputs: [checkedPdf(check(false, [{ clause: '7.1', test: 9 }]))] }),
    );
    const aside = await screen.findByRole('complementary', { name: 'What it was made from' });

    expect(within(aside).getByRole('link', { name: 'Download the full report' })).toHaveAttribute(
      'href',
      REPORT_LINK,
    );
    expect(aside).toHaveTextContent('Download the full report (20 KB)');
  });

  it('says a PDF not yet checked for accessibility is not yet checked', async () => {
    open(json(200, { ...record, outputs: [checkedPdf(null)] }));
    const aside = await screen.findByRole('complementary', { name: 'What it was made from' });

    expect(within(aside).getByText('Not yet checked for accessibility.')).toBeInTheDocument();
    expect(within(aside).queryByRole('list', { name: /failed/ })).toBeNull();
    // Nor is there a report to download before the check has written one.
    expect(within(aside).queryByRole('link', { name: 'Download the full report' })).toBeNull();
  });

  it('says a PDF whose checks all gave up could not be checked, which is not the same as not yet', async () => {
    open(json(200, { ...record, outputs: [checkedPdf(null, 'gave_up')] }));
    const aside = await screen.findByRole('complementary', { name: 'What it was made from' });

    expect(within(aside).getByText('Could not be checked for accessibility.')).toBeInTheDocument();
    expect(aside).not.toHaveTextContent('Not yet checked');
    expect(within(aside).queryByRole('link', { name: 'Download the full report' })).toBeNull();
  });

  it("says a PDF with no check in an older service's answer, which names no state, is not yet checked", async () => {
    const older: Record<string, unknown> = checkedPdf(null);
    delete older.checkState;
    open(json(200, { ...record, outputs: [older] }));
    const aside = await screen.findByRole('complementary', { name: 'What it was made from' });

    expect(within(aside).getByText('Not yet checked for accessibility.')).toBeInTheDocument();
  });

  it("says a PDF veraPDF passed was checked for PDF/UA-1 and passed, naming veraPDF's version", async () => {
    open(json(200, { ...record, outputs: [checkedPdf(check(true, []))] }));
    const aside = await screen.findByRole('complementary', { name: 'What it was made from' });

    expect(
      within(aside).getByText('Checked for PDF/UA-1 by veraPDF 1.30.2: passed.'),
    ).toBeInTheDocument();
    expect(aside).not.toHaveTextContent('Not yet checked');
  });

  it("says how many rules a PDF failed and names each, in veraPDF's words where it has them", async () => {
    open(
      json(200, {
        ...record,
        outputs: [
          checkedPdf(
            check(false, [
              { clause: '5', test: 1, description: 'The PDF/UA identification is missing' },
              { clause: '7.1', test: 10 },
            ]),
          ),
        ],
      }),
    );
    const aside = await screen.findByRole('complementary', { name: 'What it was made from' });

    expect(
      within(aside).getByText('Checked for PDF/UA-1 by veraPDF 1.30.2: 2 rules failed.'),
    ).toBeInTheDocument();
    const rules = within(aside).getByRole('list', { name: 'Rules the PDF failed' });
    expect(
      within(rules)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Clause 5, test 1: The PDF/UA identification is missing', 'Clause 7.1, test 10']);
  });

  it('says one rule failed, not one rules', async () => {
    open(
      json(200, {
        ...record,
        outputs: [checkedPdf(check(false, [{ clause: '7.1', test: 9 }]))],
      }),
    );

    expect(
      await screen.findByText('Checked for PDF/UA-1 by veraPDF 1.30.2: 1 rule failed.'),
    ).toBeInTheDocument();
  });
});
