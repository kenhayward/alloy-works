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

  it("reads a table, the header row Markdown's own", () => {
    expect(content('| Part | Count |\n| --- | --- |\n| Drum | **2** |\n')).toEqual([
      {
        type: 'table',
        caption: [],
        headerRows: 1,
        headerColumns: 0,
        rows: [
          {
            cells: [
              { content: [paragraph(text('Part'))], colspan: 1, rowspan: 1 },
              { content: [paragraph(text('Count'))], colspan: 1, rowspan: 1 },
            ],
          },
          {
            cells: [
              { content: [paragraph(text('Drum'))], colspan: 1, rowspan: 1 },
              { content: [paragraph(text('2', { type: 'strong' }))], colspan: 1, rowspan: 1 },
            ],
          },
        ],
      },
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

/** What admission stored, with the identifiers it minted left out: they are fresh on every paste. */
const unidentified = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(unidentified)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => key !== 'id')
            .map(([key, each]) => [key, unidentified(each)]),
        )
      : value;
/** A paragraph as admission stores it, in the body style. */
const stored = (...content: unknown[]) => ({ type: 'paragraph', style: 'body', content });
const run = (value: string, mark?: Record<string, unknown>) => ({
  type: 'text',
  value,
  marks: mark ? [mark] : [],
});
const storedCell = (colspan: number, value: string) => ({
  content: [stored(run(value))],
  colspan,
  rowspan: 1,
});
const receiving = () => {
  let next = 0;
  return {
    document: {
      schemaVersion: 1,
      title: 'Notes',
      language: 'en-GB',
      direction: 'ltr',
      content: [{ type: 'paragraph', id: 'b1', style: 'body', content: [] }],
    } as ContentDocument,
    conditionAxes: [],
    newIdentifier: () => `n${(next += 1)}`,
  };
};

describe('Markdown pasted whole', () => {
  // Not cited as CNT-061, for the reason html.test.ts gives CNT-062: a heading is kept as a paragraph
  // and said so, and the statement makes no such exception until Ken decides its wording.
  it('keeps every structure a component can hold, and says what it changed and left out', () => {
    const fence = '`'.repeat(3);
    const outcome = admit(
      read(
        [
          '## Setting up',
          '',
          '**Unbox** the *printer*, run `lpr`, and see [the manual](https://example.com/manual).',
          '',
          '3. Plug it in',
          '   - At the wall',
          '4. Switch it on',
          '',
          '> Print only what you need.',
          '',
          `${fence}sh`,
          'lpr -P office  report.pdf',
          fence,
          '',
          '| Site | Value |',
          '| ---- | ----- |',
          '| York | 1     |',
          '',
          '![chart](https://example.com/a.png)',
          '',
        ].join(String.fromCharCode(10)),
      ),
      receiving(),
    );
    if (!outcome.ok) throw new Error(outcome.failure);

    expect(unidentified(outcome.content)).toEqual([
      stored(run('Setting up')),
      stored(
        run('Unbox', { type: 'strong' }),
        run(' the '),
        run('printer', { type: 'emphasis' }),
        run(', run '),
        run('lpr', { type: 'inlineCode' }),
        run(', and see '),
        run('the manual', { type: 'hyperlink', href: 'https://example.com/manual' }),
        run('.'),
      ),
      {
        type: 'list',
        kind: 'ordered',
        start: 3,
        items: [
          {
            content: [
              stored(run('Plug it in')),
              {
                type: 'list',
                kind: 'unordered',
                items: [{ content: [stored(run('At the wall'))] }],
              },
            ],
          },
          { content: [stored(run('Switch it on'))] },
        ],
      },
      { type: 'blockquote', content: [stored(run('Print only what you need.'))] },
      {
        type: 'preformatted',
        text: `lpr -P office  report.pdf${String.fromCharCode(10)}`,
        language: 'sh',
      },
      {
        type: 'table',
        style: 'table',
        caption: [],
        headerRows: 1,
        headerColumns: 0,
        rows: [
          { cells: [storedCell(1, 'Site'), storedCell(1, 'Value')] },
          { cells: [storedCell(1, 'York'), storedCell(1, '1')] },
        ],
      },
    ]);
    expect(happened(outcome.report).filter((entry) => entry.stage === 'read')).toEqual([
      { stage: 'read', action: 'rewritten', subject: 'heading', count: 1 },
      { stage: 'read', action: 'discarded', subject: 'image', count: 1 },
    ]);
  });
});
