import type { ComponentView, createApiClient } from '@alloy-works/api-client';
import {
  bindingDigestInput,
  bindingsIn,
  parseContentDocument,
  readContent,
  type AnyBinding,
  type BoundTableNode,
  type ReportEntry,
} from '@alloy-works/domain';
import {
  bindingContextOf,
  bindingSelected,
  bindingsShown,
  boundFiguresShown,
  boundTableAt,
  boundTablesShown,
  changeTableBinding,
  columnsPlaced,
  insertBoundTable,
  type TableChoice,
  changeEquation,
  changeBinding,
  changeFigureBinding,
  changeReference,
  createEditorState,
  EDITOR_COMMANDS,
  equationAt,
  equationPlaceable,
  figureAt,
  fromEditor,
  imageAt,
  insertEquation,
  insertFigure,
  insertImage,
  insertBinding,
  insertBoundFigure,
  type BindingChoice,
  insertReference,
  insertSymbol,
  textWhereAt,
  replaceFigureImage,
  replaceImageAsset,
  headerOf,
  listAt,
  preformattedAt,
  tableAt,
  tablesIn,
  mountEditor,
  openFootnote,
  pasteInto,
  pasteIntoOpenFootnote,
  readMarkdownText,
  newBlockIdentifier,
  referenceContextOf,
  removeMarkCommand,
  NodeSelection,
  Selection as EditorSelection,
  setDirection,
  setLanguage,
  setBindingContext,
  setReferenceContext,
  setStyleCheck,
  setTitle,
  somewhereToPutMark,
  toEditor,
  type BindingContext,
  type ComponentHeader as Header,
  type EditorState,
  type EditorView,
  type EquationAt,
  type ReferenceContext,
  type Selection,
  storedBoundTable,
  whereBlockIs,
} from '@alloy-works/editor';
import '@alloy-works/editor/style.css';
import styles from './ComponentEditor.module.css';
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { positionAtTextOffset } from './caret.js';
import { ComponentHeader } from './ComponentHeader.js';
import { EditorToolbar } from './EditorToolbar.js';
import { FigureDialog } from './FigureDialog.js';
import { BoundTablePanel } from './BoundTablePanel.js';
import { BoundTableReadOnly, TableReadOnly } from './TableReadOnly.js';
import { FigurePanel } from './FigurePanel.js';
import { Toolbar } from '../parts/Toolbar.js';
import { Icon } from './Icon.js';
import { ListPanel } from './ListPanel.js';
import { PasteReport, shownOfPaste } from './PasteReport.js';
import { PreformattedPanel } from './PreformattedPanel.js';
import {
  dismissedFor,
  iterationLabel,
  keepDismissed,
  sentenceCase,
  unsavedSentence,
} from './recovery.js';
import { RecoveryPanel } from './RecoveryPanel.js';
import { TablePanel } from './TablePanel.js';
import { ValuePanel } from './ValuePanel.js';
import type { BindingState } from '../structure/bindingContexts.js';
import { MarkPrompt, type Refused } from './MarkPrompt.js';
import { askAndApply, pressCommand, type AskForValue, type MarkCommand } from './press.js';
import { referenceChoicesIn, type ReferenceChoices } from './referenceChoices.js';
import { ReferenceDialog } from './ReferenceDialog.js';
import { ValueDialog, type DocumentOffer } from './ValueDialog.js';
import { SymbolPalette } from './SymbolPalette.js';
import { SaveIndicator } from './SaveIndicator.js';
import { uploadImage } from './upload.js';
import { heldSentence } from './held.js';
import { editingSessionFor, sessionService, storedSessionId } from './service.js';
import {
  answerFor,
  continuing,
  createRecorder,
  forgetOffered,
  freshSession,
  keepOffered,
  lastSent,
  offeredWith,
  readKept,
  readOffered,
  replayStored,
  sentFor,
  textOfKept,
  type Recorder,
  type Sent,
  type StoredSession,
} from './stored-session.js';
import {
  browserClock,
  createSession,
  designTiming,
  type Clock,
  type Repeat,
  type Session,
  type SessionView,
  type Timing,
} from './session.js';
import { FieldsForm } from '../metadata/FieldsForm.js';
import { resolveBridge, type PlatformBridge } from '../platform/bridge.js';
import { spellingFor } from '../platform/spelling.js';
import { useStatus } from '../shell/Status.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';
import { everyPage } from '../paging.js';
import { byName } from '../metadata/people.js';
import { Canvas } from '../theme/Canvas.js';
import { ParagraphStyle } from '../theme/StyleChoice.js';
import { styleCheckFor, typefaceAt } from '../theme/check.js';
import { UnheldFaces } from '../theme/Canvas.js';
import { usePresentation } from '../theme/presentation.js';

/**
 * The Equation dialog, loaded the first time it opens, and Temml with it (equations 1's final review,
 * L5): Temml is about 50 kB compressed, and a page that never opens the dialog - most pages, and
 * every one with no editor on it - need not load it, as the Markdown reader is loaded only for Paste
 * as Markdown. A file of the product's own build, in both deliveries; nothing is fetched from
 * elsewhere.
 */
const EquationDialog = lazy(() =>
  import('./EquationDialog.js').then(({ EquationDialog }) => ({ default: EquationDialog })),
);

type Client = ReturnType<typeof createApiClient>;

export interface ComponentEditorProps {
  readonly componentId: string;
  readonly client: Client;
  /** The signed-in principal, to tell this author's other window from somebody else. */
  readonly principalId: string;
  /** Given in tests; the design's and the browser's otherwise. */
  readonly timing?: Timing;
  readonly clock?: Clock;
  readonly sessionId?: string;
  /** Given in tests, which drive the view by transaction because jsdom cannot type into it. */
  readonly onView?: (view: EditorView) => void;
  /** Told the space of the component once it has opened, for the space pane beside the editor. */
  readonly onSpace?: (space: { readonly id: string; readonly name: string }) => void;
  /**
   * Where the fields of the component's type are set, where that is somewhere other than beneath the
   * surface: the Attributes panel beside it (the LG plan, LG6b). Null while that place is not there
   * yet; left out, they stand beneath the surface. Their state is the editor's either way.
   */
  readonly fieldsHost?: HTMLElement | null;
  /**
   * Where a table's formatting is set: the Table tab of the panel beside the text (ADR-0052). Null
   * while that tab is not there yet; left out, as where a test opens the editor alone, it stands
   * under the toolbar.
   */
  readonly tableHost?: HTMLElement | null;
  /**
   * Told whether the component holds a table, and how many times the cursor has entered one: the
   * page offers the Table tab while it holds one, and chooses it each time the count goes up.
   */
  readonly onTable?: (table: { readonly holds: boolean; readonly entered: number }) => void;
  /** Its section number, where it is open in place in a document; there is none standalone. */
  readonly number?: string;
  /**
   * Given where it is open in place (interface slice 13): Done then closes it, releasing the lock
   * first when this author holds one, and is offered to a reader as the way out.
   */
  readonly onDone?: () => void;
  /** Where the text was clicked to open it, in characters: the focus and the caret go there. */
  readonly openAt?: number;
  /**
   * The block a link names (search.md, "The page"; SCH-057), and which arrival at it this is: the focus
   * and the caret go there - or the block is selected, where it has nothing to type into - or, where
   * the version that opens, the newest, no longer holds it, the page says so. A second link into the
   * component while it is open is a new arrival, and moves there without opening it again.
   */
  readonly linked?: { readonly block: string; readonly arrival: number } | null;
  /**
   * What the document it is open in offers a reference (cross-references 1, rulings R10 and R11):
   * `documentTargets` for this occurrence, from the page, which passes it again whenever it numbers
   * the document again. None standalone, where a reference shows its target's kind and caption and
   * the Reference dialog offers the component's own figures, tables and footnotes alone.
   */
  readonly referenceContext?: ReferenceContext | null;
  /**
   * Where its bindings are shown (the B1 plan, B1-D, B1-K): open in place in a document, what the
   * document holds for each - null where the page has not read it, or could not - which the page passes
   * again whenever it reads it again. Absent on the component's own page, where each binding shows what
   * it asks for, its definition's title read here once per definition, and never a value.
   */
  readonly bindingContext?: BindingContext | null;
  /** What the bindings view says of each binding, by identifier, in a document: the Value panel's. */
  readonly bindingStates?: ReadonlyMap<string, BindingState>;
  /**
   * Opens a value's provenance beside the text, from the Value panel's **Provenance** (B1-M), given the
   * button, which the focus returns to as it closes.
   */
  readonly onProvenance?: (binding: string, opener: HTMLElement) => void;
  /**
   * What a binding placed or changed here does in the document it is open in (the B2 plan, B2-C,
   * B2-D, B2-H): at a pinned node, nothing until the node takes a version holding it; otherwise the
   * page resolves or keeps it, told once this session has saved it - `session` null where this page
   * is not editing, so the binding is read from the version. Absent on the component's own page.
   */
  readonly bindingActs?: BindingActs;
  /**
   * What the document it is open in offers the Value dialog's **From the document** (the TP2 plan,
   * TP2-F), from the page. Absent on the component's own page, where a name is typed.
   */
  readonly documentParameters?: DocumentOffer;
  /**
   * The seam to whatever hosts the page, told the component's base language while it is open, for the
   * spelling checker (CNT-178); the host's own otherwise. Given in tests.
   */
  readonly bridge?: PlatformBridge;
  /**
   * Told the bound tables its text holds as it opens and whenever one changes (the TB2 plan, TB2-H),
   * so the document's Data tab checks what the author sees rather than what was last saved.
   */
  readonly onBoundTables?: (tables: readonly BoundTableNode[]) => void;
  /**
   * Told each save the service acknowledges, by its session and sequence (the TB2 final review), so a
   * document reads a bound table's rows from what the author has saved, and again after each save.
   */
  readonly onSaved?: (session: string, sequence: number) => void;
}

/** What the document does with a binding placed, changed, kept or resolved here (B2). */
export interface BindingActs {
  readonly pinned: boolean;
  readonly onSettle: (
    binding: string,
    session: string | null,
    act: 'placed' | 'changed' | 'keep' | 'resolve',
  ) => void;
}

type Loaded =
  | { readonly state: 'loading' }
  | { readonly state: 'missing' }
  /** Opening failed for a reason a retry may change (final review, finding 4). */
  | { readonly state: 'failed'; readonly signedOut: boolean }
  | { readonly state: 'unreadable'; readonly component: ComponentView }
  | {
      readonly state: 'readOnly';
      readonly component: ComponentView;
      readonly unsupported: readonly string[];
    }
  | { readonly state: 'open'; readonly component: ComponentView };

/** Every paragraph's text, one to a line: what can be kept of changes that could not be saved. */
const textOfDoc = (doc: EditorState['doc']) => {
  const lines: string[] = [];
  doc.forEach((paragraph) => lines.push(paragraph.textContent));
  return lines.join('\n');
};
const textOf = (view: EditorView) => textOfDoc(view.state.doc);

/**
 * The save a reload's window last sent, rebuilt from what it kept exactly as it was sent, to send again
 * where its answer never came back (a third look at W11.3); null where it cannot be, which is then taken
 * for the service being ahead.
 */
const repeatOf = (stored: StoredSession, sentLater: Sent | null): Repeat | null => {
  const sent = lastSent(stored, sentLater);
  if (sent === null) return null;
  try {
    return { content: fromEditor(sent.doc), values: sent.values };
  } catch {
    return null;
  }
};

/**
 * Said where what a window kept before this page opened is offered as text to copy rather than brought
 * back, or cannot be read at all, rather than dropping it unsaid (final review of W11.3, D5).
 */
const KEPT_OFFERED =
  'What you typed before this page opened could not be brought back, so it is below for you to copy.';
const KEPT_UNREADABLE = 'What you typed before this page opened could not be brought back.';

/**
 * Whether the surface takes changes in this phase - the one predicate, shared by the view's own
 * `editable` and the header's (review round 1, item 9): the header must go read-only exactly when the
 * surface does, `lost` among them, rather than staying editable by a narrower rule of its own.
 */
const isEditablePhase = (phase: SessionView['phase']) =>
  phase === 'reading' || phase === 'claiming' || phase === 'editing';

/** A binding choice asked of `insertBoundFigure` only to learn whether a figure could go there. */
const PROBE: BindingChoice = { query: '', parameters: {}, mode: 'checked', take: { column: '' } };
/** And for a bound table, which shows a column of any type but an image (TB2-E). */
const PROBE_TABLE: TableChoice = { query: '', parameters: {}, mode: 'checked' };
const PROBE_COLUMNS = [{ name: 'probe', type: { base: 'text' } }] as const;

/** Whether the document holds a result for a bound table's binding as the editor holds it now. */
function tableResolved(state: EditorState, binding: AnyBinding): boolean {
  const context = bindingContextOf(state);
  const held = context?.kind === 'document' ? context.held.get(binding.id) : undefined;
  return (
    held !== undefined && held.binding === bindingDigestInput(binding) && 'table' in held.shown
  );
}

/** What placing a bound table says where it left a declared column out (TB2-E). */
export const columnsLeftOut = (left: number): string =>
  `${left === 1 ? 'One column was' : `${left} columns were`} left out: a table shows no image column, and at most 64.`;

/** What the status bar says after a paste: the report's own last sentence says why one was refused. */
const PASTED = 'Pasted.';
const PASTED_WITH_REPORT =
  'Pasted. Some of it was changed or left out: the paste report says what.';
