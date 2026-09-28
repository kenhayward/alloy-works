import type { ContentDocument } from '@alloy-works/domain';
import { heldSentence } from './held.js';

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

/**
 * A refusal no retry will change (final review, finding 2): the author is signed out (401), may no
 * longer edit the component (403), may no longer read it (404), or the service refused the request
 * itself (400, `content_invalid` for a save), which means a bug. Network errors and server errors are
 * `failed`, and retried.
 */
export type Refusal = 'signed_out' | 'forbidden' | 'not_found' | 'invalid';

const REFUSALS: readonly string[] = ['signed_out', 'forbidden', 'not_found', 'invalid'];

const isRefusal = (code: string): code is Refusal => REFUSALS.includes(code);

export type ClaimResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'lock_held'; readonly holder: Holder }
  | { readonly ok: false; readonly code: 'failed' | Refusal };

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
        | 'failed'
        | Refusal;
      /** For a stale or conflicting sequence: the latest the service has accepted from this session. */
      readonly latest?: number;
    };

export type CutResult =
  | { readonly ok: true; readonly outcome: 'cut' | 'unchanged'; readonly version: VersionRef }
  | { readonly ok: false; readonly code: string };

/** One of the author's own iterations, as the Recovery panel lists it: never its content (RC-E). */
export interface SavedIteration {
  readonly id: string;
  /** When the service accepted it, as the service wrote the time. */
  readonly savedAt: string;
  /** Saved from the session this page is editing under now, rather than another window's. */
  readonly thisWindow: boolean;
  /** The version the session that wrote it had opened. */
  readonly openedFrom: VersionRef;
}

/** Why reading iterations back was refused: the lock is not this session's, or as any refusal. */
type ReadRefusal = 'lock_held' | 'lock_required' | 'failed' | Refusal;

export type IterationPage =
  | {
      readonly ok: true;
      readonly items: readonly SavedIteration[];
      /** The cursor for the next page, older than these, or null at the end. */
      readonly next: string | null;
    }
  | { readonly ok: false; readonly code: ReadRefusal };

export type IterationRead =
  | {
      readonly ok: true;
      /** As stored: the component migrates and validates it before opening it (CNT-012, CNT-013). */
      readonly content: unknown;
      readonly values: Readonly<Record<string, unknown>>;
    }
  | { readonly ok: false; readonly code: ReadRefusal };

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
   *
   * `signal` (task 10, finding E): aborted the moment this call loses its race against
   * `timing.claimMs`, so an adapter over a real transport can cancel a request nothing is waiting on
   * any longer instead of letting it run to completion unread.
   */
  claim(move: boolean, fresh: boolean, signal?: AbortSignal): Promise<ClaimResult>;
  /**
   * `signal`: as `claim`'s - aborted when this save loses its race against `timing.claimMs`.
   * `values`: the component's values, whole, where the session holds them (definitions.md); absent,
   * the service keeps those of the version the session opened from.
   */
  save(
    sequence: number,
    openedFrom: string,
    content: ContentDocument,
    signal?: AbortSignal,
    values?: Readonly<Record<string, unknown>>,
  ): Promise<SaveResult>;
  /** Never raced against a timeout, so never carries a signal to abort. */
  cut(openedFrom: string): Promise<CutResult>;
  /** As `cut`'s. */
  release(openedFrom: string): Promise<CutResult>;
  /** The author's own retained iterations, newest first, a page at a time, under this session. */
  iterations(cursor?: string): Promise<IterationPage>;
  /** One of them, content and values. */
  iteration(id: string): Promise<IterationRead>;
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

/**
 * component-editor.md, "The session". `recovery` is Recovery as W11 builds it: the lock is held by
 * this session, and the author is choosing saved text to restore, or closing the list to go on
 * editing what is on screen. The surface takes no change while it stands.
 */
export type Phase =
  'reading' | 'claiming' | 'editing' | 'cutting' | 'releasing' | 'lost' | 'recovery';

/**
 * CNT-068's three states, plus `stopped` (fix round 1, finding 3): not saved, and nothing is trying to
 * save it - true once `lost` (its timers are stopped) or once a refused claim has discarded a pending
 * change (kept only as text). Distinct from `failing`, which always means a retry is scheduled.
 */
