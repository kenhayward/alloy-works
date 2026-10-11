import { useEffect, useRef, useState } from 'react';

import type { TakeResult } from './session.js';

/** A time as a person reads it, to the minute, or to the second within the next few minutes. */
const timeOf = (iso: string, seconds = false) =>
  new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  });

/**
 * **Take over** (COL-009, COL-046, COL-047; collaboration.md, Taking): offered once the holder has
 * been idle the environment's take period, and before that, when it will be. Asked, it says the holder
 * has until the grace ends to keep it, and asks again then; the lock is this window's only once the
 * holder has done nothing through it. Never instant, never silent.
 */
export function TakeOver({
  holder,
  takeableAt,
  onTake,
  now = () => Date.now(),
}: {
  /** Who holds it, by name. */
  holder: string | null;
  /** When it may first be asked for. */
  takeableAt: string;
  /** Asks, or takes once the grace has passed: the session's `takeOver`. */
  onTake: () => Promise<TakeResult>;
  now?: () => number;
}) {
  const [until, setUntil] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );
  const name = holder ?? 'Its holder';

  const ask = async () => {
    setBusy(true);
    setSaid('');
    const answer = await onTake();
    if (!live.current) return;
    setBusy(false);
    if (answer.ok && !answer.taken) setUntil(answer.until);
    else if (answer.ok) setUntil(null);
    else {
      setUntil(null);
      setSaid(
        answer.code === 'lock_active'
          ? `${name} is working on it again.`
          : answer.code === 'lock_taking'
            ? `${answer.by ?? 'Somebody else'} has asked for it already.`
            : answer.code === 'lock_free'
              ? 'Nobody holds it now: begin editing to claim it.'
              : 'It could not be asked for.',
      );
    }
  };

  // Asked: asks again once the holder's grace has passed, which takes it if they did nothing.
  useEffect(() => {
    if (until === null) return undefined;
    const timer = setTimeout(
      () => void ask(),
      Math.max(0, new Date(until).getTime() - now()) + 500,
    );
    return () => clearTimeout(timer);
    // `ask` is this render's, and asks again with whatever the session holds then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [until]);

  if (until !== null) {
    return (
      <p role="status">
        {`${name} has been asked for it. It is yours at ${timeOf(until, true)} unless they go on working.`}
      </p>
    );
  }
  const askable = now() >= new Date(takeableAt).getTime();
  return (
    <>
      {askable ? (
        <button type="button" disabled={busy} onClick={() => void ask()}>
          Take over
        </button>
      ) : (
        <p>{`You may ask ${name} for it from ${timeOf(takeableAt)}.`}</p>
      )}
      <p role="status">{said}</p>
    </>
  );
}
