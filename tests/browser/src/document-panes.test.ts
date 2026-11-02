import { beforeAll, describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api, edit, makeDocument } from './testing/api.js';
import { checkAxe } from './testing/axe.js';
import { makeComponent } from './testing/component.js';
import { fromMenu, withPage } from './testing/page.js';

/**
 * The panes beside a document's text in the pinned Chromium: the outline on the left and the panels
 * on the right start at the same height, stand under the header as the text scrolls, and each hides
 * to a rail of its own. Uncited: it is how the page is laid out, which no requirement names.
 */

describe("the panes beside a document's text, in Chromium", () => {
  let report = '';
  beforeAll(async () => {
    const client = api();
    const paragraphs = Array.from({ length: 40 }, (_, at) => ({
      type: 'paragraph',
      id: `p${at}`,
      style: 'body',
      content: [
        {
          type: 'text',
          value: `Paragraph ${at + 1}. The readings at each site are taken at the same hour each morning and checked against the day before.`,
          marks: [],
        },
      ],
    }));
    const component = await makeComponent(client, 'Readings by site', paragraphs as never);
    let made = await makeDocument(client, 'Site readings report', []);
    made = await edit(client, made, {
      operation: 'insert',
      parent: null,
      position: 0,
      node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
    });
    report = made.id;
    const { data } = await client.GET('/v1/components/{id}', {
      params: { path: { id: component.id } },
    });
    const started = await client.POST('/v1/components/{id}/threads', {
      params: { path: { id: component.id } },
      body: {
        version: data!.version.id,
        anchor: { kind: 'component' },
        parts: [{ text: 'Are these readings from this year?' }],
      },
    });
    expect(started.response.status).toBe(200);
  });

  it('marks a component with an open comment in its gutter, clear of the text, and opens the comment from there', async () => {
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${SERVICE}/#/documents/${report}`);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      const glyph = page.getByRole('button', {
        name: 'Open the comment: Are these readings from this year?',
      });
      await glyph.waitFor();
      const box = await glyph.boundingBox();
      const text = await page.getByText('Paragraph 1. The readings').first().boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(text!.x);
      expect(box!.width).toBeGreaterThanOrEqual(24);
      expect(await glyph.getAttribute('title')).toBe('Are these readings from this year?');
      await glyph.click();
      const panel = page.getByRole('tabpanel', { name: 'Threads' });
      await panel.getByText('Are these readings from this year?').first().waitFor();
    });
  });

  it('starts both panes at one height, holds them still as the text scrolls, and hides the right to its rail', async ({
    task,
  }) => {
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${SERVICE}/#/documents/${report}`);
      const outline = page.getByRole('tree', { name: 'Outline' });
      const panels = page.getByRole('complementary', { name: 'Panels beside the text' });
      await outline.waitFor();
      await panels.waitFor();
      /** Where each pane's box begins, measured from the window's top. */
      const tops = () =>
        page.evaluate(() => {
          const top = (element: Element) => Math.round(element.getBoundingClientRect().top);
          return {
            outline: top(document.querySelector("[data-part='outline']")!),
            // The pane and its rail stand in one box (ADR-0074).
            panels: top(
              document.querySelector('aside[aria-label="Panels beside the text"]')!.parentElement!,
            ),
          };
        });
      const start = await tops();
      expect(start.panels).toBe(start.outline);
      await checkAxe(page, 'a document with both panes open', task.meta, {
        shows: [outline, panels],
      });

      // Scrolled any distance, to the document's end and back, the text moves and the panes do not.
      await page.mouse.move(700, 500);
      /** Where the panes stand once a turn of the wheel has settled. */
      const scrolledBy = async (distance: number) => {
        await page.mouse.wheel(0, distance);
        await expect
          .poll(async () => {
            const before = await page.evaluate(() => window.scrollY);
            await page.waitForTimeout(100);
            return before === (await page.evaluate(() => window.scrollY));
          })
          .toBe(true);
        return tops();
      };
      for (const distance of [6, 6, 1200, 20000, -20000]) {
        expect(await scrolledBy(distance)).toEqual(start);
      }
      const header = await page.evaluate(() =>
        Math.round(document.querySelector('header')!.getBoundingClientRect().bottom),
      );
      expect(start.outline - header).toBe(12);

      // Hidden, the right pane leaves its rail, which shows it again (ADR-0074).
      const rail = page.getByRole('navigation', { name: 'Document panels' });
      await rail.getByRole('button', { name: 'Hide the document panels' }).click();
      const show = page.getByRole('button', { name: 'Show the document panels' });
      await show.waitFor();
      await checkAxe(page, 'a document with its panels hidden to a rail', task.meta, {
        shows: [outline, rail],
      });
      await show.click();
      await panels.getByRole('heading', { level: 2 }).waitFor();
    });
  });

  it('keeps a dock flyout inside the window, its rows reachable, and gives the focus back to the text', async () => {
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(`${SERVICE}/#/documents/${report}`);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      await page.getByText('Paragraph 2.', { exact: false }).first().click();
      const surface = page.getByRole('textbox', { name: /^Content of / });
      await surface.waitFor();
      const dock = page.locator('[data-inplace-band]');
      await dock.getByRole('button', { name: 'Insert' }).click();
      const menu = page.getByRole('menu', { name: 'Insert' });
      await menu.waitFor();
      const box = await menu.evaluate((element) => {
        const { top, bottom, left, right } = element.getBoundingClientRect();
        return {
          top,
          bottom,
          left,
          right,
          scrolls:
            element.scrollHeight <= element.clientHeight ||
            getComputedStyle(element).overflowY === 'auto',
        };
      });
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.bottom).toBeLessThanOrEqual(720);
      expect(box.right).toBeLessThanOrEqual(1280);
      expect(box.scrolls).toBe(true);
      // What the tip would have said stands aside for the menu it names.
      expect(await page.locator('[data-name-tip]:visible').count()).toBe(0);
      await page.keyboard.press('Escape');
      await expect
        .poll(() => surface.evaluate((element) => element === document.activeElement))
        .toBe(true);
    });
  });

  it('dims the whole window behind a dialog the Document menu opens, and takes no menu key behind it', async () => {
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(`${SERVICE}/#/documents/${report}`);
      await page.getByRole('tree', { name: 'Outline' }).waitFor();
      await fromMenu(page, 'Document', 'Relationships');
      const dialog = page.getByRole('dialog', { name: /^Relationships of / });
      await dialog.waitFor();
      const scrim = await dialog.evaluate((element) => {
        const { top, left, right, bottom } = element.parentElement!.getBoundingClientRect();
        return { top, left, right, bottom };
      });
      expect(scrim).toEqual({ top: 0, left: 0, right: 1280, bottom: 720 });
      await page.keyboard.press('F10');
      expect(await page.getByRole('menu').count()).toBe(0);
      expect(
        await page.evaluate(() => document.activeElement?.closest('[role="menubar"]') !== null),
      ).toBe(false);
    });
  });

  it('shows the text only between the top and the bottom of the panes, from the first of the sheet to the last', async () => {
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${SERVICE}/#/documents/${report}`);
      await page.getByRole('tree', { name: 'Outline' }).waitFor();
      await page.getByText('Paragraph 2.', { exact: false }).first().waitFor();
      const read = () =>
        page.evaluate(() => {
          const pane = document.querySelector("[data-part='outline']")!.getBoundingClientRect();
          const sheet = document.querySelector('.aw-sheet')!.getBoundingClientRect();
          const middle = (sheet.left + sheet.right) / 2;
          const inText = (y: number) =>
            document.elementFromPoint(middle, y)?.closest('.aw-desk') !== null;
          return {
            paneTop: pane.top,
            paneBottom: pane.bottom,
            sheetTop: sheet.top,
            sheetBottom: sheet.bottom,
            textAbove: inText(pane.top - 6),
            textBelow: inText(pane.bottom + 6),
          };
        });
      const start = await read();
      expect(start.sheetTop).toBe(start.paneTop);

      await page.mouse.move(700, 500);
      /** The window scrolled by `distance`, once it has settled. */
      const scrolledBy = async (distance: number) => {
        await page.mouse.wheel(0, distance);
        await expect
          .poll(async () => {
            const before = await page.evaluate(() => window.scrollY);
            await page.waitForTimeout(100);
            return before === (await page.evaluate(() => window.scrollY));
          })
          .toBe(true);
        return read();
      };
      const between = await scrolledBy(300);
      expect(between.sheetTop).toBeLessThan(between.paneTop);
      expect(between.sheetBottom).toBeGreaterThan(between.paneBottom);
      expect(between.textAbove).toBe(false);
      expect(between.textBelow).toBe(false);

      const end = await scrolledBy(20000);
      expect(end.sheetBottom).toBe(end.paneBottom);
    });
  });
});
