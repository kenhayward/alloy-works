import type { ContentDocument } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { fromEditor, toEditor } from './mapping.js';
import { editorSchema } from './schema.js';

const document = (content: ContentDocument['content']): ContentDocument => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content,
});

const paragraph = (id: string, text: string, style = 'body') => ({
  type: 'paragraph' as const,
  id,
  style,
  content: text === '' ? [] : [{ type: 'text' as const, value: text, marks: [] }],
});

describe('the mapping between the stored model and the editor', () => {
  it('carries paragraphs of text, their styles and the root members there and back unchanged', () => {
    const stored = document([
      paragraph('b1', 'Unbox the printer.'),
      paragraph('b2', ''),
      paragraph('b3', 'Connect it to power.', 'note'),
    ]);
    stored.direction = 'rtl';

    const opened = toEditor(stored);
    expect(opened.editable).toBe(true);
    if (!opened.editable) return;
    expect(opened.doc.attrs).toEqual({
      title: 'Install the printer',
      language: 'en-GB',
      direction: 'rtl',
    });
    expect(fromEditor(opened.doc)).toEqual(stored);
  });

  it('keeps adjacent text runs as one run, as the editor holds them', () => {
    const stored = document([
      {
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [
          { type: 'text', value: 'Unbox ', marks: [] },
          { type: 'text', value: 'the printer.', marks: [] },
        ],
      },
    ]);
    const opened = toEditor(stored);
    if (!opened.editable) throw new Error('expected an editable document');
    expect(fromEditor(opened.doc).content).toEqual([paragraph('b1', 'Unbox the printer.')]);
  });

  it('refuses to open for editing anything but paragraphs of unmarked text, naming what it found', () => {
    const stored = document([
      paragraph('b1', 'Before'),
      {
        type: 'list',
        id: 'l1',
        kind: 'unordered',
        items: [{ content: [paragraph('b2', 'Item')] }],
      },
      {
        type: 'paragraph',
        id: 'b3',
        style: 'body',
        content: [{ type: 'text', value: 'Loud', marks: [{ type: 'strong', id: 'm1' }] }],
      },
    ]);
    expect(toEditor(stored)).toEqual({ editable: false, unsupported: ['list', 'mark:strong'] });
  });

  it('refuses to store a block the editor has not identified', () => {
    const doc = editorSchema.node(
      'doc',
      { title: 'Install the printer', language: 'en-GB', direction: 'ltr' },
      [editorSchema.node('paragraph', { id: null, style: 'body' }, [editorSchema.text('Hello')])],
    );
    expect(() => fromEditor(doc)).toThrow(/has no identifier/);
  });

  it('refuses to store what the stored model refuses, rather than storing a defect', () => {
    const doc = editorSchema.node(
      'doc',
      { title: 'Install the printer', language: 'en-GB', direction: 'ltr' },
      [
        editorSchema.node('paragraph', { id: 'b1', style: 'body' }),
        editorSchema.node('paragraph', { id: 'b1', style: 'body' }, [editorSchema.text('Twice')]),
      ],
    );
    expect(() => fromEditor(doc)).toThrow(/used more than once/);
  });
});
