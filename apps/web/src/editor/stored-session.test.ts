import {
  createEditorState,
  toEditor,
  type EditorState,
  type Transaction,
} from '@alloy-works/editor';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  continuing,
  createRecorder,
  freshSession,
  readStoredSession,
  replayStored,
  type StoredSession,
} from './stored-session.js';

const COMPONENT = '6a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';
const SESSION = '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b';
const OTHER = '5c4b3a29-1807-4f6e-9d5c-4b3a29180706';
const KEY = `alloy-works:editing-steps:${COMPONENT}`;

const counter = () => {
  let next = 0;
  return () => `n${(next += 1)}`;
};

function opened(text = 'Unbox the printer.') {
  const read = toEditor({
    schemaVersion: 1,
    title: 'Install the printer',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      { type: 'paragraph', id: 'b1', style: 'body', content: [{ type: 'text', value: text, marks: [] }] },
    ],
  });
  if (!read.editable) throw new Error('expected an editable document');
  return read.doc;
}

const fresh = (doc: EditorState['doc']) => createEditorState({ doc, newIdentifier: counter() });

/** A surface with a recorder on it, as the component editor runs one. */
function recording(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = sessionStorage) {
  const doc = opened();
  let state = fresh(doc);
  const recorder = createRecorder(
    COMPONENT,
    freshSession({ session: SESSION, version: 'v1', doc, values: { code: 'A1' }, sequence: 0 }),
    storage,
  );
  const apply = (tr: Transaction) => {
    const before = state;
    const { state: after, transactions } = state.applyTransaction(tr);
    state = after;
    recorder.applied(before, transactions, after);
  };
  return {
    recorder,
    doc,
    get state() {
      return state;
    },
    type: (text: string, pos: number, time: number) =>
      apply(state.tr.insertText(text, pos).setTime(time)),
  };
}

beforeEach(() => sessionStorage.clear());
afterEach(() => sessionStorage.clear());

