import { createReport, CURRENT_SCHEMA_VERSION, type ReaderResult } from '@alloy-works/domain';

import { LINE_BREAK, refuseOversized, reportControls, withoutControls } from './text.js';

/**
 * Plain text, as the pipeline's input (content-model.md, "The admission boundary").
 *
 * - **Into blocks**, each line is a paragraph and a blank line is skipped, as ProseMirror's own plain
 *   paste does: a blank line separates paragraphs in plain text, it is not one. A tab becomes a
 *   space, because a paragraph's text is set as a paragraph's, and a tab in one is a column nobody
 *   can see.
 * - **Into preformatted text**, the whole of it is one block, kept exactly - every space, tab and
 *   line - with one spelling of a line break, which is the model's rule (CNT-018).
 *
 * The text carries no language and no direction: plain text says neither, and the pipeline keeps the
 * receiving component's.
 */
export function readPlainText(text: string, into: 'blocks' | 'preformatted'): ReaderResult {
  const refused = refuseOversized(text);
  if (refused) return refused;
  const report = createReport();
  const unified = text.replace(LINE_BREAK, '\n');

  if (into === 'preformatted') {
    const kept = withoutControls(unified, 'preformatted');
    reportControls(report, kept.removed);
    return {
      ok: true,
      input: {
        candidate: {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          content: [{ type: 'preformatted', text: kept.text }],
        },
        report: report.entries,
      },
    };
  }

  let removed = 0;
  const content = unified
    .split('\n')
    .map((line) => {
      const kept = withoutControls(line.replace(/\t/g, ' '), 'paragraph');
      removed += kept.removed;
      return kept.text;
    })
    .filter((line) => line.trim() !== '')
    .map((line) => ({ type: 'paragraph', content: [{ type: 'text', value: line, marks: [] }] }));
  reportControls(report, removed);
  return {
    ok: true,
    input: {
      candidate: { schemaVersion: CURRENT_SCHEMA_VERSION, content },
      report: report.entries,
    },
  };
}
