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

  it('COL-070 COL-071 lays out cards and a thread within the panel, opened in place and across, in both themes', async ({
    task,
  }) => {
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${SERVICE}/#/documents/${report}`);
      await page.getByRole('radio', { name: 'Review' }).check();
      const panel = page.getByRole('tabpanel', { name: 'Threads' });
      const card = panel.getByRole('button', { name: /comment/, expanded: false }).first();
      await card.waitFor();
      const strip = panel.getByRole('group', { name: 'Filter by person' });
      await strip.waitFor();
      const within = async (what: string) => {
        const overflow = await panel.evaluate((each) => each.scrollWidth - each.clientWidth);
        expect(overflow, what).toBeLessThanOrEqual(0);
      };
      const shot = process.env['TP_SHOT'];
      await within('the list');
      await checkAxe(page, 'the threads panel', task.meta, { shows: [strip] });
      if (shot) await page.screenshot({ path: `${shot}-list.png` });
      await panel.getByRole('combobox', { name: 'Search, or @ for a person' }).fill('@');
      await panel.getByRole('listbox', { name: 'Filter by person' }).waitFor();
      await checkAxe(page, 'the threads panel, finding a person', task.meta, {
        shows: [panel.getByRole('listbox')],
      });
      await panel.getByRole('combobox', { name: 'Search, or @ for a person' }).fill('');
      await panel.getByRole('button', { name: /^Show: / }).click();
      await checkAxe(page, 'the threads panel, Show', task.meta, {
        shows: [panel.getByRole('menu')],
      });
      if (shot) await page.screenshot({ path: `${shot}-show.png` });
      await page.keyboard.press('Escape');
      await card.click();
      const reply = panel.getByRole('combobox', { name: 'Reply' });
      await reply.waitFor();
      await within('in place');
      if (shot) await page.screenshot({ path: `${shot}-inplace.png` });
      await reply.fill('@');
      const mentioning = panel.getByRole('listbox', { name: 'Mention someone' });
      await mentioning.waitFor();
      // Standing in the window, whatever the panel clips.
      const offered = await mentioning.boundingBox();
      expect(offered!.y).toBeGreaterThanOrEqual(0);
      expect(offered!.y + offered!.height).toBeLessThanOrEqual(900);
      await checkAxe(page, 'the threads panel, mentioning', task.meta, {
        shows: [panel.getByRole('listbox')],
      });
      await reply.fill('');
      await panel.getByRole('button', { name: 'Open thread' }).click();
      const back = panel.getByRole('button', { name: 'All threads' });
      await back.waitFor();
      await within('across the panel');
      // The reply stands at the panel's foot, within the window.
      const box = await panel.getByRole('combobox', { name: 'Reply' }).boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(900);
      await checkAxe(page, 'a thread across the panel', task.meta, { shows: [back] });
      if (shot) await page.screenshot({ path: `${shot}-whole.png` });
      if (shot) {
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.screenshot({ path: `${shot}-whole-dark.png` });
        await back.click();
        await card.waitFor();
        await page.screenshot({ path: `${shot}-list-dark.png` });
      }
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

  it('stands the formatting toolbar under the menus, its tools unmoved as a part opens', async () => {
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(`${SERVICE}/#/documents/${report}`);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      const bar = page.getByRole('toolbar', { name: 'Formatting' });
      await bar.waitFor();
      const places = () =>
        bar.evaluate((own) =>
          [...own.querySelectorAll('button')].map((each) => {
            const { left, top } = each.getBoundingClientRect();
            return [each.getAttribute('aria-label'), Math.round(left), Math.round(top)];
          }),
        );
      const idle = await places();
      expect(new Set(idle.map(([, , top]) => top)).size).toBe(1);

      // Under the menus and starting with them, in the header, with the panels below it.
      const standing = await bar.evaluate((own) => {
        const menus = document.querySelector('[role="menubar"]')!.getBoundingClientRect();
        const box = own.getBoundingClientRect();
        const header = own.closest('header')!.getBoundingClientRect();
        const dock = document.querySelector('[data-side-dock]')!;
        return {
          inHeader: own.closest('header') !== null,
          under: box.top - menus.bottom,
          start: box.left - menus.left,
          dockBelow: dock.getBoundingClientRect().top - header.bottom,
          dockTools: dock.querySelectorAll('[role="toolbar"]').length,
        };
      });
      expect(standing.inHeader).toBe(true);
      expect(standing.under).toBeGreaterThanOrEqual(0);
      expect(Math.abs(standing.start)).toBeLessThanOrEqual(8);
      expect(standing.dockBelow).toBeGreaterThanOrEqual(0);
      expect(standing.dockTools).toBe(0);

      // A tip stands wholly in view, below the row.
      await bar.getByRole('button', { name: 'Emphasis' }).hover();
      const tip = bar.locator('[data-name-tip]');
      await tip.waitFor();
      const seen = await tip.evaluate((own) => {
        const { left, right, top, bottom } = own.getBoundingClientRect();
        const owner = own.closest('[role="toolbar"]')!.getBoundingClientRect();
        return {
          below: top >= owner.bottom - 4,
          hit: [left + 2, right - 2].map((x) =>
            own.contains(document.elementFromPoint(x, (top + bottom) / 2)),
          ),
        };
      });
      expect(seen).toEqual({ below: true, hit: [true, true] });
      await page.mouse.move(640, 600);

      // Nothing along the row moves as a part opens.
      await page.getByText('Paragraph 2.', { exact: false }).first().click();
      await page.getByRole('textbox', { name: /^Content of / }).waitFor();
      expect(await places()).toEqual(idle);

      // A flyout opens under its button, over the desk.
      await bar.getByRole('button', { name: 'Insert' }).click();
      const menu = page.getByRole('menu', { name: 'Insert' });
      await menu.waitFor();
      const opened = await menu.evaluate((own) => {
        const box = own.getBoundingClientRect();
        const button = own.parentElement!.getBoundingClientRect();
        return { under: box.top - button.bottom, start: box.left - button.left };
      });
      expect(opened.under).toBeGreaterThanOrEqual(0);
      expect(Math.abs(opened.start)).toBeLessThanOrEqual(1);
      await page.keyboard.press('Escape');

      // Right to left, it starts at the other edge, its flyouts going with it.
      await page.evaluate(() => {
        document.documentElement.dir = 'rtl';
      });
      const mirrored = await bar.evaluate((own) => {
        const lefts = [...own.querySelectorAll('button')].map(
          (each) => each.getBoundingClientRect().left,
        );
        const menus = document.querySelector('[role="menubar"]')!.getBoundingClientRect();
        return {
          runsBack: lefts[0]! > lefts.at(-1)!,
          start: own.getBoundingClientRect().right - menus.right,
        };
      });
      expect(mirrored.runsBack).toBe(true);
      expect(Math.abs(mirrored.start)).toBeLessThanOrEqual(8);
      await bar.getByRole('button', { name: 'Insert' }).click();
      await menu.waitFor();
      const flipped = await menu.evaluate((own) => {
        const box = own.getBoundingClientRect();
        const button = own.parentElement!.getBoundingClientRect();
        return { under: box.top - button.bottom, start: box.right - button.right };
      });
      expect(flipped.under).toBeGreaterThanOrEqual(0);
      expect(Math.abs(flipped.start)).toBeLessThanOrEqual(1);
      await page.keyboard.press('Escape');
      await page.evaluate(() => {
        document.documentElement.dir = 'ltr';
      });

      // Reading has no row.
      await page.getByRole('button', { name: 'Done editing' }).click();
      const reading = page.getByRole('radio', { name: 'Reading' });
      await reading.click();
      await expect.poll(() => bar.count()).toBe(0);
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
      // The focus goes into the menu as it opens, so its keys are its own.
      expect(await menu.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Escape');
      await expect.poll(() => menu.count()).toBe(0);
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
