export {
  blockCommand,
  listAt,
  listAwareEnter,
  MOST_NESTED_LEVELS,
  preformattedAt,
  setListAttributes,
  setPreformattedLanguage,
  type BlockAction,
} from './blocks.js';
export {
  pasteInto,
  PRODUCT_CLIPBOARD_TYPE,
  productClipboard,
  readClipboard,
  readMarkdownText,
  type ClipboardSource,
  type PasteOutcome,
} from './clipboard.js';
export { editorSchema } from './schema.js';
export {
  addBoundTableNote,
  BOUND_TABLE_NOTES_MAX,
  boundTableAt,
  changeTableBinding,
  columnsPlaced,
  deleteBoundTable,
  insertBoundTable,
  noteColumnDropped,
  removeBoundTableNote,
  repeatedColumn,
  selectBoundTableNote,
  setBoundTable,
  setBoundTablePart,
  setTableHeaders,
  setTableNumbered,
  setTableWide,
  tableAt,
  tableCommand,
  type BoundNoteAnchor,
  type BoundNoteAt,
  type BoundTableChange,
  type BoundTablePart,
  type BoundTablePlace,
  type SortKey,
  type TableAction,
  type TableAt,
  type TableChoice,
  type Wide,
} from './tables.js';
export {
  assetContentPath,
  changeFigureBinding,
  deleteFigure,
  figureAt,
  IMAGE_OWN_DESCRIPTION,
  insertBoundFigure,
  insertFigure,
  replaceFigureImage,
  setFigureAlternative,
  setFigureNumbered,
  type FigureAt,
} from './figures.js';
export { MISSING_IMAGE } from './figureView.js';
// The one drawing of an equation, which the Equation dialog draws its preview with (equations 1, ruling R8).
export { drawEquation, NO_DESCRIPTION, UNSHOWN_EQUATION } from './equationView.js';
export { footnoteAt, insertFootnote, openFootnote, type FootnoteAt } from './footnotes.js';
export {
  changeEquation,
  equationAt,
  equationPlaceable,
  insertEquation,
  type EquationAt,
  type EquationChoice,
} from './equations.js';
export {
  changeReference,
  insertReference,
  referenceAt,
  type ReferenceAt,
  type ReferenceChoice,
} from './references.js';
export {
  BROKEN_REFERENCE,
  IN_ANOTHER_COMPONENT,
  ownTargets,
  referencesShown,
  type ReferenceContext,
  type ReferenceShown,
} from './referenceText.js';
export { referenceContextOf, setReferenceContext } from './referenceView.js';
// What a binding shows, in a document and on its own, and the one it is selected whole (the B1 plan).
export {
  A_BOUND_VALUE,
  BINDING_FAILURE_WORDS,
  bindingFailureWords,
  bindingSelected,
  bindingsShown,
  boundFiguresShown,
  boundTablesShown,
  BOUND_VALUE,
  DEFAULT_TABLE_SETTING,
  PAGE_ROWS,
  NOTE_KEY_REQUIRED,
  noteRowMissing,
  storedBoundTable,
  TABLE_CHANGED,
  TABLE_FAILURE_WORDS,
  TABLE_NEVER_RESOLVED,
  TABLE_READING,
  TABLE_UNAVAILABLE,
  tableAlone,
  tableFailureWords,
  type BoundTableAt,
  type BoundTableNoteShown,
  type BoundTableShown,
  type TableHeld,
  type TableSetting,
  bindingPlaceable,
  changeBinding,
  insertBinding,
  type BindingChoice,
  CHANGED_SINCE_RESOLVED,
  NEVER_RESOLVED,
  REVISION_WAITING,
  storedBinding,
  type BindingContext,
  type BindingFailureHeld,
  type BindingFailureShown,
  type BindingHeld,
  type BindingSelected,
  type BindingShown,
  type BoundImage,
} from './bindings.js';
export { bindingContextOf, setBindingContext } from './bindingView.js';
export { fillBoundTable, moreRows, noteLabel } from './boundTableView.js';
export { pasteIntoOpenFootnote } from './footnoteView.js';
export {
  deleteImage,
  imageAt,
  insertImage,
  replaceImageAsset,
  setImageAlternative,
  type ImageAt,
} from './images.js';
export { fromEditor, toEditor, type Opened } from './mapping.js';
// What a reload replays (component-editor.md, "Undo across a reload"; W11.3).
export {
  mergeChange,
  recordChange,
  replayChanges,
  replayPlain,
  editorSchemaIdentity,
  schemaIdentity,
  type HistoryKind,
  type RecordedChange,
  type RecordedTransaction,
} from './replay.js';
export { identityPlugin, newBlockIdentifier, whereBlockIs } from './identity.js';
export {
  applyMarkCommand,
  commandKeymap,
  EDITOR_COMMANDS,
  markAt,
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
export { mountEditor, TEXT_CLASS, type MountOptions } from './view.js';
// A section title's field: one line of text and inline equations (equations 3, ruling R1).
export { titleFromEditor, titleSchema, titleToEditor, type TitleRun } from './title.js';
export { mountTitleEditor, type TitleEditor, type TitleEditorOptions } from './titleView.js';
export { renderContent } from './render.js';
export { paragraphPlaces } from './places.js';
export { paragraphsAt, setImageStyle, setParagraphStyle, setTableStyle } from './styles.js';
export { setStyleCheck, textWhereAt } from './resolution.js';
export { canInsertSymbol, insertSymbol } from './symbols.js';
export type { StyleCheck, TextWhere, Unresolved } from './resolution.js';
export { NodeSelection, Selection } from 'prosemirror-state';
export type { Command, EditorState, Transaction } from 'prosemirror-state';
export type { EditorView } from 'prosemirror-view';
export {
  CURRENT_TABLE_CLASS,
  FOCUSED_COLUMN_CLASS,
  focusBoundTableColumn,
} from './boundTableFocus.js';
