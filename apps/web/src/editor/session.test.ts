import type { ContentDocument } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import {
  createSession,
  designTiming,
  type Clock,
  type ClaimResult,
  type CutResult,
  type Holder,
  type SaveResult,
  type SessionService,
  type SessionView,
  type VersionRef,
} from './session.js';

/** A clock that moves only when told, running what falls due in order. */
class FakeClock implements Clock {
  private time = 0;
  private next = 1;
  private readonly timers = new Map<number, { at: number; run: () => void }>();

  now() {
    return this.time;
  }
  setTimeout(run: () => void, ms: number) {
    const handle = this.next++;
    this.timers.set(handle, { at: this.time + ms, run });
    return handle;
  }
  clearTimeout(handle: unknown) {
    this.timers.delete(handle as number);
  }
  /** Moves time on, a timer at a time, letting every promise settle between them. */
  async advance(ms: number) {
    const until = this.time + ms;
    for (;;) {
      await settle();
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= until)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.time = due[1].at;
      due[1].run();
    }
    this.time = until;
    await settle();
  }
}

const settle = async () => {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
};

/** The service, hand-written: records what was asked and answers what it is told to. */
class FakeService implements SessionService {
  readonly calls: string[] = [];
  readonly saved: { sequence: number; openedFrom: string; text: string }[] = [];
  claimAnswer: () => Promise<ClaimResult> = async () => ({ ok: true });
  saveAnswer: () => Promise<SaveResult> = async () => ({ ok: true });
  cutAnswer: (openedFrom: string) => Promise<CutResult> = async () => ({
    ok: true,
    outcome: 'cut',
    version: { id: 'v2', number: '0.2' },
  });

  async claim(move: boolean) {
    this.calls.push(move ? 'claim, moving' : 'claim');
    return this.claimAnswer();
  }
  async save(sequence: number, openedFrom: string, content: ContentDocument) {
    this.calls.push(`save ${sequence}`);
    const paragraph = content.content[0];
    const text =
      paragraph?.type === 'paragraph'
        ? paragraph.content.map((inline) => (inline.type === 'text' ? inline.value : '')).join('')
        : '';
    this.saved.push({ sequence, openedFrom, text });
    return this.saveAnswer();
  }
  async cut(openedFrom: string) {
    this.calls.push(`cut from ${openedFrom}`);
    return this.cutAnswer(openedFrom);
  }
  async release(openedFrom: string) {
    this.calls.push(`release from ${openedFrom}`);
    return this.cutAnswer(openedFrom);
  }
}

function harness() {
  const clock = new FakeClock();
  const service = new FakeService();
  let text = 'Unbox the printer.';
  const views: SessionView[] = [];
  const refused: Holder[] = [];
  const versions: VersionRef[] = [];
  const session = createSession({
    service,
    clock,
    timing: designTiming,
    version: { id: 'v1', number: '0.1' },
    snapshot: () => ({
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
    }),
    onChange: (view) => views.push(view),
    onRefused: (holder) => refused.push(holder),
    onVersion: (version) => versions.push(version),
  });
  const type = (next: string) => {
    text = next;
    session.changed();
  };
  return { clock, service, session, type, views, refused, versions };
}

