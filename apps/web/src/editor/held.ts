import { useEffect, useState } from 'react';

import { formats, words } from '../words/words.js';
/** Who holds a component, as the service says: a name where it has one, and when it lapses. */
export interface Held {
  readonly name: string | null;
  readonly expectedRelease: string;
}

/**
 * Who is editing a component and when they are expected back (CNT-074), in the reader's own time: the
 * time alone where it is today, and the day with it where it is not. Where no time is known - a claim
 * that failed without naming a holder - it says who, and no more.
 */
export function heldSentence(held: Held, now: Date = new Date()): string {
  const who = held.name ?? words('editor.held.someone-else');
  const back = new Date(held.expectedRelease);
  if (held.expectedRelease === '' || Number.isNaN(back.getTime())) {
    return words('editor.held.editing', { who });
  }
  const time = formats().time(back, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  if (back.toDateString() === now.toDateString()) {
    return words('editor.held.back-at', { who, time });
  }
  const day = formats().date(back, { day: 'numeric', month: 'long' });
  return words('editor.held.back-on', { who, time, day });
}

/** A part's lock, as whatever draws it needs it. */
export interface Lock {
  readonly holder: { readonly name: string | null };
  readonly expectedRelease: string;
  readonly yours: boolean;
}

/**
 * What a part's lock says, on its symbol and in the Part panel (the EP plan, EP7): whose it is, and for
 * a lock of the reader's own, whether it is this window's.
 */
export function lockSentence(lock: Lock, openHere: boolean, now: Date = new Date()): string {
  if (lock.yours) return words(openHere ? 'editor.held.you-here' : 'editor.held.you-elsewhere');
  return heldSentence({ name: lock.holder.name, expectedRelease: lock.expectedRelease }, now);
}

/**
 * Whether a lock's symbol still stands. It goes when the lock lapses, which no event says; a lock the
 * reader is using here renews itself, and goes when the stream says it has.
 */
export function useLockStands(lock: Lock, openHere: boolean): boolean {
  const release = new Date(lock.expectedRelease).getTime();
  const inUseHere = lock.yours && openHere;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const left = release - Date.now();
    if (inUseHere || left <= 0) return undefined;
    // setTimeout holds no more than this; a longer wait simply looks again.
    const timer = setTimeout(() => setTick((was) => was + 1), Math.min(left + 1, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [release, inUseHere, tick]);
  return inUseHere || release > Date.now();
}
