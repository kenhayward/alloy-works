/**
 * A `dateTime` field's value as an author gives it and as it is stored (component-editor.md, "Metadata
 * alongside"): entered as a local date and time in a named zone, the author's own by default, and
 * **stored as the instant with its numeric offset**, never the zone's name (MET-028).
 *
 * A zone's clocks jump: a local time the zone skips names no instant, and one it repeats names two.
 * Neither is guessed at - the first is refused in a sentence and the second is asked about.
 */

/** What a local date and time names in a zone. */
export type InstantFor =
  | { readonly kind: 'one'; readonly value: string }
  /** The zone repeats it: the earlier instant, and the later. */
  | { readonly kind: 'two'; readonly earlier: string; readonly later: string }
  /** The zone skips it: no instant has it for a local time. */
  | { readonly kind: 'none' }
  /** Not a local date and time at all. */
  | { readonly kind: 'invalid' };

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DAY_MS = 86_400_000;

/** The wall-clock time an instant is in a zone, as milliseconds on a clock that knows no zone. */
function wallClock(ms: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((each) => each.type === type)?.value ?? '0');
  return Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
}

/** A zone's offset at an instant, in milliseconds east of UTC. */
const offsetAt = (ms: number, zone: string) => wallClock(ms, zone) - ms;

function offsetText(offsetMs: number): string {
  const minutes = Math.round(offsetMs / 60_000);
  const sign = minutes < 0 ? '-' : '+';
  const whole = Math.abs(minutes);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${sign}${pad(Math.floor(whole / 60))}:${pad(whole % 60)}`;
}

/** The instant, or instants, a local date and time names in a zone. */
export function instantFor(local: string, zone: string): InstantFor {
  const match = LOCAL.exec(local);
  if (!match) return { kind: 'invalid' };
  const [year, month, day, hour, minute, second] = match
    .slice(1)
    .map((each) => (each === undefined ? 0 : Number(each))) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const back = new Date(guess);
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return { kind: 'invalid' };
  }
  // The offsets either side of it, a day away: a jump is never nearer than that to itself.
  const instants = [
    ...new Set([guess - offsetAt(guess - DAY_MS, zone), guess - offsetAt(guess + DAY_MS, zone)]),
  ]
    .filter((instant) => wallClock(instant, zone) === guess)
    .sort((a, b) => a - b);
  const stored = (instant: number) => `${local}${offsetText(offsetAt(instant, zone))}`;
  if (instants.length === 0) return { kind: 'none' };
  if (instants.length === 1) return { kind: 'one', value: stored(instants[0]!) };
  return { kind: 'two', earlier: stored(instants[0]!), later: stored(instants[1]!) };
}

/**
 * The local date and time a stored instant is in a zone, as a `datetime-local` input takes it; null
 * for a value that names no instant.
 */
export function localIn(value: string, zone: string): string | null {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  const wall = new Date(wallClock(ms, zone));
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`;
  const time = `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`;
  const seconds = wall.getUTCSeconds();
  return `${date}T${time}${seconds === 0 ? '' : `:${pad(seconds)}`}`;
}

/** The zone the author's own clock is set to. */
export const authorZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
