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
  const who = `${held.name ?? 'Someone else'} is editing this component`;
  const back = new Date(held.expectedRelease);
  if (held.expectedRelease === '' || Number.isNaN(back.getTime())) return `${who}.`;
  const time = back.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const today = back.toDateString() === now.toDateString();
  const day = back.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  return `${who}, expected back at ${time}${today ? '' : ` on ${day}`}.`;
}
