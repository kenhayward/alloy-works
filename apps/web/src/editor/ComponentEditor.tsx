import type { ComponentView, createApiClient } from '@alloy-works/api-client';
import { parseContentDocument } from '@alloy-works/domain';
import {
  createEditorState,
  EDITOR_COMMANDS,
  fromEditor,
  headerOf,
  mountEditor,
  newBlockIdentifier,
  removeMarkCommand,
  setDirection,
  setLanguage,
  setTitle,
  toEditor,
  type ComponentHeader as Header,
  type EditorCommand,
  type EditorView,
  type Selection,
} from '@alloy-works/editor';
import '@alloy-works/editor/style.css';
import { useEffect, useRef, useState } from 'react';

import { ComponentHeader } from './ComponentHeader.js';
import { EditorToolbar } from './EditorToolbar.js';
import { MarkPrompt } from './MarkPrompt.js';
import { pressCommand, type AskForValue } from './press.js';
import { SaveIndicator } from './SaveIndicator.js';
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

/** One dialog, open, and the press waiting on what the author does with it. */
interface Asking {
  readonly command: EditorCommand;
  /** What to put in the boxes: the mark that is there, or what was typed and then refused. */
  readonly values: Record<string, unknown> | null;
  readonly refused: boolean;
  /** Whether there is a mark of that type there to take off. */
  readonly removable: boolean;
  /** Bumped every time one opens, so a dialog reopened over a refusal is a fresh set of boxes. */
  readonly opened: number;
  readonly settle: (answer: Record<string, unknown> | null) => void;
}

/**
 * One component, open for editing (component-editor.md): its title, the surface, the save indicator,
 * Save version and Done editing, and one status region that says what happened. The surface is one
 * ProseMirror view (ADR-0023); the session decides when changes are sent and never cuts a version on its
 * own.
 */
export function ComponentEditor({
  componentId,
  client,
  principalId,
  timing = designTiming,
  clock = browserClock,
  sessionId,
  onView,
}: ComponentEditorProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  // Bumped by Try again after opening failed, to ask for the component once more.
  const [attempt, setAttempt] = useState(0);
  const [session, setSession] = useState<SessionView | null>(null);
  const [kept, setKept] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
  // What the author last typed into a dialog, kept only long enough to put it back in the boxes if
  // the stored model refuses it: a refusal must not also take away what it refused.
  const typed = useRef<Record<string, unknown>>({});
  // A refusal standing over the next opening of this mark's dialog, set the moment one arrives.
  const refusal = useRef<string | null>(null);
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
  const askFor: AskForValue = (command, current) =>
    new Promise((settle) => {
      const refused = refusal.current === command.mark;
      refusal.current = null;
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      openings.current += 1;
      setAsking({
        command,
        values: refused ? typed.current : current,
        refused,
        // What can be taken off is what is there now, never what was typed and refused.
        removable: current !== null,
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
  const runPrompting = (view: EditorView, command: EditorCommand): boolean =>
    pressCommand({
      view,
      command,
      newIdentifier: newBlockIdentifier,
      prompt: askFor,
      onRefused: (refused) => askAgain(view, refused),
    });

  /**
   * The author gave a value and nothing came of it. Asking again is how they are told: the dialog
   * comes back with what they typed still in it and the refusal beneath the box, which is where
   * they are looking, rather than as a notice somewhere else on the page.
   *
   * It must not throw. The press that calls it wraps the continuation and the prompt in one
   * `catch`, so a handler that threw would be reported as a second refusal of the same value.
   */
  function askAgain(view: EditorView, command: EditorCommand) {
    refusal.current = command.mark;
    if (!view.isDestroyed) runPrompting(view, command);
  }

  /** Closes the dialog, puts the focus back where it came from, and answers the press. */
  const closeAsking = (answer: Record<string, unknown> | null) => {
    if (!asking) return;
    setAsking(null);
    opener.current?.focus();
    asking.settle(answer);
  };

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
          const command = EDITOR_COMMANDS.find((each) => each.mark === mark);
          if (command === undefined) return false;
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
        if (next.notice) setNotice(next.notice);
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
      refused: () => setNotice('Pasting is not available yet. Type the text instead.'),
    });
    setSurface(view);
    setHeader(headerOf(view.state.doc));
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

  if (loaded.state === 'loading') return <p>Opening...</p>;
  if (loaded.state === 'missing') {
    return <p>There is nothing here, or nothing you may read.</p>;
  }
  if (loaded.state === 'failed') {
    return (
      <>
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
      </>
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

  return (
    <article aria-labelledby="component-title">
      <header>
        {header ? (
          <ComponentHeader
            header={header}
            editable={shown.mayEdit && loaded.state === 'open' && isEditablePhase(phase)}
            onChange={changeHeader}
            onRefused={setNotice}
          />
        ) : (
          <h2 id="component-title">{typeof title === 'string' ? title : 'Untitled'}</h2>
        )}
        <p>
          Version {session?.version.number ?? shown.version.number} in {shown.space.name}
        </p>
      </header>
      {loaded.state === 'unreadable' && <p>This component could not be read.</p>}
      {loaded.state === 'readOnly' && (
        <p>
          This component holds content this editor cannot change yet (
          {loaded.unsupported.join(', ')}
          ), so it is shown for reading only.
        </p>
      )}
      {loaded.state === 'open' && (
        <>
          {!shown.mayEdit && <p>You may read this component but not edit it.</p>}
          {lock && !lock.yours && phase === 'reading' && !held && (
            <p>{lock.holder.name ?? 'Someone else'} is editing this component.</p>
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
          {shown.mayEdit && (
            <div role="toolbar" aria-label="Component">
              <button
                type="button"
                disabled={phase !== 'editing'}
                onClick={() => void controls.current?.saveVersion()}
              >
                Save version
              </button>
              <button
                type="button"
                disabled={phase !== 'editing'}
                onClick={() => void controls.current?.doneEditing()}
              >
                Done editing
              </button>
            </div>
          )}
          {session && <SaveIndicator save={session.save} savedAt={session.savedAt} />}
          {/* Above the surface, which is the order the regions are named in
              (component-editor.md, "Accessibility"), and shown to a reader too - disabled, rather
              than absent, so what the editor can do with the text is visible before the lock is. */}
          <EditorToolbar
            view={surface}
            enabled={shown.mayEdit && isEditablePhase(phase)}
            newIdentifier={newBlockIdentifier}
            prompt={askFor}
            onRefused={(command) => surface && askAgain(surface, command)}
          />
          <div ref={place} />
          {asking && (
            // Keyed by which opening this is, so a dialog that comes back carrying a refusal is a
            // fresh set of boxes rather than the same ones updated in place - the focus starts in
            // the first of them again, on the value that was refused.
            <MarkPrompt
              key={asking.opened}
              command={asking.command}
              values={asking.values}
              refused={asking.refused}
              removable={asking.removable}
              onApply={(values) => {
                typed.current = values;
                closeAsking(values);
              }}
              onRemove={() => {
                const { command } = asking;
                closeAsking(null);
                // Taking a mark off needs no value, so it never goes back to the press waiting on
                // this dialog: `removeMarkCommand` is reached from here and nowhere else.
                if (surface && !surface.isDestroyed) {
                  removeMarkCommand(command.mark)(surface.state, surface.dispatch.bind(surface));
                }
              }}
              onCancel={() => closeAsking(null)}
            />
          )}
          {kept !== null && (
            <label>
              Text that was not saved
              <textarea readOnly value={kept} />
            </label>
          )}
        </>
      )}
      <p role="status">{notice}</p>
    </article>
  );
}