export type SaveState = 'saved' | 'saving' | 'failing' | 'stopped';

export interface SessionView {
  readonly phase: Phase;
  readonly save: SaveState;
  /** When the latest acknowledged save arrived, or null before the first. */
  readonly savedAt: number | null;
  readonly version: VersionRef;
  /** Who holds the component, after a claim was refused or timed out. */
  readonly holder: Holder | null;
  /** What the author is told, once, through the live region. */
  readonly notice: string | null;
  /** A change made but not yet acknowledged by the service (fix round 1, finding 4). */
  readonly dirty: boolean;
  /**
   * True in `lost`, when the session can resume with a fresh claim - a stale or conflicting save's own
   * recovery (fix round 1, finding 1) - or open Recovery. False otherwise, including every other
   * lock-gone `lost`.
   */
  readonly recoverable: boolean;
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
  /**
   * The component's values as the metadata panel holds them now, sent whole with every save beside
   * the content (definitions.md, "A component's"). Absent for a component with no fields, whose saves
   * carry content alone.
   */
  readonly values?: () => Readonly<Record<string, unknown>>;
  readonly onChange: (view: SessionView) => void;
  /**
   * A claim was refused: the held changes are the component's to undo and offer as text.
   * `hadPending` (fix round 2, finding 1): whether anything was actually pending when this claim
   * started - false for a bare retry with nothing typed since the last refusal, which has nothing new
   * to undo or offer.
   */
  readonly onRefused: (holder: Holder, hadPending: boolean) => void;
  /** A version was cut or the session opened from a new one: undo must not reach past it (CNT-103). */
  readonly onVersion: (version: VersionRef) => void;
  /**
   * Opens a restored iteration as the session's text and values, with a fresh history (RC-G), once it
   * is migrated and validated as a stored version is (CNT-012, CNT-013); or answers why it will not
   * read, naming it by `label`, and opens nothing. Absent, nothing can be restored.
   */
  readonly open?: (
    content: unknown,
    values: Readonly<Record<string, unknown>>,
    label: string,
  ) => string | null;
  /**
   * The sequence a reload goes on from (component-editor.md, "Undo across a reload"): the larger of
   * the last one this window sent and the latest the service accepted from the session, so the next
   * save is judged above both. Absent, a page starts at 0, as one opened afresh does.
   */
  readonly sequence?: number;
  /** Told each sequence as it is taken for a save of what is on screen now, for the kept session. */
  readonly onSent?: (sequence: number) => void;
  /**
   * Told each sequence the service accepts, once or again, for the kept session: a reload takes the
   * service's save at the number it last sent for its own only where it was told this (re-review of
   * W11.3, D1). Told after the page has gone as well as before.
   */
  readonly onAccepted?: (sequence: number) => void;
  /** Told each sequence the service refuses as behind it, stale or conflicting: as `onAccepted`. */
  readonly onSaveRefused?: (sequence: number) => void;
}