describe('the session kept for a reload (component-editor.md, "Undo across a reload")', () => {
  it('keeps nothing until something changes, so a reader leaves nothing behind', () => {
    sessionStorage.setItem(KEY, 'left over');
    recording();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('keeps the version and document opened from, every change with its grouping, the values and the last sequence sent', () => {
    const live = recording();
    live.type(' Mind', 19, 1_000);
    live.type(' the cable.', 24, 1_100);
    live.recorder.sent(4);
    live.recorder.values({ code: 'B2' });
    live.type(' Then wait.', 35, 9_000);

    const kept = readStoredSession(COMPONENT)!;
    expect(kept).toMatchObject({
      session: SESSION,
      version: 'v1',
      doc: live.doc.toJSON(),
      values: { code: 'B2' },
      sent: { sequence: 4 },
    });
    expect(kept.changes.map((change) => change.history)).toEqual(['new', 'join', 'new']);
    // Something changed after the last sequence was sent: the values, and the last change.
    expect(continuing(kept, 4)).toEqual({ sequence: 4, unsent: true });
  });

  it('replays what it keeps into the document and the history the session had', () => {
    const live = recording();
    live.type(' Mind', 19, 1_000);
    live.type(' the cable.', 24, 1_100);
    live.type(' Then wait.', 35, 9_000);
    const again = replayStored(readStoredSession(COMPONENT)!, fresh);
    expect(again.doc.eq(live.state.doc)).toBe(true);
  });

  it('continues from the larger of the sequence it sent and the one the service accepted, sending only what the service has not got', () => {
    const live = recording();
    live.type(' Mind', 19, 1_000);
    live.recorder.sent(3);
    const kept = readStoredSession(COMPONENT)!;
    // The service has what was sent, and nothing has changed since.
    expect(continuing(kept, 3)).toEqual({ sequence: 3, unsent: false });
    // What was sent never arrived.
    expect(continuing(kept, 2)).toEqual({ sequence: 3, unsent: true });
    expect(continuing(kept, null)).toEqual({ sequence: 3, unsent: true });
    // The service holds a later save this window never sent, under the same session: continue past it.
    expect(continuing(kept, 7)).toEqual({ sequence: 7, unsent: true });
  });

  it('starts again from a new document and version, keeping nothing of what came before, when reset', () => {
    const live = recording();
    live.type(' Mind', 19, 1_000);
    expect(sessionStorage.getItem(KEY)).not.toBeNull();
    live.recorder.reset('v2', live.state.doc, { code: 'A1' });
    expect(sessionStorage.getItem(KEY)).toBeNull();
    live.type(' Then.', 24, 9_000);
    expect(readStoredSession(COMPONENT)).toMatchObject({
      version: 'v2',
      doc: expect.objectContaining({ type: 'doc' }),
    });
    expect(readStoredSession(COMPONENT)!.changes).toHaveLength(1);
  });

  it('follows the session to a new id, from which nothing has been sent', () => {
    const live = recording();
    live.type(' Mind', 19, 1_000);
    live.recorder.sent(5);
    live.recorder.rebind(OTHER);
    expect(readStoredSession(COMPONENT)).toMatchObject({ session: OTHER, sent: { sequence: 0 } });
    expect(continuing(readStoredSession(COMPONENT)!, null)).toEqual({ sequence: 0, unsent: true });
  });

  it('writes nothing it is told once closed, so a page that has gone never writes over the next', () => {
    const live = recording();
    live.type(' Mind', 19, 1_000);
    const before = sessionStorage.getItem(KEY);
    live.recorder.close();
    live.recorder.sent(9);
    live.type(' the cable.', 24, 9_000);
    live.recorder.values({ code: 'Z' });
    live.recorder.rebind(OTHER);
    live.recorder.reset('v2', live.state.doc, {});
    expect(sessionStorage.getItem(KEY)).toBe(before);
  });

  it('never throws: storage that is full or refused keeps nothing, and what it held is removed', () => {
    const held = new Map<string, string>([[KEY, 'something older']]);
    let full = false;
    const storage = {
      getItem: (key: string) => held.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        held.set(key, value);
      },
      removeItem: (key: string) => void held.delete(key),
    };
    const live = recording(storage);
    live.type(' Mind', 19, 1_000);
    expect(held.has(KEY)).toBe(true);
    full = true;
    expect(() => live.type(' the cable.', 24, 9_000)).not.toThrow();
    // A record that stopped short of what is on screen would replay older text: none is kept.
    expect(held.has(KEY)).toBe(false);
    expect(() => live.recorder.values({ code: 'C' })).not.toThrow();
    expect(held.has(KEY)).toBe(false);

    const refusing = {
      getItem: () => {
        throw new DOMException('Denied', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('Denied', 'SecurityError');
      },
      removeItem: () => {
        throw new DOMException('Denied', 'SecurityError');
      },
    };
    expect(readStoredSession(COMPONENT, refusing)).toBeNull();
    expect(() => recording(refusing).type(' Mind', 19, 1_000)).not.toThrow();
  });

  it('reads nothing from storage that does not parse, or is not a session it kept', () => {
    const live = recording();
    live.type(' Mind', 19, 1_000);
    const good = JSON.parse(sessionStorage.getItem(KEY)!) as Record<string, unknown>;
    const broken: unknown[] = [
      'not json',
      '[]',
      JSON.stringify({ ...good, session: 'not an id' }),
      JSON.stringify({ ...good, version: 3 }),
      JSON.stringify({ ...good, doc: null }),
      JSON.stringify({
        ...good,
        changes: [{ history: 'sideways', selection: null, transactions: [{ steps: [], held: true }] }],
      }),
      JSON.stringify({ ...good, changes: [{ history: 'new', selection: null, transactions: [{ steps: 'x', held: true }] }] }),
      JSON.stringify({ ...good, values: [] }),
      JSON.stringify({ ...good, revision: -1 }),
      JSON.stringify({ ...good, sent: { sequence: 1.5, revision: 0 } }),
    ];
    for (const each of broken) {
      sessionStorage.setItem(KEY, each as string);
      expect(readStoredSession(COMPONENT)).toBeNull();
    }
    sessionStorage.setItem(KEY, JSON.stringify(good));
    expect(readStoredSession(COMPONENT)).not.toBeNull();
  });

  it('refuses to replay a document the model does not hold, or changes that do not apply to it', () => {
    const live = recording();
    live.type(' Mind', 19, 1_000);
    const kept = readStoredSession(COMPONENT)!;
    // Text straight in the document, where the model holds blocks: refused though no change is kept.
    const notADocument: StoredSession = {
      ...kept,
      doc: { ...(kept.doc as object), content: [{ type: 'text', text: 'loose' }] },
      changes: [],
    };
    expect(() => replayStored(notADocument, fresh)).toThrow();
    const elsewhere: StoredSession = { ...kept, doc: opened('Unbox').toJSON() };
    expect(() => replayStored(elsewhere, fresh)).toThrow();
  });
});
