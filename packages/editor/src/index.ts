export { editorSchema } from './schema.js';
export { fromEditor, toEditor, type Opened } from './mapping.js';
export { identityPlugin, newBlockIdentifier } from './identity.js';
export {
  applyMarkCommand,
  EDITOR_COMMANDS,
  markAt,
  markKeymap,
  markThroughout,
  removeMarkCommand,
  somewhereToPutMark,
  toggleMarkCommand,
  type EditorCommand,
} from './marks.js';
export {
  createEditorState,
  enterWithoutEmpties,
  noAdjacentEmptyParagraphs,
  type EditorStateOptions,
} from './state.js';
export {
  headerOf,
  setDirection,
  setLanguage,
  setTitle,
  titleAccepted,
  type ComponentHeader,
} from './header.js';
export { mountEditor, type MountOptions } from './view.js';
export { Selection } from 'prosemirror-state';
export type { Command, EditorState, Transaction } from 'prosemirror-state';
export type { EditorView } from 'prosemirror-view';
