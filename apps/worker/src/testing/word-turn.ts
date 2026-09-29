import { open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Where the suite's files take their turn at Word: one lock for the machine. */
const WORD_LOCK = join(tmpdir(), 'alloy-works-word.lock');

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
 * **Runs `work` in this process's turn at Word** (W15.2). The Word check, its export-only mode and
 * Word's measurement each start a hidden Word of their own, and the Word check's script refuses while
 * any Word runs (`word-own.ps1`); the worker suite runs its files side by side, so each takes its turn:
 * a lock file holding the process's number, made only where there is none, waited for every `every`
 * milliseconds for up to `within`, and removed when `work` ends however it ends. A lock whose process
 * has ended is taken. It orders the suite's own turns and nothing else: a person's Word open on the
 * machine still makes the script refuse, as it should.
 */
export async function inWordsTurn<T>(
  work: () => Promise<T>,
  { lock = WORD_LOCK, every = 1_000, within = 900_000 } = {},
): Promise<T> {
  const until = Date.now() + within;
  for (;;) {
    try {
      const handle = await open(lock, 'wx');
      await handle.writeFile(String(process.pid));
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const holder = Number((await readFile(lock, 'utf8').catch(() => '')).trim());
      if (Number.isInteger(holder) && holder > 0 && !running(holder)) {
        await rm(lock, { force: true });
        continue;
      }
      if (Date.now() > until) {
        throw new Error(
          `Waited ${within} ms for Word's turn at ${lock}, held by process ${holder}`,
          {
            cause: error,
          },
        );
      }
      await new Promise((resolve) => setTimeout(resolve, every));
    }
  }
  try {
    return await work();
  } finally {
    await rm(lock, { force: true });
  }
}