const NOT_DROPPED = 'Dragging content in is not available yet. Copy and paste it instead.';

/** A link names a block the newest version no longer holds (SCH-057): the page says so. */
export const LINKED_PART_GONE =
  'The part the link names is no longer in this component. This is its latest version.';
const CLIPBOARD_UNREADABLE =
  'The clipboard could not be read, so nothing was pasted. Allow this page to see the clipboard and try again.';

/**
 * What a paste says: the report's entries worth an author's attention, beside the sentence for the
 * status bar. A refusal's own sentence is the status bar's, so the report is for anything beside it.
 * One answer for both ways in - a paste the browser delivered, and Paste as Markdown.
 */
function pasteSentence(
  ok: boolean,
  report: readonly ReportEntry[],
): { readonly beside: readonly ReportEntry[]; readonly said: string } {
  const shown = shownOfPaste(report);
  const beside = ok ? shown : shown.slice(0, -1);
  const said = ok
    ? beside.length > 0
      ? PASTED_WITH_REPORT
      : PASTED
    : (report.at(-1)?.message ?? '');
  return { beside, said };
}

/** One dialog, open, and the press waiting on what the author does with it. */
interface Asking {
  readonly command: MarkCommand;
  /** What to put in the boxes: the mark that is there, or what was typed and then refused. */
  readonly values: Record<string, unknown> | null;
  /** Why the last press came back with nothing done, or null where none has. */
  readonly refused: Refused | null;
  /** Whether there is a mark of that type there to take off. */
  readonly removable: boolean;
  /** The text the mark will go on, as the selection held it when the dialog opened. */
  readonly selected: string | null;
  /** Bumped every time one opens, so a dialog reopened over a refusal is a fresh set of boxes. */
  readonly opened: number;
  readonly settle: (answer: Record<string, unknown> | null) => void;
}

/** How much a component holds, as a tooltip says it: its top-level blocks and its words. */
function sizeOf(doc: EditorView['state']['doc']): string {
  const blocks = doc.childCount;
  const words = doc
    .textBetween(0, doc.content.size, ' ', ' ')
    .split(/\s+/)
    .filter((word) => word !== '').length;
  return `${blocks} ${blocks === 1 ? 'block' : 'blocks'}, ${words} ${words === 1 ? 'word' : 'words'}`;
}

/**
 * One component, open for editing (component-editor.md): a title strip holding its number, title,
 * version, language and direction, the save chip, Done and Save version; the formatting toolbar; the
 * surface; and one status region that says what happened (interface slice 13). The surface is one
 * ProseMirror view (ADR-0023); the session decides when changes are sent and never cuts a version on
 * its own.
 */
/** Whether a component's text holds a table, plain or bound (ADR-0052): the Table tab's offer. */
function holdsATable(doc: EditorView['state']['doc']): boolean {
  let holds = false;
  doc.descendants((node) => {
    if (holds) return false;
    if (node.type.name === 'tableFigure' || node.type.name === 'boundTable') holds = true;
    return !holds;
  });
  return holds;
}

