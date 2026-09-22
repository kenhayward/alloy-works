import {
  admissionLimits,
  admit,
  type ContentDocument,
  type ReportEntry,
} from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { readMarkdown } from './markdown.js';

const text = (value: string, ...marks: Record<string, unknown>[]) => ({
  type: 'text',
  value,
  marks,
});
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });

function read(markdown: string) {
  const result = readMarkdown(markdown);
  if (!result.ok) throw new Error(`refused: ${result.refusal}`);
  return result.input;
}

const content = (markdown: string) => (read(markdown).candidate as { content: unknown[] }).content;

/** The report without its sentences, which the domain's report test pins. */
const happened = (report: readonly ReportEntry[]) =>
  report.map(({ message: _, ...entry }) => entry);

describe('reading Markdown', () => {
  it('reads paragraphs and their marks, a soft line break joining the lines of one', () => {
    expect(
      content('Some *emphasis*, **strong**, `code`\nand [a link](https://example.com/).\n\nSecond'),
    ).toEqual([
      paragraph(
        text('Some '),
        text('emphasis', { type: 'emphasis' }),
        text(', '),
        text('strong', { type: 'strong' }),
        text(', '),
        text('code', { type: 'inlineCode' }),
        text(' and '),
        text('a link', { type: 'hyperlink', href: 'https://example.com/' }),
        text('.'),
      ),
      paragraph(text('Second')),
    ]);
  });

  it('reads lists, nested, with the number a numbered one starts at', () => {
    expect(content('3. Three\n4. Four\n   - under\n')).toEqual([
      {
        type: 'list',
        kind: 'ordered',
        start: 3,
        items: [
          { content: [paragraph(text('Three'))] },
          {
            content: [
              paragraph(text('Four')),
              { type: 'list', kind: 'unordered', items: [{ content: [paragraph(text('under'))] }] },
            ],
          },
        ],
      },
    ]);
  });

  it('reads a quotation, and a fenced block as preformatted text with its language', () => {
    expect(content('> Said so.\n\n```sql\nSELECT 1\n  FROM x\n```\n')).toEqual([
      { type: 'blockquote', content: [paragraph(text('Said so.'))] },
      { type: 'preformatted', text: 'SELECT 1\n  FROM x\n', language: 'sql' },
    ]);
  });

  it('keeps a heading as a paragraph, leaves out an image and a rule, and says so', () => {
    const input = read('# Title\n\n![chart](https://example.com/a.png)\n\n---\n\nAfter\n');
    expect((input.candidate as { content: unknown[] }).content).toEqual([
      paragraph(text('Title')),
      paragraph(text('After')),
    ]);
    expect(happened(input.report)).toEqual([
      { stage: 'read', action: 'rewritten', subject: 'heading', count: 1 },
      { stage: 'read', action: 'discarded', subject: 'image', count: 1 },
      { stage: 'read', action: 'discarded', subject: 'rule', count: 1 },
    ]);
  });

  it('hands HTML written in the Markdown to the same sanitising as a paste of HTML', () => {
    const receiver = {
      document: {
        schemaVersion: 1,
        title: 'Notes',
        language: 'en-GB',
        direction: 'ltr',
        content: [{ type: 'paragraph', id: 'b1', style: 'body', content: [] }],
      } satisfies ContentDocument,
      conditionAxes: [],
      newIdentifier: (() => {
        let next = 0;
        return () => `n${(next += 1)}`;
      })(),
    };
    const outcome = admit(
      read('Hi <b onclick="steal()">there</b>\n\n<script>steal()</script>\n'),
      receiver,
    );
    if (!outcome.ok) throw new Error(outcome.failure);
    expect(JSON.stringify(outcome.content)).not.toMatch(/script|steal|onclick/);
    expect(outcome.report.map((entry) => entry.subject)).toEqual(
      expect.arrayContaining(['script', 'eventHandler']),
    );
  });

  it('refuses Markdown longer than one addition can hold, before parsing it', () => {
    expect(readMarkdown('a'.repeat(admissionLimits.characters + 1))).toMatchObject({
      ok: false,
      refusal: 'oversized',
    });
  });
});
