import type { ContentDocument } from '@alloy-works/domain';

/** Who holds a component, as a refusal names them. */
export interface Holder {
  readonly name: string | null;
  readonly expectedRelease: string;
  /** The caller themselves, from another window. */
  readonly yours: boolean;
}

/** A version as the session needs it: which one it opened from, and how to name it. */
export interface VersionRef {
  readonly id: string;
  readonly number: string;
}

export type ClaimResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'lock_held'; readonly holder: Holder }
  | { readonly ok: false; readonly code: 'failed' };

export type SaveResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        | 'lock_held'
        | 'lock_required'
        | 'version_precondition'
        | 'iteration_stale'
        | 'iteration_conflict'
        | 'failed';
      /** For a stale or conflicting sequence: the latest the service has accepted from this session. */
      readonly latest?: number;
    };

export type CutResult =
  | { readonly ok: true; readonly outcome: 'cut' | 'unchanged'; readonly version: VersionRef }
  | { readonly ok: false; readonly code: string };

/**
 * The service as a session sees it: four writes, each carrying the session's own identity, which the
 * adapter adds. A hand-written fake stands in for it in tests.
 */
export interface SessionService {
  /**
   * `fresh` (fix round 2, finding 2): true asks the adapter to discard whatever session id it is
   * currently claiming under and mint a new one before claiming, because the id this call would
   * otherwise reuse has already been told by the service that it is behind - an `iteration_stale` or
   * `iteration_conflict` refusal - and reusing it would go stale again under the very same sequence,
   * forever. Only this module's stale-lost recovery ever passes `true`; every other call - the first
   * claim, a retry after a claim timeout, the reclaim after a release races an edit onto the wire -
   * passes `false` and keeps the session id this call already holds.
   */
  claim(move: boolean, fresh: boolean): Promise<ClaimResult>;
  save(sequence: number, openedFrom: string, content: ContentDocument): Promise<SaveResult>;
  cut(openedFrom: string): Promise<CutResult>;
  release(openedFrom: string): Promise<CutResult>;
}

