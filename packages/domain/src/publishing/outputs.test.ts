import { describe, expect, it } from 'vitest';

import { PUBLISHING_FORMATS } from './layout.js';
import {
  OUTPUT_CONTENT_TYPES,
  OUTPUT_REPORT_KINDS,
  outputReportSchema,
  parseOutputReport,
  type OutputReport,
} from './outputs.js';

describe("an output's report", () => {
  it('names what Word could not carry, one closed entry per thing', () => {
    const report: OutputReport = [
      { kind: 'face_substituted', family: 'STIX Two Math', wordFamily: 'Cambria Math' },
      { kind: 'no_page_cited_output' },
      { kind: 'pages_cite_the_pdf' },
    ];
    expect(parseOutputReport(JSON.parse(JSON.stringify(report)))).toEqual(report);
    expect(parseOutputReport([])).toEqual([]);
    expect(OUTPUT_REPORT_KINDS).toEqual([
      'face_substituted',
      'no_page_cited_output',
      'pages_cite_the_pdf',
    ]);
  });

  it('refuses a kind it does not declare, a member an entry does not declare, and anything but a list', () => {
    expect(() => parseOutputReport([{ kind: 'header_column_lost' }])).toThrow();
    expect(() => parseOutputReport([{ kind: 'pages_cite_the_pdf', page: 3 }])).toThrow(
      /Unrecognized key/,
    );
    expect(() =>
      parseOutputReport([
        { kind: 'face_substituted', family: 'STIX Two Math', wordFamily: 'Cambria Math', why: 'x' },
      ]),
    ).toThrow(/Unrecognized key/);
    expect(() => parseOutputReport({ kind: 'pages_cite_the_pdf' })).toThrow();
    expect(() => parseOutputReport(null)).toThrow();
  });

  it('names a substituted face and its Word face as the theme spells a family, and never the same', () => {
    expect(() =>
      parseOutputReport([{ kind: 'face_substituted', family: 'STIX Two Math' }]),
    ).toThrow();
    expect(() =>
      parseOutputReport([{ kind: 'face_substituted', family: '', wordFamily: 'Cambria Math' }]),
    ).toThrow();
    expect(() =>
      parseOutputReport([
        { kind: 'face_substituted', family: 'STIX Two Math', wordFamily: 'Cambria <Math>' },
      ]),
    ).toThrow();
    expect(() =>
      parseOutputReport([
        { kind: 'face_substituted', family: 'Cambria Math', wordFamily: 'Cambria Math' },
      ]),
    ).toThrow(/itself/);
  });

  it('says each thing once', () => {
    expect(() =>
      parseOutputReport([{ kind: 'pages_cite_the_pdf' }, { kind: 'pages_cite_the_pdf' }]),
    ).toThrow(/once/);
    const face = { kind: 'face_substituted', family: 'STIX Two Math', wordFamily: 'Cambria Math' };
    expect(() => parseOutputReport([face, { ...face }])).toThrow(/once/);
    // Two faces substituted are two things.
    expect(
      outputReportSchema.safeParse([
        face,
        { kind: 'face_substituted', family: 'Noto Sans', wordFamily: 'Arial' },
      ]).success,
    ).toBe(true);
  });
});

describe("an output's bytes", () => {
  it('are served as the media type of their format, one for every format a layout can make', () => {
    expect(Object.keys(OUTPUT_CONTENT_TYPES)).toEqual([...PUBLISHING_FORMATS]);
    expect(OUTPUT_CONTENT_TYPES).toEqual({
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  });
});
