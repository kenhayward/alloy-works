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
      'header_column_lost',
      'header_repeated',
      'continuation_label_omitted',
      'equation_flattened',
      'description_language_lost',
      'quotation_not_structure',
      'preformatted_not_structure',
      'definition_list_not_structure',
      'quoted_phrase_not_structure',
      'inline_code_not_structure',
      'equation_numbered_as_table',
      'equation_alternative_lost',
      'maths_coverage_unchecked',
    ]);
  });

  it("names what Word cannot carry of the PDF's structure (W14.6, W-J): a quotation, preformatted text, a definition list and an image's description in another language by their place; a quoted phrase and inline code by the place of their runs, a heading's naming no block; a numbered equation by its place and label; and the maths once, its alternatives and the Word face's characters", () => {
    const place = { node: 'readingsaaaaaaaaaaaaaaaaaa', block: 'q1' };
    const heading = { node: 'rateaaaaaaaaaaaaaaaaaaaaaa', block: null };
    const report: OutputReport = [
      { kind: 'description_language_lost', ...place, block: 'f1' },
      { kind: 'quotation_not_structure', ...place },
      { kind: 'preformatted_not_structure', ...place, block: 'c1' },
      { kind: 'definition_list_not_structure', ...place, block: 'd1' },
      { kind: 'quoted_phrase_not_structure', ...place, block: 'p1' },
      { kind: 'quoted_phrase_not_structure', ...heading },
      { kind: 'inline_code_not_structure', ...place, block: 'p1' },
      { kind: 'equation_numbered_as_table', ...place, block: 'e1', label: 'Equation 1' },
      { kind: 'equation_alternative_lost' },
      { kind: 'maths_coverage_unchecked', wordFamily: 'Cambria Math' },
    ];
    expect(parseOutputReport(JSON.parse(JSON.stringify(report)))).toEqual(report);
    // Each place once; two places are two things.
    expect(() =>
      parseOutputReport([
        { kind: 'quotation_not_structure', ...place },
        { kind: 'quotation_not_structure', ...place },
      ]),
    ).toThrow(/once/);
    expect(() =>
      parseOutputReport([
        { kind: 'equation_alternative_lost' },
        { kind: 'equation_alternative_lost' },
      ]),
    ).toThrow(/once/);
    // Closed: a block's place names its block, a numbered equation its label, the maths face a
    // family as the theme spells one, and nothing else.
    for (const kind of [
      'description_language_lost',
      'quotation_not_structure',
      'preformatted_not_structure',
      'definition_list_not_structure',
    ]) {
      expect(() => parseOutputReport([{ kind, ...heading }]), kind).toThrow();
      expect(() => parseOutputReport([{ kind, ...place, label: null }]), kind).toThrow(
        /Unrecognized key/,
      );
      expect(() => parseOutputReport([{ kind, ...place, node: 'Readings' }]), kind).toThrow();
    }
    for (const kind of ['quoted_phrase_not_structure', 'inline_code_not_structure']) {
      expect(() => parseOutputReport([{ kind, node: place.node }]), kind).toThrow();
      expect(() => parseOutputReport([{ kind, ...place, block: '' }]), kind).toThrow();
    }
    expect(() =>
      parseOutputReport([{ kind: 'equation_numbered_as_table', ...place, label: null }]),
    ).toThrow();
    expect(() => parseOutputReport([{ kind: 'equation_alternative_lost', ...place }])).toThrow(
      /Unrecognized key/,
    );
    expect(() => parseOutputReport([{ kind: 'maths_coverage_unchecked' }])).toThrow();
    expect(() =>
      parseOutputReport([{ kind: 'maths_coverage_unchecked', wordFamily: 'Cambria <Math>' }]),
    ).toThrow();
  });

  it("names a heading or a listed caption holding an equation Word's rebuilt entries set as its characters in a row, by its place and its number or label (the final review of Word 4, I2)", () => {
    const heading = { node: 'rateaaaaaaaaaaaaaaaaaaaaaa', block: null, label: '3' };
    const caption = { node: 'readingsaaaaaaaaaaaaaaaaaa', block: 't1', label: 'Table 1.1' };
    const report: OutputReport = [
      { kind: 'equation_flattened', ...heading },
      { kind: 'equation_flattened', ...caption },
      { kind: 'equation_flattened', ...heading, node: 'openingaaaaaaaaaaaaaaaaaaa', label: null },
    ];
    expect(parseOutputReport(JSON.parse(JSON.stringify(report)))).toEqual(report);
    // A heading and a caption in one node are two things; one said twice is one thing twice.
    expect(() =>
      parseOutputReport([
        { kind: 'equation_flattened', ...heading },
        { kind: 'equation_flattened', ...heading },
      ]),
    ).toThrow(/once/);
    // Closed: a place as the outline and the component spell one - a heading's no block - and a
    // number or a label of something or none, and nothing else.
    expect(() => parseOutputReport([{ kind: 'equation_flattened', node: heading.node }])).toThrow();
    expect(() =>
      parseOutputReport([{ kind: 'equation_flattened', ...caption, block: '' }]),
    ).toThrow();
    expect(() =>
      parseOutputReport([{ kind: 'equation_flattened', ...caption, label: '' }]),
    ).toThrow();
    expect(() =>
      parseOutputReport([{ kind: 'equation_flattened', ...heading, node: 'Rate' }]),
    ).toThrow();
    expect(() =>
      parseOutputReport([{ kind: 'equation_flattened', ...caption, text: 'x2' }]),
    ).toThrow(/Unrecognized key/);
  });

  it('names a table Word could not set as its style asks by its place, and its label where it has one (Word 2, ruling R7)', () => {
    const place = { node: 'readingsaaaaaaaaaaaaaaaaaa', block: 't1' };
    const report: OutputReport = [
      { kind: 'header_column_lost', ...place, label: 'Table 1.1' },
      { kind: 'header_repeated', ...place, label: 'Table 1.1' },
      { kind: 'continuation_label_omitted', ...place, label: null },
    ];
    expect(parseOutputReport(JSON.parse(JSON.stringify(report)))).toEqual(report);
    // Two tables are two things; one table's kinds are each its own.
    expect(
      outputReportSchema.safeParse([
        { kind: 'header_column_lost', ...place, label: 'Table 1.1' },
        { kind: 'header_column_lost', ...place, block: 't2', label: 'Table 1.2' },
      ]).success,
    ).toBe(true);
    expect(() =>
      parseOutputReport([
        { kind: 'header_repeated', ...place, label: null },
        { kind: 'header_repeated', ...place, label: null },
      ]),
    ).toThrow(/once/);
    // Closed: its place as the outline and the component spell one, a label of something or none,
    // and nothing else.
    expect(() => parseOutputReport([{ kind: 'header_column_lost', ...place }])).toThrow();
    expect(() =>
      parseOutputReport([{ kind: 'header_column_lost', ...place, label: '' }]),
    ).toThrow();
    expect(() =>
      parseOutputReport([
        { kind: 'header_column_lost', node: 'Readings', block: 't1', label: null },
      ]),
    ).toThrow();
    expect(() =>
      parseOutputReport([{ kind: 'header_column_lost', ...place, block: '', label: null }]),
    ).toThrow();
    expect(() =>
      parseOutputReport([{ kind: 'header_repeated', ...place, label: null, pages: 2 }]),
    ).toThrow(/Unrecognized key/);
  });

  it('refuses a kind it does not declare, a member an entry does not declare, and anything but a list', () => {
    expect(() => parseOutputReport([{ kind: 'table_split' }])).toThrow();
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
