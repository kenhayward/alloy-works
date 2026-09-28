import {
  editorSchema,
  editorSchemaIdentity,
  mergeChange,
  recordChange,
  replayChanges,
  replayPlain,
  Selection,
  type EditorState,
  type HistoryKind,
  type RecordedChange,
  type Transaction,
} from '@alloy-works/editor';

import type { Clock } from './session.js';

/**
 * What a window keeps of one component's editing session so that a reload loses nothing and undo
 * survives it (component-editor.md, "Undo across a reload"; W11.3): who it was kept for, the version
 * the session opened from and the document at that point, every change since with the history's
 * grouping, the latest values, and the last sequence sent.
 *
 * Pure of React and of the view: the component editor feeds it what its surface applies, and asks it
 * on a reload what there is to go on from.
 */
export interface StoredSession {
  /** How the record is written: one kept by a build that wrote it otherwise is never replayed. */
  readonly format: typeof STORED_FORMAT;
  /** The model's identity it was kept under (`editorSchemaIdentity`), for the same reason. */
  readonly schema: string;
  /** The principal it was kept for: nobody else signed in on the same tab is given it (D2). */
  readonly principal: string;
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
  readonly sent: Sent;
}

/** A sequence sent, and the revision of the record it carried. */
export interface Sent {
  readonly sequence: number;
  readonly revision: number;
}

/** Bumped whenever the record is written otherwise, so an older build's is offered, not replayed. */
export const STORED_FORMAT = 2;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** Every key the editor keeps in session storage starts with this (final review of W11.3, D2). */
const EDITING_PREFIX = 'alloy-works:editing-';

/** Where it is kept, one per component per window, beside the session's id. */
const STEPS_PREFIX = `${EDITING_PREFIX}steps:`;
const keyFor = (componentId: string) => `${STEPS_PREFIX}${componentId}`;

/**
 * The last sequence sent under one session of one component, only ever rising, and written whenever a
 * save is sent - after the page has gone as well as before - so a page's last save, sent as it goes,
 * is never taken on the next page for a save somebody else made (final review of W11.3, D1).
 */
const sentKeyFor = (componentId: string, session: string) =>
  `${EDITING_PREFIX}sent:${componentId}:${session}`;

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

const isSent = (value: unknown): value is Sent =>
  isObject(value) && isCount(value.sequence) && isCount(value.revision);

/**
 * A kept session, or null for anything that is not one written as this build writes it: text that is
 * not JSON, JSON of another shape, or a record of another format or model. Whether its changes replay
 * is `replayStored`'s question, not this one's.
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
    read.format !== STORED_FORMAT ||
    read.schema !== editorSchemaIdentity ||
    typeof read.principal !== 'string' ||
    typeof read.session !== 'string' ||
    !LOWERCASE_UUID.test(read.session) ||
    typeof read.version !== 'string' ||
    !isObject(read.doc) ||
    !Array.isArray(read.changes) ||
    !read.changes.every(isChange) ||
    !isObject(read.values) ||
    !isCount(read.revision) ||
    !isSent(read.sent)
  ) {
    return null;
  }
  return read as unknown as StoredSession;
}

const storeOf = (storage?: Store): Store => storage ?? globalThis.sessionStorage;

/** What this window keeps for a component, or null: none, none that parses, or no storage at all. */
export function readStoredSession(componentId: string, storage?: Store): StoredSession | null {
  try {
    // Resolved inside the try: reading `sessionStorage` itself can throw where access is denied.
    return parseStoredSession(storeOf(storage).getItem(keyFor(componentId)));
  } catch {
    return null;
  }
}

/** Forgets what this window keeps for a component; never throws. */
export function forgetStoredSession(componentId: string, storage?: Store): void {
  try {
    storeOf(storage).removeItem(keyFor(componentId));
  } catch {
    // Nothing kept, or nothing that can be reached: either way there is nothing to replay.
  }
}

/** Every paragraph's text, one to a line, as the editor offers text it could not save. */
function textOfDoc(doc: EditorState['doc']): string {
  const lines: string[] = [];
  doc.forEach((block) => lines.push(block.textContent));
  return lines.join('\n');
}

/**
 * What a record had on screen, as text to copy, where it will not replay as a history: its document
 * with every step it keeps applied, in order, with no history (final review of W11.3, D5). Null where
 * it holds no document this model reads or a step does not apply.
 */
export function textOfKept(record: unknown): string | null {
  if (!isObject(record) || !isObject(record.doc) || !Array.isArray(record.changes)) return null;
  if (!record.changes.every(isChange)) return null;
  try {
    const doc = editorSchema.nodeFromJSON(record.doc);
    doc.check();
    return textOfDoc(replayPlain(doc, record.changes));
  } catch {
    return null;
  }
}

