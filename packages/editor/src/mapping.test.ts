import type { ContentDocument, Mark } from '@alloy-works/domain';
import { Fragment, type Node } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';

import { fromEditor, toEditor, type Opened } from './mapping.js';
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

const run = (value: string, marks: Mark[]) => ({ type: 'text' as const, value, marks });

/** One paragraph of the given runs, under the same root as every other fixture here. */
const documentWith = (content: ReturnType<typeof run>[]): ContentDocument =>
  document([{ type: 'paragraph', id: 'b1', style: 'body', content }]);

/** The editor document, or the names `toEditor` refused it for - never a silent skip. */
const openedDoc = (stored: ContentDocument): Node => {
  const result = toEditor(stored);
  if (!result.editable) throw new Error(`unsupported: ${result.unsupported.join(', ')}`);
  return (result as Extract<Opened, { editable: true }>).doc;
};

const root = { title: 'Install the printer', language: 'en-GB', direction: 'ltr' };

/** An editor document holding one link over one run, whatever the stored model would make of it. */
const withLink = (href: string): Node =>
  editorSchema.node('doc', root, [
    editorSchema.node('paragraph', { id: 'b1', style: 'body' }, [
      editorSchema.text('the report', [
        editorSchema.marks.hyperlink!.create({ id: 'h1', href, title: null }),
      ]),
    ]),
  ]);

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

  it('CNT-031 round-trips all eight character marks unchanged', () => {
    const stored = documentWith([
      run('plain', []),
      run('emphasised', [{ type: 'emphasis', id: 'm1' }]),
      run('strong', [{ type: 'strong', id: 'm2' }]),
      run('underlined', [{ type: 'underline', id: 'm3' }]),
      run('sub', [{ type: 'subscript', id: 'm4' }]),
      run('sup', [{ type: 'superscript', id: 'm5' }]),
      run('code', [{ type: 'inlineCode', id: 'm6' }]),
      run('quoted', [{ type: 'quotedPhrase', id: 'm7' }]),
      run('term', [{ type: 'definedTerm', id: 'm8', term: 'tensile strength' }]),
    ]);

    const result = toEditor(stored);
    expect(result.editable).toBe(true);
    const doc = (result as Extract<Opened, { editable: true }>).doc;
    expect(doc.attrs.title).toBe('Install the printer');
    expect(fromEditor(doc)).toEqual(stored);
  });

  it('CNT-003 keeps two overlapping annotations whole, neither nested nor split in two', () => {
    // "alpha beta gamma": emphasis over "alpha beta", a second annotation over "beta gamma" -
    // modelled here with `language`, the other overlapping mark this slice has, because a comment
    // mark opens read-only. The middle run carries both, which is what an overlap looks like in a
    // flat run sequence: neither annotation contains the other, and neither is two annotations.
    const stored = documentWith([
      run('alpha ', [{ type: 'emphasis', id: 'e1' }]),
      run('beta', [
        { type: 'emphasis', id: 'e1' },
        { type: 'language', id: 'l1', tag: 'fr' },
      ]),
      run(' gamma', [{ type: 'language', id: 'l1', tag: 'fr' }]),
    ]);

    const doc = openedDoc(stored);
    expect(fromEditor(doc)).toEqual(stored);
    const ids = new Set<string>();
    doc.firstChild?.forEach((text) =>
      text.marks.forEach((mark) => ids.add(mark.attrs.id as string)),
    );
    expect([...ids].sort()).toEqual(['e1', 'l1']);
  });

  it('CNT-126 carries a hyperlink over a range with an absolute target and an optional title, and stores no target that is not absolute', () => {
    const stored = documentWith([
      run('the report', [{ type: 'hyperlink', id: 'h1', href: 'https://example.test/report' }]),
      run(' or write to ', []),
      run('Ada', [
        { type: 'hyperlink', id: 'h2', href: 'mailto:ada@example.test', title: 'Write to Ada' },
      ]),
    ]);

    const doc = openedDoc(stored);
    const runs = doc.firstChild;
    expect(runs?.child(0).text).toBe('the report');
    expect(runs?.child(0).marks[0]?.attrs).toEqual({
      id: 'h1',
      href: 'https://example.test/report',
      title: null,
    });
    expect(runs?.child(2).marks[0]?.attrs).toEqual({
      id: 'h2',
      href: 'mailto:ada@example.test',
      title: 'Write to Ada',
    });
    expect(fromEditor(doc)).toEqual(stored);

    // The editor's `href` attribute is a bare string, so a relative target can be put on a mark in
    // the editor; it is the stored model that refuses one, and `fromEditor` goes through it. Which
    // means a relative target can never be saved. Refusing one *as it is typed*, with words the
    // author reads, is the link prompt's job.
    expect(() => fromEditor(withLink('/report'))).toThrow();
    expect(() => fromEditor(withLink('report.html'))).toThrow();
  });

  it('opens read-only for a mark nothing in T1 can create, naming it', () => {
    const stored = documentWith([run('x', [{ type: 'comment', id: 'c1', threadId: 't1' }])]);
    expect(toEditor(stored)).toEqual({ editable: false, unsupported: ['mark:comment'] });
  });

  // Uncited: CNT-003 is demonstrated above, by the overlap the mapping carries. This is what the
  // editor cannot hold, which is a limit on the editor rather than the requirement being met.
  it('opens read-only where one run carries two annotations of one type, naming it', () => {
    // The model lets two annotations of one type cover one range (CNT-003), and ProseMirror does
    // not: `doc.check()` calls such a text node "Invalid collection of marks", and the view's own
    // read-back of what it rendered keeps one of the two. Opening read-only names what it cannot
    // hold, rather than opening and silently saving the loss.
    const stored = documentWith([
      run('alloy', [
        { type: 'definedTerm', id: 'd1', term: 'alloy' },
        { type: 'definedTerm', id: 'd2', term: 'metal' },
      ]),
    ]);
    expect(toEditor(stored)).toEqual({ editable: false, unsupported: ['mark:definedTerm'] });
  });

  it('drops a run with no text, which ProseMirror has no node for and the stored model no longer keeps', () => {
    const stored = documentWith([
      run('', []),
      run('Unbox the printer.', []),
      run('', [{ type: 'emphasis', id: 'm1' }]),
    ]);

    const doc = openedDoc(stored);
    expect(doc.firstChild?.childCount).toBe(1);
    expect(fromEditor(doc).content).toEqual([paragraph('b1', 'Unbox the printer.')]);
  });

  it('refuses to store a node a paragraph of this schema does not hold, naming it', () => {
    // Built with `copy`, which does not check content, because the schema itself refuses this
    // today. The guard is for the day a paragraph holds an image or a footnote: an inline node the
    // mapping has no run for is refused by name rather than stored as a run with no text.
    const inner = editorSchema.node('paragraph', { id: 'b2', style: 'body' });
    const block = editorSchema
      .node('paragraph', { id: 'b1', style: 'body' })
      .copy(Fragment.from(inner));
    const doc = editorSchema.node('doc', root, [block]);
    expect(() => fromEditor(doc)).toThrow(/cannot store: paragraph/);
  });

  it('refuses to open for editing anything it has no counterpart for, naming what it found', () => {
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
        content: [
          { type: 'text', value: 'Loud', marks: [{ type: 'strong', id: 'm1' }] },
          {
            type: 'text',
            value: 'Proposed',
            marks: [{ type: 'suggestion', id: 's1', operation: 'insert', author: 'Grace' }],
          },
        ],
      },
    ]);
    expect(toEditor(stored)).toEqual({
      editable: false,
      unsupported: ['list', 'mark:suggestion'],
    });
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
