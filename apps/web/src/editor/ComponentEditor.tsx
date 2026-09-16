import type { ComponentView, createApiClient } from '@alloy-works/api-client';
import { parseContentDocument } from '@alloy-works/domain';
import {
  createEditorState,
  fromEditor,
  mountEditor,
  newBlockIdentifier,
  toEditor,
  type EditorView,
  type Selection,
} from '@alloy-works/editor';
import '@alloy-works/editor/style.css';
import { useEffect, useRef, useState } from 'react';

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
  const [session, setSession] = useState<SessionView | null>(null);
  const [kept, setKept] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const place = useRef<HTMLDivElement | null>(null);
  const controls = useRef<Session | null>(null);
  // A stale GET-time lock is only true until this session has claimed or released it itself (fix
  // round 1, minor): once that happens, the initial snapshot can no longer be trusted, so it is never
  // shown again for the life of this session.
  const staleLockKnown = useRef(false);

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

  useEffect(() => {
    let current = true;
    void client
      .GET('/v1/components/{id}', { params: { path: { id: componentId } } })
      .then(({ data }) => {
        if (!current) return;
        if (!data) {
          setLoaded({ state: 'missing' });
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
        if (current) setLoaded({ state: 'missing' });
      });
    return () => {
      current = false;
    };
  }, [client, componentId]);

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
        ...(selection ? { selection } : {}),
      });
    let base = opened.doc;
    let phase: SessionView['phase'] = 'reading';
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
        phase = next.phase;
        setSession(next);
        if (next.notice) setNotice(next.notice);
        if (next.phase !== 'reading') staleLockKnown.current = true;
        if (next.phase === 'lost') setKept(textOf(view));
        // The kept text is only good until the next successful claim puts this session back in
        // control (fix round 1, finding 2): from then on it is stale, not something still worth
        // offering back.
        if (next.phase === 'editing') setKept(null);
        view.setProps({});
      },
      onRefused: () => {
        // The held changes are not applied: the surface goes back to the version, and what was typed
        // is offered as text, the one thing that can be kept without writing to the component. A
        // second refusal appends rather than replaces (fix round 1, finding 2): the surface was put
        // back to `base` after the first one, so what it holds now is only what was typed since -
        // discarding the earlier kept text here would lose it for good.
        const now = textOf(view);
        setKept((previous) => (previous ? `${previous}\n\n${now}` : now));
        view.updateState(fresh(base));
      },
      onVersion: () => {
        // Undo must not reach past a version (CNT-103): a fresh state has a fresh history. Cutting a
        // version changes nothing about the document itself, though, so the selection is carried over
        // rather than jumping back to the start (fix round 1, minor).
        const { selection } = view.state;
        base = view.state.doc;
        view.updateState(fresh(base, selection));
      },
    });
    controls.current = editing;
    setSession(editing.view());
    const view = mountEditor(place.current, {
      state: fresh(),
      label: `Content of ${opened.doc.attrs.title as string}`,
      editable: () =>
        component.mayEdit && (phase === 'reading' || phase === 'claiming' || phase === 'editing'),
      dispatch: (transaction, target) => {
        target.updateState(target.state.apply(transaction));
        if (transaction.docChanged) {
          editing.changed();
        }
      },
      refused: () => setNotice('Pasting is not available yet. Type the text instead.'),
    });
    onViewRef.current?.(view);
    return () => {
      editing.dispose();
      controls.current = null;
      view.destroy();
    };
  }, [component, client, principalId]);

  // While there is something the service has not acknowledged, an unmount already flushes it best
  // effort (Session.dispose) but a page close does not run that cleanup at all - so a close is
  // guarded for as long as anything is dirty or being sent (fix round 1, finding 4), and the guard
  // comes off the moment that stops being true.
  useEffect(() => {
    if (!session) return undefined;
    if (!(session.dirty || session.save === 'saving')) return undefined;
    const warnBeforeClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeClose);
    return () => window.removeEventListener('beforeunload', warnBeforeClose);
  }, [session]);

  if (loaded.state === 'loading') return <p>Opening...</p>;
  if (loaded.state === 'missing') {
    return <p>There is nothing here, or nothing you may read.</p>;
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
        <h2 id="component-title">{typeof title === 'string' ? title : 'Untitled'}</h2>
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
          <div ref={place} />
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
