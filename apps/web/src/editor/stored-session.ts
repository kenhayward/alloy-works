import {
  editorSchema,
  recordChange,
  replayChanges,
  Selection,
  type EditorState,
  type HistoryKind,
  type RecordedChange,
  type Transaction,
} from '@alloy-works/editor';

/**
 * What a window keeps of one component's editing session so that a reload loses nothing and undo
 * survives it (component-editor.md, "Undo across a reload"; W11.3): the version the session opened
 * from and the document at that point, every change since with the history's grouping, the latest
 * values, and the last sequence sent.
 *
 * Pure of React and of the view: the component editor feeds it what its surface applies, and asks it
 * on a reload what there is to go on from.
 */
export interface StoredSession {
  /** The editing session the changes were made in: a reload goes on only under the same one. */
  readonly session: string;
  /** The version it opened from, by id: a change recorded against an older one is never replayed. */
  readonly version: string;
  /** The document at that point, as the editor's JSON. */
  readonly doc: unknown;
  /** Every change since, in order, each with how the history took it. */
  readonly changes: readonly RecordedChange[];
  /** The component's values as they stand now, whole. */
  readonly values: Readonly<Record<string, unknown>>;
  /** Bumped by every change, of the content or a value: what `sent` is measured against. */
  readonly revision: number;
  /** The last sequence sent, and the revision it carried. */
  readonly sent: { readonly sequence: number; readonly revision: number };
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Where it is kept, one per component per window, beside the session's id. */
const keyFor = (componentId: string) => `alloy-works:editing-steps:${componentId}`;

const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KINDS: readonly HistoryKind[] = ['new', 'join', 'none', 'undo', 'redo'];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isChange = (value: unknown): value is RecordedChange =>
  isObject(value) &&
  KINDS.includes(value.history as HistoryKind) &&
  'selection' in value &&
  Array.isArray(value.transactions) &&
  value.transactions.length > 0 &&
  value.transactions.every(
    (each) => isObject(each) && Array.isArray(each.steps) && typeof each.held === 'boolean',
  );

/**
 * A kept session, or null for anything that is not one: text that is not JSON, or JSON of another
 * shape. Whether its changes replay is `replayStored`'s question, not this one's.
 */
export function parseStoredSession(text: string | null): StoredSession | null {
  if (text === null) return null;
  let read: unknown;
  try {
    read = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !isObject(read) ||
    typeof read.session !== 'string' ||
    !LOWERCASE_UUID.test(read.session) ||
    typeof read.version !== 'string' ||
    !isObject(read.doc) ||
    !Array.isArray(read.changes) ||
    !read.changes.every(isChange) ||
    !isObject(read.values) ||
    !isCount(read.revision) ||
    !isObject(read.sent) ||
    !isCount(read.sent.sequence) ||
    !isCount(read.sent.revision)
  ) {
    return null;
  }
  return read as unknown as StoredSession;
}

/** What this window keeps for a component, or null: none, none that parses, or no storage at all. */
export function readStoredSession(componentId: string, storage?: Store): StoredSession | null {
  try {
    // Resolved inside the try: reading `sessionStorage` itself can throw where access is denied.
    return parseStoredSession((storage ?? globalThis.sessionStorage).getItem(keyFor(componentId)));
  } catch {
    return null;
  }
}

/** Forgets what this window keeps for a component; never throws. */
export function forgetStoredSession(componentId: string, storage?: Store): void {
  try {
    (storage ?? globalThis.sessionStorage).removeItem(keyFor(componentId));
  } catch {
    // Nothing kept, or nothing that can be reached: either way there is nothing to replay.
  }
}

/** A session with nothing changed yet, from `doc` at `version`, having sent up to `sequence`. */
export function freshSession(start: {
  readonly session: string;
  readonly version: string;
  readonly doc: EditorState['doc'];
  readonly values: Readonly<Record<string, unknown>>;
  readonly sequence: number;
}): StoredSession {
  return {
    session: start.session,
    version: start.version,
    doc: start.doc.toJSON() as unknown,
    changes: [],
    values: { ...start.values },
    revision: 0,
    sent: { sequence: start.sequence, revision: 0 },
  };
}

/**
 * Where a reload goes on from, given the latest sequence the service has accepted from the session:
 * the larger of that and the last one this window sent, so the next save is judged above both; and
 * whether anything is on screen the service has not got - anything changed since the last send, or
 * a last send the service never accepted, or a later save under this session this window never sent.
 */
export function continuing(
  kept: StoredSession,
  latest: number | null,
): { readonly sequence: number; readonly unsent: boolean } {
  const accepted = latest ?? 0;
  return {
    sequence: Math.max(kept.sent.sequence, accepted),
    unsent: kept.sent.revision !== kept.revision || accepted !== kept.sent.sequence,
  };
}

/**
 * The state a reload opens the surface in: the kept document, checked as the model holds it, with
 * every change replayed onto it into a history of its own, in a state `fresh` makes with the surface's
 * plugins. Throws where the document is not one the model holds or a change does not replay exactly;
 * the caller then forgets it and opens as a page opened afresh does.
 */
export function replayStored(
  kept: StoredSession,
  fresh: (doc: EditorState['doc']) => EditorState,
): EditorState {
  const doc = editorSchema.nodeFromJSON(kept.doc);
  doc.check();
  const state = replayChanges(fresh(doc), kept.changes);
  // With a caret where the selection was, never a node selected whole: a footnote or a figure selected
  // opens an editor or a panel of its own as the selection reaches it, which a page opened on the
  // selection already there never draws - and selecting it again would change nothing to draw it by.
  if (state.selection.toJSON().type === 'text') return state;
  return state.apply(
    state.tr.setSelection(Selection.near(state.doc.resolve(state.selection.from))),
  );
}

/** Keeps one component's session as it changes: what the component editor tells it, it writes. */
export interface Recorder {
  /** A transaction the surface applied, with whatever the plugins appended to it. */
  applied(before: EditorState, transactions: readonly Transaction[], after: EditorState): void;
  /** The values as they stand after a change to one of them. */
  values(values: Readonly<Record<string, unknown>>): void;
  /** A sequence was taken for a save of everything as it stands now. */
  sent(sequence: number): void;
  /** The session claimed afresh, under a new id, from which nothing has been sent. */
  rebind(session: string): void;
  /**
   * The surface was put back to `doc` with a fresh history - a version cut, a restore, a refused
   * claim - so nothing from before it may be replayed: the changes kept so far go.
   */
  reset(version: string, doc: EditorState['doc'], values: Readonly<Record<string, unknown>>): void;
  /**
   * The page is gone: nothing it is told from here on is written, so a save its session queued as it
   * went never writes an older record over the one the next page keeps.
   */
  close(): void;
}

/**
 * Keeps `start` for `componentId`, writing it whole after every change, and writing nothing while
 * nothing has changed - so a reader, or a session back at its version, leaves nothing behind.
 *
 * **Never throws.** Storage that is full or refused stops keeping anything until the next reset, and
 * what it held is removed: a record that stopped short of what is on screen would replay older text
 * over newer, which is worse than none. The document and each change are turned into JSON once, as
 * they arrive, so a write costs a join rather than a walk of the whole session.
 */
export function createRecorder(
  componentId: string,
  start: StoredSession,
  storage?: Store,
): Recorder {
  const key = keyFor(componentId);
  let kept = start;
  let docJson = JSON.stringify(start.doc);
  let changeJson = start.changes.map((change) => JSON.stringify(change));
  let stopped = false;
  let closed = false;

  const store = (): Store => storage ?? globalThis.sessionStorage;
  const forget = () => {
    try {
      store().removeItem(key);
    } catch {
      // As `forgetStoredSession`.
    }
  };
  const write = () => {
    if (stopped || closed) return;
    if (kept.revision === 0) {
      forget();
      return;
    }
    try {
      const { session, version, values, revision, sent } = kept;
      store().setItem(
        key,
        `{"session":${JSON.stringify(session)},"version":${JSON.stringify(version)},` +
          `"values":${JSON.stringify(values)},"revision":${revision},"sent":${JSON.stringify(sent)},` +
          `"doc":${docJson},"changes":[${changeJson.join(',')}]}`,
      );
    } catch {
      stopped = true;
      forget();
    }
  };
  write();

  return {
    applied(before, transactions, after) {
      const change = recordChange(before, transactions, after);
      if (change === null) return;
      kept = { ...kept, changes: [...kept.changes, change], revision: kept.revision + 1 };
      changeJson.push(JSON.stringify(change));
      write();
    },
    values(values) {
      kept = { ...kept, values: { ...values }, revision: kept.revision + 1 };
      write();
    },
    sent(sequence) {
      kept = { ...kept, sent: { sequence, revision: kept.revision } };
      write();
    },
    rebind(session) {
      // Nothing has been sent under the new id, so whatever has changed is the service's to have yet:
      // only a document with nothing changed on it is kept at all.
      kept = { ...kept, session, sent: { sequence: 0, revision: 0 } };
      write();
    },
    reset(version, doc, values) {
      kept = freshSession({
        session: kept.session,
        version,
        doc,
        values,
        sequence: kept.sent.sequence,
      });
      docJson = JSON.stringify(kept.doc);
      changeJson = [];
      stopped = false;
      write();
    },
    close() {
      closed = true;
    },
  };
}
