import { Schema } from 'prosemirror-model';

/**
 * The editor's schema for this slice: the content root, paragraphs and unmarked text
 * (docs/plans/2026-09-16-editor-01-open-edit-and-save.md, decision 5). Every other node and mark in
 * content-model.md arrives with the plan that makes it editable; until then `toEditor` refuses to open a
 * component holding one for editing, so the mapping is never lossy.
 *
 * The root's title, language and direction are attributes of `doc`, so a later plan that edits them
 * does so as steps (component-editor.md, "The surface"). A block's `id` defaults to null because
 * ProseMirror must be able to make a paragraph on its own; the identity plugin fills it, and
 * `fromEditor` refuses one it did not (ADR-0023).
 */
export const editorSchema = new Schema({
  nodes: {
    doc: {
      content: 'paragraph+',
      attrs: { title: {}, language: {}, direction: {} },
    },
    paragraph: {
      content: 'text*',
      marks: '',
      attrs: { id: { default: null }, style: { default: 'body' } },
      // Typing is read back from the DOM through these rules, so a paragraph the browser makes is
      // still a paragraph - with no identifier, which the identity plugin then allocates.
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0],
    },
    text: {},
  },
  marks: {},
});
