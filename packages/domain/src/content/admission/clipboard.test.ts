import { describe, expect, it } from 'vitest';

import type { BlockNode } from '../model/blocks.js';
import type { ContentDocument } from '../model/document.js';

import { admit, type AdmissionInput } from './admit.js';
import {
  PRODUCT_CLIPBOARD_FORMAT,
  readProductClipboard,
  writeProductClipboard,
} from './clipboard.js';
import { admissionLimits } from './limits.js';
import type { Receiver } from './reidentify.js';
import type { ReportEntry } from './report.js';

const copied: BlockNode[] = [
  {
    type: 'paragraph',
    id: 'p1',
    style: 'body',
    content: [
      {
        type: 'text',
        value: 'Inspect ',
        marks: [
          { type: 'emphasis', id: 'e1' },
          { type: 'comment', id: 'c1', threadId: 'thread-7' },
        ],
      },
      {
        type: 'text',
        value: 'weekly',
        marks: [
          { type: 'comment', id: 'c1', threadId: 'thread-7' },
          { type: 'suggestion', id: 's1', operation: 'replace', author: 'Grace' },
        ],
      },
    ],
  },
  {
    type: 'list',
    id: 'l1',
    kind: 'ordered',
    items: [{ content: [{ type: 'paragraph', id: 'p2', style: 'body', content: [] }] }],
  },
];

const source: ContentDocument = {
  schemaVersion: 1,
  title: 'Leeds site',
  language: 'en-GB',
  direction: 'ltr',
  content: copied,
};

const target: ContentDocument = {
  schemaVersion: 1,
  title: 'York site',
  language: 'en-GB',
  direction: 'ltr',
  content: [{ type: 'paragraph', id: 'y1', style: 'body', content: [] }],
};

const into = (document: ContentDocument): Receiver => {
  let next = 0;
  return { document, conditionAxes: [], newIdentifier: () => `z${(next += 1)}` };
};

const read = (text: string): AdmissionInput => {
  const result = readProductClipboard(text);
  if (!result.ok) throw new Error(`expected the clipboard to read, got ${result.refusal}`);
  return result.input;
};

const happened = (report: readonly ReportEntry[]) =>
  report.map(({ message: _, ...entry }) => entry);

describe('the product clipboard', () => {
  it('writes copied blocks with the schema version, language and direction they were written in', () => {
    expect(JSON.parse(writeProductClipboard(source, copied))).toEqual({
      format: PRODUCT_CLIPBOARD_FORMAT,
      schemaVersion: 1,
      language: 'en-GB',
      direction: 'ltr',
      content: copied,
    });
  });

  it('reads what it wrote back as a reader output, reporting nothing of its own', () => {
    expect(read(writeProductClipboard(source, copied))).toEqual({
      candidate: { schemaVersion: 1, language: 'en-GB', direction: 'ltr', content: copied },
      report: [],
    });
  });

  it.each([
    ['text that is not JSON', 'Inspect weekly'],
    ['JSON in another format', JSON.stringify({ format: 'text/html', content: [] })],
    ['JSON with no format', JSON.stringify({ schemaVersion: 1, content: [] })],
    ['a JSON array', '[]'],
  ])('refuses %s as unreadable', (_, text) => {
    const result = readProductClipboard(text);
    expect(result).toMatchObject({ ok: false, refusal: 'unreadable' });
    expect(result).not.toHaveProperty('input');
    expect(happened(result.ok ? [] : result.report)).toEqual([
      { stage: 'read', action: 'refused', subject: 'unreadable' },
    ]);
  });

  it('refuses text longer than one admission may hold, before parsing it', () => {
    const result = readProductClipboard(' '.repeat(admissionLimits.characters + 1));
    expect(result).toMatchObject({ ok: false, refusal: 'oversized' });
    expect(result).not.toHaveProperty('input');
    expect(happened(result.ok ? [] : result.report)).toEqual([
      { stage: 'read', action: 'refused', subject: 'oversized' },
    ]);
  });
});