describe('the editing session', () => {
  it('claims the lock with the first change, and starts editing when it is granted', async () => {
    const { clock, service, session, type } = harness();
    expect(session.view().phase).toBe('reading');
    type('Unbox');
    expect(session.view().phase).toBe('claiming');
    await clock.advance(0);
    expect(service.calls).toEqual(['claim']);
    expect(session.view().phase).toBe('editing');
  });

  it('CNT-066 saves changes as an iteration after a pause, without the author doing anything', async () => {
    const { clock, service, session, type } = harness();
    type('Unbox');
    await clock.advance(1_999);
    expect(service.saved).toEqual([]);
    await clock.advance(1);
    expect(service.saved).toEqual([{ sequence: 1, openedFrom: 'v1', text: 'Unbox' }]);
    expect(session.view()).toMatchObject({ save: 'saved', savedAt: 2_000 });
  });

  it('saves at least every ten seconds while changes keep coming', async () => {
    const { clock, service, type } = harness();
    for (let second = 1; second <= 12; second += 1) {
      type(`Unbox ${second}`);
      await clock.advance(1_000);
    }
    expect(service.saved[0]).toEqual({ sequence: 1, openedFrom: 'v1', text: 'Unbox 10' });
  });

  it('sends one iteration at a time, and every sequence is higher than the last', async () => {
    const { clock, service, type } = harness();
    let answer: (result: SaveResult) => void = () => {};
    service.saveAnswer = () => new Promise((resolve) => (answer = resolve));
    type('Unbox');
    await clock.advance(2_000);
    type('Unbox the');
    await clock.advance(2_000);
    expect(service.calls.filter((call) => call.startsWith('save'))).toEqual(['save 1']);
    service.saveAnswer = async () => ({ ok: true });
    answer({ ok: true });
    await clock.advance(2_000);
    expect(service.saved.map((each) => [each.sequence, each.text])).toEqual([
      [1, 'Unbox'],
      [2, 'Unbox the'],
    ]);
  });

  it('CNT-070 cuts a version only when asked, never from a keystroke or the passage of time', async () => {
    const { clock, service, session, type } = harness();
    for (let change = 0; change < 30; change += 1) {
      type(`Change ${change}`);
      await clock.advance(700);
    }
    await clock.advance(60 * 60_000);
    expect(service.calls.some((call) => call.startsWith('cut') || call.startsWith('release'))).toBe(
      false,
    );
    await session.saveVersion();
    expect(service.calls.filter((call) => call.startsWith('cut'))).toEqual(['cut from v1']);
    expect(session.view()).toMatchObject({
      phase: 'editing',
      version: { id: 'v2', number: '0.2' },
      notice: 'Version 0.2 saved.',
    });
  });

  it('flushes unsaved changes before cutting, and cuts nothing when they cannot be saved', async () => {
    const { clock, service, session, type } = harness();
    type('Unbox');
    await clock.advance(0);
    service.saveAnswer = async () => ({ ok: false, code: 'failed' });
    await session.saveVersion();
    expect(service.calls).toEqual(['claim', 'save 1']);
    expect(session.view()).toMatchObject({
      phase: 'editing',
      notice: 'Not saved, so no version was made.',
    });
  });

  it('releases the lock on Done editing, and tells the component which version it now shows', async () => {
    const { clock, service, session, type, versions } = harness();
    type('Unbox');
    await clock.advance(0);
    await session.doneEditing();
    expect(service.calls).toEqual(['claim', 'save 1', 'release from v1']);
    expect(session.view().phase).toBe('reading');
    expect(versions).toEqual([{ id: 'v2', number: '0.2' }]);
  });

  it('says so when there is nothing to cut, which is not a failure', async () => {
    const { clock, service, session, type } = harness();
    service.cutAnswer = async () => ({
      ok: true,
      outcome: 'unchanged',
      version: { id: 'v1', number: '0.1' },
    });
    type('Unbox the printer.');
    await clock.advance(0);
    await session.saveVersion();
    expect(session.view()).toMatchObject({
      phase: 'editing',
      notice: 'Nothing has changed since version 0.1.',
    });
  });

  it('returns to reading when the claim is refused, naming the holder, and saves nothing', async () => {
    const { clock, service, session, type, refused } = harness();
    const holder = { name: 'Grace', expectedRelease: '2026-09-16T12:15:00.000Z', yours: false };
    service.claimAnswer = async () => ({ ok: false, code: 'lock_held', holder });
    type('Unbox');
    await clock.advance(30_000);
    expect(session.view()).toMatchObject({
      phase: 'reading',
      holder,
      notice: 'Grace is editing this component.',
    });
    expect(refused).toEqual([holder]);
    expect(service.saved).toEqual([]);
  });

  it('treats a claim with no answer in ten seconds as a refusal to retry', async () => {
    const { clock, service, session, type } = harness();
    service.claimAnswer = () => new Promise(() => {});
    type('Unbox');
    await clock.advance(9_999);
    expect(session.view().phase).toBe('claiming');
    await clock.advance(1);
    expect(session.view()).toMatchObject({
      phase: 'reading',
      notice: 'Could not start editing. Try again.',
    });
    service.claimAnswer = async () => ({ ok: true });
    session.claimAgain(false);
    await clock.advance(0);
    expect(session.view().phase).toBe('editing');
  });

  it('keeps retrying a failing save, and says so once it has failed for ten seconds', async () => {
    const { clock, service, session, type } = harness();
    service.saveAnswer = async () => ({ ok: false, code: 'failed' });
    type('Unbox');
    await clock.advance(2_000);
    expect(session.view().save).toBe('saving');
    await clock.advance(10_000);
    expect(session.view()).toMatchObject({ save: 'failing', notice: 'Not saved. Retrying.' });
    service.saveAnswer = async () => ({ ok: true });
    await clock.advance(30_000);
    expect(session.view().save).toBe('saved');
    expect(service.saved.at(-1)).toMatchObject({ text: 'Unbox' });
    const sequences = service.saved.map((each) => each.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
  });

  it('sends again above the service when a reloaded window starts counting from one', async () => {
    const { clock, service, session, type } = harness();
    service.saveAnswer = async () => {
      const last = service.saved.at(-1)!;
      return last.sequence <= 7 ? { ok: false, code: 'iteration_stale', latest: 7 } : { ok: true };
    };
    type('Unbox');
    await clock.advance(2_000);
    expect(service.saved.map((each) => each.sequence)).toEqual([1, 8]);
    expect(session.view()).toMatchObject({ phase: 'editing', save: 'saved' });
  });

  it('stops, keeping the unsaved text, when a save finds the lock gone', async () => {
    const { clock, service, session, type } = harness();
    type('Unbox');
    await clock.advance(0);
    service.saveAnswer = async () => ({ ok: false, code: 'lock_held' });
    type('Unbox the printer');
    await clock.advance(2_000);
    expect(session.view()).toMatchObject({
      phase: 'lost',
      save: 'failing',
      notice:
        'This session no longer holds the component. Your unsaved text is kept below to copy.',
    });
    type('More');
    await clock.advance(60_000);
    expect(service.calls.filter((call) => call.startsWith('save'))).toEqual(['save 1']);
  });
});
