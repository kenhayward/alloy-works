import { describe, expect, it } from 'vitest';
import {
  PublicationRequestView,
  PublicationView,
  publishingRoutes,
  RequestPreviewBody,
  RequestPublicationBody,
} from './publishing.js';

const VERSION = '11111111-1111-4111-8111-111111111111';

/** A publication as the service shows it, with the outputs given. */
const viewWith = (outputs: unknown[], record: Record<string, unknown> = {}) => ({
  id: 'p',
  document: 'd',
  version: { id: VERSION, number: '0.1' },
  title: 'The dosing report',
  publisher: { id: 'ada', displayName: 'Ada' },
  publishedAt: '2026-09-25T12:00:00.000Z',
  approval: 'none',
  formats: ['pdf', 'docx'],
  engine: { name: 'typst', version: '0.15.1' },
  template: { name: 'publication', version: 13 },
  pipeline: '13',
  outputs,
  ...record,
});

const pdf = {
  format: 'pdf',
  bytes: 1000,
  sha256: 'c'.repeat(64),
  standard: 'ua-1',
  producer: 'typst',
  producerVersion: '13',
  report: [],
  download: 'https://store/p.pdf',
  view: 'https://store/p',
};
const docx = {
  format: 'docx',
  bytes: 2000,
  sha256: 'd'.repeat(64),
  standard: null,
  producer: 'word',
  producerVersion: 'word/1',
  report: [
    { kind: 'face_substituted', family: 'STIX Two Math', wordFamily: 'Cambria Math' },
    { kind: 'pages_cite_the_pdf' },
  ],
  download: 'https://store/p.docx',
  view: null,
};

describe('the publishing contract (Word 1)', () => {
  it('takes a request for the PDF, Word or both, each named once', () => {
    for (const formats of [['pdf'], ['docx'], ['pdf', 'docx'], ['docx', 'pdf']]) {
      expect(
        RequestPublicationBody.safeParse({ version: VERSION, formats }).success,
        formats.join(),
      ).toBe(true);
    }
    for (const formats of [[], ['docx', 'docx']]) {
      expect(RequestPublicationBody.safeParse({ version: VERSION, formats }).success).toBe(false);
    }
  });

  it("serves a report's table entries, each naming its table's place and its label or none (Word 2)", () => {
    const place = { node: 'readingsaaaaaaaaaaaaaaaaaa', block: 't1' };
    const report = [
      { kind: 'header_column_lost', ...place, label: 'Table 1.1' },
      { kind: 'header_repeated', ...place, label: 'Table 1.1' },
      { kind: 'continuation_label_omitted', ...place, label: null },
    ];
    expect(PublicationView.parse(viewWith([{ ...docx, report }])).outputs[0]!.report).toEqual(
      report,
    );
    expect(
      PublicationView.safeParse(
        viewWith([{ ...docx, report: [{ kind: 'header_repeated', label: 'Table 1.1' }] }]),
      ).success,
    ).toBe(false);
  });

  it("serves a report's flattened equations, each naming its heading's or caption's place, a heading's no block, and its number or label or none (the final review of Word 4, I2)", () => {
    const report = [
      { kind: 'equation_flattened', node: 'rateaaaaaaaaaaaaaaaaaaaaaa', block: null, label: '3' },
      { kind: 'equation_flattened', node: 'readingsaaaaaaaaaaaaaaaaaa', block: 't1', label: null },
    ];
    expect(PublicationView.parse(viewWith([{ ...docx, report }])).outputs[0]!.report).toEqual(
      report,
    );
    expect(
      PublicationView.safeParse(
        viewWith([{ ...docx, report: [{ kind: 'equation_flattened', label: '3' }] }]),
      ).success,
    ).toBe(false);
  });

  it("serves what Word cannot carry of the PDF's structure, each by its place - a quoted phrase's or inline code's perhaps a heading's, naming no block - a numbered equation by its label too, and the maths once (W14.6)", () => {
    const place = { node: 'readingsaaaaaaaaaaaaaaaaaa', block: 'q1' };
    const report = [
      { kind: 'description_language_lost', ...place, block: 'f1' },
      { kind: 'quotation_not_structure', ...place },
      { kind: 'preformatted_not_structure', ...place, block: 'c1' },
      { kind: 'definition_list_not_structure', ...place, block: 'd1' },
      { kind: 'quoted_phrase_not_structure', ...place, block: null },
      { kind: 'inline_code_not_structure', ...place, block: 'p1' },
      { kind: 'equation_numbered_as_table', ...place, block: 'e1', label: 'Equation 1.1' },
      { kind: 'equation_alternative_lost' },
      { kind: 'maths_coverage_unchecked', wordFamily: 'Cambria Math' },
    ];
    expect(PublicationView.parse(viewWith([{ ...docx, report }])).outputs[0]!.report).toEqual(
      report,
    );
    for (const wrong of [
      { kind: 'quotation_not_structure', ...place, block: null },
      { kind: 'equation_numbered_as_table', ...place },
      { kind: 'maths_coverage_unchecked' },
    ]) {
      expect(PublicationView.safeParse(viewWith([{ ...docx, report: [wrong] }])).success).toBe(
        false,
      );
    }
  });

  it('shows each output with its format, standard, producer and report, and a view link for the PDF alone', () => {
    const both = PublicationView.parse(viewWith([pdf, docx]));
    expect(both.outputs).toEqual([pdf, docx]);
    // A Word document is saved, never shown in place, and claims no PDF standard.
    expect(
      PublicationView.safeParse(viewWith([pdf, { ...docx, view: 'https://store/p' }])).success,
    ).toBe(false);
    expect(PublicationView.safeParse(viewWith([pdf, { ...docx, standard: 'ua-1' }])).success).toBe(
      false,
    );
    expect(PublicationView.safeParse(viewWith([{ ...pdf, view: null }])).success).toBe(false);
    // A report says only what the domain's report can say.
    expect(
      PublicationView.safeParse(viewWith([pdf, { ...docx, report: [{ kind: 'lost' }] }])).success,
    ).toBe(false);
  });

  it('shows a Word-only publication with no PDF engine or template', () => {
    const word = PublicationView.parse(
      viewWith([docx], { formats: ['docx'], engine: null, template: null }),
    );
    expect(word).toMatchObject({ engine: null, template: null, formats: ['docx'] });
  });
});