/**
 * What this window keeps for a component, for `principal`: a record to replay; or, kept by a build
 * that wrote it otherwise, only its text to copy, if any can be read (D5); or null, where nothing is
 * kept, or what is kept is somebody else's - another author signed in on the same tab (D2). Anything
 * not given back to replay is forgotten.
 */
export type Kept =
  | { readonly readable: true; readonly session: StoredSession }
  | { readonly readable: false; readonly text: string | null };

export function readKept(componentId: string, principal: string, storage?: Store): Kept | null {
  let text: string | null;
  try {
    text = storeOf(storage).getItem(keyFor(componentId));
  } catch {
    return null;
  }
  if (text === null) return null;
  const session = parseStoredSession(text);
  if (session !== null && session.principal === principal) return { readable: true, session };
  forgetStoredSession(componentId, storage);
  if (session !== null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  // Only a record that says whose it is, and says this principal: never anybody else's text.
  if (!isObject(raw) || raw.principal !== principal) return null;
  return { readable: false, text: textOfKept(raw) };
}

/** The last sequence this window sent under a session, and its revision; null where none is kept. */
export function sentFor(componentId: string, session: string, storage?: Store): Sent | null {
  try {
    const read: unknown = JSON.parse(
      storeOf(storage).getItem(sentKeyFor(componentId, session)) ?? 'null',
    );
    return isSent(read) ? { sequence: read.sequence, revision: read.revision } : null;
  } catch {
    return null;
  }
}

/** Keeps `sent` as the last sent under the session, where it is later than what is kept. */
function keepSent(componentId: string, session: string, sent: Sent, storage?: Store) {
  const kept = sentFor(componentId, session, storage);
  if (kept !== null && kept.sequence >= sent.sequence) return;
  try {
    storeOf(storage).setItem(sentKeyFor(componentId, session), JSON.stringify(sent));
  } catch {
    // Unkept, a reload may take this page's own last save for somebody else's and go no further.
  }
}

/** A session with nothing changed yet, from `doc` at `version`, having sent up to `sequence`. */
export function freshSession(start: {
  readonly principal: string;
  readonly session: string;
  readonly version: string;
  readonly doc: EditorState['doc'];
  readonly values: Readonly<Record<string, unknown>>;
  readonly sequence: number;
}): StoredSession {
  return {
    format: STORED_FORMAT,
    schema: editorSchemaIdentity,
    principal: start.principal,
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
 * Where a reload goes on from, given the latest sequence the service has accepted from the session and
 * the last this window kept as sent under it (`sentFor`), which a page's last save, sent as it went,
 * leaves above the record's own: the larger of those, so the next save is judged above all of them;
 * whether anything is on screen the service has not got - anything changed since the last send, or a
 * last send it never accepted; and whether the service is **ahead**, holding a save under this session
 * that this window never sent - another page holding the same session, a duplicated tab - over which
 * nothing may be sent or resumed (final review of W11.3, D1).
 */
export function continuing(
  kept: StoredSession,
  latest: number | null,
  sentLater: Sent | null = null,
): { readonly sequence: number; readonly unsent: boolean; readonly ahead: boolean } {
  const accepted = latest ?? 0;
  const last =
    sentLater !== null && sentLater.sequence > kept.sent.sequence ? sentLater : kept.sent;
  return {
    sequence: Math.max(last.sequence, accepted),
    unsent: last.revision !== kept.revision || accepted !== last.sequence,
    ahead: accepted > last.sequence,
  };
}

/**
 * The state a reload opens the surface in: the kept document, checked as the model holds it, with
 * every change replayed onto it into a history of its own, in a state `fresh` makes with the surface's
 * plugins. Throws where the document is not one the model holds or a change does not replay exactly;
 * the caller then offers what it can read of it as text (`textOfKept`) and opens as a page opened
 * afresh does.
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
  /** A sequence was taken for a save of everything as it stands now: written at once. */
  sent(sequence: number): void;
  /** The session claimed afresh, under a new id, from which nothing has been sent. */
  rebind(session: string): void;
  /**
   * The surface was put back to `doc` with a fresh history - a version cut, a restore, a refused
   * claim - so nothing from before it may be replayed: the changes kept so far go.
   */
  reset(version: string, doc: EditorState['doc'], values: Readonly<Record<string, unknown>>): void;
  /** Writes now whatever is waiting to be written: the page is hidden, or about to go. */
  flush(): void;
  /**
   * The page is gone: what is waiting is written, and nothing it is told from here on is, so a save
   * its session queued as it went never writes an older record over the one the next page keeps -
   * though the sequence that save takes is still kept as sent under its session.
   */
  close(): void;
}

/** How long after a change the record is written: every keystroke is not worth a write (D4). */
export const KEEP_DELAY_MS = 300;

/**
 * Keeps `start` for `componentId`, writing it whole `delayMs` after the last change, and at once for a
 * send, a flush, a reset or a close - and writing nothing while nothing has changed, so a reader, or a
 * session back at its version, leaves nothing behind. A run of typing is kept as one change
 * (`mergeChange`), so a record grows with what the author did rather than with every key (D4).
 *
 * **Never throws.** Storage that is full first makes room by forgetting what is kept for other
 * components; storage still full, or refused, stops keeping anything until the next reset, and what
 * it held is removed: a record that stopped short of what is on screen would replay older text over
 * newer, which is worse than none. The document and each change are turned into JSON once, as they
 * arrive, so a write costs a join rather than a walk of the whole session.
 */
export function createRecorder(
  componentId: string,
  start: StoredSession,
  options: {
    readonly storage?: Store;
    readonly clock?: Pick<Clock, 'setTimeout' | 'clearTimeout'>;
    readonly delayMs?: number;
  } = {},
): Recorder {
  const key = keyFor(componentId);
  const { storage } = options;
  const clock = options.clock ?? {
    setTimeout: (run: () => void, ms: number) => globalThis.setTimeout(run, ms),
    clearTimeout: (handle: unknown) =>
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const delayMs = options.delayMs ?? KEEP_DELAY_MS;
  let kept = start;
  let docJson = JSON.stringify(start.doc);
  let changeJson = start.changes.map((change) => JSON.stringify(change));
  // The selection the last change left, which the next must start from to be merged into it.
  let leftAt: string | null = null;
  let stopped = false;
  let closed = false;
  let waiting: unknown = null;

  const forget = () => {
    try {
      storeOf(storage).removeItem(key);
    } catch {
      // As `forgetStoredSession`.
    }
  };
  /** Forgets every other component's kept session, answering whether there was any to forget. */
  const makeRoom = (): boolean => {
    try {
      const store = storeOf(storage);
      const others: string[] = [];
      for (let at = 0; at < store.length; at += 1) {
        const each = store.key(at);
        if (each !== null && each.startsWith(STEPS_PREFIX) && each !== key) others.push(each);
      }
      for (const each of others) store.removeItem(each);
      return others.length > 0;
    } catch {
      return false;
    }
  };
  const write = () => {
    if (waiting !== null) clock.clearTimeout(waiting);
    waiting = null;
    if (stopped || closed) return;
    if (kept.revision === 0) {
      forget();
      return;
    }
    const { format, schema, principal, session, version, values, revision, sent } = kept;
    const text =
      `{"format":${format},"schema":${JSON.stringify(schema)},` +
      `"principal":${JSON.stringify(principal)},"session":${JSON.stringify(session)},` +
      `"version":${JSON.stringify(version)},"values":${JSON.stringify(values)},` +
      `"revision":${revision},"sent":${JSON.stringify(sent)},` +
      `"doc":${docJson},"changes":[${changeJson.join(',')}]}`;
    try {
      storeOf(storage).setItem(key, text);
      return;
    } catch {
      // Full, most likely: other components' kept sessions go before this one stops keeping.
    }
    try {
      if (makeRoom()) {
        storeOf(storage).setItem(key, text);
        return;
      }
    } catch {
      // Still full, or refused: as below.
    }
    stopped = true;
    forget();
  };
  const later = () => {
    if (stopped || closed || waiting !== null) return;
    if (delayMs <= 0) {
      write();
      return;
    }
    waiting = clock.setTimeout(() => {
      waiting = null;
      write();
    }, delayMs);
  };
  write();

  return {
    applied(before, transactions, after) {
      const change = recordChange(before, transactions, after);
      if (change === null) return;
      const last = kept.changes.at(-1);
      const joined =
        last !== undefined && leftAt === JSON.stringify(change.selection)
          ? mergeChange(last, change)
          : null;
      leftAt = JSON.stringify(after.selection.toJSON());
      if (joined !== null) {
        kept = {
          ...kept,
          changes: [...kept.changes.slice(0, -1), joined],
          revision: kept.revision + 1,
        };
        changeJson[changeJson.length - 1] = JSON.stringify(joined);
      } else {
        kept = { ...kept, changes: [...kept.changes, change], revision: kept.revision + 1 };
        changeJson.push(JSON.stringify(change));
      }
      later();
    },
    values(values) {
      kept = { ...kept, values: { ...values }, revision: kept.revision + 1 };
      later();
    },
    sent(sequence) {
      kept = { ...kept, sent: { sequence, revision: kept.revision } };
      keepSent(componentId, kept.session, kept.sent, storage);
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
        principal: kept.principal,
        session: kept.session,
        version,
        doc,
        values,
        sequence: kept.sent.sequence,
      });
      docJson = JSON.stringify(kept.doc);
      changeJson = [];
      leftAt = null;
      stopped = false;
      write();
    },
    flush() {
      if (waiting !== null) write();
    },
    close() {
      if (waiting !== null) write();
      closed = true;
    },
  };
}
