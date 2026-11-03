import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';

import { SERVICE } from './testing/addresses.js';
import { api } from './testing/api.js';
import { checkAxe } from './testing/axe.js';
import { makeComponent } from './testing/component.js';
import { withPage } from './testing/page.js';

/**
 * A plain table's floating toolbar and the Table tab's map in the pinned Chromium (the TT plan): where
 * the toolbar stands, measured against the table, and that it moves nothing; stuck at the desk's top
 * while the table scrolls, with the caret never under it (WCAG 2.4.11); the keyboard's way through both;
 * and axe over each.
 */

const paragraph = (id: string, value: string) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [{ type: 'text', value, marks: [] }],
});

const cell = (id: string, value: string) => ({
  content: [paragraph(id, value)],
  colspan: 1,
  rowspan: 1,
});

/** Some text, then a table long enough to scroll, whose rows say where they are. */
const longTable = [
  paragraph('p1', 'The words above the table.'),
  {
    type: 'table',
    id: 't1',
    style: 'table',
    caption: [{ type: 'text', value: 'Readings at each site', marks: [] }],
    headerRows: 1,
    headerColumns: 0,
    rows: [
      { cells: [cell('h1', 'Site'), cell('h2', 'Depth'), cell('h3', 'Notes')] },
      ...Array.from({ length: 60 }, (_, row) => ({
        cells: [
          cell(`a${row}`, `Row ${row + 1}`),
          cell(`b${row}`, String(row)),
          cell(`c${row}`, 'Measured'),
        ],
      })),
    ],
  },
  paragraph('p2', 'The words below the table.'),
];

async function openComponent(page: Page, id: string): Promise<Locator> {
  await page.goto(`${SERVICE}/#/components/${id}`);
  const surface = page.getByRole('textbox', { name: /^Content of / });
  await surface.waitFor();
  await page.getByText('Saved', { exact: true }).waitFor();
  return surface;
}

describe('a plain table in the browser (ADR-0079)', () => {
  it('stands the toolbar above the table without moving the text, and sticks it clear of the caret', async ({
    task,
  }) => {
    const client = api();
    const made = await makeComponent(client, 'A long table', longTable);
    await withPage(async (page) => {
      const surface = await openComponent(page, made.id);
      const figure = surface.locator('figure').first();
      const before = await figure.boundingBox();

      await surface.getByText('Row 1', { exact: true }).click();
      const toolbar = page.getByRole('toolbar', { name: 'Table toolbar' });
      await toolbar.waitFor();

      // Above the table's top edge, 8px off, at its left; the table where it was.
      const at = await figure.boundingBox();
      const bar = await toolbar.boundingBox();
      expect(at?.y).toBe(before?.y);
      expect(bar?.height).toBe(44);
      expect((bar?.y ?? 0) + (bar?.height ?? 0)).toBeCloseTo((at?.y ?? 0) - 8, 0);
      expect(bar?.x).toBeCloseTo(at?.x ?? 0, 0);
      // And inside the window: nothing of it is clipped.
      expect(bar?.x ?? 0).toBeGreaterThanOrEqual(0);
      expect((bar?.x ?? 0) + (bar?.width ?? 0)).toBeLessThanOrEqual(page.viewportSize()!.width);
      await checkAxe(page, "a plain table's floating toolbar", task.meta, { shows: toolbar });

      // Far down the table its top has scrolled away: the toolbar stays in view.
      await surface.getByText('Row 40', { exact: true }).click();
      await surface
        .getByText('Row 40', { exact: true })
        .evaluate((element) => element.scrollIntoView({ block: 'start' }));
      const stuck = await toolbar.boundingBox();
      expect(stuck?.y ?? -1).toBeGreaterThanOrEqual(0);
      const figureNow = await figure.boundingBox();
      expect(stuck?.y ?? 0).toBeGreaterThan(figureNow?.y ?? 0);

      // Up through the rows by the keyboard, the caret never beneath it.
      for (let press = 0; press < 20; press += 1) {
        await page.keyboard.press('ArrowUp');
        const caret = await page.evaluate(() => {
          const range = window.getSelection()!.getRangeAt(0);
          const rects = range.getClientRects();
          const rect =
            rects.length > 0
              ? rects[0]!
              : (range.startContainer as Element).getBoundingClientRect?.();
          return rect ? { top: rect.top, bottom: rect.bottom } : null;
        });
        const now = await toolbar.boundingBox();
        expect(caret).not.toBeNull();
        expect(caret!.top).toBeGreaterThanOrEqual((now?.y ?? 0) + (now?.height ?? 0));
      }
    });
  });

  it('CNT-077 reaches the toolbar, its settings and the map from the keyboard', async ({
    task,
  }) => {
    const client = api();
    const made = await makeComponent(client, 'A table by the keyboard', longTable);
    await withPage(async (page) => {
      const surface = await openComponent(page, made.id);
      await surface.getByText('Row 2', { exact: true }).click();
      const toolbar = page.getByRole('toolbar', { name: 'Table toolbar' });
      await toolbar.waitFor();

      for (let press = 0; press < 12; press += 1) {
        if (await toolbar.evaluate((element) => element.contains(document.activeElement))) break;
        await page.keyboard.press('F6');
      }
      const name = toolbar.getByRole('button', { name: 'Table, its settings' });
      expect(await name.evaluate((element) => element === document.activeElement)).toBe(true);

      await page.keyboard.press('Enter');
      const settings = toolbar.getByRole('dialog', { name: 'Table settings' });
      await settings.waitFor();
      await checkAxe(page, "a plain table's settings", task.meta, { shows: settings });
      await page.keyboard.press('Escape');
      await settings.waitFor({ state: 'detached' });
      expect(await name.evaluate((element) => element === document.activeElement)).toBe(true);

      await page.keyboard.press('Escape');
      const inCell = await page.evaluate(
        () => window.getSelection()?.anchorNode?.parentElement?.closest('td, th') !== null,
      );
      expect(inCell).toBe(true);

      // Nothing chooses the Table tab for the reader: the tab is marked, and chosen by hand.
      await page.getByRole('tab', { name: 'Table, the cursor is in a table' }).click();
      const panel = page.getByRole('group', { name: 'Table', exact: true });
      const map = panel.getByRole('grid', { name: 'Map of the table' });
      await map.waitFor();
      await checkAxe(page, 'the Table tab as a map', task.meta, { shows: map });

      await map.focus();
      await page.keyboard.press('ArrowDown');
      await expect
        .poll(async () => panel.textContent())
        .toContain('Row 4 of 61 · column 1 of 3, Site');
      await page.keyboard.press('Enter');
      expect(await surface.evaluate((element) => element === document.activeElement)).toBe(true);
    });
  });
});
