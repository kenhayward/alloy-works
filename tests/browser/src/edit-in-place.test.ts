import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';

import { SERVICE } from './testing/addresses.js';
import { api, edit, makeDocument } from './testing/api.js';
import { makeComponent, uploadImage } from './testing/component.js';
import { everyBlock } from './testing/every-block.js';
import { withPage } from './testing/page.js';

/**
 * Clicking into a document's text, in the pinned Chromium (the EP plan, EP2): nothing moves, the words
 * never leave the page, and one rule says which part is open.
 */
const para = (id: string, value: string) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [{ type: 'text', value, marks: [] }],
});
const item = (id: string, value: string) => ({ content: [para(id, value)] });

const words = (lead: string) =>
  `${lead} The objective of this exercise is to record what each system says, and to keep it. `.repeat(
    2,
  );

async function twoParts() {
  const client = api();
  const stamp = String(Date.now());
  const first = await makeComponent(client, `First ${stamp}`, [
    para('a1', words('First words.')),
    {
      type: 'list',
      id: 'l1',
      kind: 'ordered',
      start: 1,
      format: 'decimal',
      items: [item('i1', 'One thing to do.'), item('i2', 'Another thing to do.')],
    },
    para('a2', 'Last words of the first.'),
  ] as never);
  const second = await makeComponent(client, `Second ${stamp}`, [
    para('b1', words('Following words.')),
  ] as never);
  let made = await makeDocument(client, `Editing in place ${stamp}`, []);
  for (const [position, component] of [first, second].entries()) {
    made = await edit(client, made, {
      operation: 'insert',
      parent: null,
      position,
      node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
    });
  }
  return { document: made.id, first: first.id };
}

/** Where each named run of words stands, to the tenth of a pixel. */
const standing = (page: Page) =>
  page.evaluate(() => {
    const at = (text: string) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (node.textContent?.startsWith(text)) {
          const box = node.parentElement!.getBoundingClientRect();
          return [box.left, box.top, box.height].map((each) => Math.round(each * 10) / 10);
        }
      }
      return null;
    };
    return {
      first: at('First words.'),
      list: at('Another thing'),
      last: at('Last words'),
      next: at('Following words.'),
    };
  });

