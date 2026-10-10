import { afterAll, beforeEach, inject } from 'vitest';
import type { Browser, Locator, Page } from 'playwright-core';
import { launchPinned } from './launch.js';

/** One browser per file, launched the first time a test asks for a page and closed after the file. */
let browser: Promise<Browser> | null = null;

afterAll(async () => {
  const launched = browser;
  browser = null;
  if (launched !== null) await (await launched).close();
});

/** What this test expects its page to say, each line matching one. Re-armed before every test. */
let allowed: readonly RegExp[] = [];

beforeEach(() => {
  allowed = [];
});

/**
 * Lets this one test's page say what the test provokes on purpose - each console line or uncaught
 * exception that matches one of `expected` - and nothing else: any other error, warning or exception
 * still fails the test. The gate re-arms for the next test, as the jsdom suite's `allowConsoleNoise`
 * does.
 */
export function allowPageNoise(...expected: [RegExp, ...RegExp[]]): void {
  allowed = expected;
}

/**
 * A fresh context, signed in as Ada from the run's saved storage state, at a desktop viewport, and a
 * page in it, handed to `test` and closed after it: nothing one test leaves reaches the next.
 *
 * **The page's console is gated** (the W13 plan's B-H): a `console.error`, a `console.warn` or an
 * uncaught exception in the page fails the test, naming what was said and where, unless the test
 * called `allowPageNoise()` with a pattern it matches. A run of the page's own console into the run's output is where nobody
 * reads it.
 *
 * `signedIn: false` starts the context with nothing in it instead, for the screens a person meets
 * before signing in.
 */
export async function withPage<T>(
  test: (page: Page) => Promise<T>,
  { signedIn = true }: { readonly signedIn?: boolean } = {},
): Promise<T> {
  browser ??= launchPinned();
  const context = await (
    await browser
  ).newContext({
    ...(signedIn ? { storageState: inject('storageState') } : {}),
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
  const unexpected = noise.filter((said) => !allowed.some((pattern) => pattern.test(said)));
  if (unexpected.length > 0) {
    throw new Error(
      `The page was not quiet during this test:\n${unexpected.join('\n')}\n` +
        'Fix the cause, or call allowPageNoise() with what this test provokes on purpose.',
    );
  }
  return result;
}

/**
 * Scrolls the pane an element stands in - its nearest scrolling ancestor - so the element begins at
 * the pane's top, and nothing above it is left half in view, which axe counts as a target obscured.
 * The window stays where it is, unlike `scrollIntoView`, which scrolls every scroller holding it.
 */
export async function scrollPaneTo(target: Locator): Promise<void> {
  await target.evaluate((element) => {
    let pane = element.parentElement;
    while (pane !== null && !/(auto|scroll)/.test(getComputedStyle(pane).overflowY)) {
      pane = pane.parentElement;
    }
    if (pane === null) return;
    pane.scrollTop += element.getBoundingClientRect().top - pane.getBoundingClientRect().top;
  });
}
