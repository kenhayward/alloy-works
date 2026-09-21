/**
 * Months as the lists abbreviate them, spelled here rather than asked of `Intl`: engines disagree
 * (one writes "Sept" where another writes "Sep"), and a list whose dates change with the browser is a
 * list nobody can quote.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const twoDigits = (value: number) => String(value).padStart(2, '0');
const clock = (at: Date) => `${twoDigits(at.getHours())}:${twoDigits(at.getMinutes())}`;
const startOfDay = (at: Date) => new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'} ago`;

/**
 * When something last changed, in the reader's own time, as near as is useful: minutes and hours
 * today, yesterday with its time, the day and month this year, and the year before that.
 */
export function whenChanged(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return plural(minutes, 'minute');
  if (startOfDay(at) === startOfDay(now)) return plural(Math.floor(minutes / 60), 'hour');
  const yesterday = startOfDay(now) - 86_400_000;
  if (startOfDay(at) === startOfDay(new Date(yesterday))) return `Yesterday, ${clock(at)}`;
  const day = `${at.getDate()} ${MONTHS[at.getMonth()] ?? ''}`;
  if (at.getFullYear() === now.getFullYear()) return `${day}, ${clock(at)}`;
  return `${day} ${at.getFullYear()}`;
}
