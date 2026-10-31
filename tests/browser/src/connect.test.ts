import { describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { checkAxe } from './testing/axe.js';
import { allowPageNoise, withPage } from './testing/page.js';

/**
 * The desktop's Connect to screen (the DR plan, DR-B) in the pinned Chromium: the served renderer
 * given a bridge as the desktop's preload gives one, its `connectTo` answering as the shell would.
 * Uncited: the jsdom tests cite what a person sees; this holds it to axe and the keyboard alone.
 */

/** A desktop bridge in the page before the renderer reads it, refusing every address as unreachable. */
const DESKTOP_BRIDGE = `window.alloyWorks = {
  getPlatformInfo: async () => ({ delivery: 'desktop', runtime: 'Electron', connectedTo: 'https://acme.example' }),
  opensServedPages: false,
  setSpellCheckLanguages: async () => {},
  setInterfaceLanguage: async () => {},
  connectTo: async () => ({ kind: 'refused', reason: 'unreachable' }),
};`;

describe('the Connect to screen, in Chromium (the DR plan, DR-B)', () => {
  it('passes axe asking, and saying an address did not answer, reached by the keyboard alone', async ({
    task,
  }) => {
    // The interface's language asks who is signed in before anything else: on this served page,
    // nobody. From disk, in the desktop, there is no service to ask.
    allowPageNoise(/status of 401 \(Unauthorized\) \(http:\/\/[^)]*\/v1\/me/);
    await withPage(
      async (page) => {
        await page.addInitScript(DESKTOP_BRIDGE);
        await page.goto(`${SERVICE}/#/connect`);
        const field = page.getByRole('textbox', { name: 'Environment address' });
        await expect.poll(() => field.inputValue()).toBe('https://acme.example');
        await checkAxe(page, 'the Connect to screen', task.meta, { shows: field });
        await page.goto(`${SERVICE}/#/connect?unreachable`);
        await page.reload();
        const alert = page.getByRole('alert');
        await alert.waitFor();
        await checkAxe(page, 'the Connect to screen, unreachable', task.meta, { shows: alert });
        await page.keyboard.press('Tab');
        expect(await field.evaluate((element) => element === document.activeElement)).toBe(true);
        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');
        await expect
          .poll(() => alert.textContent())
          .toBe('Nothing answered at that address. Check it, and your connection.');
      },
      { signedIn: false },
    );
  });
});
