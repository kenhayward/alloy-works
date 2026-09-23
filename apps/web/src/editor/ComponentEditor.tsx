import type { ComponentView, createApiClient } from '@alloy-works/api-client';
import { parseContentDocument, type ReportEntry } from '@alloy-works/domain';
import {
  createEditorState,
  EDITOR_COMMANDS,
  figureAt,
  fromEditor,
  insertFigure,
  replaceFigureImage,
  headerOf,
  listAt,
  preformattedAt,
  tableAt,
  mountEditor,
  pasteInto,
  readMarkdownText,
  newBlockIdentifier,
  removeMarkCommand,
  Selection as EditorSelection,
  setDirection,
  setLanguage,
  setTitle,
  somewhereToPutMark,
  toEditor,
  type ComponentHeader as Header,
  type EditorView,
  type Selection,
} from '@alloy-works/editor';
import '@alloy-works/editor/style.css';
import styles from './ComponentEditor.module.css';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

import { positionAtTextOffset } from './caret.js';
import { ComponentHeader } from './ComponentHeader.js';
import { EditorToolbar } from './EditorToolbar.js';
import { FigureDialog } from './FigureDialog.js';
import { FigurePanel } from './FigurePanel.js';
import { Icon } from './Icon.js';
import { ListPanel } from './ListPanel.js';
import { PasteReport, shownOfPaste } from './PasteReport.js';
import { PreformattedPanel } from './PreformattedPanel.js';
import { TablePanel } from './TablePanel.js';
import { MarkPrompt, type Refused } from './MarkPrompt.js';
import { askAndApply, pressCommand, type AskForValue, type MarkCommand } from './press.js';
import { SaveIndicator } from './SaveIndicator.js';
import { uploadImage } from './upload.js';
import { editingSessionFor, sessionService } from './service.js';
import {
  browserClock,
  createSession,
  designTiming,
  type Clock,
  type Session,
  type SessionView,
  type Timing,
} from './session.js';
import { useStatus } from '../shell/Status.js';
import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';

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
  /** Its section number, where it is open in place in a document; there is none standalone. */
  readonly number?: string;
  /**
   * Given where it is open in place (interface slice 13): Done then closes it, releasing the lock
   * first when this author holds one, and is offered to a reader as the way out.
   */
  readonly onDone?: () => void;
  /** Where the text was clicked to open it, in characters: the focus and the caret go there. */
  readonly openAt?: number;
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
const textOf = (view: EditorView) => {
  const lines: string[] = [];
  view.state.doc.forEach((paragraph) => lines.push(paragraph.textContent));
  return lines.join('\n');
};

/**
 * Whether the surface takes changes in this phase - the one predicate, shared by the view's own
 * `editable` and the header's (review round 1, item 9): the header must go read-only exactly when the
 * surface does, `lost` among them, rather than staying editable by a narrower rule of its own.
 */
const isEditablePhase = (phase: SessionView['phase']) =>
  phase === 'reading' || phase === 'claiming' || phase === 'editing';

/** What the status bar says after a paste: the report's own last sentence says why one was refused. */
const PASTED = 'Pasted.';
const PASTED_WITH_REPORT =
  'Pasted. Some of it was changed or left out: the paste report says what.';
