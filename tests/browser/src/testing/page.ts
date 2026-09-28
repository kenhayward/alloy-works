import { afterAll, beforeEach, inject } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { launchPinned } from './launch.js';

/** One browser per file, launched the first time a test asks for a page and closed after the file. */
let browser: Promise<Browser> | null = null;

afterAll(async () => {
  const launched = browser;
  browser = null;
  if (launched !== null) await (await launched).close();
});

/** Whether this test has opted out of the page's console gate. Re-armed before every test. */
let allowed = false;

beforeEach(() => {
  allowed = false;
});

/**
 * Opts this one test out of the page's console gate, because it provokes the noise on purpose. The
 * gate re-arms for the next test, as the jsdom suite's `allowConsoleNoise` does.
 */
export function allowPageNoise(): void {
  allowed = true;
}

/**
 * A fresh context, signed in as Ada from the run's saved storage state, at a desktop viewport, and a
 * page in it, handed to `test` and closed after it: nothing one test leaves reaches the next.
 *
 * **The page's console is gated** (the W13 plan's B-H): a `console.error`, a `console.warn` or an
 * uncaught exception in the page fails the test, naming what was said and where, unless the test
 * called `allowPageNoise()`. A run of the page's own console into the run's output is where nobody
 * reads it.
 */
export async function withPage<T>(test: (page: Page) => Promise<T>): Promise<T> {
  browser ??= launchPinned();
  const context = await (
    await browser
  ).newContext({
    storageState: inject('storageState'),
    viewport: { width: 1280, height: 800 },
    locale: 'en-GB',
  });
  const noise: string[] = [];
  let result: T;
  try {
    const page = await context.newPage();
    page.on('console', (message) => {
      const type = message.type();
      if (type !== 'error' && type !== 'warning') return;
      const { url, lineNumber } = message.location();
      noise.push(`console.${type}: ${message.text()}${url ? ` (${url}:${lineNumber + 1})` : ''}`);
    });
    page.on('pageerror', (error) => noise.push(`uncaught: ${error.message}`));
    try {
      result = await test(page);
    } catch (failure) {
      // The test's own failure comes first; what the page said is often why.
      if (noise.length > 0 && failure instanceof Error) {
        failure.message += `\n\nThe page also said:\n${noise.join('\n')}`;
      }
      throw failure;
    }
  } finally {
    await context.close();
  }
  if (noise.length > 0 && !allowed) {
    throw new Error(
      `The page was not quiet during this test:\n${noise.join('\n')}\n` +
        'Fix the cause, or call allowPageNoise() if this test provokes it on purpose.',
    );
  }
  return result;
}
