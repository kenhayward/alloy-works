import type { BlockNode, ContentDocument, InlineNode } from '@alloy-works/domain';
import { undo } from 'prosemirror-history';
import type { Node } from 'prosemirror-model';
import {
  NodeSelection,
  TextSelection,
  type EditorState,
  type Transaction,
} from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import { IMAGE_OWN_DESCRIPTION } from './figures.js';
import {
  deleteImage,
  imageAt,
  insertImage,
  replaceImageAsset,
  setImageAlternative,
} from './images.js';
import { fromEditor, toEditor } from './mapping.js';
import { applyMarkCommand, somewhereToPutMark, toggleMarkCommand } from './marks.js';
import { editorSchema } from './schema.js';
import { createEditorState } from './state.js';

// Invented asset version identifiers: an image names the version it shows, as a figure does.
const RED = '00000000-0000-4000-8000-00000000a551';
const BLUE = '00000000-0000-4000-8000-00000000b10e';

const counter = (prefix = 'n') => {
  let next = 0;
  return () => `${prefix}${(next += 1)}`;
};

const text = (value: string): InlineNode => ({ type: 'text', value, marks: [] });
const image = (
  alternative: Extract<InlineNode, { type: 'image' }>['alternative'],
  asset = RED,
): InlineNode => ({ type: 'image', asset, imageStyle: 'inline', alternative });
const paragraph = (id: string, ...content: InlineNode[]): BlockNode => ({
  type: 'paragraph',
  id,
  style: 'body',
  content,
});
const table = (...cells: BlockNode[][]): BlockNode => ({
  type: 'table',
  id: 't1',
  style: 'table',
  caption: [text('Readings')],
  headerRows: 0,
  headerColumns: 0,
  rows: [{ cells: cells.map((content) => ({ content, colspan: 1, rowspan: 1 })) }],
});

const documentOf = (...content: BlockNode[]): ContentDocument => ({
  schemaVersion: 1,
  title: 'Shapes',
  language: 'en-GB',
  direction: 'ltr',
  content,
});

function stateOf(document: ContentDocument, at?: number): EditorState {
  const opened = toEditor(document);
  if (!opened.editable) throw new Error(`not editable: ${opened.unsupported.join(', ')}`);
  const state = createEditorState({ doc: opened.doc, newIdentifier: counter() });
  if (at === undefined) return state;
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
}

/** The position just inside the block carrying this identifier. */
function inside(doc: Node, id: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (node.attrs.id === id) found = pos + 1;
    return true;
  });
  if (found === -1) throw new Error(`no ${id}`);
  return found;
}

/** The first image in the document, selected whole. */
function selectImage(state: EditorState): EditorState {
  let at = -1;
  state.doc.descendants((node, pos) => {
    if (at === -1 && node.type.name === 'image') at = pos;
    return at === -1;
  });
  if (at === -1) throw new Error('no image');
  return state.apply(state.tr.setSelection(NodeSelection.create(state.doc, at)));
}

function run(
  state: EditorState,
  command: (s: EditorState, d?: (tr: Transaction) => void) => boolean,
) {
  let next = state;
  const handled = command(state, (tr) => (next = state.apply(tr)));
  return { handled, next };
}

const stored = (state: EditorState) => fromEditor(state.doc).content;

