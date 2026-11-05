import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';

import { SERVICE } from './testing/addresses.js';
import { api, edit, makeDocument } from './testing/api.js';
import { makeComponent } from './testing/component.js';
import { withPage } from './testing/page.js';

const para = (id: string, text: string) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [{ type: 'text', value: text, marks: [] }],
});

async function onePart() {
  const client = api();
  const stamp = String(Date.now());
  const component = await makeComponent(client, `Bench testing ${stamp}`, [
    para('a1', 'First words.'),
  ] as never);
  let made = await makeDocument(client, `The Part panel ${stamp}`, []);
  made = await edit(client, made, {
    operation: 'insert',
    parent: null,
    position: 0,
    node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
  });
  return made.id;
}

async function chosen(page: Page, id: string, width = 1920) {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(`${SERVICE}/#/documents/${id}`);
  await page.getByRole('radio', { name: 'Authoring' }).check();
  await page.getByText('First words.').first().click();
  const row = page.getByRole('button', { name: /choose the version of/ });
  await row.waitFor();
  return row;
}

/** Whether what is on top at each of an element's inner corners and its middle is the element itself. */
const onTop = (locator: Locator) =>
  locator.evaluate((own) => {
    const { top, bottom, left, right } = own.getBoundingClientRect();
    return [
      [left + 4, top + 4],
      [right - 4, top + 4],
      [left + 4, bottom - 4],
      [right - 4, bottom - 4],
      [(left + right) / 2, (top + bottom) / 2],
    ].every(([x, y]) => own.contains(document.elementFromPoint(x!, y!)));
  });

const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  if (found === null) throw new Error(`${String(locator)} is not drawn`);
  return found;
};

describe('the Part panel, second pass, in Chromium (part-panel-2)', () => {
  it('CNT-158 CNT-162 opens the version menu under its row, as wide, over everything, and pins from it', async () => {
    const id = await onePart();
    await withPage(async (page) => {
      const row = await chosen(page, id);
      expect((await box(row)).height).toBeGreaterThanOrEqual(34);
      expect((await box(row)).height).toBeLessThan(40);
      await row.click();
      const menu = page.getByRole('menu', { name: /^Versions of / });
      const version = menu.getByRole('menuitemradio', { name: /^Version / }).first();
      await version.waitFor();
      const [drawn, under] = [await box(row), await box(menu)];
      expect(under.x).toBeCloseTo(drawn.x, 0);
      expect(under.width).toBeCloseTo(drawn.width, 0);
      expect(under.y).toBeCloseTo(drawn.y + drawn.height + 4, 0);
      expect(await onTop(menu)).toBe(true);
      await version.click();
      await page.getByRole('button', { name: /pinned, choose the version of/ }).waitFor();
      expect(await page.getByRole('menu').count()).toBe(0);
    });
  });

  it('keeps the menu in the window on a page too short for it', async () => {
    const id = await onePart();
    await withPage(async (page) => {
      const row = await chosen(page, id);
      await page.setViewportSize({ width: 1920, height: 420 });
      await row.click();
      const menu = page.getByRole('menu', { name: /^Versions of / });
      await menu
        .getByRole('menuitemradio', { name: /^Version / })
        .first()
        .waitFor();
      const under = await box(menu);
      expect(under.y).toBeGreaterThanOrEqual(0);
      expect(under.y + under.height).toBeLessThanOrEqual(420);
      expect(await onTop(menu)).toBe(true);
    });
  });

  it('REU-011 tips Overrides at once and over everything, saying what it does, and opens its dialog', async () => {
    const id = await onePart();
    await withPage(async (page) => {
      await chosen(page, id);
      const icon = page.getByRole('button', { name: /^Overrides/ });
      await icon.hover();
      const tip = page.locator('[data-name-tip]');
      await expect.poll(() => tip.textContent()).toContain('in this document only');
      expect(await onTop(tip)).toBe(true);
      const shown = await box(tip);
      expect(shown.x).toBeGreaterThanOrEqual(0);
      expect(shown.x + shown.width).toBeLessThanOrEqual(1920);
      expect(await icon.getAttribute('title')).toBeNull();
      await icon.click();
      await page.getByRole('dialog', { name: /^Overrides of / }).waitFor();
    });
  });

  it('keeps every tip of the head in the window at the last icon', async () => {
    const id = await onePart();
    await withPage(async (page) => {
      await chosen(page, id);
      await page.getByRole('button', { name: /^Remove component/ }).hover();
      const tip = page.locator('[data-name-tip]');
      await expect.poll(() => tip.textContent()).toBe('Remove component');
      const shown = await box(tip);
      expect(shown.x + shown.width).toBeLessThanOrEqual(1920);
      expect(await onTop(tip)).toBe(true);
    });
  });
});