/** Each frame from here on: whether the words are on the page, and whether the next part moved. */
const watchFrames = (page: Page) =>
  page.evaluate(() => {
    const seen = window as unknown as { frames_: string[]; stop_: boolean };
    seen.frames_ = [];
    seen.stop_ = false;
    const has = (text: string) =>
      (document.querySelector('.aw-canvas')?.textContent ?? '').includes(text);
    const next = () => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (node.textContent?.startsWith('Following words.')) {
          return Math.round(node.parentElement!.getBoundingClientRect().top);
        }
      }
      return null;
    };
    const tick = () => {
      if (seen.stop_) return;
      seen.frames_.push(`${has('First words.')}:${has('ZED')}:${next()}`);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

const framesSeen = (page: Page) =>
  page.evaluate(() => {
    const seen = window as unknown as { frames_: string[]; stop_: boolean };
    seen.stop_ = true;
    return [...new Set(seen.frames_)];
  });

const edgesOf = (page: Page) =>
  page.evaluate(() => {
    const part = [...document.querySelectorAll('[data-component]')].find((each) =>
      each.textContent?.includes('First words.'),
    )!;
    const rule = getComputedStyle(part, '::before');
    const card = part.querySelector('article');
    const surface = part.querySelector('[class*=surface]');
    return {
      rule: rule.borderInlineStartWidth,
      colour: rule.borderInlineStartColor,
      outline: getComputedStyle(part).outlineStyle,
      card: card === null ? null : getComputedStyle(card).boxShadow,
      surface: surface === null ? null : getComputedStyle(surface).outlineStyle,
    };
  });

describe('clicking into a document, in Chromium', () => {
  it('moves nothing on opening, keeps the words on the page, and marks the part with one rule', async () => {
    const { document: id } = await twoParts();
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1920, height: 1000 });
      await page.goto(`${SERVICE}/#/documents/${id}`);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      const target = page.getByText('First words.').first();
      await target.waitFor();
      await page.waitForTimeout(500);
      const before = await standing(page);

      // Held back, so that a frame without the words could not be missed.
      await page.route('**/v1/components/*', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        await route.continue();
      });
      await watchFrames(page);
      await target.click();
      await page.locator('.ProseMirror').first().waitFor();
      await page.waitForTimeout(300);
      const frames = await framesSeen(page);

      expect(frames.filter((each) => each.startsWith('false'))).toEqual([]);
      expect(new Set(frames.map((each) => each.split(':')[2])).size, frames.join(' ')).toBe(1);
      expect(await standing(page)).toEqual(before);

      const edges = await edgesOf(page);
      expect(edges.rule).toBe('3px');
      expect(edges.outline).toBe('none');
      expect(edges.card).toBe('none');
      expect(edges.surface).toBe('none');
    });
  });

  it('keeps a part holding every kind of block within a few pixels, and never sideways', async () => {
    const client = api();
    const image = await uploadImage(client, 'A small square');
    const figure = await uploadImage(client, 'A blue rectangle');
    const every = await makeComponent(client, `Every block ${Date.now()}`, [
      para('e0', 'First words.'),
      ...everyBlock(figure, image),
    ] as never);
    const after = await makeComponent(client, 'What follows', [
      para('n1', 'Following words.'),
    ] as never);
    let made = await makeDocument(client, `Every block ${Date.now()}`, []);
    for (const [position, component] of [every, after].entries()) {
      made = await edit(client, made, {
        operation: 'insert',
        parent: null,
        position,
        node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
      });
    }
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1920, height: 1000 });
      await page.goto(`${SERVICE}/#/documents/${made.id}`);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      const target = page.getByText('First words.').first();
      await target.waitFor();
      await page.waitForTimeout(800);
      const before = await standing(page);
      await target.click();
      await page.locator('.ProseMirror').first().waitFor();
      await page.waitForTimeout(800);
      const now = await standing(page);
      expect(now.first).toEqual(before.first);
      // Sideways not at all, whatever the panels (a table's tab once widened them by 120px). Down the
      // page, an inline equation and the end of the text still give a few pixels: #973.
      expect(now.next![0]).toBe(before.next![0]);
      expect(Math.abs(now.next![1]! - before.next![1]!)).toBeLessThan(6);
    });
  });

  it('takes the keys typed while it opens, and keeps the words on the page on closing', async () => {
    const { document: id } = await twoParts();
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1920, height: 1000 });
      await page.goto(`${SERVICE}/#/documents/${id}`);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      const target = page.getByText('First words.').first();
      await target.waitFor();
      await page.waitForTimeout(500);

      await page.route('**/v1/components/*', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        await route.continue();
      });
      await target.click();
      await page.keyboard.type('ZED');
      await page.locator('.ProseMirror').first().waitFor();
      await expect.poll(() => page.locator('.ProseMirror').first().textContent()).toContain('ZED');
      await page.unroute('**/v1/components/*');

      // The save answered, and then closed: the words stand from the click on.
      await page.waitForTimeout(3000);
      await watchFrames(page);
      await page.getByRole('button', { name: 'Done editing' }).click();
      await page.locator('.ProseMirror').first().waitFor({ state: 'detached' });
      await page.waitForTimeout(800);
      const frames = await framesSeen(page);
      expect(frames.filter((each) => each.split(':')[1] === 'false')).toEqual([]);
    });
  });

  it("stands one toolbar over the part, in the reader's theme, its acts still as a table is entered", async () => {
    const client = api();
    const image = await uploadImage(client, 'A small mark');
    const figure = await uploadImage(client, 'A blue rectangle');
    const every = await makeComponent(client, `Every block ${Date.now()}`, [
      para('e0', 'First words.'),
      ...everyBlock(figure, image),
    ] as never);
    const made = await edit(client, await makeDocument(client, `One toolbar ${Date.now()}`, []), {
      operation: 'insert',
      parent: null,
      position: 0,
      node: { type: 'reference', component: every.id, mode: { kind: 'latest' } },
    });
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1920, height: 700 });
      await page.goto(`${SERVICE}/#/documents/${made.id}`);
      await page.evaluate(() => {
        document.documentElement.dataset['theme'] = 'dark';
      });
      await page.getByRole('radio', { name: 'Authoring' }).check();
      const target = page.getByText('First words.').first();
      await target.waitFor();
      await target.click();
      const bar = page.getByRole('toolbar', { name: 'Part toolbar' });
      await bar.waitFor();

      // Not the paper's light, whatever the sheet takes.
      const ground = await bar.evaluate((own) => getComputedStyle(own).backgroundColor);
      const paper = await page
        .locator('.aw-sheet')
        .first()
        .evaluate((own) => getComputedStyle(own).backgroundColor);
      expect(ground).not.toBe(paper);

      // Above the part, heading and all, at its end.
      const part = (await page.locator('[data-component]').first().boundingBox())!;
      const box = (await bar.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(part.y);
      expect(box.x + box.width).toBeCloseTo(part.x + part.width, 0);

      const done = bar.getByRole('button', { name: 'Done editing' });
      const before = (await done.boundingBox())!;
      await page.locator('[data-component] figure.aw-table td').first().click();
      const table = bar.getByRole('button', { name: /settings/ });
      await table.waitFor();
      const after = (await done.boundingBox())!;
      expect(after.x).toBeCloseTo(before.x, 0);
      expect(after.y).toBeCloseTo(before.y, 0);

      // Scrolled down the part it stays in view.
      await page.evaluate(() => {
        const scrolled = [document.scrollingElement, ...document.querySelectorAll('*')].find(
          (each) =>
            each !== null &&
            each.scrollHeight > each.clientHeight + 200 &&
            ['auto', 'scroll'].includes(getComputedStyle(each).overflowY) &&
            each.querySelector('[data-component]') !== null,
        );
        scrolled?.scrollBy(0, 400);
      });
      await page.waitForTimeout(200);
      const stuck = (await bar.boundingBox())!;
      expect(stuck.y).toBeGreaterThanOrEqual(0);
      expect(stuck.y).toBeLessThan(120);
    });
  });

  it('shows the rule alone on hover, in forced colours too', async () => {
    const { document: id } = await twoParts();
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1920, height: 1000 });
      await page.goto(`${SERVICE}/#/documents/${id}`);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      const target = page.getByText('First words.').first();
      await target.waitFor();
      await target.hover();
      expect((await edgesOf(page)).rule).toBe('3px');
      expect((await edgesOf(page)).outline).toBe('none');

      await page.emulateMedia({ forcedColors: 'active' });
      const { colour } = await edgesOf(page);
      const ground = await target.evaluate(
        (element) => getComputedStyle(element.closest('.aw-canvas')!).backgroundColor,
      );
      expect(colour).not.toBe(ground);
    });
  });
});