/** A save sent again as it was sent: the content, and the values, sent only where the session holds any. */
export interface Repeat {
  readonly content: ContentDocument;
  readonly values: Readonly<Record<string, unknown>>;
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
  /**
   * A reload going on with the changes its window kept, replayed onto the surface (W11.3): from
   * reading, claims again under the same session, neither fresh nor moving, as a lapsed lock is
   * claimed; `unsent` holds them as a change, sent as the next iteration once the claim is granted. A
   * refusal goes back to reading and offers them, as any refused claim does.
   *
   * `repeat` (a third look at W11.3): the last save this window sent, whose answer never came back,
   * sent again once the claim is granted at the very number it took - the sequence the session goes on
   * from - before anything else. Acknowledged again, the save the service holds there is this window's,
   * and the session goes on; refused, it is another page's, and the session goes to `lost` as `behind`
   * leaves it; with no answer, or any other, it goes there too rather than guess. A page that goes
   * before it is acknowledged sends nothing more: what its window kept settles it on the next.
   */
  resume(unsent: boolean, repeat?: Repeat): void;
  /**
   * A reload whose session the service has saved past, from a page this window never was - a
   * duplicated tab holding the same session (final review of W11.3, D1): from reading, goes to `lost`
   * as a stale save does, recoverable by Continue or Recover, sending nothing and claiming nothing, what
   * is on screen held as not saved.
   */
  behind(): void;
  /**
   * Recover (component-editor.md, "Recovery, as W11 builds it"): from reading, or from a `lost` that
   * is `recoverable`, claims afresh - moving the lock from the author's own other window - and opens
   * Recovery. From editing, where the lock is already this session's, it claims nothing: anything on
   * screen not yet saved is saved first, so it is listed too, and then Recovery opens.
   */
  recover(): void;
  /** Closes Recovery and goes on editing what is on screen. */
  closeRecovery(): void;
  /**
   * The author's own saved iterations, a page at a time, while this session holds the lock. A lock
   * found lapsed is claimed again once under this session, as a save's is, and the page asked again.
   */
  iterations(cursor?: string): Promise<IterationPage>;
  /**
   * Restores one: anything on screen not yet saved is saved first, and acknowledged; then the
   * iteration is read (a lock found lapsed claimed again once, as a save's is),
   * opened by `open`, and sent as the next save. Answers null once restored, or why nothing was, which
   * is also the session's notice. `label` names it, as "the text saved at 14:02:07".
   */
  restore(id: string, label: string): Promise<string | null>;
  view(): SessionView;
  dispose(): void;
}

const HELD = 'lock_held';

/** A save refused as stale or conflicting, or a reload found behind the service: the same notice. */
const NEWER_TEXT =
  'Newer text was saved from another window, or from before this page was reloaded. ' +
  'It is kept. Continuing starts a new session from what is on screen.';