describe('the preview contract (W10.2)', () => {
  const request = {
    id: 'r',
    document: 'd',
    state: 'done',
    failures: [],
    publication: null,
  };
  const links = {
    view: 'https://store/r',
    download: 'https://store/r-preview.pdf',
    expiresAt: '2026-09-27T13:00:00.000Z',
  };

  it('asks for a preview by the version alone, since a preview is the PDF and nothing else', () => {
    expect(RequestPreviewBody.safeParse({ version: VERSION }).success).toBe(true);
    expect(RequestPreviewBody.safeParse({ version: VERSION, formats: ['pdf'] }).success).toBe(
      false,
    );
    expect(RequestPreviewBody.safeParse({}).success).toBe(false);
  });

  it('is asked for by anybody who may read the document, and answers the request', () => {
    const route = publishingRoutes.requestPreview;
    expect(route).toMatchObject({
      method: 'POST',
      path: '/v1/documents/{id}/previews',
      access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    });
    expect(route.responses[200].schema).toBe(PublicationRequestView);
  });

  it("shows a request's kind, and a preview's links and expiry, or none", () => {
    expect(
      PublicationRequestView.parse({ ...request, kind: 'preview', preview: links }).preview,
    ).toEqual(links);
    expect(
      PublicationRequestView.parse({ ...request, kind: 'publish', preview: null }).preview,
    ).toBeNull();
    expect(PublicationRequestView.safeParse(request).success).toBe(false);
    expect(
      PublicationRequestView.safeParse({ ...request, kind: 'draft', preview: null }).success,
    ).toBe(false);
    expect(
      PublicationRequestView.safeParse({
        ...request,
        kind: 'preview',
        preview: { view: links.view, expiresAt: links.expiresAt },
      }).success,
    ).toBe(false);
  });
});
