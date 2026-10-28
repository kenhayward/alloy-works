import type { ContentDocument } from '@alloy-works/domain';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import { blockCommand } from './blocks.js';
import {
  changeIndexMarker,
  indexEntryRefused,
  indexMarkerAt,
  indexMarkerPlaceable,
  indexTermsIn,
  insertIndexMarker,
  type IndexEntryChoice,
} from './indexEntries.js';
import { fromEditor, toEditor } from './mapping.js';
import { EDITOR_COMMANDS, somewhereToPutMark } from './marks.js';
import { createEditorState } from './state.js';
import { titleSchema } from './title.js';

const stored: ContentDocument = {
  schemaVersion: 1,
  title: 'Alloys',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    {
      type: 'paragraph',
      id: 'p1',
      style: 'body',
      content: [{ type: 'text', value: 'Bronze is ', marks: [] }],
    },
    { type: 'preformatted', id: 'pre1', text: 'code' },
  ],
};

function caretAt(offset: number): EditorState {
  const opened = toEditor(stored);
  if (!opened.editable) throw new Error('not editable');
  const state = createEditorState({ doc: opened.doc, newIdentifier: () => 'n1' });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, offset)));
}

const runs = (state: EditorState) =>
  (fromEditor(state.doc).content as unknown as [{ content: unknown[] }])[0].content;

const entry = (over: Partial<IndexEntryChoice> = {}): IndexEntryChoice => ({
  term: 'Alloy',
  sub: null,
  see: null,
  seeAlso: null,
  ...over,
});

describe('marking an index entry (the IX plan, IX-M)', () => {
  it('STR-043 places the entry an author marked, selected whole, and stores its term and sub-entry', () => {
    let next = caretAt(11);
    expect(indexMarkerPlaceable(next)).toBe(true);
    expect(
      insertIndexMarker(entry({ sub: 'bronze' }))(next, (tr) => (next = next.apply(tr))),
    ).toBe(true);
    expect(next.selection).toBeInstanceOf(NodeSelection);
    expect(indexMarkerAt(next)).toEqual({ pos: 11, ...entry({ sub: 'bronze' }) });
    expect(runs(next).at(-1)).toEqual({ type: 'indexMarker', term: 'Alloy', sub: 'bronze' });
  });

  it('changes the marker selected to a "see", then to "see also"s, and is removed as any atom is', () => {
    let next = caretAt(11);
    insertIndexMarker(entry())(next, (tr) => (next = next.apply(tr)));
    const run = (command: ReturnType<typeof changeIndexMarker>) =>
      command(next, (tr) => (next = next.apply(tr)));
    expect(run(changeIndexMarker(11, entry({ term: 'Brass', see: 'Alloy' })))).toBe(true);
    expect(runs(next).at(-1)).toEqual({ type: 'indexMarker', term: 'Brass', see: 'Alloy' });
    expect(run(changeIndexMarker(11, entry({ term: 'Tin', seeAlso: ['Alloy', 'Bronze'] })))).toBe(
      true,
    );
    expect(indexMarkerAt(next)).toMatchObject({ term: 'Tin', see: null, seeAlso: ['Alloy', 'Bronze'] });
    expect(runs(next).at(-1)).toEqual({
      type: 'indexMarker',
      term: 'Tin',
      seeAlso: ['Alloy', 'Bronze'],
    });
    expect(run(changeIndexMarker(3, entry()))).toBe(false);
    next = next.apply(next.tr.deleteSelection());
    expect(indexTermsIn(next.doc)).toEqual([]);
  });

  it('refuses what the content model refuses, naming the member, and places nothing', () => {
    expect(indexEntryRefused(entry())).toBeNull();
    expect(indexEntryRefused(entry({ term: '' }))).toBe('term');
    expect(indexEntryRefused(entry({ term: 'a'.repeat(201) }))).toBe('term');
    expect(indexEntryRefused(entry({ sub: 'two\nlines' }))).toBe('sub');
    expect(indexEntryRefused(entry({ sub: '   ' }))).toBe('sub');
    expect(indexEntryRefused(entry({ see: 'Café' }))).toBe('see');
    expect(indexEntryRefused(entry({ seeAlso: [] }))).toBe('seeAlso');
    expect(indexEntryRefused(entry({ seeAlso: Array.from({ length: 11 }, () => 'Tin') }))).toBe(
      'seeAlso',
    );
    expect(indexEntryRefused(entry({ see: 'Tin', seeAlso: ['Lead'] }))).toBe('seeAlso');
    const state = caretAt(11);
    expect(insertIndexMarker(entry({ term: '' }))(state, () => undefined)).toBe(false);
  });

  it('places none in preformatted text or a title', () => {
    const pre = caretAt(15);
    expect(pre.selection.$from.parent.type.name).toBe('preformatted');
    expect(indexMarkerPlaceable(pre)).toBe(false);
    expect(insertIndexMarker(entry())(pre)).toBe(false);
    const title = EditorState.create({
      doc: titleSchema.node('doc', null, [titleSchema.text('A')]),
    });
    expect(indexMarkerPlaceable(title)).toBe(false);
  });

  it("offers each term the component's markers carry, once, in reading order", () => {
    let next = caretAt(11);
    for (const term of ['Tin', 'Alloy', 'Tin']) {
      insertIndexMarker(entry({ term }))(next, (tr) => (next = next.apply(tr)));
    }
    expect(indexTermsIn(next.doc)).toEqual(['Tin', 'Alloy']);
  });

  it('puts no mark on a marker selected whole, which carries none', () => {
    let next = caretAt(11);
    insertIndexMarker(entry())(next, (tr) => (next = next.apply(tr)));
    expect(somewhereToPutMark(next, 'strong')).toBe(false);
  });

  it('CNT-077 is offered as Index entry, beside Cite, prompting for the entry on its own shortcut', () => {
    const command = EDITOR_COMMANDS.find(
      (each) => each.kind === 'block' && each.action === 'indexEntry',
    );
    expect(command).toMatchObject({ label: 'Index entry', shortcut: 'Mod-Shift-1', prompts: true });
    expect(blockCommand('indexEntry', () => 'n1')(caretAt(11))).toBe(true);
    expect(blockCommand('indexEntry', () => 'n1')(caretAt(15))).toBe(false);
  });
});
