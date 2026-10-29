import { describe, expect, it } from 'vitest';

import { CARRY_CODES, carry } from './report.js';

describe('what a delivery carries over and reports', () => {
  it('API-073 has the closed set of codes the design names', () => {
    expect([...CARRY_CODES]).toEqual([
      'cell_header_dropped',
      'presentation_dropped',
      'note_anchored_table',
      'note_flattened',
      'xref_outside',
      'link_scheme',
      'equation_image_only',
      'alt_missing',
      'title_from_text',
      'property_unmapped',
      'property_unconverted',
    ]);
  });

  it('API-073 builds an entry that omits a detail it was not given', () => {
    expect(carry('alt_missing', 'img1')).toEqual({ code: 'alt_missing', element: 'img1' });
    expect(carry('link_scheme', null, 'ftp:')).toEqual({
      code: 'link_scheme',
      element: null,
      detail: 'ftp:',
    });
  });
});
