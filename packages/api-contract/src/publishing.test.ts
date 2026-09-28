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
  check: null,
  checkState: 'pending',
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

  it("shows the PDF's check by veraPDF once it has run, none before, and nothing else", () => {
    const check = {
      checker: 'verapdf',
      checkerVersion: '1.30.2',
      profile: 'ua1',
      compliant: false,
      failedRules: [
        { clause: '5', test: 1, description: 'Identify it' },
        { clause: '7.1', test: 10 },
      ],
      report: { bytes: 4096, sha256: 'a'.repeat(64), download: 'https://store/r.json' },
      checkedAt: '2026-09-28T10:00:00.000Z',
    };
    expect(
      PublicationView.parse(viewWith([{ ...pdf, check, checkState: 'failed' }])).outputs[0],
    ).toMatchObject({ check });
    expect(PublicationView.parse(viewWith([pdf])).outputs[0]).toMatchObject({ check: null });
    const unreported: Partial<typeof check> = { ...check };
    delete unreported.report;
    // Only veraPDF against PDF/UA-1, each rule by its clause and test, and always its whole report.
    for (const wrong of [
      { ...check, checker: 'pdfbox' },
      { ...check, profile: 'ua2' },
      { ...check, failedRules: [{ clause: '5' }] },
      unreported,
      { ...check, report: { bytes: 4096, sha256: 'a'.repeat(64) } },
    ]) {
      expect(
        PublicationView.safeParse(viewWith([{ ...pdf, check: wrong, checkState: 'failed' }]))
          .success,
      ).toBe(false);
    }
  });

  it("says where the PDF's check stands - not yet checked, passed, failed or given up - and only as its check says", () => {
    const check = (compliant: boolean) => ({
      checker: 'verapdf',
      checkerVersion: '1.30.2',
      profile: 'ua1',
      compliant,
      failedRules: compliant ? [] : [{ clause: '7.1', test: 10 }],
      report: { bytes: 4096, sha256: 'a'.repeat(64), download: 'https://store/r.json' },
      checkedAt: '2026-09-28T10:00:00.000Z',
    });
    for (const [state, found] of [
      ['pending', null],
      ['gave_up', null],
      ['passed', check(true)],
      ['failed', check(false)],
    ] as const) {
      expect(
        PublicationView.parse(viewWith([{ ...pdf, check: found, checkState: state }])).outputs[0],
      ).toMatchObject({ checkState: state });
    }
    // A state its check contradicts, one there is no such state as, and none at all.
    for (const [state, found] of [
      ['passed', null],
      ['gave_up', check(false)],
      ['pending', check(true)],
      ['failed', check(true)],
      ['passed', check(false)],
      ['unknown', null],
      [undefined, null],
    ] as const) {
      const output: Record<string, unknown> = { ...pdf, check: found, checkState: state };
      if (state === undefined) delete output.checkState;
      expect(PublicationView.safeParse(viewWith([output])).success, String(state)).toBe(false);
    }
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
