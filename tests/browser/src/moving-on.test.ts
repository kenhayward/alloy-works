import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';

import { SERVICE } from './testing/addresses.js';
import { api, edit, makeDocument } from './testing/api.js';
import { makeComponent } from './testing/component.js';
import { withPage } from './testing/page.js';

/**
 * Moving on from a part open in place, in the pinned Chromium (the EP plan, EP5; #970): what was typed
 * stays on the page, a version is cut and the lock is released.
 */
const para = (id: string, value: string) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [{ type: 'text', value, marks: [] }],
});

const versionOf = async (client: ReturnType<typeof api>, component: string) => {
  const { data } = await client.GET('/v1/components/{id}', {
    params: { path: { id: component } },
  });
  return data!;
};

async function parts(mode: 'latest' | 'pinned' = 'latest') {
  const client = api();
  const stamp = String(Date.now());
  const first = await makeComponent(client, `First ${stamp}`, [
    para('a1', 'First words.'),
  ] as never);
  const second = await makeComponent(client, `Second ${stamp}`, [
    para('b1', 'Second words.'),
  ] as never);
  const third = await makeComponent(client, `Third ${stamp}`, [
    para('c1', 'Third words.'),
  ] as never);
  let made = await makeDocument(client, `Moving on ${stamp}`, []);
  for (const [position, component] of [first, second, third].entries()) {
    made = await edit(client, made, {
      operation: 'insert',
      parent: null,
      position,
      node: {
        type: 'reference',
        component: component.id,
        mode:
          mode === 'pinned' && position === 0
            ? { kind: 'pinned', version: (await versionOf(client, component.id)).version.id }
            : { kind: 'latest' },
      },
    });
  }
  return { client, document: made.id, first: first.id, second: second.id };
}

const openAuthoring = async (page: Page, id: string) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await page.goto(`${SERVICE}/#/documents/${id}`);
  await page.getByRole('radio', { name: 'Authoring' }).check();
  await page.getByText('First words.').first().waitFor();
};

/** Types into the first part, and waits for its autosave. */
const typeIntoFirst = async (page: Page) => {
  await page.getByText('First words.').first().click();
  const surface = page.getByRole('textbox', { name: /^Content of First/ });
  await surface.waitFor();
  await surface.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Typed here.');
  return surface;
};

describe('moving on from a part open in place, in Chromium (#970)', () => {
  it('CNT-070 COL-010 keeps the words, cuts a version and releases the lock on clicking another part', async () => {
    const { client, document, first } = await parts();
    const before = await versionOf(client, first);
    await withPage(async (page) => {
      await openAuthoring(page, document);
      await typeIntoFirst(page);
      await page.getByText('Second words.').first().click();
      await page.getByRole('textbox', { name: /^Content of Second/ }).waitFor();
      await page.getByText('First words. Typed here.').first().waitFor();
    });
    const after = await versionOf(client, first);
    expect(after.version.id).not.toBe(before.version.id);
    expect(after.lock).toBeNull();
  });

  it('opens the last part clicked, where a third is clicked while the first is closing', async () => {
    const { document } = await parts();
    await withPage(async (page) => {
      await openAuthoring(page, document);
      await typeIntoFirst(page);
      // Held back, so that the closing is still going on at the second click.
      await page.route('**/v1/components/*/lock', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await route.continue();
      });
      await page.getByText('Second words.').first().click();
      await page.getByText('Third words.').first().click();
      await page.getByRole('textbox', { name: /^Content of Third/ }).waitFor();
      expect(await page.getByRole('textbox', { name: /^Content of Second/ }).count()).toBe(0);
      await page.getByText('First words. Typed here.').first().waitFor();
    });
  });

  it('CNT-070 keeps the words of a pinned part, its pin moved to the version cut', async () => {
    const { client, document, first } = await parts('pinned');
    await withPage(async (page) => {
      await openAuthoring(page, document);
      await typeIntoFirst(page);
      await page.getByText('Second words.').first().click();
      await page.getByRole('textbox', { name: /^Content of Second/ }).waitFor();
      await page.getByText('First words. Typed here.').first().waitFor();
      await page.waitForTimeout(500);
      await page.getByText('First words. Typed here.').first().waitFor();
    });
    expect((await versionOf(client, first)).lock).toBeNull();
  });

  it('counts a switch of mode as moving on, and leaving the page as not', async () => {
    const { client, document, first, second } = await parts();
    const before = await versionOf(client, first);
    await withPage(async (page) => {
      await openAuthoring(page, document);
      await typeIntoFirst(page);
      // It takes once the part has closed.
      const reading = page.getByRole('radio', { name: 'Reading' });
      await reading.click();
      await expect.poll(() => reading.isChecked()).toBe(true);
      await page.getByText('First words. Typed here.').first().waitFor();
      await expect
        .poll(async () => (await versionOf(client, first)).version.id)
        .not.toBe(before.version.id);

      const held = await versionOf(client, second);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      await page.getByText('Second words.').first().click();
      const surface = page.getByRole('textbox', { name: /^Content of Second/ });
      await surface.click();
      await page.keyboard.type('More. ');
      // Saved, not cut, on leaving: the words come back on return.
      await expect.poll(async () => (await versionOf(client, second)).lock).not.toBeNull();
      await page.getByRole('link', { name: 'Home', exact: true }).click();
      expect((await versionOf(client, second)).version.id).toBe(held.version.id);
    });
  });

  it('closes on a click on empty sheet with nothing changed, and stays open with changes', async () => {
    const { document } = await parts();
    await withPage(async (page) => {
      await openAuthoring(page, document);
      await page.getByText('First words.').first().click();
      const surface = page.getByRole('textbox', { name: /^Content of First/ });
      await surface.waitFor();
      const sheet = (await page.locator('.aw-sheet').first().boundingBox())!;
      const below = { x: sheet.x + sheet.width / 2, y: sheet.y + sheet.height - 20 };

      await page.mouse.click(below.x, below.y);
      await expect.poll(() => surface.count()).toBe(0);

      const again = await typeIntoFirst(page);
      await page.mouse.click(below.x, below.y);
      await page.waitForTimeout(400);
      expect(await again.count()).toBe(1);

      // A drag ending on the sheet is no click on it, and the toolbar is not the sheet.
      await page.getByRole('toolbar', { name: 'Part toolbar' }).click({ position: { x: 2, y: 2 } });
      expect(await again.count()).toBe(1);
    });
  });

  it('REU-008 asks before moving on from a part used elsewhere, and stays open on Cancel', async () => {
    const { client, document, first } = await parts();
    const other = await makeDocument(client, `Also using it ${Date.now()}`, []);
    await edit(client, other, {
      operation: 'insert',
      parent: null,
      position: 0,
      node: { type: 'reference', component: first, mode: { kind: 'latest' } },
    });
    await withPage(async (page) => {
      await openAuthoring(page, document);
      const surface = await typeIntoFirst(page);
      await page.getByText('Second words.').first().click();
      const question = page.getByRole('dialog');
      await question.getByRole('button', { name: 'Cancel' }).click();
      await page.waitForTimeout(300);
      expect(await surface.count()).toBe(1);
      expect(await page.getByRole('textbox', { name: /^Content of Second/ }).count()).toBe(0);

      // Answered the other way it moves on, and Done asks the same, where it can be seen.
      await page.getByText('Second words.').first().click();
      await question.getByRole('button', { name: 'Done editing' }).click();
      await page.getByRole('textbox', { name: /^Content of Second/ }).waitFor();
      await page.getByText('First words. Typed here.').first().waitFor();
    });
  });
});
