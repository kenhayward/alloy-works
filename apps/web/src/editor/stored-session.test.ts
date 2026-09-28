import {
  createEditorState,
  Selection,
  toEditor,
  type EditorState,
  type Transaction,
} from '@alloy-works/editor';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { forgetEditing } from './editing-storage.js';
import type { Clock } from './session.js';
import { editingSessionFor } from './service.js';
import {
  answerFor,
  continuing,
  createRecorder,
  forgetOffered,
  freshSession,
  keepOffered,
  offeredWith,
  readKept,
  readOffered,
  readStoredSession,
  replayStored,
  sentFor,
  textOfKept,
  type StoredSession,
} from './stored-session.js';

const COMPONENT = '6a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';
const SESSION = '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b';
const OTHER = '5c4b3a29-1807-4f6e-9d5c-4b3a29180706';
const KEY = `alloy-works:editing-steps:${COMPONENT}`;
const ADA = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const GRACE = 'f1e2d3c4-b5a6-4978-8899-aabbccddeeff';
const ANOTHER = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** Storage held in a map, as a hand-written fake: `limit` is how many characters it takes in all. */
function storageOf(
  limit = Infinity,
  held = new Map<string, string>(),
): Store & { held: Map<string, string> } {
  const size = () => [...held].reduce((sum, [key, value]) => sum + key.length + value.length, 0);
  return {
    held,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => {
      const without = size() - (held.has(key) ? key.length + held.get(key)!.length : 0);
      if (without + key.length + value.length > limit) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      held.set(key, value);
    },
    removeItem: (key) => void held.delete(key),
    key: (index) => [...held.keys()][index] ?? null,
    get length() {
      return held.size;
    },
  };
}

/** Time a test moves by hand. */
function clockOf() {
  let now = 0;
  const due: { at: number; run: () => void; handle: number }[] = [];
  let handles = 0;
  const clock: Clock = {
    now: () => now,
    setTimeout: (run, ms) => {
      handles += 1;
      due.push({ at: now + ms, run, handle: handles });
      return handles;
    },
    clearTimeout: (handle) => {
      const at = due.findIndex((each) => each.handle === handle);
      if (at !== -1) due.splice(at, 1);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const each of due.filter((one) => one.at <= now)) {
      due.splice(due.indexOf(each), 1);
      each.run();
    }
  };
  return { clock, advance };
}

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
      {
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [{ type: 'text', value: text, marks: [] }],
      },
    ],
  });
  if (!read.editable) throw new Error('expected an editable document');
  return read.doc;
}

const fresh = (doc: EditorState['doc']) => createEditorState({ doc, newIdentifier: counter() });

/** A session kept with nothing sent and nothing changed. */
const freshKept = () =>
  freshSession({
    principal: ADA,
    session: SESSION,
    version: 'v1',
    doc: opened(),
    values: {},
    sequence: 0,
  });

/**
 * A surface with a recorder on it, as the component editor runs one; writing at once unless a clock
 * and a delay are given.
 */
