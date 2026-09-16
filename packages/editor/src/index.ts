export { editorSchema } from './schema.js';
export { fromEditor, toEditor, type Opened } from './mapping.js';
export { identityPlugin, newBlockIdentifier } from './identity.js';
export {
  createEditorState,
  enterWithoutEmpties,
  noAdjacentEmptyParagraphs,
  type EditorStateOptions,
} from './state.js';
export { mountEditor, type MountOptions } from './view.js';
export type { EditorState, Transaction } from 'prosemirror-state';
export type { EditorView } from 'prosemirror-view';
