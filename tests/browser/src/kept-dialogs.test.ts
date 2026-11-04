import { describe, expect, it } from 'vitest';
import type { Locator, Page } from 'playwright-core';

import { SERVICE } from './testing/addresses.js';
import { api } from './testing/api.js';
import { makeComponent } from './testing/component.js';
import { withPage } from './testing/page.js';

/**
 * A dialog on a page the workspace keeps, in the pinned Chromium (#962): history is the one way out from
 * behind a modal, and the page arrived at answers while the dialog waits, hidden, for the way back.
 */

const words = [
  {
    type: 'paragraph',
    id: 'p1',
    style: 'body',
    content: [{ type: 'text', value: 'The words of a kept page.', marks: [] }],
  },
];

/** Opens the component by a link from Home, so that going back has somewhere to go. */
async function openFromHome(page: Page, id: string): Promise<Locator> {
  await page.goto(`${SERVICE}/#/`);
  await page.getByRole('navigation', { name: 'Modules' }).waitFor();
  await page.evaluate((to) => {
    window.location.hash = to;
  }, `#/components/${id}`);
  const surface = page.getByRole('textbox', { name: /^Content of / });
  await surface.waitFor();
  await page.getByText('Saved', { exact: true }).waitFor();
  return surface;
}

/** Back to Home, the dialog gone and the page answering; forward, the dialog as it was left. */
async function leaveAndReturn(page: Page, dialog: Locator): Promise<void> {
  await dialog.waitFor();
  await page.goBack();
  await expect.poll(() => dialog.count()).toBe(0);
  expect(await page.locator('#root').getAttribute('inert')).toBeNull();
  // Taken by the window, where a stale modal would hold it back.
  const terms = page
    .getByRole('navigation', { name: 'Modules' })
    .getByRole('link', { name: 'Terms', exact: true });
  await expect.poll(() => terms.evaluate((link) => link.closest('[inert]') === null)).toBe(true);

  await page.goForward();
  await dialog.waitFor();
  expect(await dialog.evaluate((own) => own.contains(document.activeElement))).toBe(true);
}

describe('a dialog on a kept page (#962)', () => {
  it('goes with the page on going back, and returns on going forward', async () => {
    const made = await makeComponent(api(), 'A dialog left behind', words);
    await withPage(async (page) => {
      const surface = await openFromHome(page, made.id);
      await surface.getByText('The words of a kept page.').click();
      await page.getByRole('button', { name: 'Symbols', exact: true }).click();
      await leaveAndReturn(page, page.getByRole('dialog', { name: /Symbol/ }));
    });
  });

  it('gives the window back where the dialog makes the rest of it inert', async () => {
    const made = await makeComponent(api(), 'An inert page left behind', words);
    await withPage(async (page) => {
      const surface = await openFromHome(page, made.id);
      // Offered once there is saved text of the author's to list.
      await surface.getByText('The words of a kept page.').click();
      await page.keyboard.type(' More.');
      const offered = page.getByRole('button', { name: 'Saved text', exact: true });
      await expect
        .poll(() => offered.getAttribute('aria-disabled'), { timeout: 20_000 })
        .not.toBe('true');
      await offered.click();
      const dialog = page.getByRole('dialog', { name: 'Saved text' });
      await dialog.waitFor();
      expect(await page.locator('#root').getAttribute('inert')).not.toBeNull();
      await leaveAndReturn(page, dialog);
      expect(await page.locator('#root').getAttribute('inert')).not.toBeNull();
    });
  });
});
