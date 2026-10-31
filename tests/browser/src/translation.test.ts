import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api } from './testing/api.js';
import { translatedComponent } from './testing/fixtures.js';
import { withPage } from './testing/page.js';

/**
 * Translating a component in the pinned Chromium by the keyboard alone (the TR plan, TRc): a
 * translation begun from the component's Translations, opened on its own line, and found in the
 * space's report. Uncited: the jsdom and service tests cite what each demonstrates.
 */

/** Tab pressed until `target` holds the focus: at most `most` presses. */
async function tabTo(page: Page, target: Locator, most = 120) {
  for (let pressed = 0; pressed < most; pressed++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`${String(target)} never took the focus`);
}

describe('translating a component, in Chromium', () => {
  it('begins a translation by the keyboard alone, opens it on its line, and finds it in the report', async () => {
    const component = await translatedComponent(api());
    await withPage(async (page) => {
      await page.goto(`${SERVICE}/#/components/${component.id}`);
      const translations = page.getByRole('button', { name: 'Translations' });
      await translations.waitFor();
      await tabTo(page, translations);
      await page.keyboard.press('Enter');

      const dialog = page.getByRole('dialog', { name: 'Translations' });
      // The French one begun already, listed with its status.
      await dialog.getByRole('list', { name: 'Translations' }).getByText('fr-FR').waitFor();
      const language = dialog.getByRole('textbox', { name: 'Language' });
      await tabTo(page, language);
      await page.keyboard.type('de-DE');
      await tabTo(page, dialog.getByRole('button', { name: 'Begin a translation' }));
      await page.keyboard.press('Enter');

      // Opened on its own line, the source's words in German's root to start from.
      await page.waitForURL(/#\/components\/[0-9a-f-]{36}\/lines\/[0-9a-f-]{36}$/, {
        timeout: 30_000,
      });
      expect(page.url()).toContain(component.id);

      await page.goto(`${SERVICE}/#/translations`);
      // The picker shows once the spaces have loaded, and only where there is more than one; the
      // report opens on the first by name, so choose General before reading it (#841).
      const space = page.getByRole('combobox', { name: 'Space' });
      const table = page.getByRole('table', { name: /Translated components/ });
      await space.or(table).first().waitFor();
      if ((await space.count()) > 0) await space.selectOption({ label: 'General' });
      const row = table.getByRole('row', { name: new RegExp(component.title) });
      await row.waitFor();
      expect(await row.textContent()).toMatch(/de-DE: Untranslated.*fr-FR: Untranslated/);
    });
  });
});