const NOT_DROPPED = 'Dragging content in is not available yet. Copy and paste it instead.';
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
export function ComponentEditor({
  componentId,
  client,
  principalId,
  timing = designTiming,
  clock = browserClock,
  sessionId,
  onView,
  onSpace,
  number,
  onDone,
  openAt,
}: ComponentEditorProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
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
  const [notice, setNotice] = useState<string | null>(null);
  // Said through the application's status bar, its one live region, where there is one (interface
  // slice 15); a component opened in place in a document shares it with the document's own notices.
  const status = useStatus();
  useEffect(() => {
    if (notice !== null) status?.say(notice);
  }, [status, notice]);
  const [header, setHeader] = useState<Header | null>(null);
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
  // The Figure dialog, open to make a figure or to give one another image, or closed.
  const [figureDialog, setFigureDialog] = useState<'Figure' | 'Replace image' | null>(null);
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
    const selection = surface?.state.selection;
    if (!selection || selection.empty || !selection.$from.sameParent(selection.$to)) return null;
    return surface!.state.doc.textBetween(selection.from, selection.to);
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

  useEffect(() => {
    let current = true;
    void client
      .GET('/v1/components/{id}', { params: { path: { id: componentId } } })
      .then(({ data, response }) => {
        if (!current) return;
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
    const fresh = (doc = opened.doc, selection?: Selection) =>
      createEditorState({
        doc,
        newIdentifier: newBlockIdentifier,
        // A shortcut for a mark whose value only the author can give opens the same dialog the
        // toolbar's button opens, and runs the same press, so the keyboard and the button cannot
        // come to mean two different things (CNT-077). It reports the key handled only where it
        // did something with it: a component being read, or a selection with nowhere to put the
        // mark, hands the key back rather than swallowing it.
        onPrompt: (mark) => {
          const command = EDITOR_COMMANDS.find(
            (each) => each.kind === 'mark' && each.mark === mark,
          );
          if (command === undefined || command.kind !== 'mark') return false;
          // Restated, not a case this catches: it is the same expression `editable` below is, and
          // ProseMirror hands a keydown to a keymap only while the view is editable - so a reader
          // never reaches here at all. It stays because the two must agree, and a later `editable`
          // that grew a clause of its own would leave the keyboard the one way in.
          if (!(component.mayEdit && isEditablePhase(phase))) return false;
          return runPromptingRef.current(view, command);
        },
        ...(selection ? { selection } : {}),
      });
    let base = opened.doc;
    let phase: SessionView['phase'] = 'reading';
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
    const initialSession =
      sessionIdRef.current ??
      editingSessionFor(
        component.id,
        (stored) => component.lock?.yours === true && component.lock.session === stored,
      );
    // A new session has published nothing yet, and no paste is waiting on its claim.
    sessionNotice.current = null;
    pasteSaid.current = null;
    const editing = createSession({
      service: sessionService(client, component.id, initialSession, principalId),
      clock: clockRef.current,
      timing: timingRef.current,
      version: { id: component.version.id, number: component.version.number },
      snapshot: () => fromEditor(view.state.doc),
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
        // saved version to the kept text.
        if (!hadPending) return;
        // The held changes are not applied: the surface goes back to the version, and what was typed
        // is offered as text, the one thing that can be kept without writing to the component.
        // `captureKept` appends rather than replaces (fix round 1, finding 2) and is a no-op when the
        // surface's current content was already captured - a refused Continue after `lost` already
        // filled `kept` with exactly this text must not add a second copy of it (fix round 2, minor).
        captureKept();
        view.updateState(fresh(base));
        // `updateState` does not go through `dispatch` above, so nothing else refreshes `header`
        // (review round 1, item 1): left alone, it would keep showing whatever was typed right up to
        // the refusal, and the next keystroke into that stale field would resend it - resurrecting
        // text the surface itself just discarded.
        setHeader(headerOf(view.state.doc));
      },
      onVersion: () => {
        // Undo must not reach past a version (CNT-103): a fresh state has a fresh history. Cutting a
        // version changes nothing about the document itself, though, so the selection is carried over
        // rather than jumping back to the start (fix round 1, minor).
        const { selection } = view.state;
        base = view.state.doc;
        view.updateState(fresh(base, selection));
        // As above: cutting changes nothing about the header, but this keeps that an invariant the
        // surface enforces rather than one a future change could silently break.
        setHeader(headerOf(view.state.doc));
      },
    });
    controls.current = editing;
    setSession(editing.view());
    const view = mountEditor(place.current, {
      state: fresh(),
      // Named once, from what the component opened with (task 5 brief): it does not follow a title
      // typed afterwards, which is wrong only after a rename, and the accessibility plan owns the
      // surface's naming.
      label: `Content of ${opened.doc.attrs.title as string}`,
      editable: () => component.mayEdit && isEditablePhase(phase),
      dispatch: (transaction, target) => {
        target.updateState(target.state.apply(transaction));
        // Every transaction, not only one that changed the document: a transaction that only moved
        // the caret is exactly the one the toolbar has to hear about.
        setTransactions((count) => count + 1);
        if (transaction.docChanged) {
          setHeader(headerOf(target.state.doc));
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
    // Opened by a click in its rendered text: the caret goes where the click was, and the focus with
    // it, so the author types where they pointed. A selection changes nothing and claims nothing.
    if (openAtRef.current !== undefined) {
      const at = positionAtTextOffset(view.state.doc, openAtRef.current);
      view.dispatch(view.state.tr.setSelection(EditorSelection.near(view.state.doc.resolve(at))));
      view.focus();
    }
    onViewRef.current?.(view);
    return () => {
      editing.dispose();
      controls.current = null;
      setSurface(null);
      view.destroy();
    };
  }, [component, client, principalId]);

  // While there is something the service has not acknowledged, an unmount already flushes it best
  // effort (Session.dispose) but a page close does not run that cleanup at all - so a close is
  // guarded for as long as anything is dirty or being sent (fix round 1, finding 4): while dirty,
  // while a save is in flight, while a retry is failing with content it has not yet acknowledged, or
  // while there is still text kept from a refusal that was never written anywhere (fix round 2,
  // minor). The guard comes off the moment none of those is true any longer.
  useEffect(() => {
    if (!session) return undefined;
    const unacknowledged =
      session.dirty || session.save === 'saving' || session.save === 'failing' || kept !== null;
    if (!unacknowledged) return undefined;
    const warnBeforeClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeClose);
    return () => window.removeEventListener('beforeunload', warnBeforeClose);
  }, [session, kept]);

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
      pasteRegion.current,
      place.current,
    ].filter((region) => region !== null);
    if (ring.length === 0) return;
    event.preventDefault();
    const at = ring.findIndex((region) => region.contains(document.activeElement));
    const back = event.shiftKey;
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
  const mayFormat = shown.mayEdit && isEditablePhase(phase);
  // Asked of the command itself, without dispatching, so **Figure** is offered exactly where a figure
  // can go - never in a caption, a cell or preformatted text, where an upload would place nothing.
  const mayPlaceFigure =
    surface !== null && insertFigure('', { kind: 'decorative' }, () => '')(surface.state);

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
    const outcome = pasteInto(view.state, reading, newBlockIdentifier);
    if (outcome.ok) view.dispatch(outcome.transaction);
    const { beside, said } = pasteSentence(outcome.ok, outcome.report);
    setPasteReport(beside.length > 0 ? beside : null);
    setNotice(said);
    if (outcome.ok && controls.current?.view().phase !== 'editing') pasteSaid.current = said;
    view.focus();
  };
  const size = surface === null ? undefined : sizeOf(surface.state.doc);
  const mayCut = shown.mayEdit && loaded.state === 'open';
  // Standalone, Done is Done editing and releases a lock only this session can hold. In place it is
  // also the way out of the card, so it is offered while reading as well, and closes once released.
  const doneDisabled = onDone ? !(phase === 'editing' || phase === 'reading') : phase !== 'editing';
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
        inert={asking !== null || figureDialog !== null}
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
              <div className={styles['actions']} role="toolbar" aria-label="Component">
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
              </div>
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
              ref={toolbarRegion}
              view={surface}
              enabled={mayFormat}
              newIdentifier={newBlockIdentifier}
              prompt={askFor}
              onRefused={(command) =>
                surface && askAgain(surface, command, whyRefused(surface, command))
              }
            />
            {!shown.mayEdit && (
              <Notice tone="readOnly">
                <p>You may read this component but not edit it.</p>
              </Notice>
            )}
            {lock && !lock.yours && phase === 'reading' && !held && (
              <Notice tone="editing">
                <p>{lock.holder.name ?? 'Someone else'} is editing this component.</p>
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
            {phase === 'lost' && session?.recoverable && (
              <button type="button" onClick={() => controls.current?.claimAgain(true)}>
                Continue
              </button>
            )}
            {/* Beside the toolbar, and only while the cursor stands in a counted list. A
                definition list carries no start and no numbering and its kind is the button that
                made it, so nothing is shown for one - a deliberate absence rather than an empty
                box. */}
            {surface !== null && list !== null && list.kind !== 'definition' && (
              <ListPanel ref={listRegion} view={surface} list={list} enabled={mayFormat} />
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
            {/* And only while the cursor stands in a table: its header counts and its grid's acts. */}
            {surface !== null && table !== null && (
              <TablePanel ref={tableRegion} view={surface} table={table} enabled={mayFormat} />
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
            <div ref={place} className={styles['surface']} tabIndex={-1} />
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
            onDone={({ assetVersion, alternative }) => {
              // The phase as it is now, from the session, not as this render saw it: the lock can
              // be lost while the image is checked, and a command dispatches whatever the surface's
              // own `editable` says (figures 2, final review).
              const now = controls.current?.view().phase;
              if (!shown.mayEdit || now === undefined || !isEditablePhase(now)) {
                return 'This component can no longer be edited here, so the image was not placed.';
              }
              const dispatch = surface.dispatch.bind(surface);
              const placed =
                figureDialog === 'Figure'
                  ? insertFigure(
                      assetVersion,
                      alternative,
                      newBlockIdentifier,
                    )(surface.state, dispatch)
                  : replaceFigureImage(assetVersion, alternative)(surface.state, dispatch);
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
