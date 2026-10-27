import { publishFailureCodes } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { FAILURE_SUMMARIES, failureSummary, failureWords } from './failures.js';

describe("a failure's summary, said where its place is not", () => {
  it('summarises every code a publish can fail with, in one sentence needing no detail', () => {
    expect(Object.keys(FAILURE_SUMMARIES).sort()).toEqual([...publishFailureCodes].sort());
    for (const code of publishFailureCodes) {
      const said = failureSummary(code);
      expect(said, code).toMatch(/^[A-Z].*\.$/);
      expect(said, code).not.toMatch(/ {2}|[–—]| - /);
      expect(said, code).not.toMatch(/\bhere\b|\bthis\b/i);
    }
  });

  it('says a code it does not know as a failed publish', () => {
    expect(failureSummary('something_new')).toBe('Its latest publish failed. Publish again.');
  });
});

describe("a citation's failure, in words (CIc)", () => {
  const at = (code: string, detail: string | null) =>
    failureWords({ stage: 'compose', code, node: null, block: 'p1', detail } as never);

  it('names the citation and its entry, the entry and the variable, and the style', () => {
    expect(at('citation_unresolved', '2: 0b0e2c4b')).toBe(
      'Citation 2 here names a bibliography entry you may not read, or one not in this space: 0b0e2c4b. Cite an entry of this space, or remove the citation.',
    );
    expect(at('entry_incomplete', '0b0e2c4b: container-title')).toBe(
      'The bibliography entry 0b0e2c4b lacks container-title, which the citation style needs for its type. Fill it in on the entry, and publish again.',
    );
    expect(at('style_invalid', 'none')).toBe(
      "The publication's theme names no citation style, so its citations cannot be set. Choose one in the theme.",
    );
    expect(at('style_invalid', 'render')).toBe(
      "The theme's citation style no longer sets citations. Choose another in the theme, or upload the style again.",
    );
  });
});

describe('a failure where HTML is asked for, in words (the HT plan, HTa)', () => {
  const at = (code: string, detail: string | null) =>
    failureWords({ stage: 'compose', code, node: null, block: 'b1', detail } as never);

  it('names what HTML does not write yet, and the page a cross-reference cites with no form without one', () => {
    expect(at('html_not_yet', 'table')).toBe(
      'A table cannot be published in HTML yet. Publish this document without HTML.',
    );
    expect(at('html_not_yet', 'listOf:figure')).toBe(
      'The list of figures after the contents cannot be published in HTML yet. Publish this document without HTML.',
    );
    expect(at('page_reference_without_pages', null)).toBe(
      'This cross-reference shows a page, and HTML has no pages. Choose what it shows where there are none, or publish this document without HTML.',
    );
  });

  it("names HTML where its layout makes none, and where a face's licence does not let it be embedded", () => {
    expect(at('format_unsupported', 'html')).toBe(
      "This publication's layout makes no HTML, so it cannot be published in HTML. Publish it without HTML, or under a layout that makes it.",
    );
    expect(at('typeface_not_embeddable', 'Liberation Serif: html')).toBe(
      "The typeface Liberation Serif cannot be embedded in an HTML file: its licence does not permit it. The publication's theme has to change before this document can be published.",
    );
    expect(at('condition_leaked', 'html')).toContain('in the HTML file');
  });
});
