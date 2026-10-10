import { beforeAll, describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api, edit, makeDocument } from './testing/api.js';
import { checkAxe } from './testing/axe.js';
import { makeComponent } from './testing/component.js';
import { withPage } from './testing/page.js';

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
  });

  it('starts both panes at one height, keeps them under the header as the text scrolls, and hides the right to its rail', async ({
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
          const top = (selector: string) =>
            Math.round(document.querySelector(selector)!.getBoundingClientRect().top);
          return {
            outline: top("[data-part='outline']"),
            panels: top('aside[aria-label="Panels beside the text"]'),
          };
        });
      const start = await tops();
      expect(start.panels).toBe(start.outline);
      await checkAxe(page, 'a document with both panes open', task.meta, {
        shows: [outline, panels],
      });

      // Scrolled, the text moves and each pane stays under the header, at the same height.
      await page.mouse.move(700, 500);
      await page.mouse.wheel(0, 1200);
      await expect.poll(async () => (await tops()).outline).toBeLessThan(start.outline);
      const scrolled = await tops();
      expect(scrolled.panels).toBe(scrolled.outline);
      const header = await page.evaluate(() =>
        Math.round(
          // Under the header, or under the in-place band where Authoring keeps one (ADR-0056).
          (document.querySelector('[data-inplace-band]') ??
            document.querySelector('header'))!.getBoundingClientRect().bottom,
        ),
      );
      expect(scrolled.outline).toBeGreaterThanOrEqual(header);
      expect(scrolled.outline - header).toBeLessThanOrEqual(16);

      // Hidden, the right pane leaves its rail, which shows it again.
      await panels.getByRole('button', { name: 'Hide the document panels' }).click();
      const show = page.getByRole('button', { name: 'Show the document panels' });
      await show.waitFor();
      await checkAxe(page, 'a document with its panels hidden to a rail', task.meta, {
        shows: [outline, show],
      });
      await show.click();
      await panels.getByRole('tablist', { name: 'Document panels' }).waitFor();
    });
  });
});
