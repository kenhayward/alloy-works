import { describe, expect, it } from 'vitest';

import type { ContentDocument } from '../model/document.js';

import { normalise } from './normalise.js';
import { createReport } from './report.js';

const receiver: ContentDocument = {
  schemaVersion: 1,
  title: 'Site visits',
  language: 'en-GB',
  direction: 'ltr',
  content: [{ type: 'paragraph', id: 'b1', style: 'body', content: [] }],
};

const text = (value: string, marks: unknown[] = []) => ({ type: 'text', value, marks });
const paragraph = (content: unknown[], extra: Record<string, unknown> = {}) => ({
  type: 'paragraph',
  style: 'body',
  content,
  ...extra,
});

const run = (candidate: Record<string, unknown>) => {
  const report = createReport();
  const output = normalise(candidate, receiver, report);
  return { output, entries: report.entries.map(({ message: _, ...entry }) => entry) };
};

describe('the normalise stage', () => {
  it('passes content with nothing to normalise through unchanged, and reports nothing', () => {
    const clean = { schemaVersion: 1, content: [paragraph([text('Leeds, then York.')])] };
    expect(run(clean)).toEqual({ output: clean, entries: [] });
  });

  it('drops typeface, size and colour wherever they arrive, counting each', () => {
    const { output, entries } = run({
      schemaVersion: 1,
      content: [
        paragraph([{ ...text('Big'), presentation: { typeface: 'Leeds Serif', size: '24pt' } }], {
          presentation: { colour: '#c00', typeface: 'Leeds Sans' },
        }),
      ],
    });
    expect(output).toEqual({ schemaVersion: 1, content: [paragraph([text('Big')])] });
    expect(entries).toEqual([
      { stage: 'normalise', action: 'discarded', subject: 'typeface', count: 2 },
      { stage: 'normalise', action: 'discarded', subject: 'size', count: 1 },
      { stage: 'normalise', action: 'discarded', subject: 'colour', count: 1 },
    ]);
  });

  it('drops other formatting, naming each property the reader gave', () => {
    const { output, entries } = run({
      schemaVersion: 1,
      content: [
        paragraph([text('x')], { presentation: { 'text-align': 'center', 'margin-top': '2em' } }),
        paragraph([text('y')], { presentation: { 'text-align': 'right' } }),
        paragraph([text('z')], { presentation: 'color: red' }),
      ],
    });
    expect(output).toEqual({
      schemaVersion: 1,
      content: [paragraph([text('x')]), paragraph([text('y')]), paragraph([text('z')])],
    });
    expect(entries).toEqual([
      {
        stage: 'normalise',
        action: 'discarded',
        subject: 'appearance',
        count: 2,
        detail: 'text-align',
      },
      {
        stage: 'normalise',
        action: 'discarded',
        subject: 'appearance',
        count: 1,
        detail: 'margin-top',
      },
      { stage: 'normalise', action: 'discarded', subject: 'appearance', count: 1 },
    ]);
  });

  it('puts every string in NFC, counting the strings it changed', () => {
    const { output, entries } = run({
      schemaVersion: 1,
      content: [
        paragraph([text('Cafe\u{301}'), text('already \u{E9}')]),
        { type: 'preformatted', text: 'Ame\u{301}lie' },
      ],
    });
    expect(output).toEqual({
      schemaVersion: 1,
      content: [
        paragraph([text('Caf\u{E9}'), text('already \u{E9}')]),
        { type: 'preformatted', text: 'Am\u{E9}lie' },
      ],
    });
    expect(entries).toEqual([
      { stage: 'normalise', action: 'rewritten', subject: 'unicode', count: 2 },
    ]);
  });

  it('drops empty runs of text, then every empty paragraph standing after another', () => {
    const { output, entries } = run({
      schemaVersion: 1,
      content: [
        paragraph([text('One')]),
        paragraph([]),
        paragraph([text('')]),
        paragraph([]),
        paragraph([text('Two'), text('')]),
        {
          type: 'blockquote',
          content: [paragraph([]), paragraph([])],
        },
      ],
    });
    expect(output).toEqual({
      schemaVersion: 1,
      content: [
        paragraph([text('One')]),
        paragraph([]),
        paragraph([text('Two')]),
        { type: 'blockquote', content: [paragraph([])] },
      ],
    });
    expect(entries).toEqual([
      { stage: 'normalise', action: 'discarded', subject: 'emptyText', count: 2 },
      { stage: 'normalise', action: 'discarded', subject: 'emptyParagraph', count: 3 },
    ]);
  });

  it('keeps the language content came from as a mark over its text, where it differs', () => {
    const { output, entries } = run({
      schemaVersion: 1,
      language: 'fr-FR',
      direction: 'ltr',
      content: [
        paragraph([
          text('Bonjour'),
          text('Hello', [{ type: 'language', tag: 'en-GB' }]),
          { type: 'footnote', anchor: { kind: 'span' }, content: [paragraph([text('Note')])] },
        ]),
      ],
    });
    expect(output).toEqual({
      schemaVersion: 1,
      content: [
        paragraph([
          text('Bonjour', [{ type: 'language', tag: 'fr-FR' }]),
          text('Hello', [{ type: 'language', tag: 'en-GB' }]),
          {
            type: 'footnote',
            anchor: { kind: 'span' },
            content: [paragraph([text('Note', [{ type: 'language', tag: 'fr-FR' }])])],
          },
        ]),
      ],
    });
    expect(entries).toEqual([
      { stage: 'normalise', action: 'rewritten', subject: 'language', detail: 'fr-FR' },
    ]);
  });

  it("adds no mark where the language is the receiving component's own", () => {
    const same = {
      schemaVersion: 1,
      language: 'en-GB',
      direction: 'ltr',
      content: [paragraph([text('x')])],
    };
    expect(run(same)).toEqual({
      output: { schemaVersion: 1, content: [paragraph([text('x')])] },
      entries: [],
    });
  });

  it('reports a language that is not a tag, and a direction it cannot keep', () => {
    const { output, entries } = run({
      schemaVersion: 1,
      language: 'french',
      direction: 'rtl',
      content: [paragraph([text('x')])],
    });
    expect(output).toEqual({ schemaVersion: 1, content: [paragraph([text('x')])] });
    expect(entries).toEqual([
      { stage: 'normalise', action: 'discarded', subject: 'language', detail: 'french' },
      { stage: 'normalise', action: 'discarded', subject: 'direction', detail: 'rtl' },
    ]);
  });
});
