import { formats, words } from '../words/words.js';

const startOfDay = (at: Date) => new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();

/** A time of day, as the reader's language sets it from the bundled locale data (UI-A). */
const clock = (at: Date) =>
  formats().time(at, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/**
 * When something last changed, in the reader's own time and language, as near as is useful: minutes
 * and hours today, yesterday with its time, the day and month this year, and the year before that.
 * Months are the bundled locale data's, so a list's dates never change with the browser.
 */
export function whenChanged(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return words('editor.changed.just-now');
  if (minutes < 60) return words('editor.changed.minutes-ago', { count: minutes });
  if (startOfDay(at) === startOfDay(now)) {
    return words('editor.changed.hours-ago', { count: Math.floor(minutes / 60) });
  }
  const yesterday = startOfDay(now) - 86_400_000;
  if (startOfDay(at) === startOfDay(new Date(yesterday))) {
    return words('editor.changed.yesterday', { time: clock(at) });
  }
  if (at.getFullYear() === now.getFullYear()) {
    return words('editor.changed.this-year', {
      day: formats().date(at, { day: 'numeric', month: 'short' }),
      time: clock(at),
    });
  }
  return formats().date(at, { day: 'numeric', month: 'short', year: 'numeric' });
}