describe('an inline image in the editor (figures 4)', () => {
  it('CNT-087 opens an image in a run of text and stores it back exactly, in each state of its alternative text', () => {
    for (const alternative of [
      { kind: 'own', text: 'Our logo' },
      { kind: 'inherited' },
      { kind: 'decorative' },
    ] as const) {
      const document = documentOf(
        paragraph('p1', text('Press '), image(alternative), text(' to start.')),
      );
      const opened = toEditor(document);
      if (!opened.editable) throw new Error(opened.unsupported.join(', '));
      expect(fromEditor(opened.doc).content, alternative.kind).toEqual(document.content);
    }
  });

  it('still opens for reading only an image anywhere but a paragraph, naming it', () => {
    const decorative = image({ kind: 'decorative' });
    const inCaption = documentOf({
      type: 'figure',
      id: 'f1',
      asset: RED,
      imageStyle: 'figure',
      caption: [text('Shapes '), decorative],
      alternative: { kind: 'decorative' },
    });
    const inAttribution = documentOf({
      type: 'blockquote',
      id: 'q1',
      content: [paragraph('p1', text('Words.'))],
      attribution: [decorative],
    });
    for (const document of [inCaption, inAttribution]) {
      expect(toEditor(document)).toEqual({ editable: false, unsupported: ['image'] });
    }
  });

  it('draws the image one line high from the asset version, its alt as a figure gives one', () => {
    const toDOM = editorSchema.nodes.image!.spec.toDOM!;
    const drawn = (alternative: object) =>
      toDOM(
        editorSchema.nodes.image!.create({ asset: RED, imageStyle: 'inline', alternative }),
      ) as unknown as [string, Record<string, string>];
    expect(drawn({ kind: 'own', text: 'Our logo' })).toEqual([
      'img',
      expect.objectContaining({
        src: `/v1/asset-versions/${RED}/content`,
        alt: 'Our logo',
        class: 'aw-inline-image',
      }),
    ]);
    expect(drawn({ kind: 'decorative' })[1].alt).toBe('');
    expect(drawn({ kind: 'inherited' })[1].alt).toBe(IMAGE_OWN_DESCRIPTION);
  });

  it('CNT-087 places an image at the cursor in a run of text, and one undo takes it away', () => {
    const state = stateOf(documentOf(paragraph('p1', text('Press here'))));
    const at = run(
      state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, inside(state.doc, 'p1') + 5)),
      ),
      insertImage(RED, { kind: 'decorative' }),
    );
    expect(at.handled).toBe(true);
    expect(stored(at.next)).toEqual([
      paragraph('p1', text('Press'), image({ kind: 'decorative' }), text(' here')),
    ]);
    // The cursor stands after the image, ready to go on typing.
    expect(at.next.selection.$from.nodeBefore?.type.name).toBe('image');
    const undone = run(at.next, undo);
    expect(stored(undone.next)).toEqual([paragraph('p1', text('Press here'))]);
  });

  it('CNT-086 places an image in a paragraph in a table cell, and stores it there', () => {
    const state = stateOf(documentOf(table([paragraph('c1', text('Site '))])));
    const at = run(
      state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, inside(state.doc, 'c1') + 5)),
      ),
      insertImage(RED, { kind: 'own', text: 'A red flag' }),
    );
    expect(at.handled).toBe(true);
    const [placed] = stored(at.next) as [Extract<BlockNode, { type: 'table' }>];
    expect(placed.rows[0]!.cells[0]!.content).toEqual([
      paragraph('c1', text('Site '), image({ kind: 'own', text: 'A red flag' })),
    ]);
  });

  it('places no image where one may not stand, nor one described by spaces alone', () => {
    const quoted = stateOf(
      documentOf({
        type: 'blockquote',
        id: 'q1',
        content: [paragraph('p1', text('Words.'))],
        attribution: [text('Ada')],
      }),
    );
    let attribution = -1;
    quoted.doc.descendants((node, pos) => {
      if (node.type.name === 'attribution') attribution = pos + 1;
      return true;
    });
    const inAttribution = quoted.apply(
      quoted.tr.setSelection(TextSelection.create(quoted.doc, attribution)),
    );
    expect(insertImage(RED, { kind: 'decorative' })(inAttribution)).toBe(false);

    const code = stateOf(documentOf({ type: 'preformatted', id: 'b1', text: 'x = 1\n' }), 2);
    expect(insertImage(RED, { kind: 'decorative' })(code)).toBe(false);

    const plain = stateOf(documentOf(paragraph('p1', text('Press'))), 2);
    expect(insertImage(RED, { kind: 'own', text: '   ' })(plain)).toBe(false);
  });

  it('never lets a mark rest on an image, whatever the mark is put over', () => {
    // Found by the final review: the paragraph allows every mark, so ProseMirror put one on the image
    // too - shown on the surface and never stored. Ruling R1: the image carries none.
    const document = documentOf(
      paragraph('p1', text('ab'), image({ kind: 'decorative' }), text('cd')),
    );
    const state = stateOf(document);
    const all = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, inside(state.doc, 'p1'), inside(state.doc, 'p1') + 5),
      ),
    );
    const bold = run(all, toggleMarkCommand('strong', counter('s')));
    expect(bold.handled).toBe(true);
    bold.next.doc.descendants((node) => {
      if (node.type.name === 'image') expect(node.marks).toEqual([]);
    });
    // An image selected whole is nothing to put a mark on, so no dialog opens for it.
    const selected = selectImage(stateOf(document));
    expect(somewhereToPutMark(selected, 'hyperlink')).toBe(false);
    expect(somewhereToPutMark(selected, 'strong')).toBe(false);
  });

  it('changes a link that runs across an image as the one annotation it is', () => {
    // The stored model closes an annotation only at text without it, so an image inside a link does
    // not break it; the editor, asked from one side, must change both.
    const link = (value: string): InlineNode => ({
      type: 'text',
      value,
      marks: [{ type: 'hyperlink', id: 'k1', href: 'https://old.example/' }],
    });
    const state = stateOf(
      documentOf(paragraph('p1', link('ab'), image({ kind: 'decorative' }), link('cd'))),
    );
    const cursor = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, inside(state.doc, 'p1') + 1)),
    );
    const changed = run(
      cursor,
      applyMarkCommand('hyperlink', counter('k'), { href: 'https://new.example/' }),
    );
    expect(changed.handled).toBe(true);
    const [block] = stored(changed.next) as unknown as [{ content: InlineNode[] }];
    const targets = block.content.flatMap((each) =>
      each.type === 'text' ? each.marks.map((mark) => (mark as { href: string }).href) : [],
    );
    expect(targets).toEqual(['https://new.example/', 'https://new.example/']);
  });

  it('goes on with the link and the formatting it stands in when text is typed straight after an image', () => {
    // Found by the re-review: text typed after an image took its marks from the image, which has
    // none, so a link over words either side of the image was split, the far half renamed.
    const link = (value: string): InlineNode => ({
      type: 'text',
      value,
      // In the schema's order, which the editor writes a run's marks in.
      marks: [
        { type: 'strong', id: 's1' },
        { type: 'hyperlink', id: 'k1', href: 'https://old.example/' },
      ],
    });
    const state = stateOf(
      documentOf(paragraph('p1', link('ab'), image({ kind: 'decorative' }), link('cd'))),
    );
    // Just after the image: two characters and the image into the paragraph.
    const after = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, inside(state.doc, 'p1') + 3)),
    );
    const typed = after.apply(after.tr.insertText('X'));
    const [block] = stored(typed) as unknown as [{ content: InlineNode[] }];
    expect(block.content).toEqual([link('ab'), image({ kind: 'decorative' }), { ...link('Xcd') }]);
  });

  it('reads, sets, replaces and deletes an image selected whole', () => {
    const state = selectImage(
      stateOf(documentOf(paragraph('p1', text('Press '), image({ kind: 'inherited' })))),
    );
    expect(imageAt(state)).toMatchObject({ asset: RED, alternative: { kind: 'inherited' } });
    // Nothing is selected whole in running text.
    expect(imageAt(stateOf(documentOf(paragraph('p1', text('Press'))), 2))).toBeNull();

    const described = run(state, setImageAlternative({ kind: 'own', text: 'Our logo' }));
    expect(stored(described.next)).toEqual([
      paragraph('p1', text('Press '), image({ kind: 'own', text: 'Our logo' })),
    ]);
    expect(setImageAlternative({ kind: 'own', text: ' ' })(state)).toBe(false);

    const replaced = run(state, replaceImageAsset(BLUE, { kind: 'decorative' }));
    expect(stored(replaced.next)).toEqual([
      paragraph('p1', text('Press '), image({ kind: 'decorative' }, BLUE)),
    ]);

    const deleted = run(state, deleteImage);
    expect(stored(deleted.next)).toEqual([paragraph('p1', text('Press '))]);
  });
});
