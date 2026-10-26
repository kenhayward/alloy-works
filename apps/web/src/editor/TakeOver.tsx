import { useEffect, useRef, useState } from 'react';

import type { TakeResult } from './session.js';
import { words } from '../words/words.js';

/** A time as a person reads it, to the minute, or to the second within the next few minutes. */
const timeOf = (iso: string, seconds = false) =>
  new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  });

/** What asking stands at: asked, with when to ask again, numbered so each answer re-arms the wait. */
interface Asked {
  readonly until: string;
  readonly retryAfterMs: number;
  readonly answer: number;
}

/**
 * **Take over** (COL-009, COL-046, COL-047; collaboration.md, Taking): offered once the holder has
 * been idle the environment's take period - appearing then of itself - and before that, saying when.
 * Asked, it says the holder has until the grace ends to keep it, and asks again when the service says
 * to, by the service's clock, never this window's; each answer waits afresh (the PL final review,
 * findings 1 and 8). The lock is this window's only once the holder has done nothing through it.
 */
export function TakeOver({
  holder,
  takeableAt,
  onTake,
  now = () => Date.now(),
}: {
  /** Who holds it, by name. */
  holder: string | null;
  /** When it may first be asked for, as the page last read it. */
  takeableAt: string;
  /** Asks, or takes once the grace has passed: the session's `takeOver`. */
  onTake: () => Promise<TakeResult>;
  now?: () => number;
}) {
  const [asked, setAsked] = useState<Asked | null>(null);
  const [askable, setAskable] = useState(takeableAt);
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  const answers = useRef(0);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );
  useEffect(() => setAskable(takeableAt), [takeableAt]);
  const name = holder ?? words('editor.its-holder');

  const ask = async () => {
    setBusy(true);
    setSaid('');
    const answer = await onTake();
    if (!live.current) return;
    setBusy(false);
    answers.current += 1;
    if (answer.ok && !answer.taken) {
      setAsked({ until: answer.until, retryAfterMs: answer.retryAfterMs, answer: answers.current });
      return;
    }
    setAsked(null);
    if (answer.ok) return;
    if (answer.code === 'lock_active' && answer.takeableAt !== undefined) {
      setAskable(answer.takeableAt);
    }
    setSaid(
      answer.code === 'lock_active'
        ? words('editor.is-working-on-it-again', { name })
        : answer.code === 'lock_taking'
          ? words('editor.has-asked-for-it-already', {
              value1: answer.by ?? words('editor.somebody-else'),
            })
          : answer.code === 'lock_free'
            ? words('editor.nobody-holds-it-now-begin')
            : words('editor.it-could-not-be-asked'),
    );
  };

  // Asked: asks again when the service said to, which takes it if the holder did nothing. Each
  // answer is a new wait, even one naming the same moment.
  useEffect(() => {
    if (asked === null) return undefined;
    const timer = setTimeout(() => void ask(), asked.retryAfterMs + 500);
    return () => clearTimeout(timer);
    // `ask` is this render's, and asks again with whatever the session holds then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);

  // Not yet askable: drawn again when it becomes so, since an idle holder sends nothing to say it.
  const wait = new Date(askable).getTime() - now();
  useEffect(() => {
    if (asked !== null || wait <= 0) return undefined;
    const timer = setTimeout(() => setTick((tick) => tick + 1), wait + 250);
    return () => clearTimeout(timer);
  }, [asked, wait]);

  if (asked !== null) {
    return (
      <p role="status">
        {words('editor.has-been-asked-for-it', { name, value2: timeOf(asked.until, true) })}
      </p>
    );
  }
  return (
    <>
      {wait <= 0 ? (
        <button type="button" disabled={busy} onClick={() => void ask()}>
          {words('editor.take-over')}
        </button>
      ) : (
        <p>{words('editor.you-may-ask-for-it', { name, value2: timeOf(askable) })}</p>
      )}
      <p role="status">{said}</p>
    </>
  );
}
