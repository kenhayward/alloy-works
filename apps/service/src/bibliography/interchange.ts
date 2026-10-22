import { plugins } from '@citation-js/core';
import '@citation-js/plugin-bibtex';
import '@citation-js/plugin-ris';
import type { CslItem } from '@alloy-works/domain';

/**
 * CSL-JSON, BibTeX and RIS (LIB-009, IMP-014; the CI plan, CI-C), read and written by citation-js's
 * core and its BibTeX and RIS plugins, never its CSL plugin. Each read names its input type, so
 * citation-js never fetches anything to find out what the text is.
 */

export type InterchangeFormat = 'csl-json' | 'bibtex' | 'ris';

// Core registers readers that fetch a URL or walk a page; none is wanted, whatever a read asks for.
for (const type of ['@else/url', '@else/jquery', '@else/html']) plugins.input.remove(type);

const INPUT_TYPES = { bibtex: '@bibtex/text', ris: '@ris/file' } as const;

/**
 * The records the text holds, as CSL as citation-js reads them, each still to be admitted as an
 * entry; undefined where the text holds none in the format.
 */
export function readRecords(format: InterchangeFormat, text: string): unknown[] | undefined {
  if (format === 'csl-json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return undefined;
    }
    const records = Array.isArray(parsed) ? (parsed as unknown[]) : [parsed];
    return records.length > 0 &&
      records.every((each) => typeof each === 'object' && each !== null && !Array.isArray(each))
      ? records
      : undefined;
  }
  let records: unknown;
  try {
    // Its declared options all required, though citation-js defaults each.
    const options = { forceType: INPUT_TYPES[format], generateGraph: false };
    records = plugins.input.chain(text, options as Parameters<typeof plugins.input.chain>[1]);
  } catch {
    return undefined;
  }
  return Array.isArray(records) && records.length > 0 ? (records as unknown[]) : undefined;
}

/** The entries in the format, each named by its key. */
export function formatEntries(
  format: InterchangeFormat,
  entries: readonly { readonly key: string; readonly csl: CslItem }[],
): string {
  if (format === 'csl-json') {
    return JSON.stringify(
      entries.map((each) => ({ id: each.key, ...each.csl })),
      null,
      2,
    );
  }
  // BibTeX names a record by its citation key, which citation-js otherwise makes up.
  const items = entries.map((each) => ({
    ...each.csl,
    id: each.key,
    'citation-key': each.key,
  }));
  return String(
    plugins.output.format(format, items as unknown as Parameters<typeof plugins.output.format>[1], {
      format: 'text',
    }),
  );
}