function recording(
  storage: Store = sessionStorage,
  timing: { clock?: Clock; delayMs?: number } = { delayMs: 0 },
) {
  const doc = opened();
  let state = fresh(doc);
  const recorder = createRecorder(
    COMPONENT,
    freshSession({
      principal: ADA,
      session: SESSION,
      version: 'v1',
      doc,
      values: { code: 'A1' },
      sequence: 0,
    }),
    { storage, ...timing },
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
    apply,
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
    live.recorder.accepted(4);
    live.recorder.values({ code: 'B2' });
    live.type(' Then wait.', 35, 9_000);

    const kept = readStoredSession(COMPONENT)!;
    expect(kept).toMatchObject({
      principal: ADA,
      session: SESSION,
      version: 'v1',
      doc: live.doc.toJSON(),
      values: { code: 'B2' },
      sent: { sequence: 4 },
    });
    // The second change joined the first, and was typed straight after it: kept as one (D4).
    expect(kept.changes.map((change) => change.history)).toEqual(['new', 'new']);
    expect(kept.revision).toBe(4);
    // Something changed after the last sequence was sent: the values, and the last change.
    expect(continuing(kept, 4, null, answerFor(COMPONENT, SESSION))).toEqual({
      sequence: 4,
      unsent: true,
      ahead: false,
    });
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
    live.recorder.accepted(3);
    const kept = readStoredSession(COMPONENT)!;
    // The service has what was sent, acknowledged to this window, and nothing has changed since.
    expect(continuing(kept, 3, null, answerFor(COMPONENT, SESSION))).toEqual({
      sequence: 3,
      unsent: false,
      ahead: false,
    });
    // What was sent never arrived.
    expect(continuing(kept, 2)).toEqual({ sequence: 3, unsent: true, ahead: false });
    expect(continuing(kept, null)).toEqual({ sequence: 3, unsent: true, ahead: false });
  });

  it('says where the service holds a later save under the session than this window ever sent', () => {
    const live = recording();
    live.type(' Mind', 19, 1_000);
    live.recorder.sent(3);
    const kept = readStoredSession(COMPONENT)!;
    // Another page holding the same session - a duplicated tab - saved past it: nothing goes on.
    expect(continuing(kept, 7)).toMatchObject({ ahead: true });
    // Unless it was this window's own last save, sent as its page went, after the record was closed,
    // and acknowledged to it once the page had gone.
    live.recorder.close();
    live.recorder.sent(7);
    expect(readStoredSession(COMPONENT)!.sent.sequence).toBe(3);
    expect(continuing(kept, 7, sentFor(COMPONENT, SESSION))).toMatchObject({ ahead: true });
    live.recorder.accepted(7);
    expect(continuing(kept, 7, sentFor(COMPONENT, SESSION), answerFor(COMPONENT, SESSION))).toEqual(
      { sequence: 7, unsent: false, ahead: false },
    );
    expect(
      continuing(kept, 8, sentFor(COMPONENT, SESSION), answerFor(COMPONENT, SESSION)),
    ).toMatchObject({ ahead: true });
  });

  it('takes a save the service holds at the number it last sent for somebody else unless the service acknowledged it to this window, and never where it refused it (re-review of W11.3, D1)', () => {
    const live = recording();
    live.type(' Mind', 19, 1_000);
    live.recorder.sent(3);
    const kept = () => readStoredSession(COMPONENT)!;
    const answer = () => answerFor(COMPONENT, SESSION);
    // Sent, and never answered: what the service holds at that number may be another page's.
    expect(continuing(kept(), 3, null, answer())).toMatchObject({ ahead: true });
    live.recorder.accepted(3);
    expect(continuing(kept(), 3, null, answer())).toEqual({
      sequence: 3,
      unsent: false,
      ahead: false,
    });
    // An answer to an earlier number says nothing of the last.
    live.recorder.sent(4);
    expect(continuing(kept(), 4, null, answer())).toMatchObject({ ahead: true });
    // Refused, as another page of the same session saved that number first: behind it, whatever the
    // service is asked or answers.
    live.recorder.refused(4);
    expect(continuing(kept(), 4, null, answer())).toMatchObject({ ahead: true });
    expect(continuing(kept(), null, null, answer())).toMatchObject({ ahead: true });
    // Nothing of the kind before anything is sent, or where the service has nothing yet.
    expect(continuing(freshKept(), 0, null, null)).toMatchObject({ ahead: false });
    expect(continuing(freshKept(), null, null, null)).toMatchObject({ ahead: false });
  });

  it('keeps the last answer to a save under a session only ever rising, written after the page has gone, and nothing once signed out', () => {
    const live = recording();
    live.type(' Mind', 19, 1_000);
    live.recorder.sent(4);
    live.recorder.close();
    live.recorder.accepted(4);
    expect(answerFor(COMPONENT, SESSION)).toEqual({ sequence: 4, accepted: true });
    live.recorder.accepted(3);
    live.recorder.refused(2);
    expect(answerFor(COMPONENT, SESSION)).toEqual({ sequence: 4, accepted: true });
    live.recorder.refused(5);
    expect(answerFor(COMPONENT, SESSION)).toEqual({ sequence: 5, accepted: false });
    expect(answerFor(COMPONENT, OTHER)).toBeNull();
    sessionStorage.setItem(`alloy-works:editing-acked:${COMPONENT}:${OTHER}`, '{"sequence":-1}');
    expect(answerFor(COMPONENT, OTHER)).toBeNull();

    forgetEditing();
    expect(answerFor(COMPONENT, SESSION)).toBeNull();
    live.recorder.accepted(6);
    expect(answerFor(COMPONENT, SESSION)).toBeNull();
  });

  it('keeps the last sequence sent under a session only ever rising, whatever sends it', () => {
    const live = recording();
    live.type(' Mind', 19, 1_000);
    live.recorder.sent(4);
    expect(sentFor(COMPONENT, SESSION)).toEqual({ sequence: 4, revision: 1 });
    sessionStorage.setItem(
      `alloy-works:editing-sent:${COMPONENT}:${SESSION}`,
      '{"sequence":9,"revision":1}',
    );
    live.recorder.sent(5);
    expect(sentFor(COMPONENT, SESSION)).toEqual({ sequence: 9, revision: 1 });
    expect(sentFor(COMPONENT, OTHER)).toBeNull();
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
    expect(continuing(readStoredSession(COMPONENT)!, null)).toEqual({
      sequence: 0,
      unsent: true,
      ahead: false,
    });
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
    const storage = storageOf(Infinity, new Map([[KEY, 'something older']]));
    const { held } = storage;
    const live = recording(storage);
    live.type(' Mind', 19, 1_000);
    expect(held.has(KEY)).toBe(true);
    // Full, with nothing of any other component's to make room.
    storage.setItem = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
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
      key: () => {
        throw new DOMException('Denied', 'SecurityError');
      },
      get length(): number {
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
        changes: [
          { history: 'sideways', selection: null, transactions: [{ steps: [], held: true }] },
        ],
      }),
      JSON.stringify({
        ...good,
        changes: [{ history: 'new', selection: null, transactions: [{ steps: 'x', held: true }] }],
      }),
      JSON.stringify({ ...good, values: [] }),
      JSON.stringify({ ...good, revision: -1 }),
      JSON.stringify({ ...good, sent: { sequence: 1.5, revision: 0 } }),
    ];
    broken.push(
      JSON.stringify({ ...good, principal: undefined }),
      JSON.stringify({ ...good, format: 0 }),
      JSON.stringify({ ...good, schema: 'another model' }),
    );
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

  it('gives what it keeps only to whom it was kept for, forgetting it for anybody else', () => {
    const live = recording();
    live.type(' Mind', 19, 1_000);
    expect(readKept(COMPONENT, ADA)).toMatchObject({
      readable: true,
      session: { session: SESSION },
    });
    expect(readKept(COMPONENT, GRACE)).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(readKept(COMPONENT, ADA)).toBeNull();
  });

  it('gives what an older build kept as text to copy, never to replay, and forgets it', () => {
    const live = recording();
    live.type(' Mind', 19, 1_000);
    const good = JSON.parse(sessionStorage.getItem(KEY)!) as Record<string, unknown>;
    sessionStorage.setItem(KEY, JSON.stringify({ ...good, format: 0 }));
    expect(readKept(COMPONENT, ADA)).toEqual({ readable: false, text: 'Unbox the printer. Mind' });
    expect(sessionStorage.getItem(KEY)).toBeNull();
    // Nothing for somebody else, and nothing where not even the steps apply.
    sessionStorage.setItem(KEY, JSON.stringify({ ...good, schema: 'another model' }));
    expect(readKept(COMPONENT, GRACE)).toBeNull();
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ ...good, format: 0, doc: opened('Unbox').toJSON() }),
    );
    expect(readKept(COMPONENT, ADA)).toEqual({ readable: false, text: null });
    expect(textOfKept({ ...good, doc: null })).toBeNull();
  });

  it('writes a moment after a change, once for every change in that moment, and at once for a send, a flush or a close', () => {
    const { clock, advance } = clockOf();
    const live = recording(sessionStorage, { clock, delayMs: 300 });
    live.type(' Mind', 19, 1_000);
    expect(sessionStorage.getItem(KEY)).toBeNull();
    advance(200);
    live.type(' the', 24, 1_100);
    expect(sessionStorage.getItem(KEY)).toBeNull();
    advance(100);
    expect(readStoredSession(COMPONENT)!.revision).toBe(2);

    live.type(' cable.', 28, 1_150);
    live.recorder.flush();
    expect(readStoredSession(COMPONENT)!.revision).toBe(3);
    live.recorder.values({ code: 'B2' });
    live.recorder.sent(1);
    expect(readStoredSession(COMPONENT)).toMatchObject({ revision: 4, values: { code: 'B2' } });
    live.type(' Then.', 35, 9_000);
    live.recorder.close();
    expect(readStoredSession(COMPONENT)!.revision).toBe(5);
    advance(1_000);
    expect(readStoredSession(COMPONENT)!.revision).toBe(5);
  });

  it("makes room by forgetting another component's kept session before it stops keeping", () => {
    const other = `alloy-works:editing-steps:${ANOTHER}`;
    // Room for another component's session and this one's first change, but not its third.
    const storage = storageOf(
      2_000,
      new Map([
        [other, 'x'.repeat(1_000)],
        ['alloy-works:theme', 'dark'],
      ]),
    );
    const live = recording(storage);
    live.type(' Mind the cable.', 19, 1_000);
    live.type(' Keep the box.', 35, 9_000);
    live.type(' Then wait.', 49, 20_000);
    expect(storage.held.has(other)).toBe(false);
    expect(storage.held.get('alloy-works:theme')).toBe('dark');
    expect(readStoredSession(COMPONENT, storage)!.changes).toHaveLength(3);
  });

  it('keeps a run of typing as one change, which replays into the same document', () => {
    const live = recording();
    live.type(' M', 19, 1_000);
    live.type('i', 21, 1_050);
    live.type('nd', 22, 1_100);
    const kept = readStoredSession(COMPONENT)!;
    expect(kept.changes).toHaveLength(1);
    expect(kept.revision).toBe(3);
    expect(replayStored(kept, fresh).doc.eq(live.state.doc)).toBe(true);
  });

  it('gives the text offered on opening only to whom it was offered, until it is dismissed', () => {
    keepOffered(COMPONENT, ADA, 'Unbox the printer. Mind the cable.');
    expect(readOffered(COMPONENT, ADA)).toBe('Unbox the printer. Mind the cable.');
    expect(readOffered(COMPONENT, GRACE)).toBeNull();
    // Forgotten for anybody else, as a kept record is.
    expect(readOffered(COMPONENT, ADA)).toBeNull();
    keepOffered(COMPONENT, ADA, 'Kept.');
    forgetOffered(COMPONENT);
    expect(readOffered(COMPONENT, ADA)).toBeNull();
    // And offered again beside itself, by a page opened twice over the same record, only once.
    expect(offeredWith('One.', 'Two.')).toBe('One.\n\nTwo.');
    expect(offeredWith('One.\n\nTwo.', 'Two.')).toBe('One.\n\nTwo.');
    expect(offeredWith(null, 'Two.')).toBe('Two.');
    expect(offeredWith('One.', null)).toBe('One.');
  });

  it('writes nothing more once the author has signed out: not a write pending then, a send, nor the flush as the page goes', () => {
    const { clock, advance } = clockOf();
    const live = recording(sessionStorage, { clock, delayMs: 300 });
    live.type(' Mind', 19, 1_000);
    forgetEditing();
    advance(300);
    live.recorder.sent(1);
    live.type(' the', 24, 1_100);
    live.recorder.flush();
    live.recorder.close();
    advance(1_000);
    // Nor a session id, should a component open before the page goes.
    expect(editingSessionFor(COMPONENT, () => false)).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys({ ...sessionStorage })).toEqual([]);
  });

  it('keeps typing as a change of its own where the caret moved before it, so the replay leaves the caret where it was', () => {
    const live = recording();
    live.type(' Mi', 19, 1_000);
    // The caret moved, with nothing typed, and then typing beside the last: the history joins them.
    live.apply(live.state.tr.setSelection(Selection.near(live.state.doc.resolve(5))));
    live.type('nd', 22, 1_050);
    const kept = readStoredSession(COMPONENT)!;
    expect(kept.changes.map((change) => change.history)).toEqual(['new', 'join']);
    const again = replayStored(kept, fresh);
    expect(again.doc.eq(live.state.doc)).toBe(true);
    expect(again.selection.eq(live.state.selection)).toBe(true);
  });
});
