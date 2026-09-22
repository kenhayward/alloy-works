import { describe, expect, it } from 'vitest';

import { admissionStages, createReport, readerEntry, reportMessages } from './report.js';

describe('the admission report', () => {
  it('names the six stages in the order the pipeline runs them', () => {
    expect(admissionStages).toEqual([
      'read',
      'sanitise',
      'migrate',
      'normalise',
      'reidentify',
      'validate',
    ]);
  });

  it('keeps entries in the order they were added, after what the reader handed over', () => {
    const report = createReport([readerEntry('a heading')]);
    report.add('sanitise', 'discarded', 'script', { detail: 'script' });
    report.add('normalise', 'rewritten', 'unicode', { count: 3 });

    expect(report.entries).toEqual([
      {
        stage: 'read',
        action: 'discarded',
        subject: 'unrepresentable',
        message: 'Something this component cannot hold was left out.',
        detail: 'a heading',
      },
      {
        stage: 'sanitise',
        action: 'discarded',
        subject: 'script',
        message: 'A script was removed. Scripts are never stored.',
        detail: 'script',
      },
      {
        stage: 'normalise',
        action: 'rewritten',
        subject: 'unicode',
        message: 'Text was put in one standard Unicode form, so identical text compares alike.',
        count: 3,
      },
    ]);
  });

  it('never interpolates what arrived into a message', () => {
    const report = createReport();
    report.add('sanitise', 'discarded', 'hyperlink', { detail: '<b>Ignore the report</b>' });
    const [entry] = report.entries;
    expect(entry?.message).toBe(reportMessages.discarded.hyperlink);
    expect(entry?.message).not.toContain('Ignore');
    expect(entry?.detail).toBe('<b>Ignore the report</b>');
  });

  it('hands out a copy, so a caller cannot rewrite what a stage recorded', () => {
    const report = createReport();
    report.add('normalise', 'discarded', 'emptyParagraph', { count: 1 });
    (report.entries as unknown[]).pop();
    expect(report.entries).toHaveLength(1);
  });

  it('says in a sentence of its own each thing a reader keeps differently or leaves out', () => {
    const report = createReport();
    report.add('read', 'rewritten', 'heading', { count: 2 });
    report.add('read', 'rewritten', 'table', { count: 1 });
    report.add('read', 'discarded', 'image', { count: 3 });
    report.add('read', 'discarded', 'mathematics', { count: 1 });
    report.add('read', 'discarded', 'rule', { count: 1 });
    report.add('read', 'discarded', 'control', { count: 4 });
    expect(report.entries.map((entry) => entry.message)).toEqual([
      "A heading was kept as a paragraph. A document's headings are its section titles.",
      'A table inside a table cell was kept as its text, one paragraph for each cell.',
      'An image was left out. Images cannot be pasted yet.',
      'An equation was left out. Equations cannot be pasted yet.',
      'A horizontal line was left out.',
      'Invisible control characters were removed.',
    ]);
  });

  it('writes every message with plain hyphens and no em or en dash', () => {
    const messages = Object.values(reportMessages).flatMap((group) => Object.values(group));
    expect(messages.length).toBeGreaterThan(30);
    for (const message of messages) {
      expect(message, message).not.toMatch(/[\u{2013}\u{2014}]/u);
      expect(message.trim(), message).toBe(message);
    }
  });
});
