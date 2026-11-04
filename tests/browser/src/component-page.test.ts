import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';

import { SERVICE } from './testing/addresses.js';
import { api } from './testing/api.js';
import { makeComponent } from './testing/component.js';
import { withPage } from './testing/page.js';

/**
 * A component on the document's shell in the pinned Chromium (ADR-0085): what leaving it and changing
 * its mode do to its lock, as a document's do, measured from the service.
 */
async function openComponent(page: Page, id: string): Promise<Locator> {
  await page.goto(`${SERVICE}/#/components/${id}`);
  const surface = page.getByRole('textbox', { name: /^Content of / });
  await surface.waitFor();
  return surface;
}

const words = [
  {
    type: 'paragraph',
    id: 'p1',
    style: 'body',
    content: [{ type: 'text', value: 'The first words.', marks: [] }],
  },
];

describe("a component's own page", () => {
  it('keeps its lock while the rail hides the page, and Done editing lets it go, staying open', async () => {
    const client = api();
    const made = await makeComponent(client, 'Held across the rail', words);
    const held = async () => {
      const { data } = await client.GET('/v1/components/{id}', {
        params: { path: { id: made.id } },
      });
      return (data as { lock?: unknown } | undefined)?.lock ?? null;
    };
    await withPage(async (page) => {
      const surface = await openComponent(page, made.id);
      await surface.getByText('The first words.').click();
      await page.keyboard.press('End');
      await page.keyboard.type(' More.');
      await expect.poll(held).not.toBeNull();

      await page.getByRole('link', { name: 'Home', exact: true }).click();
      await expect.poll(() => surface.isVisible()).toBe(false);
      expect(await held()).not.toBeNull();
      await page.goBack();
      await surface.waitFor();

      await page.getByRole('button', { name: 'Done editing', exact: true }).click();
      await expect.poll(held).toBeNull();
      await surface.waitFor();
      expect(await surface.getByText('The first words. More.').count()).toBe(1);
    });
  });

  it('claims nothing in Reading, on a reload too, and takes the band away', async () => {
    const client = api();
    const made = await makeComponent(client, 'Only read', words);
    await withPage(async (page) => {
      const surface = await openComponent(page, made.id);
      await page.getByRole('radio', { name: 'Reading' }).check();
      await expect.poll(() => page.getByRole('toolbar', { name: 'Formatting' }).count()).toBe(0);
      await page.reload();
      await surface.waitFor();
      await expect.poll(() => page.getByRole('radio', { name: 'Reading' }).isChecked()).toBe(true);
      expect(await surface.getAttribute('contenteditable')).toBe('false');
      const { data } = await client.GET('/v1/components/{id}', {
        params: { path: { id: made.id } },
      });
      expect((data as { lock?: unknown } | undefined)?.lock ?? null).toBeNull();
      // Back to Authoring for whatever follows in this browser.
      await page.getByRole('radio', { name: 'Authoring' }).check();
      await page.getByRole('toolbar', { name: 'Formatting' }).waitFor();
    });
  });
});
