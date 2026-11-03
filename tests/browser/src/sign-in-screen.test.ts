import { describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { checkAxe } from './testing/axe.js';
import { allowPageNoise, withPage } from './testing/page.js';

/**
 * The screen a page opened with nobody signed in meets, in the pinned Chromium, through the stand-in
 * provider: in, back at the page asked for, out, and on the screen again rather than signed straight
 * back in. Uncited: the jsdom tests cite what a person sees.
 */
describe('the sign-in screen, in Chromium', () => {
  it('signs in from a deep address and comes back to it, and signing out returns to the screen', async ({
    task,
  }) => {
    allowPageNoise(/status of 401 \(Unauthorized\) \(http:\/\/[^)]*\/v1\/me/);
    await withPage(
      async (page) => {
        await page.goto(`${SERVICE}/#/documents`);
        const way = page.getByRole('link', { name: 'Sign in', exact: true });
        await way.waitFor();
        expect(await page.getByRole('banner').count()).toBe(0);
        await checkAxe(page, 'the sign-in screen', task.meta, { shows: way });
        await page.keyboard.press('Tab');
        expect(await way.evaluate((element) => element === document.activeElement)).toBe(true);

        await way.click();
        await page.getByRole('link', { name: /^Ada / }).click();
        const account = page.getByRole('button', { name: /Ada/ });
        await account.waitFor();
        expect(new URL(page.url()).hash).toBe('#/documents');

        await account.click();
        await page.getByRole('button', { name: 'Sign out', exact: true }).click();
        await way.waitFor();
        expect(await page.getByRole('banner').count()).toBe(0);
        expect(new URL(page.url()).origin).toBe(new URL(SERVICE).origin);
      },
      { signedIn: false },
    );
  });
});