describe('copying within the product', () => {
  it('CNT-132 gives every pasted block a new identifier, even pasted back into the component it came from', () => {
    const outcome = admit(read(writeProductClipboard(source, copied)), into(source));
    if (!outcome.ok) throw new Error(`expected an admission, got ${outcome.refusal}`);

    const blockIds = (blocks: readonly BlockNode[]): string[] =>
      blocks.flatMap((block) => [
        block.id,
        ...(block.type === 'list' ? block.items.flatMap((item) => blockIds(item.content)) : []),
      ]);
    const pasted = blockIds(outcome.content);
    expect(pasted).toEqual(['z1', 'z3', 'z4']);
    for (const id of blockIds(copied)) expect(pasted).not.toContain(id);
    expect(outcome.content[1]).toEqual({
      type: 'list',
      id: 'z3',
      kind: 'ordered',
      items: [{ content: [{ type: 'paragraph', id: 'z4', style: 'body', content: [] }] }],
    });
    expect(happened(outcome.report)).toEqual([
      { stage: 'reidentify', action: 'discarded', subject: 'comment' },
      { stage: 'reidentify', action: 'discarded', subject: 'suggestion' },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 3 },
      { stage: 'reidentify', action: 'rewritten', subject: 'markIdentifier', count: 1 },
    ]);
  });

  it('CNT-133 drops a comment anchor and a suggestion pasted into another component, and names each once', () => {
    const outcome = admit(read(writeProductClipboard(source, copied)), into(target));
    if (!outcome.ok) throw new Error(`expected an admission, got ${outcome.refusal}`);

    expect(outcome.content[0]).toEqual({
      type: 'paragraph',
      id: 'z1',
      style: 'body',
      content: [
        { type: 'text', value: 'Inspect ', marks: [{ type: 'emphasis', id: 'z2' }] },
        { type: 'text', value: 'weekly', marks: [] },
      ],
    });
    expect(JSON.stringify(outcome.content)).not.toMatch(/comment|suggestion|thread-7|Grace/);
    expect(happened(outcome.report)).toEqual([
      { stage: 'reidentify', action: 'discarded', subject: 'comment' },
      { stage: 'reidentify', action: 'discarded', subject: 'suggestion' },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 3 },
      { stage: 'reidentify', action: 'rewritten', subject: 'markIdentifier', count: 1 },
    ]);
  });

  it('CNT-135 reports a copy within the product to the same standard as a foreign paste of the same content', () => {
    const hostile = [
      ...copied,
      {
        type: 'paragraph',
        id: 'p3',
        style: 'body',
        handlers: ['onclick'],
        content: [
          {
            type: 'text',
            value: 'here',
            marks: [{ type: 'hyperlink', id: 'h1', href: 'javascript:alert(1)' }],
          },
        ],
      },
    ];
    const internal = admit(
      read(
        JSON.stringify({ format: PRODUCT_CLIPBOARD_FORMAT, schemaVersion: 1, content: hostile }),
      ),
      into(target),
    );
    const foreign = admit(
      { candidate: { schemaVersion: 1, content: hostile }, report: [] },
      into(target),
    );

    expect(internal).toEqual(foreign);
    expect(internal.ok && internal.content).toHaveLength(3);
    expect(happened(internal.report)).toEqual([
      { stage: 'sanitise', action: 'discarded', subject: 'eventHandler', detail: 'onclick' },
      {
        stage: 'sanitise',
        action: 'discarded',
        subject: 'hyperlink',
        detail: 'javascript:alert(1)',
      },
      { stage: 'reidentify', action: 'discarded', subject: 'comment' },
      { stage: 'reidentify', action: 'discarded', subject: 'suggestion' },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 4 },
      { stage: 'reidentify', action: 'rewritten', subject: 'markIdentifier', count: 1 },
    ]);
  });

  it('marks text copied from a component in another language with the language it came from', () => {
    const french: ContentDocument = { ...source, language: 'fr-FR' };
    const outcome = admit(
      read(
        writeProductClipboard(french, [
          {
            type: 'paragraph',
            id: 'p9',
            style: 'body',
            content: [{ type: 'text', value: 'Bonjour', marks: [] }],
          },
        ]),
      ),
      into(target),
    );
    expect(outcome.ok && outcome.content).toEqual([
      {
        type: 'paragraph',
        id: 'z1',
        style: 'body',
        content: [
          { type: 'text', value: 'Bonjour', marks: [{ type: 'language', id: 'z2', tag: 'fr-FR' }] },
        ],
      },
    ]);
    expect(happened(outcome.report)).toEqual([
      { stage: 'normalise', action: 'rewritten', subject: 'language', detail: 'fr-FR' },
      { stage: 'reidentify', action: 'rewritten', subject: 'blockIdentifier', count: 1 },
      { stage: 'reidentify', action: 'rewritten', subject: 'markIdentifier', count: 1 },
    ]);
  });
});
