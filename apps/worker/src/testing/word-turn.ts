import { randomUUID } from 'node:crypto';
import { open, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Where the suite's files take their turn at Word: one lock for the machine. */
const WORD_LOCK = join(tmpdir(), 'alloy-works-word.lock');

/**
 * How long a lock may stand empty before it is taken as left behind: its maker writes its number
 * straight after making it, so one still empty after this was made by a process that ended between.
 */
const EMPTY_FOR = 5_000;

/** Whether a process of this number is running. */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Not ours to signal is still running; gone is gone.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Whether a lock could not be made because another stands there: it exists, or - on Windows - it is
 * being removed, which refuses a file of its name until it is gone.
 */
const taken = (error: unknown) =>
  ['EEXIST', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '');

/** The process a lock's words name, or nothing where they name none. */
const holderOf = (words: string) => {
  const pid = Number(words.trim().split(' ')[0]);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
};

/** How long ago a file was last written, in milliseconds, or nothing where it is gone. */
const ageOf = async (path: string) =>
  stat(path).then(
    (found) => Date.now() - found.mtimeMs,
    () => undefined,
  );

/**
 * Whether a lock whose words are these was left behind: it names a process that has ended, or it is
 * empty and older than `EMPTY_FOR`.
 */
async function leftBehind(path: string, words: string): Promise<boolean> {
  const holder = holderOf(words);
  if (holder !== undefined) return !running(holder);
  if (words.trim() !== '') return false;
  return ((await ageOf(path)) ?? 0) > EMPTY_FOR;
}

/**
 * Takes a lock left behind with `seen` in it away, and only that one: under a second lock, the
 * reaper's, made only where there is none, it is read again and removed only if it still holds `seen`
 * and is still left behind. A waiter never removes a lock otherwise, so one that saw the same lock left
 * behind and comes second finds the turn another took since, and leaves it. A reaper's lock left
 * behind - its maker ended in the moment it held it - is removed once older than `EMPTY_FOR`.
 * Whether this waiter was the one to look.
 */
async function takeAway(lock: string, seen: string): Promise<boolean> {
  const reaper = `${lock}.reaper`;
  try {
    await (await open(reaper, 'wx')).close();
  } catch (error) {
    if (!taken(error)) throw error;
    if (((await ageOf(reaper)) ?? 0) > EMPTY_FOR) await rm(reaper, { force: true });
    return false;
  }
  try {
    const now = await readFile(lock, 'utf8').catch(() => undefined);
    if (now === seen && (await leftBehind(lock, now))) await rm(lock, { force: true });
    return true;
  } finally {
    await rm(reaper, { force: true });
  }
}

/**
 * **Runs `work` in this process's turn at Word** (W15.2). The Word check, its export-only mode and
 * Word's measurement each start a hidden Word of their own, and the Word check's script refuses while
 * any Word runs (`word-own.ps1`); the worker suite runs its files side by side, so each takes its turn:
 * a lock file holding the process's number and a word of its own turn, made only where there is none,
 * waited for every `every` milliseconds for up to `within`, and removed when `work` ends however it
 * ends - if it is still this turn's. A lock left behind - naming a process that has ended, or empty
 * for longer than its maker takes to write its number - is taken away by one waiter at a time, and
 * only while it is still the lock that waiter saw (`takeAway`), never from under a turn another waiter
 * took in between. It orders the suite's own turns and nothing else: a person's Word open on the
 * machine still makes the script refuse, as it should.
 */
export async function inWordsTurn<T>(
  work: () => Promise<T>,
  { lock = WORD_LOCK, every = 1_000, within = 900_000 } = {},
): Promise<T> {
  const until = Date.now() + within;
  const mine = `${process.pid} ${randomUUID()}`;
  for (;;) {
    try {
      const handle = await open(lock, 'wx');
      await handle.writeFile(mine);
      await handle.close();
      break;
    } catch (error) {
      if (!taken(error)) throw error;
      const seen = await readFile(lock, 'utf8').catch(() => undefined);
      // Taken away, or found gone: try again at once. Another reaping it: wait, as for a turn.
      if (seen !== undefined && (await leftBehind(lock, seen)) && (await takeAway(lock, seen))) {
        continue;
      }
      if (Date.now() > until) {
        throw new Error(
          `Waited ${within} ms for Word's turn at ${lock}, held by process ${holderOf(seen ?? '') ?? 'unknown'}`,
          { cause: error },
        );
      }
      await new Promise((resolve) => setTimeout(resolve, every));
    }
  }
  try {
    return await work();
  } finally {
    // Only this turn's lock: one taken away as left behind and made again is another's.
    if ((await readFile(lock, 'utf8').catch(() => undefined)) === mine) {
      await rm(lock, { force: true });
    }
  }
}
