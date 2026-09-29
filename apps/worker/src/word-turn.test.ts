import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { inWordsTurn } from './testing/word-turn.js';

/**
 * **One Word at a time** (W15.2): the Word check, its export-only mode and Word's measurement each
 * start a Word of their own, and the Word check's script refuses to start while any Word runs - so the
 * worker suite's files, which run side by side, take turns at Word through a lock file, and the whole
 * suite runs with the switch on as W15-D asks.
 */
describe('taking turns at Word', () => {
  let folder = '';
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'alloy-works-word-turn-'));
  });
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it('lets one file drive Word at a time, the next waiting for the first to finish', async () => {
    const lock = join(folder, 'word.lock');
    const events: string[] = [];
    const turn = (name: string, ms: number) =>
      inWordsTurn(
        async () => {
          events.push(`${name} starts`);
          await new Promise((resolve) => setTimeout(resolve, ms));
          events.push(`${name} ends`);
          return name;
        },
        { lock, every: 10 },
      );
    const done = await Promise.all([turn('first', 60), turn('second', 10)]);
    expect(done).toEqual(['first', 'second']);
    // Whichever takes the turn first, the other starts only once it has ended.
    const [one, other] = [events[0]!.split(' ')[0]!, events[2]?.split(' ')[0] ?? ''];
    expect(new Set([one, other])).toEqual(new Set(['first', 'second']));
    expect(events).toEqual([`${one} starts`, `${one} ends`, `${other} starts`, `${other} ends`]);
  });

  it('gives the turn up when the work fails, so the next is not kept waiting', async () => {
    const lock = join(folder, 'word.lock');
    await expect(
      inWordsTurn(
        async () => {
          throw new Error('Word refused');
        },
        { lock, every: 10 },
      ),
    ).rejects.toThrow('Word refused');
    await expect(inWordsTurn(async () => 'next', { lock, every: 10 })).resolves.toBe('next');
  });

  it('takes a turn a process that has ended left behind', async () => {
    const lock = join(folder, 'word.lock');
    // A process number no process holds: past the largest a system gives out.
    await writeFile(lock, '2147483646');
    await expect(inWordsTurn(async () => 'taken', { lock, every: 10 })).resolves.toBe('taken');
  });

  it('lets one of several waiters take a turn a process that has ended left behind, never two at once', async () => {
    // Every waiter sees the same ended holder; the first to take the turn must not have its lock taken
    // from it by another that saw the ended one too.
    for (let round = 0; round < 20; round += 1) {
      const lock = join(folder, `word-${round}.lock`);
      await writeFile(lock, '2147483646');
      let inside = 0;
      let most = 0;
      await Promise.all(
        Array.from({ length: 4 }, () =>
          inWordsTurn(
            async () => {
              inside += 1;
              most = Math.max(most, inside);
              await new Promise((resolve) => setTimeout(resolve, 5));
              inside -= 1;
            },
            { lock, every: 1 },
          ),
        ),
      );
      expect(most, `round ${round}`).toBe(1);
    }
  });

  it('takes a turn whose lock was left empty a while ago, by a process that ended before it wrote its number', async () => {
    const lock = join(folder, 'word.lock');
    await writeFile(lock, '');
    const before = new Date(Date.now() - 60_000);
    await utimes(lock, before, before);
    await expect(inWordsTurn(async () => 'taken', { lock, every: 10 })).resolves.toBe('taken');
  });

  it('waits on a lock just made and still empty, whose maker is writing its number', async () => {
    const lock = join(folder, 'word.lock');
    await writeFile(lock, '');
    await expect(inWordsTurn(async () => 'never', { lock, every: 10, within: 50 })).rejects.toThrow(
      /word\.lock/,
    );
  });

  it('stops waiting after as long as it is told, naming the lock', async () => {
    const lock = join(folder, 'word.lock');
    await writeFile(lock, String(process.pid));
    await expect(inWordsTurn(async () => 'never', { lock, every: 10, within: 50 })).rejects.toThrow(
      /word\.lock/,
    );
  });
});