export function ComponentEditor({
  componentId,
  client,
  principalId,
  timing = designTiming,
  clock = browserClock,
  sessionId,
  onView,
  onSpace,
  fieldsHost,
  tableHost,
  onTable,
  number,
  onDone,
  openAt,
  linked = null,
  referenceContext = null,
  bindingContext,
  bindingStates,
  onProvenance,
  bindingActs,
  documentParameters,
  bridge = resolveBridge(),
  onBoundTables,
  onSaved,
}: ComponentEditorProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  // The bound tables told to the page, by their nodes' attributes: told again only when one changes.
  const toldTables = useRef<readonly object[] | null>(null);
  const toldAnchors = useRef<string | null>(null);
  const onBoundTablesRef = useRef(onBoundTables);
  onBoundTablesRef.current = onBoundTables;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const tellTables = (doc: EditorState['doc']) => {
    const attrs: object[] = [];
    const tables: BoundTableNode[] = [];
    doc.descendants((node) => {
      if (node.type.name !== 'boundTable') return true;
      attrs.push(node.attrs);
      tables.push(storedBoundTable(node));
      return false;
    });
    // Its notes' anchors too, which are its children's (TB3.3): a note added or removed is told.
    const anchors = JSON.stringify(
      tables.map((table) => (table.notes ?? []).map((each) => [each.id, each.anchor])),
    );
    const told = toldTables.current;
    if (
      told !== null &&
      toldAnchors.current === anchors &&
      told.length === attrs.length &&
      attrs.every((each, at) => each === told[at])
    ) {
      return;
    }
    toldTables.current = attrs;
    toldAnchors.current = anchors;
    onBoundTablesRef.current?.(tables);
  };
  // Held in a ref, so a parent passing a new inline callback on every render asks nothing again.
  const toldSpace = useRef(onSpace);
  toldSpace.current = onSpace;
  const spaceId = 'component' in loaded ? loaded.component.space.id : null;
  const spaceName = 'component' in loaded ? loaded.component.space.name : null;
  useEffect(() => {
    if (spaceId !== null && spaceName !== null) {
      toldSpace.current?.({ id: spaceId, name: spaceName });
    }
  }, [spaceId, spaceName]);
  // Bumped by Try again after opening failed, to ask for the component once more.
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState<SessionView | null>(null);
  const [kept, setKept] = useState<string | null>(null);
  // What was offered on opening, from before this page opened, as text to copy: held until the author
  // dismisses it, through claims, saves and reloads, since by then it is kept nowhere else (re-review
  // of W11.3). `kept`, above, is a refusal's, and a claim that succeeds after it clears it.
  const [offered, setOffered] = useState<string | null>(null);
  // The same, and for which component and whom, as the page last showed it: a component opened over
  // again reads it from here rather than from storage, which may have refused to keep it.
  const offeredShown = useRef<{
    readonly component: string;
    readonly principal: string;
    readonly text: string;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Said through the application's status bar, its one live region, where there is one (interface
  // slice 15); a component opened in place in a document shares it with the document's own notices.
  const status = useStatus();
  useEffect(() => {
    if (notice !== null) status?.say(notice);
  }, [status, notice]);
  const [header, setHeader] = useState<Header | null>(null);
  // The spelling checker checks against the component's base language while it is open, and again
  // as it changes (CNT-178). A run in another language is not checked at all (CNT-147), so its
  // language is not asked for.
  const baseLanguage = header?.language ?? null;
  useEffect(() => {
    if (baseLanguage === null) return undefined;
    return spellingFor(bridge).hold(baseLanguage);
  }, [bridge, baseLanguage]);
  // The surface itself, held as state rather than in a ref, because the formatting toolbar renders
  // from it: what a mark button says about the selection is read off `view.state` during a render,
  // and a ref set in an effect schedules none (pre-flight F8).
  const [surface, setSurface] = useState<EditorView | null>(null);
  // Bumped by every transaction, and read by nothing. Moving the caret changes what the toolbar must
  // say about the selection and changes nothing else in the page, so there is no value to compare
  // and nothing else that would ask React for a render.
  const [, setTransactions] = useState(0);
  // The link or language dialog, while one is open. Null the rest of the time, which is almost all
  // of it: nothing of it is rendered until a press asks for a value.
  const [asking, setAsking] = useState<Asking | null>(null);
  const place = useRef<HTMLDivElement | null>(null);
  // The other regions of the view; `place` is the last. Held as elements rather than as a list of
  // selectors, so a region that is not rendered at all - a component that failed to open, or the
  // list panel with the cursor outside a list - is simply absent from the ring rather than a query
  // that quietly finds nothing.
  const headerRegion = useRef<HTMLElement | null>(null);
  const toolbarRegion = useRef<HTMLDivElement | null>(null);
  // The list panel's, which is null for most of a session: it is the one region of this view that
  // comes and goes, because it exists only while the cursor stands in a counted list.
  const listRegion = useRef<HTMLDivElement | null>(null);
  // The preformatted panel's, which comes and goes the same way, with a preformatted block.
  const preformattedRegion = useRef<HTMLDivElement | null>(null);
  // The table panel's, which comes and goes the same way, with a table (tables 1).
  const tableRegion = useRef<HTMLDivElement | null>(null);
  // The figure panel's, while the cursor stands in a figure (figures 2, ruling R5).
  const figureRegion = useRef<HTMLDivElement | null>(null);
  const valueRegion = useRef<HTMLElement | null>(null);
  // The Bound table panel's, while the cursor stands in a bound table (TB2-F).
  const boundTableRegion = useRef<HTMLDivElement | null>(null);
  // The Recovery panel's, while the session is in Recovery (W11.2).
  const recoveryRegion = useRef<HTMLElement | null>(null);
  // What was focused when Recovery was asked for, which the focus goes back to as it closes where it
  // is still there; the surface otherwise, since the Recover that asked is gone by then.
  const recoveryOpener = useRef<HTMLElement | null>(null);
  // Whether Saved text was opened from reading, so Cancel gives back the lock it claimed (the R1 plan).
  const recoveryFromReading = useRef(false);
  // The unsaved changes this tab put away with Dismiss, by when they were saved (the R1 plan).
  const [dismissedAt, setDismissedAt] = useState<string | null>(() => dismissedFor(componentId));
  // Whether this page has a session of its own running: once it has edited or recovered, what the
  // component's GET said was saved and never made a version is no longer this page's to offer.
  const [ownSession, setOwnSession] = useState(false);
  // The notice's Recover, which takes the focus back once a Saved text opened from it is cancelled.
  const noticeRecover = useRef<HTMLButtonElement | null>(null);
  const [backToNotice, setBackToNotice] = useState(0);
  useEffect(() => {
    if (backToNotice > 0) noticeRecover.current?.focus();
  }, [backToNotice]);
  // The Figure dialog, open to make a figure or to give one another image, or closed.
  const [figureDialog, setFigureDialog] = useState<'Figure' | 'Image' | 'Replace image' | null>(
    null,
  );
  // The Reference dialog, open over the view it was asked from - the surface, or a footnote's open
  // editor - with what it offers there, or closed (cross-references 1, ruling R11).
  const [referring, setReferring] = useState<
    (ReferenceChoices & { readonly view: EditorView }) | null
  >(null);
  // What was focused as it opened, for the same reason as `opener` below, and apart from it: the
  // two dialogs are never open together, and each puts back only what it took.
  const referenceOpener = useRef<HTMLElement | null>(null);
  // The Equation dialog, open over the view it was asked from - the surface, or a footnote's open
  // editor - on the equation selected whole there or none, with whether a block may stand where a new
  // one would go; or closed (equations 1, ruling R8).
  const [equating, setEquating] = useState<{
    readonly view: EditorView;
    readonly current: EquationAt | null;
    readonly blockPlaceable: boolean;
  } | null>(null);
  // What was focused as it opened, as for the Reference dialog, and apart from it.
  const equationOpener = useRef<HTMLElement | null>(null);
  // The Value dialog, open over the view it was asked from on the binding selected whole there or
  // none, or closed (the B2 plan, task 4); and what was focused as it opened.
  const [valuing, setValuing] = useState<{
    readonly view: EditorView;
    readonly current: { readonly pos: number; readonly binding: AnyBinding } | null;
    /**
     * Where the value may stand (B6-H, TB2-E): offered as a figure or a table where a block may go,
     * the figure's own or the table's own where it changes a bound figure's or a bound table's
     * binding, and in the line otherwise.
     */
    readonly place: 'line' | 'offer' | 'figure' | 'table';
  } | null>(null);
  const valueOpener = useRef<HTMLElement | null>(null);
  // Whether the Bound table panel's Format dialog is open over the page (TB2-F).
  const [formatting, setFormatting] = useState(false);
  // The editing session this page saves under, which a binding placed here is read from (B2-C).
  const sessionNow = useRef<string | null>(null);
  // The symbol palette, open over the view it was asked from - the surface, or a footnote's open
  // editor - or closed (W14.7, W-L).
  const [symbolizing, setSymbolizing] = useState<EditorView | null>(null);
  // The view the palette gives the focus back to as it closes: where the cursor was, whether a
  // symbol went in or not (component-editor.md, "Accessibility"), never the button that opened it.
  const symbolsBack = useRef<EditorView | null>(null);
  // The paste report's, which comes and goes too: it is there from a paste with something to say
  // until it is closed or the next paste replaces it.
  const pasteRegion = useRef<HTMLElement | null>(null);
  const [pasteReport, setPasteReport] = useState<readonly ReportEntry[] | null>(null);
  // What a paste said while the lock it is the first change for was still being claimed. The claim
  // announces itself when it lands, in the one live region, and would otherwise replace it unheard.
  const pasteSaid = useRef<string | null>(null);
  // The session's notice as it last published it. The session publishes on every change of state,
  // carrying its notice each time, so a notice is news only when it differs from this; repeating it
  // would put it back over whatever the page said since - a paste, a refused header field.
  const sessionNotice = useRef<string | null>(null);
  const controls = useRef<Session | null>(null);
  // What this window keeps of the session for a reload (W11.3), told of every value changed.
  const recorder = useRef<Recorder | null>(null);
  // The metadata panel's region, beside the surface wherever the component has fields; its values as
  // the author holds them, which the session reads whole at every save (definitions.md); and who a
  // `user` field may name.
  const metadataRegion = useRef<HTMLElement | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  // Each time the values are put back rather than changed, the form is drawn anew.
  const [valuesDrawn, setValuesDrawn] = useState(0);
  const heldValues = useRef<Record<string, unknown>>({});
  const [people, setPeople] = useState<readonly { id: string; name: string }[]>([]);
  // Read only where a field names a person: a component with none has no one to pick.
  const wantsPeople =
    (loaded.state === 'open' || loaded.state === 'readOnly') &&
    loaded.component.fields.some((each) => each.dataType === 'user');
  useEffect(() => {
    if (!wantsPeople) return;
    let current = true;
    // Every page, then by name: the listing gives people in the order each first appeared.
    everyPage((cursor) =>
      client.GET('/v1/people', {
        params: { query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } },
      }),
    )
      .then((all) => {
        if (current && 'items' in all) setPeople(byName(all.items));
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [client, wantsPeople]);
  // A stale GET-time lock is only true until this session has claimed or released it itself (fix
  // round 1, minor): once that happens, the initial snapshot can no longer be trusted, so it is never
  // shown again for the life of this session.
  const staleLockKnown = useRef(false);
  // Whether `kept` already reflects the surface exactly as it stands (fix round 2, minor): true right
  // after `lost` or a refusal captures it, false again the moment a real change arrives. Without this,
  // a second refusal that found nothing new to lose - the reclaim from `lost` failing again, or a bare
  // Try again - would append the very same unchanged text a second time.
  const keptIsCurrent = useRef(false);
  // What was focused when a dialog opened, so that closing it puts the author back where they were.
  // Captured rather than assumed to be the button: a press from the toolbar deliberately leaves the
  // focus on the surface, so that the selection the command acts on survives, and a shortcut is
  // pressed in the surface to begin with.
  const opener = useRef<HTMLElement | null>(null);
  // What the dialog that closed last answered with, and nothing longer lived than that: it is put
  // back in the boxes where that very answer was then refused, so a refusal does not also take away
  // what it refused. Written by every close, so a dialog that answered nothing - cancelled, or a
  // Remove that found nothing to take off - leaves null here rather than somebody else's address.
  const answered = useRef<Record<string, unknown> | null>(null);
  // The press a dialog now standing is waiting on, so that a second dialog displacing the first
  // answers it rather than leaving it pending for ever. `inert` bars the author's own routes to a
  // second one; whether this is right should not depend on that.
  const pending = useRef<((answer: Record<string, unknown> | null) => void) | null>(null);
  // A refusal standing over the next opening of this mark's dialog, set the moment one arrives and
  // consumed by the dialog that carries it. It names the mark as well as the reason, so that a
  // refusal of a link can never surface in the language dialog.
  const refusal = useRef<{ readonly mark: string; readonly because: Refused } | null>(null);
  // How many dialogs have opened, which is what makes a reopened one a fresh set of boxes rather
  // than the same React element updated in place.
  const openings = useRef(0);

  /**
   * Asks the author for a link's target or a run's language, and answers with what they gave -
   * null where they cancelled, which applies nothing (component-editor.md, "Marks").
   *
   * A refusal standing over this mark reopens the dialog **filled with what was refused**, so that
   * a target the stored model would not take is corrected rather than typed again from nothing.
   */
  /**
   * The text the selection covers as a dialog opens, captured then rather than read while it stands:
   * the selection moving is what a refusal of `gone` is about. Null for a caret, and for a
   * selection across blocks, which is more than the one line the dialog says it in.
   */
  const selectedText = (): string | null => {
    // The footnote's own text while one is open, which is what the dialog's mark goes on (final
    // review of footnotes 1, finding 4).
    const target = surface === null ? null : (openFootnote(surface) ?? surface);
    const selection = target?.state.selection;
    if (!selection || selection.empty || !selection.$from.sameParent(selection.$to)) return null;
    return target!.state.doc.textBetween(selection.from, selection.to);
  };

  const askFor: AskForValue = (command, current) =>
    new Promise((settle) => {
      const standing = refusal.current?.mark === command.mark ? refusal.current : null;
      refusal.current = null;
      pending.current?.(null);
      pending.current = settle;
      // Only where none is held: a dialog that comes straight back carrying a complaint must send
      // the author to what opened the first one, not to a button it is about to take away.
      opener.current ??=
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      openings.current += 1;
      setAsking({
        command,
        values: standing ? (answered.current ?? current) : current,
        refused: standing?.because ?? null,
        // What can be taken off is what is there now, never what was typed and refused.
        removable: current !== null,
        selected: selectedText(),
        opened: openings.current,
        settle,
      });
    });

  /**
   * One prompting command over this view, from the toolbar's press and from its shortcut alike.
   *
   * Answers whether the press was taken up, which is what lets a shortcut with nowhere to put its
   * mark hand the key back rather than swallow it.
   */
  const runPrompting = (view: EditorView, command: MarkCommand): boolean =>
    pressCommand({
      view,
      command,
      newIdentifier: newBlockIdentifier,
      prompt: askFor,
      onRefused: (refused) => askAgain(view, refused, whyRefused(view, refused)),
    });

  /**
   * Why a command answered no, as far as anything outside it can tell: the text it was to go on has
   * moved out from under the dialog, or else it is the value the author typed. Asked of the state
   * the command itself just read, so the answer is about the press that failed.
   */
  const whyRefused = (view: EditorView, command: MarkCommand): Refused =>
    somewhereToPutMark(view.state, command.mark) ? 'value' : 'gone';

  /**
   * A press came back with nothing done. Asking again is how the author is told: the dialog comes
   * back with what they typed still in it and the complaint beneath the box, which is where they
   * are looking, rather than as a notice somewhere else on the page.
   *
   * **It goes straight back to the dialog, not back through `pressCommand`.** The range gate is the
   * first press's job: re-running it would answer about the state as it is now, and a selection
   * that moved while the dialog stood over it would close the dialog with nothing applied, nothing
   * said, and a refusal left standing for the next press to inherit.
   *
   * It must not throw. The press that calls it wraps the continuation and the prompt in one
   * `catch`, so a handler that threw would be reported as a second refusal of the same value.
   */
  function askAgain(view: EditorView, command: MarkCommand, because: Refused) {
    if (view.isDestroyed) {
      // Nothing will open to carry it, so it must not be left standing over a later dialog.
      refusal.current = null;
      return;
    }
    refusal.current = { mark: command.mark, because };
    askAndApply({
      view,
      command,
      newIdentifier: newBlockIdentifier,
      prompt: askFor,
      onRefused: (refused) => askAgain(view, refused, whyRefused(view, refused)),
    });
  }

  /** Closes the dialog and answers the press. The focus goes back once the page behind is live. */
  const closeAsking = (answer: Record<string, unknown> | null) => {
    if (!asking) return;
    setAsking(null);
    answered.current = answer;
    pending.current = null;
    asking.settle(answer);
  };

  // The focus goes back **after** the render that takes the dialog away, never in the handler that
  // asked for it: the page behind is inert until that render, and focusing an element inside an
  // inert subtree does nothing at all.
  useEffect(() => {
    if (asking !== null) return;
    const back = opener.current;
    opener.current = null;
    back?.focus();
  }, [asking]);

  /**
   * Opens the Reference dialog over `editing` - the surface, or the footnote open in it - with what
   * the component and the page's context offer there. Answers true: the command has already said a
   * reference could be placed, which is what makes the press one that opens a dialog.
   */
  const openReference = (view: EditorView, editing: EditorView): boolean => {
    referenceOpener.current ??=
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReferring({ ...referenceChoicesIn(view, editing), view: editing });
    return true;
  };

  // As for `asking`: the focus goes back once the page behind is no longer inert.
  useEffect(() => {
    if (referring !== null) return;
    const back = referenceOpener.current;
    referenceOpener.current = null;
    back?.focus();
  }, [referring]);

  /**
   * Opens the Equation dialog over `editing` - the surface, or the footnote open in it - on the
   * equation selected whole there, to change it, or to place a new one; answers true, since the
   * command has already said an equation could be placed or is selected (equations 1, ruling R8).
   * Whether a block is offered is asked of the same state: never in a footnote, a cell or a caption.
   */
  const openEquation = (editing: EditorView): boolean => {
    equationOpener.current ??=
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEquating({
      view: editing,
      current: equationAt(editing.state),
      blockPlaceable: equationPlaceable(editing.state, 'block'),
    });
    return true;
  };

  // And the same for it.
  useEffect(() => {
    if (equating !== null) return;
    const back = equationOpener.current;
    equationOpener.current = null;
    back?.focus();
  }, [equating]);

  /** Opens the Value dialog over `editing`, on the binding selected whole there or to place one. */
  const openValue = (editing: EditorView): boolean => {
    valueOpener.current ??=
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const current = bindingSelected(editing.state);
    const mayBlock =
      current === null &&
      (insertBoundFigure(PROBE, () => '')(editing.state) ||
        insertBoundTable(PROBE_TABLE, PROBE_COLUMNS, () => '')(editing.state));
    setValuing({ view: editing, current, place: mayBlock ? 'offer' : 'line' });
    return true;
  };

  /** Opens the Value dialog on a bound table's binding, to change it (TB2-G). */
  const openTableValue = (editing: EditorView, at: { pos: number; binding: AnyBinding }) => {
    valueOpener.current ??=
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setValuing({ view: editing, current: at, place: 'table' });
  };

  /** Opens the Value dialog on a bound figure's binding, to change it (B6-H). */
  const openFigureValue = (editing: EditorView, at: { pos: number; binding: AnyBinding }) => {
    valueOpener.current ??=
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setValuing({ view: editing, current: at, place: 'figure' });
  };

  useEffect(() => {
    if (valuing !== null) return;
    const back = valueOpener.current;
    valueOpener.current = null;
    back?.focus();
  }, [valuing]);

  /**
   * Tells the document a binding was placed, changed, or asked to be kept or resolved, once this
   * session has saved it where it is editing, so the binding is read from that save (B2-C).
   */
  const settle = (binding: string, act: 'placed' | 'changed' | 'keep' | 'resolve') => {
    if (bindingActs === undefined || bindingActs.pinned) return;
    const session = controls.current;
    // A first change claims the lock: the save waits for the claim, as a binding placed is one.
    const phase = session?.view().phase;
    const editingNow = phase === 'editing' || phase === 'claiming';
    void (editingNow ? session!.saveNow() : Promise.resolve(false)).then((saved) =>
      bindingActs.onSettle(binding, saved ? sessionNow.current : null, act),
    );
  };

  /**
   * Opens the symbol palette over `editing` - the surface, or the footnote open in it; answers true,
   * since the command has already said a symbol could be typed there (W-L).
   */
  const openSymbols = (editing: EditorView): boolean => {
    setSymbolizing(editing);
    return true;
  };

  /** Closes the palette; the focus goes back to where the cursor was once the page is live. */
  const closeSymbols = () => {
    symbolsBack.current = symbolizing;
    setSymbolizing(null);
  };

  // As for the other dialogs, after the render that takes the palette away and the page's `inert`
  // with it; to the view, which puts the caret back where its selection is.
  useEffect(() => {
    if (symbolizing !== null) return;
    const back = symbolsBack.current;
    symbolsBack.current = null;
    if (back !== null && !back.isDestroyed) back.focus();
  }, [symbolizing]);

  // Held in refs, not the effect's own dependency list (fix round 1, finding 5): a parent that does
  // not memoise its callback, or recreates its timing object, must not tear the session down and
  // rebuild the surface from the original content on every render. Read fresh at the moment the effect
  // below actually runs - which is exactly once per (component, client, principal) - never stale.
  const timingRef = useRef(timing);
  timingRef.current = timing;
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const onViewRef = useRef(onView);
  onViewRef.current = onView;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const runPromptingRef = useRef(runPrompting);
  runPromptingRef.current = runPrompting;
  const openAtRef = useRef(openAt);
  openAtRef.current = openAt;
  // The arrival last taken, on the surface it was taken on: StrictMode mounts a second surface.
  const takenArrival = useRef<{ surface: EditorView; arrival: number } | null>(null);
  const openReferenceRef = useRef(openReference);
  openReferenceRef.current = openReference;
  const openEquationRef = useRef(openEquation);
  openEquationRef.current = openEquation;
  const openValueRef = useRef(openValue);
  openValueRef.current = openValue;
  const openSymbolsRef = useRef(openSymbols);
  openSymbolsRef.current = openSymbols;
  // The page's latest context, which every fresh state starts from: a state rebuilt after a version is
  // cut or a claim refused would otherwise start with none, and every reference would lose its label.
  const referenceContextRef = useRef(referenceContext);
  referenceContextRef.current = referenceContext;
  // On its own page, each definition's title, by its identifier (B1-K): read once per definition the
  // component's bindings name, null where the reader may not read it. Never a value.
  const [titles, setTitles] = useState<ReadonlyMap<string, string | null>>(new Map());
  const alone = bindingContext === undefined;
  const shownBindings: BindingContext | null = useMemo(
    () => (alone ? { kind: 'alone', titles } : (bindingContext ?? null)),
    [alone, titles, bindingContext],
  );
  // And the context every fresh state starts from, as the references' is.
  const bindingContextRef = useRef(shownBindings);
  bindingContextRef.current = shownBindings;
  // The session the component's last `GET` named, whose sequence it answered (final review of W11.3,
  // D3): a page that goes on under that id goes on above it.
  const askedSession = useRef<string | null>(null);

  useEffect(() => {
    let current = true;
    // The session this window keeps for the component, if any, is asked where its sequence stands
    // (W11.3): whether it goes on with kept changes or with none, as after a cut or a restore, which
    // keep none (final review of W11.3, D3).
    const asked = storedSessionId(componentId);
    void client
      .GET('/v1/components/{id}', {
        params: {
          path: { id: componentId },
          ...(asked === null ? {} : { query: { session: asked } }),
        },
      })
      .then(({ data, response }) => {
        if (!current) return;
        askedSession.current = asked;
        if (!data) {
          // Only a 404 means missing or unreadable, which the service answers alike (final review,
          // finding 4): signed out, a server error or no answer is not the component's absence.
          setLoaded(
            response.status === 404
              ? { state: 'missing' }
              : { state: 'failed', signedOut: response.status === 401 },
          );
          return;
        }
        let opened;
        try {
          opened = toEditor(parseContentDocument(data.content));
        } catch {
          setLoaded({ state: 'unreadable', component: data });
          return;
        }
        heldValues.current = { ...data.values };
        setValues(heldValues.current);
        setLoaded(
          opened.editable
            ? { state: 'open', component: data }
            : { state: 'readOnly', component: data, unsupported: opened.unsupported },
        );
      })
      .catch(() => {
        if (current) setLoaded({ state: 'failed', signedOut: false });
      });
    return () => {
      current = false;
    };
  }, [client, componentId, attempt]);

  const component = loaded.state === 'open' ? loaded.component : null;

  useEffect(() => {
    if (!component || !place.current) return undefined;
    const opened = toEditor(parseContentDocument(component.content));
    if (!opened.editable) return undefined;
    staleLockKnown.current = false;
    setOwnSession(false);
    const fresh = (doc = opened.doc, selection?: Selection) =>
      createEditorState({
        doc,
        newIdentifier: newBlockIdentifier,
        // A shortcut for a mark whose value only the author can give opens the same dialog the
        // toolbar's button opens, and runs the same press, so the keyboard and the button cannot
        // come to mean two different things (CNT-077). It reports the key handled only where it
        // did something with it: a component being read, or a selection with nowhere to put the
        // mark, hands the key back rather than swallowing it.
        onPrompt: (name) => {
          // Restated, not a case this catches: it is the same expression `editable` below is, and
          // ProseMirror hands a keydown to a keymap only while the view is editable - so a reader
          // never reaches here at all. It stays because the two must agree, and a later `editable`
          // that grew a clause of its own would leave the keyboard the one way in.
          if (!(component.mayEdit && isEditablePhase(phase))) return false;
          // Into the footnote's own text while one is open (footnotes 1, ruling R9).
          const into = openFootnote(view) ?? view;
          // **Reference** asks through its own dialog, as its button does (cross-references 1): the
          // keymap has already asked whether one could be placed here.
          if (name === 'reference') return openReferenceRef.current(view, into);
          // **Equation** too (equations 1, ruling R8), from its shortcut and from Enter over an
          // equation selected whole, in the footnote's text as in the component's.
          if (name === 'equation') return openEquationRef.current(into);
          // **Symbols** too (W-L), from its shortcut, in the footnote's text as in the component's.
          if (name === 'symbol') return openSymbolsRef.current(into);
          // **Value** too (B2-A), in the footnote's text as in the component's.
          if (name === 'value') return openValueRef.current(into);
          const command = EDITOR_COMMANDS.find(
            (each) => each.kind === 'mark' && each.mark === name,
          );
          if (command === undefined || command.kind !== 'mark') return false;
          return runPromptingRef.current(into, command);
        },
        referenceContext: referenceContextRef.current,
        bindingContext: bindingContextRef.current,
        ...(selection ? { selection } : {}),
      });
    let base = opened.doc;
    // The values' own base, as `base` is the text's: what a refused claim puts the fields back to.
    let baseValues: Record<string, unknown> = { ...component.values };
    let phase: SessionView['phase'] = 'reading';
    // What this window kept of its session before a reload (component-editor.md, "Undo across a
    // reload"), and only if it was kept for whoever is signed in now (final review of W11.3, D2):
    // replayed only where it was recorded against the version that opens - a change recorded against
    // an older one is never replayed (CNT-169) - where the author may still edit the component, and
    // where every change replays exactly onto a document the model holds. Anything else opens as a
    // page opened afresh does, with what was on screen offered as text to copy where it can be read
    // and differs from what opens, or said to be lost where it cannot be read at all (D5).
    const kept = readKept(component.id, principalId);
    const stored: StoredSession | null = kept?.readable === true ? kept.session : null;
    let offering: string | null = kept?.readable === false ? kept.text : null;
    let unreadable = kept?.readable === false && kept.text === null;
    let replayed: EditorState | null = null;
    if (stored !== null && stored.version === component.version.id && stored.revision > 0) {
      try {
        if (!component.mayEdit) throw new Error('The component may no longer be edited');
        const state = replayStored(stored, (doc) => fresh(doc));
        // Storable as it stands, or the first save would refuse it.
        fromEditor(state.doc);
        replayed = state;
      } catch {
        offering = textOfKept(stored);
        unreadable = offering === null;
      }
    }
    // True from a replay until its claim is answered: a refusal puts the surface back to the version
    // even where everything replayed was saved, since what is shown then is the latest version.
    let ahead = false;
    keptIsCurrent.current = false;
    /**
     * Captures the surface into `kept`, once for whatever it currently holds (fix round 2, minor).
     * Appends by default: a refused claim puts the surface back to the version, so each refusal's text
     * exists only in `kept`. `replace` is for a stop while editing goes on (signed out, or content
     * refused): the surface still holds everything typed, so the kept text becomes it rather than
     * growing another whole copy with every pause.
     */
    const captureKept = (replace = false) => {
      if (keptIsCurrent.current) return;
      const now = textOf(view);
      setKept((previous) => (previous && !replace ? `${previous}\n\n${now}` : now));
      keptIsCurrent.current = true;
    };
    // Which id this page starts with (task 10, finding C): kept only if this component's lock, as the
    // GET just answered, says this caller already holds it under that very id - a reload while
    // holding keeps its lock, while reopening after Done editing (nothing holds it any longer) starts
    // a fresh session at sequence 0, never a false "newer text" notice from reusing a stale one.
    // A replay goes on under the session it was recorded in, whoever holds the lock now: the claim
    // says whether it may (RC-H).
    const initialSession =
      sessionIdRef.current ??
      editingSessionFor(
        component.id,
        (id) =>
          (component.lock?.yours === true && component.lock.session === id) ||
          (replayed !== null && stored?.session === id),
      );
    sessionNow.current = initialSession;
    // Replayed under the session it was kept in, or not at all: a page that starts under another id -
    // the id it was kept under gone from storage - offers what was kept as text instead.
    const sentLater = stored === null ? null : sentFor(component.id, stored.session);
    const going =
      replayed !== null && stored !== null && stored.session === initialSession
        ? continuing(
            stored,
            askedSession.current === stored.session ? (component.sequence ?? null) : null,
            sentLater,
            // What the service said to this window of the last it sent: a save it holds at that
            // number is this window's only where it said so (re-review of W11.3, D1).
            answerFor(component.id, stored.session),
          )
        : null;
    // Where it never said, the save is sent again after the claim, rebuilt exactly as it was sent, and
    // the service's answer settles whose it is; one that cannot be rebuilt is taken for another page's
    // (a third look at W11.3).
    const repeat = going?.repeat === true && stored !== null ? repeatOf(stored, sentLater) : null;
    const resumed =
      replayed !== null && going !== null
        ? {
            state: replayed,
            ...going,
            ahead: going.ahead || (going.repeat && repeat === null),
            repeat,
          }
        : null;
    // True from a repeat until it is settled: refused, what is on screen is offered, as a replay the
    // service has saved past is.
    let repeating = resumed !== null && !resumed.ahead && resumed.repeat !== null;
    if (replayed !== null && resumed === null) offering = textOfDoc(replayed.doc);
    // A replay the service has saved past is offered too: it goes to `lost` with it on screen, and
    // whatever goes on from there, what was kept has no other copy (D1; its re-review).
    const offeredBehind = resumed?.ahead === true ? textOfDoc(resumed.state.doc) : null;
    // Where the session's sequence goes on from: a replay's, or - an id reused with nothing kept, as
    // after a cut or a restore - the larger of the service's answer for it and the last this window
    // sent under it, never 0 under an id it has saves from (final review of W11.3, D3), nor below a
    // save this window sent that the service had not yet taken when it answered (its re-review).
    const startAt =
      resumed?.sequence ??
      Math.max(
        initialSession === askedSession.current ? (component.sequence ?? 0) : 0,
        sentFor(component.id, initialSession)?.sequence ?? 0,
      );
    const keeping = createRecorder(
      component.id,
      resumed !== null && stored !== null
        ? stored
        : freshSession({
            principal: principalId,
            session: initialSession,
            version: component.version.id,
            doc: opened.doc,
            values: component.values,
            sequence: startAt,
          }),
    );
    recorder.current = keeping;
    if (resumed !== null && stored !== null) {
      heldValues.current = { ...stored.values };
      setValues(heldValues.current);
      setValuesDrawn((drawn) => drawn + 1);
    }
    // Offered where it says anything the version does not, beside whatever this window offered before
    // and the author has not dismissed, and kept until they do (re-review of W11.3). What this page
    // already shows for the component comes first: storage may have refused to keep it, and the record
    // it came from is forgotten by now, so a component opened over again - for a new client, or the
    // same component read again - would otherwise read nothing back and lose it (re-review of W11.3,
    // M3).
    const differs = (text: string | null) => (text !== textOfDoc(opened.doc) ? text : null);
    const offeredKept = readOffered(component.id, principalId);
    const shown =
      offeredShown.current?.component === component.id &&
      offeredShown.current.principal === principalId
        ? offeredShown.current.text
        : null;
    const already = shown ?? offeredKept;
    const offeredNow = offeredWith(offeredWith(already, differs(offering)), differs(offeredBehind));
    offeredShown.current =
      offeredNow === null
        ? null
        : { component: component.id, principal: principalId, text: offeredNow };
    setOffered(offeredNow);
    if (offeredNow !== null && offeredNow !== offeredKept) {
      keepOffered(component.id, principalId, offeredNow);
    }
    if (differs(offering) !== null) setNotice(KEPT_OFFERED);
    else if (unreadable) setNotice(KEPT_UNREADABLE);
    /** Offers `text` beside whatever is offered already, once the page is open: a repeat refused. */
    const offerAlso = (text: string) => {
      const shownNow =
        offeredShown.current?.component === component.id &&
        offeredShown.current.principal === principalId
          ? offeredShown.current.text
          : null;
      const next = offeredWith(shownNow, differs(text));
      if (next === null || next === shownNow) return;
      offeredShown.current = { component: component.id, principal: principalId, text: next };
      setOffered(next);
      keepOffered(component.id, principalId, next);
    };
    // Written at once when the page is hidden or goes, which runs no unmount (D4).
    const keepNow = () => keeping.flush();
    const keepIfHidden = () => {
      if (document.visibilityState === 'hidden') keeping.flush();
    };
    window.addEventListener('pagehide', keepNow);
    document.addEventListener('visibilitychange', keepIfHidden);
    // A new session has published nothing yet, and no paste is waiting on its claim.
    sessionNotice.current = null;
    pasteSaid.current = null;
    const editing = createSession({
      // A session claimed afresh is followed by what the window keeps, from which nothing is sent.
      service: sessionService(client, component.id, initialSession, principalId, undefined, (id) =>
        keeping.rebind(id),
      ),
      sequence: startAt,
      onSent: (sequence) => keeping.sent(sequence),
      onAccepted: (sequence) => {
        keeping.accepted(sequence);
        if (sessionNow.current !== null) onSavedRef.current?.(sessionNow.current, sequence);
      },
      onSaveRefused: (sequence) => keeping.refused(sequence),
      clock: clockRef.current,
      timing: timingRef.current,
      version: { id: component.version.id, number: component.version.number },
      snapshot: () => fromEditor(view.state.doc),
      // A component with no fields saves its content alone, as it always has.
      ...(component.fields.length > 0 ? { values: () => heldValues.current } : {}),
      onChange: (next) => {
        const previous = phase;
        phase = next.phase;
        setSession(next);
        const news = next.notice !== sessionNotice.current;
        sessionNotice.current = next.notice;
        if (next.notice && news) {
          const said = pasteSaid.current;
          pasteSaid.current = null;
          setNotice(said && next.phase === 'editing' ? `${next.notice} ${said}` : next.notice);
        }
        if (next.phase !== 'reading') staleLockKnown.current = true;
        if (next.phase === 'editing') ahead = false;
        // A reload's last save, sent again, refused as another page's: what is on screen is offered,
        // as a replay the service has saved past is, rather than kept as a refusal's (a third look at
        // W11.3).
        if (repeating && (next.phase === 'editing' || next.phase === 'lost')) {
          repeating = false;
          if (next.phase === 'lost' && next.recoverable) {
            offerAlso(textOf(view));
            keptIsCurrent.current = true;
          }
        }
        // Released by Done editing, whether or not a version was cut: a reload claims nothing back.
        if (previous === 'releasing' && next.phase === 'reading') {
          keeping.reset(next.version.id, view.state.doc, heldValues.current);
        }
        if (next.phase === 'editing' || next.phase === 'recovery') setOwnSession(true);
        // Lost, or stopped while editing goes on - signed out, or content the service refused (final
        // review, finding 2): either way what is on screen is not saved and nothing is retrying it.
        const stoppedEditing = next.phase === 'editing' && next.save === 'stopped';
        if (stoppedEditing) captureKept(true);
        else if (next.phase === 'lost') captureKept();
        // The kept text is only good until the next successful claim puts this session back in
        // control (fix round 1, finding 2), or - kept while editing went on - until a save
        // acknowledges everything on screen: from then on it is stale, not something still worth
        // offering back. A later refusal starts capturing fresh too (fix round 2, minor).
        if (
          next.phase === 'editing' &&
          (previous === 'claiming' || (next.save === 'saved' && !next.dirty))
        ) {
          setKept(null);
          keptIsCurrent.current = false;
        }
        view.setProps({});
      },
      onRefused: (_holder, hadPending) => {
        // Nothing was pending: there is nothing new to undo or offer, so nothing here changes (fix
        // round 2, finding 1) - a bare Try again must not add another copy of the unchanged, already
        // saved version to the kept text. Unless the surface holds a replay whose claim this was:
        // everything in it was saved, and the latest version is what goes back on screen, with
        // Recover to reach what was saved.
        if (!hadPending && !ahead) return;
        ahead = false;
        if (!hadPending) {
          view.updateState(fresh(base));
          tellTables(view.state.doc);
          heldValues.current = baseValues;
          setValues(baseValues);
          setValuesDrawn((drawn) => drawn + 1);
          setHeader(headerOf(view.state.doc));
          keeping.reset(editing.view().version.id, base, baseValues);
          return;
        }
        // The held changes are not applied: the surface goes back to the version, and what was typed
        // is offered as text, the one thing that can be kept without writing to the component.
        // `captureKept` appends rather than replaces (fix round 1, finding 2) and is a no-op when the
        // surface's current content was already captured - a refused Continue after `lost` already
        // filled `kept` with exactly this text must not add a second copy of it (fix round 2, minor).
        captureKept();
        view.updateState(fresh(base));
        tellTables(view.state.doc);
        // And the fields, which are held changes too: what was typed into them is not applied either,
        // and the form is drawn afresh so no input keeps what it held (W5.3 review).
        heldValues.current = baseValues;
        setValues(baseValues);
        setValuesDrawn((drawn) => drawn + 1);
        // Nothing kept for a reload survives it: the held changes are offered as text, not replayed.
        keeping.reset(editing.view().version.id, base, baseValues);
        // `updateState` does not go through `dispatch` above, so nothing else refreshes `header`
        // (review round 1, item 1): left alone, it would keep showing whatever was typed right up to
        // the refusal, and the next keystroke into that stale field would resend it - resurrecting
        // text the surface itself just discarded.
        setHeader(headerOf(view.state.doc));
      },
      /**
       * Restoring (component-editor.md, "Recovery, as W11 builds it"): the stored iteration migrated
       * and validated as a stored version is (CNT-012, CNT-013) - one that will not read is refused by
       * name and nothing of it is opened - then opened as the text and the values, with a fresh
       * history (RC-G): undo reaches nothing from before the restore, whose values it could not bring
       * back.
       */
      open: (stored, restoredValues, label) => {
        const read = readContent(stored, { artifact: component.id, version: label });
        if (!read.ok || typeof restoredValues !== 'object' || Array.isArray(restoredValues)) {
          return `${sentenceCase(label)} could not be read, so it was not restored.`;
        }
        const reopened = toEditor(read.document);
        if (!reopened.editable) {
          return `${sentenceCase(label)} holds content this editor cannot change yet (${reopened.unsupported.join(', ')}), so it was not restored.`;
        }
        view.updateState(fresh(reopened.doc));
        tellTables(view.state.doc);
        // And what the window keeps for a reload starts again from it, as the history does (RC-G).
        keeping.reset(editing.view().version.id, reopened.doc, restoredValues);
        heldValues.current = { ...restoredValues };
        setValues(heldValues.current);
        setValuesDrawn((drawn) => drawn + 1);
        setHeader(headerOf(view.state.doc));
        keptIsCurrent.current = false;
        return null;
      },
      onVersion: (cut) => {
        // Undo must not reach past a version (CNT-103): a fresh state has a fresh history. Cutting a
        // version changes nothing about the document itself, though, so the selection is carried over
        // rather than jumping back to the start (fix round 1, minor).
        const { selection } = view.state;
        base = view.state.doc;
        baseValues = heldValues.current;
        view.updateState(fresh(base, selection));
        tellTables(view.state.doc);
        // And nothing kept for a reload reaches past it either: the kept changes go with the history.
        keeping.reset(cut.id, base, baseValues);
        // As above: cutting changes nothing about the header, but this keeps that an invariant the
        // surface enforces rather than one a future change could silently break.
        setHeader(headerOf(view.state.doc));
      },
    });
    controls.current = editing;
    setSession(editing.view());
    const view = mountEditor(place.current, {
      state: resumed?.state ?? fresh(),
      // Named once, from what the component opened with (task 5 brief): it does not follow a title
      // typed afterwards, which is wrong only after a rename, and the accessibility plan owns the
      // surface's naming.
      label: `Content of ${opened.doc.attrs.title as string}`,
      editable: () => component.mayEdit && isEditablePhase(phase),
      dispatch: (transaction, target) => {
        const before = target.state;
        const { state: after, transactions } = before.applyTransaction(transaction);
        target.updateState(after);
        // Kept for a reload with whatever the plugins appended, as the history took it (W11.3).
        keeping.applied(before, transactions, after);
        // Every transaction, not only one that changed the document: a transaction that only moved
        // the caret is exactly the one the toolbar has to hear about.
        setTransactions((count) => count + 1);
        if (transaction.docChanged) {
          setHeader(headerOf(target.state.doc));
          tellTables(target.state.doc);
          // A real change invalidates whatever `kept` already captured (fix round 2, minor): the next
          // refusal, if there is one, has something new to capture again.
          keptIsCurrent.current = false;
          editing.changed();
        }
      },
      pasted: ({ ok, report }) => {
        const { beside, said } = pasteSentence(ok, report);
        setPasteReport(beside.length > 0 ? beside : null);
        setNotice(said);
        if (ok && phase !== 'editing') pasteSaid.current = said;
      },
      refused: () => setNotice(NOT_DROPPED),
    });
    setSurface(view);
    setHeader(headerOf(view.state.doc));
    tellTables(view.state.doc);
    // Opened by a click in its rendered text: the caret goes where the click was, and the focus with
    // it, so the author types where they pointed. A selection changes nothing and claims nothing.
    if (openAtRef.current !== undefined) {
      const at = positionAtTextOffset(view.state.doc, openAtRef.current);
      view.dispatch(view.state.tr.setSelection(EditorSelection.near(view.state.doc.resolve(at))));
      view.focus();
    }
    onViewRef.current?.(view);
    // A reload going on: claimed again under its own session, and what the service has not got sent -
    // unless the service holds a later save under it than this window sent, which nothing here may go
    // on over (D1).
    if (resumed?.ahead === true) {
      // Offered already, above: `lost` captures nothing more of it.
      keptIsCurrent.current = true;
      editing.behind();
    } else if (resumed !== null) {
      ahead = true;
      editing.resume(resumed.unsent, resumed.repeat ?? undefined);
    }
    return () => {
      window.removeEventListener('pagehide', keepNow);
      document.removeEventListener('visibilitychange', keepIfHidden);
      editing.dispose();
      // Whatever this page's session does after it is gone - a save queued behind one in flight - is
      // not kept: a later page's record is not this one's to write over.
      keeping.close();
      if (recorder.current === keeping) recorder.current = null;
      controls.current = null;
      setSurface(null);
      view.destroy();
    };
  }, [component, client, principalId]);

  // Arrived at by a link naming a block, on opening or while open: the caret goes to the block's start,
  // or it is selected where it has nothing to type into - an equation, a footnote - or the page says
  // it is gone.
  const linkedBlock = linked?.block;
  const linkedArrival = linked?.arrival;
  useEffect(() => {
    if (surface === null || surface.isDestroyed) return;
    if (linkedBlock === undefined || linkedArrival === undefined) return;
    const taken = takenArrival.current;
    if (taken?.surface === surface && taken.arrival === linkedArrival) return;
    takenArrival.current = { surface, arrival: linkedArrival };
    const { doc } = surface.state;
    const at = whereBlockIs(doc, linkedBlock);
    if (at === undefined) {
      setNotice(LINKED_PART_GONE);
      return;
    }
    const node = doc.nodeAt(at);
    const selection =
      node !== null && !node.isTextblock && node.isAtom
        ? NodeSelection.create(doc, at)
        : EditorSelection.near(doc.resolve(at + 1));
    surface.dispatch(surface.state.tr.setSelection(selection).scrollIntoView());
    surface.focus();
  }, [surface, linkedBlock, linkedArrival]);

  // The page numbers the document again, or opens this editor in another place: every reference on
  // the surface, and in a footnote's open editor, is drawn again from what it now offers (R10, R11).
  useEffect(() => {
    if (surface === null || surface.isDestroyed) return;
    if (referenceContextOf(surface.state) !== referenceContext) {
      setReferenceContext(surface, referenceContext);
    }
  }, [surface, referenceContext]);

  // The page reads what the document holds again, or the component's own page hears a definition's
  // title: every binding on the surface, and in a footnote's open editor, is drawn again (B1-D, B1-N).
  useEffect(() => {
    if (surface === null || surface.isDestroyed) return;
    if (bindingContextOf(surface.state) !== shownBindings) {
      setBindingContext(surface, shownBindings);
    }
  }, [surface, shownBindings]);

  // On its own page, the titles of the definitions its bindings name, each asked once (B1-K).
  const namedDefinitions = useMemo(() => {
    if (!alone || component === null) return '';
    const read = readContent(component.content, { artifact: component.id, version: '' });
    if (!read.ok) return '';
    return [...new Set(bindingsIn(read.document).map((each) => each.binding.query))]
      .sort()
      .join(' ');
  }, [alone, component]);
  useEffect(() => {
    if (namedDefinitions === '') return undefined;
    let current = true;
    const ids = namedDefinitions.split(' ');
    void Promise.all(
      ids.map(async (definition) => {
        try {
          const { data } = await client.GET('/v1/query-definitions/{id}', {
            params: { path: { id: definition } },
          });
          const body: unknown = data;
          const title =
            typeof body === 'object' &&
            body !== null &&
            'definition' in body &&
            typeof (body as { definition: { title?: unknown } }).definition?.title === 'string'
              ? (body as { definition: { title: string } }).definition.title
              : null;
          return [definition, title] as const;
        } catch {
          return [definition, null] as const;
        }
      }),
    ).then((answered) => {
      if (current) setTitles(new Map(answered));
    });
    return () => {
      current = false;
    };
  }, [client, namedDefinitions]);

  // The theme the page is set in marks, on the surface and in a footnote's editor, what will not
  // resolve in it (themes.md, "What will not resolve", ET-I; STY-070); nothing is marked without one.
  const presentation = usePresentation();
  const styleCheck = useMemo(
    () =>
      presentation?.state === 'ready'
        ? styleCheckFor(presentation.theme, presentation.unheld)
        : null,
    [presentation],
  );
  useEffect(() => {
    if (surface === null || surface.isDestroyed) return;
    setStyleCheck(surface, styleCheck);
  }, [surface, styleCheck]);

  // As Recovery closes - restored, or closed - the focus goes back to what asked for it where that
  // is still there, and to the text otherwise: the Recover that asked is gone once the claim lands.
  const inRecovery = session?.phase === 'recovery';
  const wasInRecovery = useRef(false);
  useEffect(() => {
    if (inRecovery) {
      wasInRecovery.current = true;
      return;
    }
    if (!wasInRecovery.current) return;
    wasInRecovery.current = false;
    const back = recoveryOpener.current;
    recoveryOpener.current = null;
    if (back?.isConnected) back.focus();
    else surface?.focus();
  }, [inRecovery, surface]);

  // While there is something the service has not acknowledged, an unmount already flushes it best
  // effort (Session.dispose) but a page close does not run that cleanup at all - so a close is
  // guarded for as long as anything is dirty or being sent (fix round 1, finding 4): while dirty,
  // while a save is in flight, while a retry is failing with content it has not yet acknowledged, or
  // while there is still text kept from a refusal that was never written anywhere (fix round 2,
  // minor), or text offered on opening that the author has not dismissed, which a reload keeps and a
  // closed tab does not (re-review of W11.3). The guard comes off the moment none of those is true.
  useEffect(() => {
    if (!session) return undefined;
    const unacknowledged =
      session.dirty ||
      session.save === 'saving' ||
      session.save === 'failing' ||
      kept !== null ||
      offered !== null;
    if (!unacknowledged) return undefined;
    const warnBeforeClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeClose);
    return () => window.removeEventListener('beforeunload', warnBeforeClose);
  }, [session, kept, offered]);

  /**
   * Puts the focus in a region: on the first control a Tab would reach inside it, or on the region
   * itself where it has none.
   *
   * The fallback is not a rare case. A component being read has a header whose fields are disabled
   * and a surface that takes no input, so two of the three regions hold nothing focusable at all -
   * and a ring that skipped them would leave a reader moving between one region and itself, with no
   * way to reach the text. Each region is therefore focusable in its own right, and a Tab from
   * there walks into whatever it holds.
   */
  const land = (region: HTMLElement) => {
    // The surface is the one region whose control ProseMirror owns rather than React, and it is
    // asked for by name rather than found: it is the element carrying `role="textbox"` and the
    // component's own name, where the div it sits in carries neither, so the focus belongs on it
    // whether or not it is taking input today.
    if (region === place.current) {
      (surface?.dom ?? region).focus();
      return;
    }
    // The other regions hold form controls and nothing else - the header's three fields, the
    // toolbar's fourteen buttons, the list panel's kind, start and numbering - so the first in
    // document order that a Tab would reach is the first one this finds. A disabled control is excluded by its attribute rather than by `tabIndex`,
    // which reports 0 for one all the same; without that, F6 would land a reader on a header field
    // they cannot type into.
    const inside = [
      ...region.querySelectorAll<HTMLElement>('input, select, textarea, button'),
    ].find((each) => !each.hasAttribute('disabled') && each.tabIndex >= 0);
    (inside ?? region).focus();
  };

  /**
   * `F6` and `Shift-F6` move the focus between the regions of the view and wrap (CNT-077): the
   * component header, the formatting toolbar, the list panel, the surface. The design names one
   * more, the metadata panel, which is not built; the **Component** toolbar - Save version and
   * Done editing - is deliberately not one of them and keeps its own ordinary tab stops.
   *
   * **The list panel comes and goes with the selection**, which is new in this ring: it is there
   * only while the cursor stands in a counted list, so the ring is three regions most of the time
   * and four inside a list. That is why the ring is built from elements each time the key is
   * pressed rather than from a fixed list of selectors - a region that is not rendered is simply
   * absent, and the wrap is over whatever is really there.
   *
   * Pressed from somewhere that is no region at all, it enters the ring at the first region going
   * forwards and at the last going backwards, rather than guessing which region the author meant.
   */
  const moveRegion = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'F6' || event.altKey || event.ctrlKey || event.metaKey) return;
    const ring = [
      headerRegion.current,
      toolbarRegion.current,
      listRegion.current,
      preformattedRegion.current,
      tableRegion.current,
      figureRegion.current,
      boundTableRegion.current,
      valueRegion.current,
      pasteRegion.current,
      recoveryRegion.current,
      place.current,
      metadataRegion.current,
      // A region in a panel that is not shown, such as the fields in Attributes while Versions is,
      // is no stop: the focus cannot land in what is hidden.
    ].filter(
      (region): region is HTMLElement => region !== null && region.closest('[hidden]') === null,
    );
    if (ring.length === 0) return;
    // The innermost region holding the focus: the Value panel stands inside the Bound table band.
    const at = ring.reduce(
      (found, region, index) => (region.contains(document.activeElement) ? index : found),
      -1,
    );
    const back = event.shiftKey;
    // Past either end, inside the application, the key goes on to its own regions - the header band,
    // the rail - rather than wrapping here (the LG plan, LG6b): `RegionKeys` takes it from there.
    const past = at >= 0 && (back ? at === 0 : at === ring.length - 1);
    if (past && event.currentTarget.closest('[data-app-region]') !== null) return;
    event.preventDefault();
    const next =
      at < 0 ? (back ? ring.length - 1 : 0) : (at + (back ? -1 : 1) + ring.length) % ring.length;
    land(ring[next]!);
  };

  /**
   * Asks the view to make a header step, answering the header the document holds afterwards - the
   * model's own answer to what was sent, which the fields compare against rather than assuming their
   * value survived unchanged (fix round 2): a title comes back trimmed, and a step the editor refused
   * or found redundant comes back as whatever was already there. `null` where there is no view left
   * to ask, which leaves a field showing what was typed rather than reverting it to nothing.
   */
  const changeHeader = <K extends keyof Header>(member: K, value: Header[K]): Header | null => {
    const view = surface;
    if (!view) return null;
    const command =
      member === 'title'
        ? setTitle(value as string)
        : member === 'language'
          ? setLanguage(value as string)
          : setDirection(value as Header['direction']);
    command(view.state, view.dispatch.bind(view));
    return headerOf(view.state.doc);
  };

  // Whether the component holds a table, and each entry of the cursor into one (ADR-0052): the page
  // offers the Table tab while it holds one, and chooses it as the cursor enters one. Above the
  // returns below, as every hook is.
  const holdsTable = surface !== null && holdsATable(surface.state.doc);
  const tableKey =
    surface === null
      ? null
      : (() => {
          const bound = boundTableAt(surface.state);
          if (bound !== null) return `bound-${bound.id ?? bound.pos}`;
          const plain = tableAt(surface.state);
          return plain === null ? null : `table-${plain.id ?? plain.pos}`;
        })();
  const lastTable = useRef<string | null>(null);
  // The table the cursor was last in, which the Table tab shows read only once it leaves (TF-E).
  const [lastSeenTable, setLastSeenTable] = useState<string | null>(null);
  const [entered, setEntered] = useState(0);
  useEffect(() => {
    if (tableKey !== null && tableKey !== lastTable.current) setEntered((count) => count + 1);
    if (tableKey !== null) setLastSeenTable(tableKey);
    lastTable.current = tableKey;
  }, [tableKey]);
  // Closed, it holds no table, and the next editor's first entry is a new one.
  const toldTable = useRef(onTable);
  toldTable.current = onTable;
  useEffect(() => () => toldTable.current?.({ holds: false, entered: 0 }), []);
  useEffect(() => {
    onTable?.({ holds: holdsTable, entered });
    // Told what changed, not each new callback the page hands down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdsTable, entered]);
  if (loaded.state === 'loading') return <Waiting>Opening...</Waiting>;
  // In place, a component that did not open still needs a way out, the card head being gone.
  const leave = onDone && (
    <button type="button" onClick={onDone}>
      Done
    </button>
  );
  if (loaded.state === 'missing') {
    return (
      <Notice tone="refused">
        <p>There is nothing here, or nothing you may read.</p>
        {leave}
      </Notice>
    );
  }
  if (loaded.state === 'failed') {
    return (
      <Notice tone={loaded.signedOut ? 'signedOut' : 'failed'}>
        <p>
          {loaded.signedOut
            ? 'You are signed out. Sign in again to open this component.'
            : 'The component could not be opened.'}
        </p>
        <button
          type="button"
          onClick={() => {
            setLoaded({ state: 'loading' });
            setAttempt((count) => count + 1);
          }}
        >
          Try again
        </button>
        {leave}
      </Notice>
    );
  }
  const { component: shown } = loaded;
  const title = (shown.content as { title?: unknown }).title;
  // Once this session has claimed or released the lock itself, the GET-time snapshot no longer
  // reflects who holds it (fix round 1, minor) - so it is never consulted again, rather than
  // reappearing as a stale "someone else is editing" once phase later returns to `reading`.
  const lock = staleLockKnown.current ? null : shown.lock;
  const held = session?.holder ?? null;
  const phase = session?.phase ?? 'reading';
  // Read during render from `view.state`, exactly as the toolbar's answers are: moving the caret
  // is the change the panel has to hear about, and `dispatch` re-renders on every transaction.
  const list = surface === null ? null : listAt(surface.state);
  const preformatted = surface === null ? null : preformattedAt(surface.state);
  const table = surface === null ? null : tableAt(surface.state);
  const figure = surface === null ? null : figureAt(surface.state);
  // A binding selected whole, and what it shows where it stands (B1-M): the Value panel's.
  const selectedBinding = surface === null ? null : bindingSelected(surface.state);
  const selectedShown =
    selectedBinding === null || surface === null
      ? null
      : (bindingsShown(surface.state.doc, bindingContextOf(surface.state)).find(
          (each) => each.pos === selectedBinding.pos,
        ) ?? null);
  // A bound figure the cursor stands in, and what its image shows (B6.2): the Value panel's too.
  const figureShown =
    figure?.binding == null || surface === null
      ? null
      : (boundFiguresShown(surface.state.doc, bindingContextOf(surface.state)).find(
          (each) => each.pos === figure.pos,
        ) ?? null);
  // A bound table the cursor stands in, and what its body shows (TB2-F, TB2-G): the Bound table
  // panel's, and the Value panel's too.
  const boundTable = surface === null ? null : boundTableAt(surface.state);
  const boundTableShown =
    boundTable === null || surface === null
      ? null
      : (boundTablesShown(surface.state.doc, bindingContextOf(surface.state)).find(
          (each) => each.tablePos === boundTable.pos,
        )?.shown ?? null);
  // What the Value panel is about: a binding selected whole, a bound figure's, or a bound table's.
  const valued: {
    readonly pos: number;
    readonly binding: AnyBinding;
    readonly shown: { readonly text: string; readonly resolved: boolean };
    readonly place: 'line' | 'figure' | 'table';
  } | null =
    selectedBinding !== null && selectedShown !== null
      ? { ...selectedBinding, shown: selectedShown, place: 'line' }
      : figure?.binding != null && figureShown !== null
        ? { pos: figure.pos, binding: figure.binding, shown: figureShown, place: 'figure' }
        : boundTable !== null && boundTableShown !== null
          ? {
              pos: boundTable.pos,
              binding: boundTable.binding,
              shown: {
                text:
                  boundTableShown.spanning?.text ??
                  `A table of ${boundTableShown.rows.length + boundTableShown.more} rows`,
                resolved: tableResolved(surface!.state, boundTable.binding),
              },
              place: 'table',
            }
          : null;
  const mayFormat = shown.mayEdit && isEditablePhase(phase);
  /** A table's panels, plain or bound, while the cursor stands in one. */
  const tablePanels = () => (
    <>
      {/* And only while the cursor stands in a table: its header counts and its grid's acts. */}
      {surface !== null && table !== null && (
        <TablePanel ref={tableRegion} view={surface} table={table} enabled={mayFormat} />
      )}
      {/* And while the cursor stands in a bound table (TB2-F): its presentation, a band whose
          first line is its value (ADR-0051). */}
      {surface !== null && boundTable !== null && (
        <BoundTablePanel
          key={`bound-table-${boundTable.id ?? boundTable.pos}`}
          ref={boundTableRegion}
          view={surface}
          table={boundTable}
          enabled={mayFormat}
          client={client}
          onFormatting={setFormatting}
          value={valued?.place === 'table' ? valuePanel(valued, true) : undefined}
        />
      )}
    </>
  );
  /**
   * Where those panels stand (ADR-0052): under the toolbar where the page gives them no place, else
   * in its Table tab, which says where to go while the cursor is in no table.
   */
  // A dialog stands over the page: the article is inert behind it, and so is what the editor sets
  // beside it - the Table tab, the fields in Attributes - which stand outside the article.
  const behindDialog =
    asking !== null ||
    figureDialog !== null ||
    referring !== null ||
    equating !== null ||
    symbolizing !== null ||
    valuing !== null ||
    formatting;
  const placeTables = (panels: ReactNode) => {
    if (tableHost === undefined) return panels;
    if (tableHost === null) return null;
    return createPortal(
      <div inert={behindDialog}>
        {mayFormat && (table !== null || boundTable !== null) ? panels : readOnlyTable()}
      </div>,
      tableHost,
    );
  };
  /**
   * The Table tab read only (ADR-0052, decision 5): the table the cursor is in, else the one it was
   * last in, else the first the text holds (TF-E).
   */
  const readOnlyTable = () => {
    if (surface === null) return null;
    const found = tablesIn(surface.state);
    const keyOf = (kind: string, each: { id: string | null; pos: number }) =>
      `${kind}-${each.id ?? each.pos}`;
    const bound =
      boundTable ??
      (table === null
        ? (found.bound.find((each) => keyOf('bound', each) === lastSeenTable) ??
          (found.plain.some((each) => keyOf('table', each) === lastSeenTable)
            ? undefined
            : found.bound[0]))
        : undefined);
    if (bound !== undefined && bound !== null) {
      const shown = boundTablesShown(surface.state.doc, bindingContextOf(surface.state)).find(
        (each) => each.tablePos === bound.pos,
      )?.shown;
      return (
        <BoundTableReadOnly
          key={keyOf('bound', bound)}
          table={bound}
          shownNotes={shown?.notes ?? []}
          value={
            shown === undefined ? undefined : (
              <ValuePanel
                stacked
                binding={bound.binding}
                shown={shown.spanning?.text ?? `A table of ${shown.rows.length + shown.more} rows`}
                resolved={tableResolved(surface.state, bound.binding)}
                state={bindingStates?.get(bound.binding.id)}
                {...(alone ? { title: titles.get(bound.binding.query) } : {})}
                {...(onProvenance
                  ? {
                      onProvenance: (opener: HTMLElement) => onProvenance(bound.binding.id, opener),
                    }
                  : {})}
              />
            )
          }
        />
      );
    }
    const plain =
      table ?? found.plain.find((each) => keyOf('table', each) === lastSeenTable) ?? found.plain[0];
    return plain === undefined ? null : <TableReadOnly key={keyOf('table', plain)} table={plain} />;
  };

  /** The Value panel, one line, on what `valued` names. */
  type Valued = NonNullable<typeof valued>;
  const valuePanel = (valued: Valued, stacked = false) => (
    <ValuePanel
      stacked={stacked}
      key={`value-${valued.pos}`}
      ref={valueRegion}
      binding={valued.binding}
      shown={valued.shown.text}
      resolved={valued.shown.resolved}
      state={bindingStates?.get(valued.binding.id)}
      // Undefined until the title is answered, so the panel says nothing of it yet.
      {...(alone ? { title: titles.get(valued.binding.query) } : {})}
      {...(onProvenance
        ? {
            onProvenance: (opener: HTMLElement) => onProvenance(valued.binding.id, opener),
          }
        : {})}
      {...(mayFormat && surface !== null
        ? {
            onChange: () =>
              valued.place === 'figure'
                ? openFigureValue(surface, valued)
                : valued.place === 'table'
                  ? openTableValue(surface, valued)
                  : openValue(openFootnote(surface) ?? surface),
          }
        : {})}
      {...(bindingActs !== undefined && !bindingActs.pinned
        ? {
            onKeep: () => settle(valued.binding.id, 'keep'),
            onResolve: () => settle(valued.binding.id, 'resolve'),
          }
        : {})}
    />
  );
  // What the toolbar acts on: the footnote's own text while one is open, and the surface otherwise
  // (footnotes 1, ruling R9). Every button is asked of that state, so a mark applies in the footnote
  // and everything a footnote cannot hold is unavailable there, by its content expression alone.
  const editing = surface === null ? null : (openFootnote(surface) ?? surface);
  // Asked of the command itself, without dispatching, so **Figure** is offered exactly where a figure
  // can go - never in a caption, a cell or preformatted text, where an upload would place nothing.
  const mayPlaceFigure =
    editing !== null && insertFigure('', { kind: 'decorative' }, () => '')(editing.state);
  // An inline image selected whole, and where one could go, asked the same way (figures 4).
  const image = surface === null ? null : imageAt(surface.state);
  const mayPlaceImage = editing !== null && insertImage('', { kind: 'decorative' })(editing.state);

  /**
   * **Paste as Markdown**: the clipboard's plain text read as Markdown and placed as a paste is,
   * through the admission pipeline and with the same report. The browser is asked for the text
   * rather than handed it by a paste event, so it may ask the author first, or refuse; a refusal
   * is said, and nothing is placed.
   */
  const pasteMarkdown = async () => {
    const view = surface;
    if (view === null || !mayFormat) return;
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Refused, or no clipboard to ask at all outside a secure page.
      setNotice(CLIPBOARD_UNREADABLE);
      return;
    }
    const into = view.state.selection.$from.parent.type.spec.code ? 'preformatted' : 'blocks';
    const reading = await readMarkdownText(text, into);
    // The author may have closed the component while the clipboard or the parser was coming.
    if (view.isDestroyed) return;
    // Into the footnote's own text while one is open (footnotes 1, ruling R9), and never over the
    // footnote the surface has selected.
    const intoFootnote = pasteIntoOpenFootnote(view, reading, newBlockIdentifier);
    const outcome = intoFootnote ?? pasteInto(view.state, reading, newBlockIdentifier);
    if (intoFootnote === null && outcome.ok) view.dispatch(outcome.transaction);
    const { beside, said } = pasteSentence(outcome.ok, outcome.report);
    setPasteReport(beside.length > 0 ? beside : null);
    setNotice(said);
    if (outcome.ok && controls.current?.view().phase !== 'editing') pasteSaid.current = said;
    (openFootnote(view) ?? view).focus();
  };
  const size = surface === null ? undefined : sizeOf(surface.state.doc);
  const mayCut = shown.mayEdit && loaded.state === 'open';
  // Standalone, Done is Done editing and releases a lock only this session can hold. In place it is
  // also the way out of the card, so it is offered while reading as well, and closes once released.
  const doneDisabled = onDone ? !(phase === 'editing' || phase === 'reading') : phase !== 'editing';
  // What the component's GET said this author saved and never made a version (RC-F), offered while
  // this page has no session of its own running: as unsaved work where nobody holds the lock, and as
  // the author's own other window's work where that window holds it (final review of W11.2, D2).
  // Where somebody else holds it, the notice above says who, and nothing is offered until they are
  // done.
  const unsaved =
    loaded.state === 'open' && shown.mayEdit && !ownSession && phase === 'reading'
      ? (shown.unsaved ?? null)
      : null;
  const recover = () => {
    recoveryOpener.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Opened from reading, Saved text claims the lock to list under; cancelled, it gives it back.
    recoveryFromReading.current = phase === 'reading' || phase === 'lost';
    controls.current?.recover();
  };
  // Cancel: nothing restored. From reading the lock it claimed goes back, cutting nothing, since this
  // session saved nothing; from editing the author goes on editing.
  const cancelRecovery = () => {
    const fromReading = recoveryFromReading.current;
    recoveryFromReading.current = false;
    controls.current?.closeRecovery();
    if (!fromReading) return;
    // Given back, the changes are as unrecovered as before: the notice offers them again.
    void controls.current?.doneEditing().then(() => {
      setOwnSession(false);
      setBackToNotice((count) => count + 1);
    });
  };
  // Dismiss (the R1 plan): the notice put away for this tab until something newer is saved.
  const dismiss = (savedAt: string) => {
    keepDismissed(componentId, savedAt);
    setDismissedAt(savedAt);
  };
  const done = async () => {
    if (phase === 'editing') {
      await controls.current?.doneEditing();
      if (controls.current?.view().phase !== 'reading') return;
    }
    onDone?.();
  };

  return (
    <>
      {/* Inert while a dialog stands over it, which is the other half of what that dialog's
          `aria-modal` promises: a keyboard is held inside the dialog by its own trap, and a mouse
          by this. Without it the surface behind still takes clicks, so the selection the command
          is about to act on moves out from under the author while they type a target for it. */}
      <article
        aria-labelledby="component-title"
        className={styles['card']}
        data-in-place={onDone !== undefined}
        inert={behindDialog}
        onKeyDown={moveRegion}
      >
        <div className={styles['strip']}>
          {/* A named group, not a bare `<header>`: F6 lands on this element itself when the fields
              inside it are disabled, and an element with no role and no name announces nothing at
              all to whoever the ring just moved. `tabIndex` makes it a target for that key and not
              a new stop in the tab order. */}
          <header
            ref={headerRegion}
            className={styles['header']}
            role="group"
            aria-label="Component header"
            tabIndex={-1}
            // Where the application's F6 enters this editor's own ring (`RegionKeys`).
            data-region-entry
          >
            {number !== undefined && (
              <span className={styles['number']} title={size}>
                {number}
              </span>
            )}
            {header ? (
              <ComponentHeader
                header={header}
                editable={shown.mayEdit && loaded.state === 'open' && isEditablePhase(phase)}
                onChange={changeHeader}
                onRefused={setNotice}
              >
                <span
                  className={styles['version']}
                  {...(number === undefined && size !== undefined ? { title: size } : {})}
                >
                  {session?.version.number ?? shown.version.number} · {shown.space.name}
                </span>
              </ComponentHeader>
            ) : (
              <>
                <h2 id="component-title" className={styles['fallbackTitle']}>
                  {typeof title === 'string' ? title : 'Untitled'}
                </h2>
                <span className={styles['version']}>
                  {shown.version.number} · {shown.space.name}
                </span>
              </>
            )}
          </header>
          {session && loaded.state === 'open' && (
            <SaveIndicator save={session.save} savedAt={session.savedAt} />
          )}
          {(mayCut || onDone) && (
            <>
              <span className={styles['divider']} aria-hidden="true" />
              <Toolbar label="Component" className={styles['actions']}>
                {/* The author's own saved text, listed while editing: the lock is already this
                    session's, so nothing is claimed (final review of W11.2, D1). */}
                {mayCut && (
                  <button
                    className={styles['act']}
                    type="button"
                    title="Saved text"
                    disabled={phase !== 'editing'}
                    onClick={recover}
                  >
                    <Icon name="Saved text" />
                    Saved text
                  </button>
                )}
                {mayCut && (
                  <button
                    className={`primary ${styles['act']}`}
                    type="button"
                    title="Save version"
                    disabled={phase !== 'editing'}
                    onClick={() => void controls.current?.saveVersion()}
                  >
                    <Icon name="Save version" />
                    Save version
                  </button>
                )}
                <button
                  className={styles['act']}
                  type="button"
                  aria-label="Done editing"
                  title="Done editing"
                  disabled={doneDisabled}
                  onClick={() => void done()}
                >
                  <Icon name="Done editing" />
                  Done
                </button>
              </Toolbar>
            </>
          )}
        </div>
        {loaded.state === 'unreadable' && (
          <Notice tone="failed">
            <p>This component could not be read.</p>
          </Notice>
        )}
        {loaded.state === 'readOnly' && (
          <Notice tone="readOnly">
            <p>
              This component holds content this editor cannot change yet (
              {loaded.unsupported.join(', ')}
              ), so it is shown for reading only.
            </p>
          </Notice>
        )}
        {loaded.state === 'open' && (
          <>
            {/* Above the surface, which is the order the regions are named in
              (component-editor.md, "Accessibility"), and shown to a reader too - disabled, rather
              than absent, so what the editor can do with the text is visible before the lock is. */}
            <EditorToolbar
              onPasteMarkdown={() => void pasteMarkdown()}
              onInsertFigure={() => setFigureDialog('Figure')}
              figurePlaceable={mayPlaceFigure}
              onInsertImage={() => setFigureDialog('Image')}
              imagePlaceable={mayPlaceImage}
              ref={toolbarRegion}
              view={editing}
              enabled={mayFormat}
              newIdentifier={newBlockIdentifier}
              prompt={askFor}
              onRefused={(command) =>
                editing && askAgain(editing, command, whyRefused(editing, command))
              }
              openDialog={(action, view) =>
                surface !== null &&
                ((action === 'reference' && openReference(surface, view)) ||
                  (action === 'equation' && openEquation(view)) ||
                  (action === 'symbol' && openSymbols(view)) ||
                  (action === 'value' && openValue(view)))
              }
            />
            {/* The toolbar's second line (ADR-0053): there whenever the text is open, so nothing
                under it moves as options come and go, holding what the selection offers. */}
            <div className={styles['toolbarLine']} data-toolbar-line="">
              {/* The style of the paragraphs the selection touches, from the theme's catalogue: the
                  only way a paragraph's alignment, indents and spacing change (CNT-094). Of the
                  footnote's own text while one is open, as the toolbar's buttons are. */}
              {editing !== null && <ParagraphStyle view={editing} enabled={mayFormat} />}
              {/* While the cursor stands in a list: Nest and Lift, and a numbered list's start and
                  numbering. A bulleted list's are its own; its kind is the toolbar's buttons. */}
              {surface !== null && list !== null && (
                <ListPanel
                  ref={listRegion}
                  view={surface}
                  list={list}
                  enabled={mayFormat}
                  newIdentifier={newBlockIdentifier}
                />
              )}
              {/* And only while the cursor stands in a preformatted block: its one field is the
                  language label, which nothing else in the view can set. */}
              {surface !== null && preformatted !== null && (
                <PreformattedPanel
                  ref={preformattedRegion}
                  view={surface}
                  block={preformatted}
                  enabled={mayFormat}
                />
              )}
              {/* And only while the cursor stands in a figure: how its alternative text is given,
                  and what can be done to its image. */}
              {surface !== null && figure !== null && (
                <FigurePanel
                  // One panel per figure, so what was typed for one is never offered to the next.
                  key={figure.id ?? figure.pos}
                  ref={figureRegion}
                  view={surface}
                  figure={figure}
                  enabled={mayFormat}
                  client={client}
                  onReplace={() => setFigureDialog('Replace image')}
                />
              )}
              {/* Or while an inline image is selected whole: the same panel, about the image
                  (figures 4, ruling R7). An image never stands in a figure, so the two never meet. */}
              {surface !== null && image !== null && (
                <FigurePanel
                  key={`image-${image.pos}`}
                  kind="image"
                  ref={figureRegion}
                  view={surface}
                  figure={image}
                  enabled={mayFormat}
                  client={client}
                  onReplace={() => setFigureDialog('Replace image')}
                />
              )}
              {/* And while a binding is selected whole, or the cursor stands in a bound figure (B6.2):
                  what it shows, and its provenance (B1-M), in one line. */}
              {valued !== null && valued.place !== 'table' && valuePanel(valued)}
            </div>
            {!shown.mayEdit && (
              <Notice tone="readOnly">
                <p>You may read this component but not edit it.</p>
              </Notice>
            )}
            {lock && !lock.yours && phase === 'reading' && !held && (
              <Notice tone="editing">
                <p>
                  {heldSentence({ name: lock.holder.name, expectedRelease: lock.expectedRelease })}
                </p>
              </Notice>
            )}
            {held?.yours && (
              <button type="button" onClick={() => controls.current?.claimAgain(true)}>
                Continue here
              </button>
            )}
            {held && !held.yours && (
              <button type="button" onClick={() => controls.current?.claimAgain(false)}>
                Try again
              </button>
            )}
            {/* Above the text, before anybody types (RC-F): claimed, the saved text is listed. Only
                while nobody holds it: a refused claim leaves the lock unread, but the holder it
                named is still there, whoever it is (W11.2's re-review). */}
            {unsaved !== null &&
              unsaved.savedAt !== dismissedAt &&
              lock === null &&
              !(held && (held.yours || held.name !== null)) && (
                <Notice tone="unsaved">
                  <p>{unsavedSentence(unsaved.savedAt)}</p>
                  <button type="button" ref={noticeRecover} onClick={recover}>
                    Recover
                  </button>
                  <button type="button" onClick={() => dismiss(unsaved.savedAt)}>
                    Dismiss
                  </button>
                </Notice>
              )}
            {/* The author's other window is editing: what it saved is its work in progress, and
                recovering it here moves the edit to this window, as Continue here does. */}
            {unsaved !== null && lock?.yours === true && (
              <Notice tone="editing">
                <p>You are editing this component in another window.</p>
                <button type="button" onClick={recover}>
                  Recover here
                </button>
              </Notice>
            )}
            {/* The same, found by a refused claim: the session's notice has said so already. */}
            {unsaved !== null && lock?.yours !== true && held?.yours === true && (
              <button type="button" onClick={recover}>
                Recover here
              </button>
            )}
            {phase === 'lost' && session?.recoverable && (
              <>
                <button type="button" onClick={() => controls.current?.claimAgain(true)}>
                  Continue
                </button>
                <button type="button" onClick={recover}>
                  Recover
                </button>
              </>
            )}
            {phase === 'recovery' && (
              <RecoveryPanel
                ref={recoveryRegion}
                load={(cursor) =>
                  controls.current?.iterations(cursor) ??
                  Promise.resolve({ ok: false, code: 'failed' })
                }
                peek={async (iteration) => {
                  const label = iterationLabel(iteration.savedAt);
                  const read = await controls.current?.peek(iteration.id);
                  if (read === undefined || !read.ok) {
                    return `${sentenceCase(label)} could not be read.`;
                  }
                  const stored = readContent(read.content, {
                    artifact: componentId,
                    version: label,
                  });
                  return stored.ok ? stored.document : `${sentenceCase(label)} could not be read.`;
                }}
                current={() => (surface === null ? null : fromEditor(surface.state.doc))}
                restore={(iteration) =>
                  controls.current?.restore(iteration.id, iterationLabel(iteration.savedAt)) ??
                  Promise.resolve(null)
                }
                onCancel={cancelRecovery}
              />
            )}
            {placeTables(tablePanels())}
            {/* What the last paste changed, while the surface takes changes: a report about a paste
                into a component that has since been lost to someone else is about nothing here. */}
            {surface !== null && pasteReport !== null && mayFormat && (
              <PasteReport
                ref={pasteRegion}
                entries={pasteReport}
                onClose={() => {
                  setPasteReport(null);
                  surface.focus();
                }}
              />
            )}
            {/* The surface's region: ProseMirror mounts into it, and F6 lands on this element
                itself where what it holds cannot take the focus, such as a component being read. */}
            {/* On the paper the theme sets text on, at the layout's measure (themes.md, "The theme in
                the editor"): the same element whether or not the theme has arrived. */}
            <UnheldFaces />
            <Canvas>
              <div ref={place} className={styles['surface']} tabIndex={-1} />
            </Canvas>
            {/* Beside the surface, wherever the type gives the component fields: its values are
                part of the iteration, saved with the content (definitions.md, "Shown as they
                arise"). A change is a change like any typed on the surface, and claims the lock. */}
            {shown.fields.length > 0 &&
              (() => {
                const fieldsSection = (
                  <section
                    ref={metadataRegion}
                    aria-label={`Fields of ${shown.type.name}`}
                    className={styles['fields']}
                  >
                    <FieldsForm
                      key={valuesDrawn}
                      fields={shown.fields}
                      schemas={shown.schemas}
                      values={values}
                      people={people}
                      readOnly={!mayFormat || loaded.state !== 'open'}
                      onChange={(next) => {
                        heldValues.current = next;
                        setValues(next);
                        recorder.current?.values(next);
                        controls.current?.changed();
                      }}
                    />
                  </section>
                );
                if (fieldsHost === undefined) return fieldsSection;
                return fieldsHost === null
                  ? null
                  : createPortal(<div inert={behindDialog}>{fieldsSection}</div>, fieldsHost);
              })()}
            {offered !== null && (
              <div>
                <label>
                  Text from before this page opened
                  <textarea readOnly value={offered} />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setOffered(null);
                    offeredShown.current = null;
                    forgetOffered(componentId);
                    surface?.focus();
                  }}
                >
                  Dismiss
                </button>
              </div>
            )}
            {kept !== null && (
              <label>
                Text that was not saved
                <textarea readOnly value={kept} />
              </label>
            )}
          </>
        )}
      </article>
      {/* Beside the article, never inside it, and always there rather than moved when a dialog
          opens: `inert` takes the article out of the accessibility tree, so a notice that arrived
          while a dialog stood over the page - newer text saved from another window, signed out,
          the lock lost - would be announced to nobody. A live region that moved between parents
          would be a live region that lost the announcement instead, so it stays put out here.
          In the application the status bar is that region, outside the article for the same
          reason; this one is for an editor rendered with no shell around it. */}
      {status === null && <p role="status">{notice}</p>}
      {figureDialog !== null &&
        surface !== null &&
        // Beside the article, as the prompt is, and for the same reason.
        createPortal(
          <FigureDialog
            title={figureDialog}
            language={headerOf(surface.state.doc).language}
            upload={(bytes, alternative) =>
              uploadImage(client, { space: shown.space.id, bytes, alternative })
            }
            onDone={({ assetVersion, alternative, imageStyle }) => {
              // The phase as it is now, from the session, not as this render saw it: the lock can
              // be lost while the image is checked, and a command dispatches whatever the surface's
              // own `editable` says (figures 2, final review).
              const now = controls.current?.view().phase;
              if (!shown.mayEdit || now === undefined || !isEditablePhase(now)) {
                return 'This component can no longer be edited here, so the image was not placed.';
              }
              const dispatch = surface.dispatch.bind(surface);
              const command =
                figureDialog === 'Figure'
                  ? insertFigure(assetVersion, alternative, newBlockIdentifier, imageStyle)
                  : figureDialog === 'Image'
                    ? insertImage(assetVersion, alternative, imageStyle)
                    : // Replacing what the panel is about: an inline image selected whole, or the
                      // figure the cursor stands in.
                      imageAt(surface.state) !== null
                      ? replaceImageAsset(assetVersion, alternative)
                      : replaceFigureImage(assetVersion, alternative);
              const placed = command(surface.state, dispatch);
              if (!placed) return 'The image could not be placed where the cursor is.';
              setFigureDialog(null);
              surface.focus();
              return null;
            }}
            onCancel={() => {
              setFigureDialog(null);
              surface.focus();
            }}
          />,
          document.body,
        )}
      {referring !== null &&
        // Beside the article, as the prompt is, and for the same reason.
        createPortal(
          <ReferenceDialog
            options={referring.options}
            inDocument={referring.inDocument}
            current={referring.current}
            onDone={(choice) => {
              // As the Figure dialog asks: the phase as it is now, since the lock can be lost while
              // the dialog stands.
              const now = controls.current?.view().phase;
              const into = referring.view;
              if (
                !shown.mayEdit ||
                now === undefined ||
                !isEditablePhase(now) ||
                into.isDestroyed
              ) {
                return 'This component can no longer be edited here, so the reference was not placed.';
              }
              const command =
                referring.current === null
                  ? insertReference(choice)
                  : changeReference(referring.current.pos, choice);
              if (!command(into.state, into.dispatch.bind(into))) {
                return referring.current === null
                  ? 'A reference cannot be placed where the cursor is.'
                  : 'That reference is not there any more.';
              }
              setReferring(null);
              return null;
            }}
            onCancel={() => setReferring(null)}
          />,
          document.body,
        )}
      {valuing !== null &&
        createPortal(
          <ValueDialog
            client={client}
            componentId={componentId}
            current={valuing.current?.binding ?? null}
            inDocument={
              bindingContext === undefined ? null : { pinned: bindingActs?.pinned ?? false }
            }
            {...(documentParameters === undefined ? {} : { documentParameters })}
            place={valuing.place}
            onDone={(...chosen) => {
              const now = controls.current?.view().phase;
              const into = valuing.view;
              if (
                !shown.mayEdit ||
                now === undefined ||
                !isEditablePhase(now) ||
                into.isDestroyed
              ) {
                return 'This component can no longer be edited here, so the value was not placed.';
              }
              const changing = valuing.current;
              const dispatch = into.dispatch.bind(into);
              const notThere =
                changing === null
                  ? 'A value cannot be placed where the cursor is.'
                  : 'That value is not there any more.';
              // A table's binding is the table's, which the cursor stands in (TB2-E, TB2-G).
              if (chosen[1] === 'table') {
                const [choice, , columns] = chosen;
                const command =
                  changing === null
                    ? insertBoundTable(choice, columns, newBlockIdentifier)
                    : changeTableBinding(changing.pos, choice);
                if (!command(into.state, dispatch)) return notThere;
                setValuing(null);
                const left = columnsPlaced(columns).left;
                if (changing === null && left > 0) {
                  const said = columnsLeftOut(left);
                  setNotice(said);
                  // Said again beside the session's own notice, as a paste's is, where this claims.
                  if (controls.current?.view().phase !== 'editing') pasteSaid.current = said;
                }
                const placed =
                  changing === null ? boundTableAt(into.state)?.binding.id : changing.binding.id;
                if (placed) settle(placed, changing === null ? 'placed' : 'changed');
                return null;
              }
              const [choice, placeAs] = chosen;
              const asFigure = valuing.place === 'figure' || placeAs === 'figure';
              const command =
                changing === null
                  ? asFigure
                    ? insertBoundFigure(choice, newBlockIdentifier)
                    : insertBinding(choice)
                  : valuing.place === 'figure'
                    ? changeFigureBinding(changing.pos, choice)
                    : changeBinding(changing.pos, choice);
              if (!command(into.state, dispatch)) return notThere;
              setValuing(null);
              // A figure's binding is the figure's, which the cursor stands in (B6-H).
              const placed = asFigure
                ? figureAt(into.state)?.binding?.id
                : bindingSelected(into.state)?.binding.id;
              if (placed) settle(placed, changing === null ? 'placed' : 'changed');
              return null;
            }}
            onCancel={() => setValuing(null)}
          />,
          document.body,
        )}
      {equating !== null &&
        surface !== null &&
        // Beside the article, as the prompt is, and for the same reason. Nothing stands in its place
        // while it loads, from the build's own files.
        createPortal(
          <Suspense fallback={null}>
            <EquationDialog
              current={equating.current}
              blockPlaceable={equating.blockPlaceable}
              // The component's base language as it is now, which the header may have changed.
              language={headerOf(surface.state.doc).language}
              onDone={(choice) => {
                // As the Reference dialog asks: the phase as it is now, since the lock can be lost
                // while the dialog stands.
                const now = controls.current?.view().phase;
                const into = equating.view;
                if (
                  !shown.mayEdit ||
                  now === undefined ||
                  !isEditablePhase(now) ||
                  into.isDestroyed
                ) {
                  return 'This component can no longer be edited here, so the equation was not placed.';
                }
                const command =
                  equating.current === null
                    ? insertEquation(choice)
                    : changeEquation(equating.current.pos, choice);
                if (!command(into.state, into.dispatch.bind(into))) {
                  return equating.current === null
                    ? 'An equation cannot be placed where the cursor is.'
                    : 'That equation is not there any more.';
                }
                setEquating(null);
                return null;
              }}
              onCancel={() => setEquating(null)}
            />
          </Suspense>,
          document.body,
        )}
      {symbolizing !== null &&
        // Beside the article, as the prompt is, and for the same reason.
        createPortal(
          <SymbolPalette
            // The face that sets the text where the cursor is, which dims what it lacks (W-M); every
            // character is offered until the presentation says which that is.
            typeface={(() => {
              const where = symbolizing.isDestroyed ? null : textWhereAt(symbolizing.state);
              return presentation?.state === 'ready' && where !== null
                ? typefaceAt(presentation.theme, presentation.unheld, where)
                : null;
            })()}
            onChoose={(character) => {
              // As the Equation dialog asks: the phase as it is now, since the lock can be lost while
              // the palette stands.
              const now = controls.current?.view().phase;
              const into = symbolizing;
              const placed =
                shown.mayEdit &&
                now !== undefined &&
                isEditablePhase(now) &&
                !into.isDestroyed &&
                insertSymbol(character)(into.state, into.dispatch.bind(into));
              if (!placed) setNotice('The symbol could not be inserted where the cursor is.');
              closeSymbols();
            }}
            onCancel={closeSymbols}
          />,
          document.body,
        )}
      {asking &&
        // Beside the article rather than inside it, because the article is what it makes inert:
        // a dialog within an inert subtree is a dialog nothing can reach. Keyed by which opening
        // this is, so a dialog that comes back carrying a complaint is a fresh set of boxes rather
        // than the same ones updated in place, and the focus starts in the first of them again.
        createPortal(
          <MarkPrompt
            key={asking.opened}
            command={asking.command}
            values={asking.values}
            refused={asking.refused}
            removable={asking.removable}
            selected={asking.selected}
            onApply={(values) => closeAsking(values)}
            onRemove={() => {
              const { command } = asking;
              // Taking a mark off needs no value, so it never goes back to the press waiting on
              // this dialog: `removeMarkCommand` is reached from here and nowhere else. Its answer
              // is read rather than dropped - the mark it was offered over can have gone while the
              // dialog stood open, and closing on that would be a press that did nothing silently.
              const removed =
                surface !== null &&
                !surface.isDestroyed &&
                removeMarkCommand(command.mark)(surface.state, surface.dispatch.bind(surface));
              // Answered either way, so the press waiting on this dialog is never left pending.
              closeAsking(null);
              // Asked, never asserted. A removal answers no when there is no mark of that type in
              // the range, which is not the same as the text having gone - and telling the author
              // the text has gone while it is on the screen in front of them is worse than saying
              // nothing at all.
              if (!removed && surface !== null) {
                askAgain(
                  surface,
                  command,
                  whyRefused(surface, command) === 'gone' ? 'gone' : 'noMark',
                );
              }
            }}
            onCancel={() => closeAsking(null)}
          />,
          document.body,
        )}
    </>
  );
}
