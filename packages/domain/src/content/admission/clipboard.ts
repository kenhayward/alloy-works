import type { BlockNode } from '../model/blocks.js';
import type { ContentDocument } from '../model/document.js';

import type { AdmissionInput, AdmissionRefused } from './admit.js';
import { admissionLimits } from './limits.js';
import { createReport } from './report.js';

/**
 * The product's own clipboard: the one reader that needs no parser, because its format is the
 * model's. Copying writes the blocks with the schema version, base language and direction of the
 * component they came from; pasting reads that back as a reader's output for `admit`.
 *
 * It is trusted no further than any other source. Any page can put text on a clipboard claiming to
 * be this format, so what it reads goes through every stage a foreign paste does - which CNT-135
 * requires anyway - and this function only turns text into a candidate or says it could not.
 */
export const PRODUCT_CLIPBOARD_FORMAT = 'alloy-works/content';

export function writeProductClipboard(
  source: ContentDocument,
  blocks: readonly BlockNode[],
): string {
  return JSON.stringify({
    format: PRODUCT_CLIPBOARD_FORMAT,
    schemaVersion: source.schemaVersion,
    language: source.language,
    direction: source.direction,
    content: blocks,
  });
}

export type ReaderResult = { readonly ok: true; readonly input: AdmissionInput } | AdmissionRefused;

export function readProductClipboard(text: string): ReaderResult {
  const report = createReport();
  if (text.length > admissionLimits.characters) {
    report.add('read', 'refused', 'oversized');
    return {
      ok: false,
      refusal: 'oversized',
      failure: `The clipboard holds more than ${admissionLimits.characters} characters`,
      report: report.entries,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as Record<string, unknown>).format !== PRODUCT_CLIPBOARD_FORMAT
  ) {
    report.add('read', 'refused', 'unreadable');
    return {
      ok: false,
      refusal: 'unreadable',
      failure: `The clipboard does not hold ${PRODUCT_CLIPBOARD_FORMAT}`,
      report: report.entries,
    };
  }

  const candidate: Record<string, unknown> = { ...parsed };
  delete candidate.format;
  return { ok: true, input: { candidate, report: [] } };
}
