import { probesOf } from '@alloy-works/domain';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { leakedFrom } from './scan.js';
import { pdfSaying } from './testing/handmade-pdf.js';

/** A Word package whose body and core properties say what they are given. */
const docxSaying = (body: string, subject: string) =>
  zipSync({
    'word/document.xml': strToU8(
      `<w:document><w:body><w:p><w:r><w:t>${body}</w:t></w:r></w:p></w:body></w:document>`,
    ),
    'docProps/core.xml': strToU8(
      `<cp:coreProperties><dc:subject>${subject}</dc:subject></cp:coreProperties>`,
    ),
  });

describe("an output's scan for excluded text (the R6 plan, R6-G)", () => {
  const probes = probesOf(['Staff are told at the morning meeting.'], 'Readings were taken.');

  it('REU-048 finds an excluded passage in a PDF, in its text and in its metadata', async () => {
    expect(
      await leakedFrom(probes, 'pdf', pdfSaying('Readings were taken.', 'Site report')),
    ).toEqual([]);
    expect(
      await leakedFrom(
        probes,
        'pdf',
        pdfSaying('Staff are told at the morning meeting.', 'Report'),
      ),
    ).not.toEqual([]);
    expect(
      await leakedFrom(probes, 'pdf', pdfSaying('Readings.', 'Staff are told at the meeting')),
    ).toEqual(['staff are told at', 'are told at the']);
  });

  it('reads Word text through its entities, so a passage holding a quotation mark or an ampersand is found', async () => {
    const marked = probesOf(['Press the "red" button & wait.'], 'Readings were taken.');
    expect(
      await leakedFrom(
        marked,
        'docx',
        docxSaying('Press the &quot;red&quot; button &amp; wait.', 'Sites'),
      ),
    ).toEqual(['press the red button', 'the red button wait']);
  });

  it('REU-048 finds an excluded passage in a Word document, in its body and in its properties', async () => {
    expect(await leakedFrom(probes, 'docx', docxSaying('Readings were taken.', 'Sites'))).toEqual(
      [],
    );
    expect(
      await leakedFrom(probes, 'docx', docxSaying('Readings.', 'Staff are told at the meeting')),
    ).toEqual(['staff are told at', 'are told at the']);
    expect(
      await leakedFrom(probes, 'docx', docxSaying('Staff are told at noon.', 'Sites')),
    ).toEqual(['staff are told at']);
  });

  it('finds an excluded passage in an HTML file, in its text and its title, through its marks', async () => {
    const html = (body: string, title: string) =>
      new TextEncoder().encode(
        `<!DOCTYPE html><html><head><title>${title}</title></head><body>${body}</body></html>`,
      );
    expect(await leakedFrom(probes, 'html', html('<p>Readings were taken.</p>', 'Sites'))).toEqual(
      [],
    );
    expect(
      await leakedFrom(
        probes,
        'html',
        html('<p>Staff are <em><span>to</span></em>ld at the morning meeting.</p>', 'Sites'),
      ),
    ).not.toEqual([]);
    expect(
      await leakedFrom(probes, 'html', html('<p>Readings.</p>', 'Staff are told at noon')),
    ).toEqual(['staff are told at']);
  });
});