/** Time, given so that tests can move it. */
export interface Clock {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const browserClock: Clock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** component-editor.md, "The session": the states this slice has. Recovery is the next plan's. */
export type Phase = 'reading' | 'claiming' | 'editing' | 'cutting' | 'releasing' | 'lost';

/** CNT-068's three states. */
export type SaveState = 'saved' | 'saving' | 'failing';

export interface SessionView {
  readonly phase: Phase;
  readonly save: SaveState;
  /** When the latest acknowledged save arrived, or null before the first. */
  readonly savedAt: number | null;
  readonly version: VersionRef;
  /** Who holds the component, after a claim was refused. */
  readonly holder: Holder | null;
  /** What the author is told, once, through the live region. */
  readonly notice: string | null;
}

export interface Timing {
  /** An iteration after this long without a change: two seconds. */
  readonly idleMs: number;
  /** And at least this often during continuous typing: ten seconds. */
  readonly continuousMs: number;
  /** No answer to a claim in this long is a refusal to retry: ten seconds. */
  readonly claimMs: number;
  /** A save failing for this long says so: ten seconds. */
  readonly failingMs: number;
  /** The first retry's wait, doubling to at most thirty seconds. */
  readonly retryMs: number;
}

export const designTiming: Timing = {
  idleMs: 2_000,
  continuousMs: 10_000,
  claimMs: 10_000,
  failingMs: 10_000,
  retryMs: 2_000,
};

export interface SessionOptions {
  readonly service: SessionService;
  readonly clock: Clock;
  readonly timing: Timing;
  readonly version: VersionRef;
  /** The whole content as the editor holds it now, through `fromEditor`. */
  readonly snapshot: () => ContentDocument;
  readonly onChange: (view: SessionView) => void;
  /** A claim was refused: the held changes are the component's to undo and offer as text. */
  readonly onRefused: (holder: Holder) => void;
  /** A version was cut or the session opened from a new one: undo must not reach past it (CNT-103). */
  readonly onVersion: (version: VersionRef) => void;
}

export interface Session {
  /** A change was made to the content. The first one claims the lock (COL-005). */
  changed(): void;
  /** Save version: flush, then cut. Never runs on its own (CNT-070). */
  saveVersion(): Promise<void>;
  /** Done editing: flush, cut if anything changed, release. */
  doneEditing(): Promise<void>;
  /** Claim again after a refusal; `move` continues here when the holder is this author elsewhere. */
  claimAgain(move: boolean): void;
  view(): SessionView;
  dispose(): void;
}

const HELD = 'lock_held';

/**
 * The editing session, as a state machine over a service and a clock (component-editor.md, "The
 * session"). Pure of React and ProseMirror: the component calls `changed` after each change it applies,
 * and reads the view back.
 *
 * Saving follows "Saving": one iteration in flight at a time, sequence numbers only increasing, an
 * iteration after `idleMs` without a change or every `continuousMs` while changes continue, and a
 * failure retried with backoff while the changes stay held. Nothing here ever cuts a version except
 * `saveVersion` and `doneEditing` (CNT-070).
 */
export function createSession(options: SessionOptions): Session {
  const { service, clock, timing } = options;
  let phase: Phase = 'reading';
  let save: SaveState = 'saved';
  let savedAt: number | null = null;
  let version = options.version;
  let holder: Holder | null = null;
  let notice: string | null = null;

  let sequence = 0;
  let dirty = false;
  let inFlight: Promise<boolean> | null = null;
  let idle: unknown = null;
  let continuous: unknown = null;
  let retry: unknown = null;
  let failures = 0;
  /** Set at the first failure of a streak; fires once, announcing "failing". */
  let failing: unknown = null;
  /** True from the moment a streak is announced "failing" until a save next succeeds - so a retry's
   * own "saving" moment (send() resets it each attempt) never papers back over the indicator. */
  let hasFailed = false;
  /** Set when `lost` was entered because the service is ahead of this page (a stale or conflicting
   * sequence): the one case this slice lets the author recover from, by claiming afresh. A lock simply
   * gone stays unrecoverable here - Recovery is the next plan's. */
  let lostFromStale = false;
  let disposed = false;

  const view = (): SessionView => ({ phase, save, savedAt, version, holder, notice });
  const publish = () => {
    if (!disposed) options.onChange(view());
  };
  const cancel = (handle: unknown) => {
    if (handle !== null) clock.clearTimeout(handle);
  };
  const stopTimers = () => {
    cancel(idle);
    cancel(continuous);
    cancel(retry);
    cancel(failing);
    idle = continuous = retry = failing = null;
  };

  const lose = (message: string, fromStale = false) => {
    stopTimers();
    phase = 'lost';
    lostFromStale = fromStale;
    notice = message;
    publish();
  };

  /** "Kept to copy" is only true when there is something unsaved to copy (fix round 2, finding 7). */
  const lockGoneMessage = () =>
    dirty
      ? 'This session no longer holds the component. Your unsaved text is kept below to copy.'
      : 'This session no longer holds the component.';

  /** Sends what the editor holds now, once; answers whether everything changed so far is acknowledged. */
  const send = async (): Promise<boolean> => {
    if (disposed) return false;
    // Whenever an attempt starts, any backoff wait it grew out of is spent - never let a stale handle
    // linger to fire a redundant retry later (finding 3).
    cancel(retry);
    retry = null;
    sequence += 1;
    const sent = sequence;
    dirty = false;
    save = hasFailed ? 'failing' : 'saving';
    publish();
    let timer: unknown = null;
    const timedOut = new Promise<SaveResult>((resolve) => {
      timer = clock.setTimeout(() => resolve({ ok: false, code: 'failed' }), timing.claimMs);
    });
    const result = await Promise.race([
      service.save(sent, version.id, options.snapshot()),
      timedOut,
    ]);
    cancel(timer);
    if (disposed) return false;
    if (result.ok) {
      failures = 0;
      hasFailed = false;
      cancel(failing);
      failing = null;
      savedAt = clock.now();
      if (notice === 'Not saved. Retrying.' || notice === 'Not saved, so no version was made.') {
        notice = null;
      }
      save = dirty ? 'saving' : 'saved';
      publish();
      return !dirty;
    }
    if (
      result.code === HELD ||
      result.code === 'lock_required' ||
      result.code === 'version_precondition'
    ) {
      dirty = true;
      save = 'failing';
      lose(lockGoneMessage());
      return false;
    }
    if (result.code === 'iteration_stale' || result.code === 'iteration_conflict') {
      // The service already holds an iteration this page never sent - another window, or this same
      // window from before a reload - so sending the whole snapshot again over a raised sequence
      // would overwrite it. This holds regardless of whether the refusal named `latest`: climbing the
      // sequence by the ordinary retry backoff until it happens to clear whatever the service is
      // holding is the same overwrite, just arrived at by accident instead of by design (fix round 2,
      // finding 3). Nothing here can tell whether what is on screen is newer or older than what was
      // overwritten, so it stops rather than guess: the author is offered a fresh session, starting
      // from what is on screen now (component-editor.md, "Undo across a reload").
      dirty = true;
      save = 'failing';
      lose(
        'Newer text was saved from another window, or from before this page was reloaded. ' +
          'It is kept. Continuing starts a new session from what is on screen.',
        true,
      );
      return false;
    }
    // Held, not lost: the next attempt sends everything again under a higher sequence.
    dirty = true;
    failures += 1;
    failing ??= clock.setTimeout(() => {
      hasFailed = true;
      save = 'failing';
      notice = 'Not saved. Retrying.';
      publish();
    }, timing.failingMs);
    publish();
    const wait = Math.min(30_000, timing.retryMs * 2 ** (failures - 1));
    retry = clock.setTimeout(() => {
      retry = null;
      void flush(true);
    }, wait);
    return false;
  };

  /**
   * `force` bypasses a backoff already under way - the deliberate action a caller takes (a save
   * flushed before a cut, the backoff's own timer firing) tries now rather than waiting out someone
   * else's wait. Without it, idle and continuous firing during a backoff would each start a parallel
   * attempt of their own, defeating the backoff entirely (finding 3).
   */
  const flush = async (force = false): Promise<boolean> => {
    cancel(idle);
    cancel(continuous);
    idle = continuous = null;
    // The backoff check happens after waiting on whatever is already in flight, not before: an
    // attempt already under way can fail while this call is waiting on it and arm its own retry - a
    // check made before the wait would be checking a `retry` that did not exist yet (fix round 2,
    // finding 5).
    while (inFlight) await inFlight;
    if (disposed) return false;
    if (!force && retry !== null) return false;
    if (!dirty) return save === 'saved';
    if (phase !== 'editing' && phase !== 'cutting' && phase !== 'releasing') return false;
    inFlight = send();
    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  };

  const schedule = () => {
    cancel(idle);
    idle = clock.setTimeout(() => void flush(), timing.idleMs);
    continuous ??= clock.setTimeout(() => {
      continuous = null;
      void flush();
    }, timing.continuousMs);
  };

  const claim = async (move: boolean, fresh: boolean) => {
    phase = 'claiming';
    holder = null;
    notice = 'Starting to edit.';
    // The sequence belongs to the session id, not to this call: the id survives Done editing within
    // the same window (decision 14), and the service keeps the latest sequence it has accepted per
    // artifact, principal and session - a release does not reset it (packages/db/src/editing.ts).
    // Resetting it on every claim, as round 1 and round 2 did, sent every second edit in a window, and
    // the reclaim after a release, in under a sequence the service had already passed - answered
    // `iteration_stale`/`iteration_conflict` and lost the session on a false "newer text" notice (fix
    // round 3, the critical finding). Only a fresh claim - a genuinely new session id, because the old
    // one just went stale - starts the count over; a reload already starts a session at 0 on its own,
    // so reload detection needs no help from this reset. The failure streak and its backoff are the
    // opposite: they are this session's own bookkeeping, not the service's, so they always start clean
    // on any claim (fix round 2, finding 6).
    if (fresh) sequence = 0;
    failures = 0;
    hasFailed = false;
    publish();
    let timer: unknown = null;
    const timedOut = new Promise<ClaimResult>((resolve) => {
      timer = clock.setTimeout(() => resolve({ ok: false, code: 'failed' }), timing.claimMs);
    });
    const result = await Promise.race([service.claim(move, fresh), timedOut]);
    cancel(timer);
    if (disposed) return;
    if (result.ok) {
      phase = 'editing';
      notice = 'You are editing this component.';
      publish();
      if (dirty) schedule();
      return;
    }
    phase = 'reading';
    dirty = false;
    save = 'saved';
    if (result.code === HELD) {
      holder = result.holder;
      notice = result.holder.yours
        ? 'You are editing this component in another window.'
        : `${result.holder.name ?? 'Someone else'} is editing this component.`;
      publish();
      options.onRefused(result.holder);
      return;
    }
    notice = 'Could not start editing. Try again.';
    publish();
    options.onRefused({ name: null, expectedRelease: '', yours: false });
  };

  const finish = async (
    during: 'cutting' | 'releasing',
    request: (openedFrom: string) => Promise<CutResult>,
  ) => {
    if (phase !== 'editing') return;
    phase = during;
    publish();
    // Flush to a standstill before asking for the cut or the release: a change that lands while this
    // loop is running - typing during the flush, or while a save from before is still in flight - is
    // sent too, rather than being reported as an unexplained failure or, for a release, abandoned
    // under a lock about to be given up (finding 4). `failures` tells a genuine failure (it climbs)
    // from a save that succeeded but left something new to send (it does not): only the latter loops.
    let flushed: boolean;
    for (;;) {
      const before = failures;
      flushed = await flush(true);
      if (disposed) return;
      if ((phase as Phase) === 'lost') return;
      if (flushed || failures > before || !dirty) break;
    }
    if (!flushed) {
      phase = 'editing';
      notice = 'Not saved, so no version was made.';
      publish();
      return;
    }
    const result = await request(version.id);
    if (disposed) return;
    if (!result.ok) {
      if (
        result.code === HELD ||
        result.code === 'lock_required' ||
        result.code === 'version_precondition'
      ) {
        lose(lockGoneMessage());
        return;
      }
      phase = 'editing';
      notice = 'The version could not be made.';
      publish();
      return;
    }
    const cut = result.outcome === 'cut';
    notice = cut
      ? `Version ${result.version.number} saved.`
      : `Nothing has changed since version ${result.version.number}.`;
    if (result.version.id !== version.id) {
      version = result.version;
      options.onVersion(version);
    }
    if (during === 'cutting') {
      phase = 'editing';
      publish();
      if (dirty) schedule();
      return;
    }
    if (!dirty) {
      phase = 'reading';
      publish();
      return;
    }
    // An edit landed while the release call was itself on the wire: the lock is gone, but there is
    // unsaved text on screen. Reclaim it at once - not fresh, this is the same session picking its own
    // lock back up, not recovering from a stale one - rather than stranding the edit in `reading` with
    // no lock and nothing left scheduled to save it (fix round 2, finding 4).
    phase = 'claiming';
    notice = 'Starting to edit.';
    publish();
    let reclaimTimer: unknown = null;
    const reclaimTimedOut = new Promise<ClaimResult>((resolve) => {
      reclaimTimer = clock.setTimeout(() => resolve({ ok: false, code: 'failed' }), timing.claimMs);
    });
    const reclaimed = await Promise.race([service.claim(false, false), reclaimTimedOut]);
    cancel(reclaimTimer);
    if (disposed) return;
    if (!reclaimed.ok) {
      lose(lockGoneMessage());
      return;
    }
    // Not fresh: this is the same session id picking its own lock back up, so its sequence continues
    // rather than resetting (fix round 3).
    failures = 0;
    hasFailed = false;
    phase = 'editing';
    notice = 'You are editing this component.';
    publish();
    schedule();
  };

  return {
    changed() {
      if (phase === 'lost' || disposed) return;
      dirty = true;
      // A live failure streak stays shown through a keystroke too - not just through send()'s own
      // attempts - or every keystroke during an outage paints "saving" over "failing" (fix round 2,
      // finding 2).
      save = hasFailed ? 'failing' : 'saving';
      if (phase === 'reading') {
        void claim(false, false);
        return;
      }
      publish();
      if (phase === 'editing' || phase === 'cutting' || phase === 'releasing') schedule();
    },
    saveVersion: () => finish('cutting', (openedFrom) => service.cut(openedFrom)),
    doneEditing: () => finish('releasing', (openedFrom) => service.release(openedFrom)),
    claimAgain(move) {
      if (phase === 'reading') void claim(move, false);
      else if (phase === 'lost' && lostFromStale) void claim(move, true);
    },
    view,
    dispose() {
      disposed = true;
      stopTimers();
    },
  };
}