/** Recovery, announced as it opens (component-editor.md, "Accessibility"). */
const RECOVERY_OPENED =
  'Your saved text is listed. Restore some of it, or close the list to go on editing.';

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

  let sequence = options.sequence ?? 0;
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
   * sequence): the one case this page lets the author recover from, by claiming afresh, to go on or
   * into Recovery. A lock simply gone stays unrecoverable in this page; what it saved is offered as
   * Recover the next time the component is opened (W11.2). */
  let lostFromStale = false;
  let disposed = false;
  /** Set once a claim has ever discarded a pending change (fix round 2, finding 2): stays true across
   * a later bare retry that has nothing new to lose, so the indicator keeps saying not saved for as
   * long as that earlier text is still only kept, not written anywhere. Cleared only by a successful
   * claim, which puts the kept text behind it (fix round 2, finding 3). */
  let somethingKept = false;
  /** A reload's last save to send again (`resume`), from then until the service acknowledges it: sent
   * first by every claim under this session, a refused one's retry too, and nothing else is sent
   * meanwhile, not even as the page goes. A fresh session has nothing to settle (a third look at
   * W11.3). */
  let pendingRepeat: Repeat | null = null;

  const view = (): SessionView => ({
    phase,
    save,
    savedAt,
    version,
    holder,
    notice,
    dirty,
    recoverable: phase === 'lost' && lostFromStale,
  });
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
    // Not saved, and - since the timers are just stopped - nothing is retrying it either (fix round 1,
    // finding 3): `failing` would say a retry is still scheduled, which is no longer true.
    save = 'stopped';
    lostFromStale = fromStale;
    notice = message;
    publish();
  };

  /** "Kept to copy" is only true when there is something unsaved to copy (fix round 2, finding 7). */
  const lockGoneMessage = () =>
    dirty
      ? 'This session no longer holds the component. Your unsaved text is kept below to copy.'
      : 'This session no longer holds the component.';

  /** True while Recovery, asked for from editing, waits for what is on screen to be saved. */
  let enteringRecovery = false;

  /** The notice a refusal set while editing goes on, so a later successful save can clear it. */
  let refusalNotice: string | null = null;

  /**
   * What the author is told when `snapshot` cannot make a document of what is on screen. It says
   * what is true and no more: the session knows only that the editor refused, not which change did
   * it. Undoing is what makes saving possible again, and the next change is what starts it - which
   * is how a refusal the service gave behaves too.
   */
  const unstorableMessage =
    'This text cannot be saved as it stands, so it was not saved. ' +
    'Undo the change that caused it and saving starts again.';

  /**
   * `options.snapshot()` - `fromEditor`, which parses through `parseContentDocument` - threw, so
   * there is nothing to send and a retry would take the same snapshot and throw again (final
   * review, critical 1).
   *
   * **The change stays `dirty`.** Every other path out of a failed save keeps it, and this one is
   * the same kind of failure: the text is still on screen and still unwritten. Clearing it, as the
   * old order did by taking the snapshot after `dirty = false`, left the indicator saying "Saving"
   * for ever, stopped `dispose` sending anything, and made **Save version** and **Done editing**
   * reject into a button that then waited for ever - with everything typed afterwards lost.
   *
   * Editing goes on, as it does for a `signed_out` or an `invalid` refusal, because the author's way
   * out of this one is to undo in the editor that is still in front of them.
   */
  const cannotSnapshot = () => {
    stopTimers();
    failures = 0;
    hasFailed = false;
    save = 'stopped';
    phase = 'editing';
    notice = unstorableMessage;
    refusalNotice = unstorableMessage;
    publish();
  };

  /** What the author is told for a refusal no retry will change, with or without unsaved text. */
  const refusalMessage = (code: Refusal, unsaved: boolean): string => {
    switch (code) {
      case 'signed_out':
        return unsaved
          ? 'You are signed out. Sign in again; your unsaved text is kept below.'
          : 'You are signed out. Sign in again.';
      case 'invalid':
        return unsaved
          ? 'The service did not accept this text, so it was not saved. Your unsaved text is kept below.'
          : 'The service did not accept this request.';
      case 'forbidden':
        return unsaved
          ? 'You may no longer edit this component. Your unsaved text is kept below to copy.'
          : 'You may no longer edit this component.';
      case 'not_found':
        return unsaved
          ? 'This component is no longer available to you. Your unsaved text is kept below to copy.'
          : 'This component is no longer available to you.';
    }
  };

  /**
   * A refusal no retry will change (final review, finding 2), so nothing retries it. Withdrawn
   * permission to edit or to read goes to `lost`: there is no way back from here. Signed out, or a
   * request the service refused as invalid, stops saving and says why, with the text kept, while
   * editing goes on: once the author has signed in again, their next change sends everything.
   */
  const refuse = (code: Refusal) => {
    const message = refusalMessage(code, dirty);
    if (code === 'forbidden' || code === 'not_found') {
      lose(message);
      return;
    }
    stopTimers();
    failures = 0;
    hasFailed = false;
    if (dirty) save = 'stopped';
    phase = 'editing';
    notice = message;
    refusalNotice = message;
    publish();
  };

  /**
   * Tells the kept session how the service answered the save at `sequence`, whether or not the page is
   * still here to hear it otherwise: accepted, or refused as behind it. Nothing else the service
   * answers says anything of what it holds at that number.
   */
  const answered = (sequence: number, result: SaveResult) => {
    if (result.ok) options.onAccepted?.(sequence);
    else if (result.code === 'iteration_stale' || result.code === 'iteration_conflict') {
      options.onSaveRefused?.(sequence);
    }
  };

  /** One claim, raced against `timing.claimMs`, its request aborted once the race is lost. */
  const claimWithin = async (move: boolean, fresh: boolean): Promise<ClaimResult> => {
    const controller = new AbortController();
    let timer: unknown = null;
    const timedOut = new Promise<ClaimResult>((resolve) => {
      timer = clock.setTimeout(() => {
        controller.abort();
        resolve({ ok: false, code: 'failed' });
      }, timing.claimMs);
    });
    const result = await Promise.race([service.claim(move, fresh, controller.signal), timedOut]);
    cancel(timer);
    return result;
  };

  /**
   * Sends what the editor holds now, once; answers whether everything changed so far is acknowledged.
   *
   * `afterReclaim` (final review, the critical finding): true for the one retry made after this very
   * write found the lock lapsed and the session claimed it again, so a second `lock_required` goes to
   * `lost` instead of claiming again - at most one re-claim per refused write, never a loop.
   */
  const send = async (afterReclaim = false): Promise<boolean> => {
    if (disposed) return false;
    // Whenever an attempt starts, any backoff wait it grew out of is spent - never let a stale handle
    // linger to fire a redundant retry later (finding 3).
    cancel(retry);
    retry = null;
    // **Before anything else is moved.** The snapshot is the one step here that can throw, and
    // everything below it - the sequence, `dirty`, the indicator - is bookkeeping this attempt owns.
    // Taken first, a throw leaves all of it exactly as it was and `cannotSnapshot` can say so; taken
    // after, as it was, it left the session claiming to be saving a change it had already forgotten.
    let content: ContentDocument;
    try {
      content = options.snapshot();
    } catch {
      cannotSnapshot();
      return false;
    }
    sequence += 1;
    const sent = sequence;
    options.onSent?.(sent);
    dirty = false;
    save = hasFailed ? 'failing' : 'saving';
    publish();
    const controller = new AbortController();
    let timer: unknown = null;
    const timedOut = new Promise<SaveResult>((resolve) => {
      timer = clock.setTimeout(() => {
        controller.abort();
        resolve({ ok: false, code: 'failed' });
      }, timing.claimMs);
    });
    const result = await Promise.race([
      service.save(sent, version.id, content, controller.signal, options.values?.()),
      timedOut,
    ]);
    cancel(timer);
    // Told before anything else, and even once disposed: the page that sent it may have gone, and the
    // next is to know whether the service took this number from it (re-review of W11.3, D1).
    answered(sent, result);
    if (disposed) return false;
    if (result.ok) {
      failures = 0;
      hasFailed = false;
      cancel(failing);
      failing = null;
      savedAt = clock.now();
      if (
        notice === 'Not saved. Retrying.' ||
        notice === 'Not saved, so no version was made.' ||
        (notice !== null && notice === refusalNotice)
      ) {
        notice = null;
      }
      refusalNotice = null;
      save = dirty ? 'saving' : 'saved';
      publish();
      return !dirty;
    }
    if (result.code === 'lock_required' && !afterReclaim) {
      // Nobody holds the lock: most often a pause longer than the lock period, since only an accepted
      // write extends it (final review, the critical finding). Claim it again under this same session
      // id - not fresh, so the sequence continues and the service still finds this session's earlier
      // iterations - and send again. If somebody else took it meanwhile, the claim says so and this
      // stops exactly as before.
      dirty = true;
      const reclaimed = await claimWithin(false, false);
      if (disposed) return false;
      if (reclaimed.ok) return send(true);
      if (isRefusal(reclaimed.code)) refuse(reclaimed.code);
      else lose(lockGoneMessage());
      return false;
    }
    if (isRefusal(result.code)) {
      dirty = true;
      refuse(result.code);
      return false;
    }
    if (
      result.code === HELD ||
      result.code === 'lock_required' ||
      result.code === 'version_precondition'
    ) {
      dirty = true;
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
      lose(NEWER_TEXT, true);
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
   * A reload's last save sent again at the number it took (`resume`'s repeat), once the claim is
   * granted: answers whether the service acknowledged it again, the session going on; otherwise the
   * session has gone to `lost`, where nothing more is sent. Raced against `timing.claimMs` as a save is.
   */
  const sendAgain = async (repeat: Repeat): Promise<boolean> => {
    const at = sequence;
    const controller = new AbortController();
    let timer: unknown = null;
    const timedOut = new Promise<SaveResult>((resolve) => {
      timer = clock.setTimeout(() => {
        controller.abort();
        resolve({ ok: false, code: 'failed' });
      }, timing.claimMs);
    });
    const result = await Promise.race([
      service.save(
        at,
        version.id,
        repeat.content,
        controller.signal,
        options.values === undefined ? undefined : repeat.values,
      ),
      timedOut,
    ]);
    cancel(timer);
    answered(at, result);
    if (disposed) return false;
    if (result.ok) {
      pendingRepeat = null;
      savedAt = clock.now();
      return true;
    }
    dirty = true;
    // Signed out, forbidden and the rest say why. Anything else - refused as another page's, or no
    // answer at all - leaves the save the service holds at that number perhaps somebody else's, which
    // nothing may be sent over: as `behind`.
    if (isRefusal(result.code)) lose(refusalMessage(result.code, true));
    else lose(NEWER_TEXT, true);
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
    if (
      phase !== 'editing' &&
      phase !== 'cutting' &&
      phase !== 'releasing' &&
      phase !== 'recovery'
    ) {
      return false;
    }
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

  /**
   * `into` is where a granted claim goes: editing, or Recovery for a claim that Recover asked for,
   * which then lists what the author saved rather than letting them type.
   */
  const claim = async (move: boolean, fresh: boolean, into: 'editing' | 'recovery' = 'editing') => {
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
    if (fresh) {
      sequence = 0;
      // A new session has saved nothing: nothing of the old one's is sent again under it.
      pendingRepeat = null;
    }
    failures = 0;
    hasFailed = false;
    publish();
    const result = await claimWithin(move, fresh);
    if (disposed) return;
    if (result.ok) {
      // Still claiming, so nothing else is sent, until the reload's last save is settled.
      if (pendingRepeat !== null && !(await sendAgain(pendingRepeat))) return;
      phase = into;
      notice = into === 'recovery' ? RECOVERY_OPENED : 'You are editing this component.';
      // A successful claim is the real state, told plainly (fix round 2, finding 3): the previous
      // value could be `stopped`, left over from a refusal this claim has now resolved, which would
      // otherwise say "not saved" while there was nothing left unsaved. Whatever was kept as text
      // stands behind this session now, so it no longer keeps `save` pinned at `stopped` either.
      save = dirty ? 'saving' : 'saved';
      somethingKept = false;
      publish();
      if (dirty) schedule();
      return;
    }
    // Whatever was pending when this claim started is discarded - the held changes are the caller's to
    // undo and offer as text (`onRefused`, below) - so `stopped` says plainly that it is not saved and
    // nothing is retrying it; `saved` only when nothing has ever been discarded this way (fix round 1,
    // finding 3; fix round 2, finding 2): a bare retry with nothing typed since the last refusal has
    // nothing new to lose, but whatever an earlier refusal already discarded is still only kept, not
    // written anywhere, so `save` must not swing back to `saved` while that stays true.
    const hadPending = dirty;
    if (hadPending) somethingKept = true;
    phase = 'reading';
    dirty = false;
    save = somethingKept ? 'stopped' : 'saved';
    if (result.code === HELD) {
      holder = result.holder;
      notice = result.holder.yours
        ? 'You are editing this component in another window.'
        : heldSentence(result.holder);
      publish();
      options.onRefused(result.holder, hadPending);
      return;
    }
    // A holder that is nobody's (fix round 1, finding 1): a claim that merely failed or timed out - not
    // a `lock_held` refusal - names no one, but still needs to read as "refused" so a caller can offer
    // a retry control rather than typing being the only way back in.
    holder = { name: null, expectedRelease: '', yours: false };
    notice = isRefusal(result.code)
      ? refusalMessage(result.code, hadPending)
      : 'Could not start editing. Try again.';
    publish();
    options.onRefused(holder, hadPending);
  };

  /**
   * Recovery found the lock lapsed - a pause longer than the lock period while the list stood open -
   * so it is claimed again once under this same session, as a save's is (final review, the critical
   * finding): not fresh, so the sequence continues. Refused, the session stops as a refused save's
   * re-claim stops it. Answers whether the lock is this session's again.
   */
  const reclaimInRecovery = async (): Promise<boolean> => {
    const reclaimed = await claimWithin(false, false);
    if (disposed) return false;
    if (reclaimed.ok) return true;
    if (isRefusal(reclaimed.code)) refuse(reclaimed.code);
    else lose(lockGoneMessage());
    return false;
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
      // Lost, or a refusal that stopped saving and returned to editing with its reason (final review,
      // finding 2): either way there is nothing to cut, and the reason stays shown.
      if ((phase as Phase) !== during) return;
      if (flushed || failures > before || !dirty) break;
    }
    if (!flushed) {
      phase = 'editing';
      notice = 'Not saved, so no version was made.';
      publish();
      return;
    }
    let result = await request(version.id);
    if (disposed) return;
    if (!result.ok && result.code === 'lock_required') {
      // As a save's (final review, the critical finding): the lock lapsed, so claim it again under the
      // same session and ask once more - once only. A refused claim stops as a refused cut always has.
      const reclaimed = await claimWithin(false, false);
      if (disposed) return;
      if (!reclaimed.ok) {
        if (isRefusal(reclaimed.code)) refuse(reclaimed.code);
        else lose(lockGoneMessage());
        return;
      }
      result = await request(version.id);
      if (disposed) return;
    }
    if (!result.ok) {
      if (isRefusal(result.code)) {
        refuse(result.code);
        return;
      }
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
    const reclaimed = await claimWithin(false, false);
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
    resume(unsent, repeat) {
      if (phase !== 'reading' || disposed) return;
      dirty = unsent;
      // Saving while the repeat is unanswered, whatever it holds: nothing is saved until it is.
      save = unsent || repeat !== undefined ? 'saving' : 'saved';
      pendingRepeat = repeat ?? null;
      void claim(false, false);
    },
    behind() {
      if (phase !== 'reading' || disposed) return;
      dirty = true;
      lose(NEWER_TEXT, true);
    },
    recover() {
      if (phase === 'editing') {
        // The lock is this session's already, so nothing is claimed. Anything on screen not yet
        // saved is saved first, so it is listed with the rest and can be restored too; Recovery opens
        // once that is answered, and only if nothing - a cut, a lost lock, a refusal - moved the
        // session on meanwhile. A save that failed is retried as ever, and a restore asks for it again.
        if (enteringRecovery) return;
        enteringRecovery = true;
        void flush(true).then(() => {
          enteringRecovery = false;
          // A refusal stops the saving without moving the phase: its reason stays said, and the
          // panel does not open over it (W11.2's re-review).
          if (disposed || (phase as Phase) !== 'editing' || (save as SaveState) === 'stopped')
            return;
          phase = 'recovery';
          notice = RECOVERY_OPENED;
          publish();
        });
        return;
      }
      // Always a fresh session, and always moving: the id this page holds may be a reload's, which
      // the service has already accepted saves from past this page's own count, and the author asked
      // to recover here, which is to take the lock from any window of theirs. `move` moves nothing of
      // anybody else's: a lock another author holds refuses it all the same, naming them.
      if (phase === 'reading' || (phase === 'lost' && lostFromStale))
        void claim(true, true, 'recovery');
    },
    closeRecovery() {
      if (phase !== 'recovery') return;
      phase = 'editing';
      notice = 'You are editing this component.';
      publish();
      if (dirty) schedule();
    },
    async iterations(cursor) {
      const page = await service.iterations(cursor);
      if (page.ok || page.code !== 'lock_required' || phase !== 'recovery') return page;
      if (!(await reclaimInRecovery())) return page;
      return service.iterations(cursor);
    },
    async restore(id, label) {
      if (phase !== 'recovery' || options.open === undefined) return null;
      const refuseRestore = (message: string) => {
        notice = message;
        publish();
        return message;
      };
      // First anything on screen not yet saved, acknowledged, so a restore can itself be undone by
      // restoring what it replaced (component-editor.md, "Recovery"). Nothing unsaved sends nothing:
      // what is on screen is then the newest save listed, or the version itself.
      const flushed = await flush(true);
      if (disposed) return null;
      // Lost, or a refusal that stopped saving, on the way: its own notice says why.
      if ((phase as Phase) !== 'recovery') return notice;
      if (!flushed) return refuseRestore('Not saved, so nothing was restored.');
      let read = await service.iteration(id);
      if (disposed) return null;
      if ((phase as Phase) !== 'recovery') return notice;
      if (!read.ok && read.code === 'lock_required') {
        if (!(await reclaimInRecovery())) return disposed ? null : notice;
        if ((phase as Phase) !== 'recovery') return notice;
        read = await service.iteration(id);
        if (disposed) return null;
        if ((phase as Phase) !== 'recovery') return notice;
      }
      if (!read.ok) {
        if (read.code === HELD || read.code === 'lock_required') {
          lose(lockGoneMessage());
          return notice;
        }
        if (read.code === 'signed_out' || read.code === 'forbidden') {
          refuse(read.code);
          return notice;
        }
        return refuseRestore(
          read.code === 'not_found'
            ? 'That saved text is no longer kept.'
            : 'The saved text could not be read. Try again.',
        );
      }
      const refused = options.open(read.content, read.values, label);
      if (refused !== null) return refuseRestore(refused);
      // Opened, with a fresh history: the restored text is the next iteration sent.
      phase = 'editing';
      notice = `Restored ${label}.`;
      dirty = true;
      save = hasFailed ? 'failing' : 'saving';
      publish();
      await flush(true);
      return null;
    },
    view,
    dispose() {
      /**
       * The last save, sent as the page goes and never retried; its answer is still told, since only
       * that says whether the service took this number from this window (re-review of W11.3, D1).
       */
      const sendAsGone = (
        at: number,
        openedFrom: string,
        body: ContentDocument,
        held: Readonly<Record<string, unknown>> | undefined,
      ) => {
        options.onSent?.(at);
        void service
          .save(at, openedFrom, body, undefined, held)
          .then((result) => answered(at, result))
          .catch(() => {});
      };
      // Best effort: an unmount must not drop a change silently (fix round 1, finding 4). Fired before
      // `disposed` is set, so the guards inside `send` do not refuse it - but nothing here awaits the
      // result, retries it, or publishes a view for it: whatever would show either is already gone.
      // `claiming` counts too (fix round 2, minor): typing that arrived while the very first claim is
      // still on the wire is exactly as unsent as typing during `editing`. `lost` does not: there is no
      // lock left to save under.
      // Nor while a reload's last save, sent again, is unanswered (a third look at W11.3): what the
      // service holds at that number may be another page's, and the window keeps everything anyway.
      if (
        dirty &&
        pendingRepeat === null &&
        (phase === 'claiming' ||
          phase === 'editing' ||
          phase === 'cutting' ||
          phase === 'releasing' ||
          phase === 'recovery')
      ) {
        // The snapshot must be taken now, synchronously: the caller destroys the view the instant
        // this returns, and `options.snapshot()` reads it.
        //
        // **And it can throw** (final review, critical 1), where the editor holds content the model
        // refuses. Best effort means best effort: there is nothing to send, `dirty` stays true, and
        // `dispose` returns rather than throwing out of the unmount that called it. Sending an
        // earlier snapshot instead is not the safer answer - it would record text the author has
        // since changed as their latest, under their name, with nothing left on screen to say so.
        let content: ContentDocument | null;
        try {
          content = options.snapshot();
        } catch {
          content = null;
        }
        if (content !== null) {
          const body = content;
          const held = options.values?.();
          const openedFrom = version.id;
          const alreadyInFlight = inFlight;
          dirty = false;
          if (alreadyInFlight) {
            // A save is already on the wire, sent from an earlier snapshot - this typing arrived
            // after that one was taken, so it is not in that request and must not be dropped just
            // because another is already running (fix round 2, finding 4). Queued after it settles,
            // over the next sequence, rather than sent alongside it: never two requests for one
            // session at once, and never more than this one follow-up, since nothing can arrive
            // after the view is destroyed.
            //
            // This holds during `cutting`/`releasing` too (fix round 3): `finish`, above, is also
            // waiting on this same in-flight save through its own `flush`, but once it notices this
            // disposal (`if (disposed) return;`, its very next checkpoint) it returns without
            // cutting a version or sending anything of its own - it does not queue this follow-up
            // itself, so skipping it here, as an earlier attempt at this fix did, dropped the
            // typing silently instead of racing anything.
            void alreadyInFlight.then(() => {
              sequence += 1;
              sendAsGone(sequence, openedFrom, body, held);
            });
          } else {
            sequence += 1;
            sendAsGone(sequence, openedFrom, body, held);
          }
        }
      }
      disposed = true;
      stopTimers();
    },
  };
}
