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
  claim(move: boolean): Promise<ClaimResult>;
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
  /** Set at the first failure since the last acknowledgement; says "failing" if nothing lands first. */
  let failing: unknown = null;
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

  const lose = (message: string) => {
    stopTimers();
    phase = 'lost';
    notice = message;
    publish();
  };

  /** Sends what the editor holds now, once; answers whether everything changed so far is acknowledged. */
  const send = async (): Promise<boolean> => {
    sequence += 1;
    const sent = sequence;
    dirty = false;
    save = 'saving';
    publish();
    const result = await service.save(sent, version.id, options.snapshot());
    if (disposed) return false;
    if (result.ok) {
      failures = 0;
      cancel(failing);
      failing = null;
      if (!dirty) {
        save = 'saved';
        savedAt = clock.now();
      }
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
      lose('This session no longer holds the component. Your unsaved text is kept below to copy.');
      return false;
    }
    if (
      (result.code === 'iteration_stale' || result.code === 'iteration_conflict') &&
      result.latest !== undefined &&
      result.latest >= sent
    ) {
      // The service is ahead of this page - a reload of the same window starts counting again - so
      // the whole snapshot goes again at once, above what the service already holds (component-editor.md,
      // "Undo across a reload": the service's record is never overwritten by an older local one).
      sequence = result.latest;
      dirty = true;
      return send();
    }
    // Held, not lost: the next attempt sends everything again under a higher sequence.
    dirty = true;
    failures += 1;
    failing ??= clock.setTimeout(() => {
      save = 'failing';
      notice = 'Not saved. Retrying.';
      publish();
    }, timing.failingMs);
    publish();
    const wait = Math.min(30_000, timing.retryMs * 2 ** (failures - 1));
    retry = clock.setTimeout(() => {
      retry = null;
      void flush();
    }, wait);
    return false;
  };

  const flush = async (): Promise<boolean> => {
    cancel(idle);
    cancel(continuous);
    idle = continuous = null;
    while (inFlight) await inFlight;
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

  const claim = async (move: boolean) => {
    phase = 'claiming';
    holder = null;
    notice = 'Starting to edit.';
    publish();
    let timer: unknown = null;
    const timedOut = new Promise<ClaimResult>((resolve) => {
      timer = clock.setTimeout(() => resolve({ ok: false, code: 'failed' }), timing.claimMs);
    });
    const result = await Promise.race([service.claim(move), timedOut]);
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
    const flushed = await flush();
    if (disposed) return;
    if (!flushed && (phase as Phase) === 'lost') return;
    if (!flushed) {
      phase = 'editing';
      notice = 'Not saved, so no version was made.';
      publish();
      return;
    }
    const result = await request(version.id);
    if (disposed) return;
    if (!result.ok) {
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
    phase = during === 'releasing' ? 'reading' : 'editing';
    publish();
    if (dirty && phase === 'editing') schedule();
  };

  return {
    changed() {
      if (phase === 'lost' || disposed) return;
      dirty = true;
      save = 'saving';
      if (phase === 'reading') {
        void claim(false);
        return;
      }
      publish();
      if (phase === 'editing') schedule();
    },
    saveVersion: () => finish('cutting', (openedFrom) => service.cut(openedFrom)),
    doneEditing: () => finish('releasing', (openedFrom) => service.release(openedFrom)),
    claimAgain(move) {
      if (phase === 'reading') void claim(move);
    },
    view,
    dispose() {
      disposed = true;
      stopTimers();
    },
  };
}
