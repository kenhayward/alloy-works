import type { Page, Route } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { withPage } from './testing/page.js';
import { instrument, measure } from './testing/timing.js';

/**
 * The budgets' own clock (`testing/timing.ts`), on a page of the test's own: a tree item that a click
 * removes once a request is answered, the service played by the test with a delay it chooses. Cites
 * nothing - it tests the measurement, not the product.
 */

const ORIGIN = 'http://timing.localhost';

/** A page whose one button, clicked, asks each of `paths`, reads each answer, and removes the tree item. */
function pageAsking(paths: readonly string[]): string {
  return `<!doctype html><html><body>
    <ul role="tree"><li role="treeitem" data-node="n1">One</li></ul>
    <button id="act">Act</button>
    <script>
      document.getElementById('act').addEventListener('click', async () => {
        await Promise.all(${JSON.stringify(paths)}.map(async (path) => (await fetch(path, { method: 'POST' })).json()));
        document.querySelector('[data-node="n1"]').remove();
      });
    </script>
  </body></html>`;
}

/** The test's own service: the page at `/`, and every other path answered after `delayMs`. */
async function serve(page: Page, html: string, delayMs: number): Promise<void> {
  await page.route(`${ORIGIN}/**`, async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') {
      await route.fulfill({ contentType: 'text/html', body: html });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({ contentType: 'application/json', body: '{}' });
  });
  await page.addInitScript(instrument);
  await page.goto(`${ORIGIN}/`);
}

describe("the budgets' clock", () => {
  it('takes the time the act waited on its own request out of the interface share', async () => {
    await withPage(
      async (page) => {
        await serve(page, pageAsking(['/v1/documents/d1/outline']), 120);
        const measured = await measure(
          page,
          { kind: 'gone', node: 'n1' },
          () => page.locator('#act').click(),
          { expects: [/^\/v1\/documents\/[^/]+\/outline$/] },
        );
        expect(measured.service).toBeGreaterThanOrEqual(100);
        expect(measured.interface).toBeLessThan(measured.whole - 100);
        expect(measured.requests.map((each) => each.name)).toEqual(['/v1/documents/d1/outline']);
      },
      { signedIn: false },
    );
  });

  it('refuses a sample in whose window a request the act does not make was answered', async () => {
    await withPage(
      async (page) => {
        // A heartbeat, say, answered while the act waits: subtracted, it would be taken off the
        // interface's share as though the act had waited on it.
        await serve(page, pageAsking(['/v1/documents/d1/outline', '/v1/heartbeat']), 60);
        await expect(
          measure(page, { kind: 'gone', node: 'n1' }, () => page.locator('#act').click(), {
            expects: [/^\/v1\/documents\/[^/]+\/outline$/],
          }),
        ).rejects.toThrow(/\/v1\/heartbeat/);
      },
      { signedIn: false },
    );
  });
});
