import { describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { withPage } from './testing/page.js';

/**
 * **A style's sample is set as the editor sets text** (the SY plan, SY-F): at the style's own size,
 * which the projection writes in points times the canvas's zoom, and with a mark's words drawn.
 */
describe("Document themes' samples (the SY plan, SY-F)", () => {
  it("sets a paragraph style's sample at its size, and a character style's marked words where they can be seen", async () => {
    await withPage(async (page) => {
      await page.goto(`${SERVICE}/#/admin/themes`);
      await page
        .getByRole('table', { name: 'Document themes' })
        .getByRole('button', { name: /^Open / })
        .first()
        .click();
      await page
        .getByRole('table', { name: 'Paragraph styles' })
        .getByRole('button', { name: 'Edit Heading 1' })
        .click();
      const form = page.getByRole('form', { name: 'Paragraph style Heading 1' });
      // Heading 1 states its size: the field holds it.
      const points = Number(
        await form.getByRole('group', { name: 'Size' }).getByRole('spinbutton').inputValue(),
      );
      const size = await form
        .getByTestId('style-sample')
        .locator('p')
        .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
      expect(size).toBeCloseTo((points * 4) / 3, 1);
      await form.getByRole('button', { name: 'Cancel' }).click();

      await page
        .getByRole('table', { name: 'Character styles' })
        .getByRole('button', { name: 'Edit Inline code' })
        .click();
      const marked = page
        .getByRole('form', { name: 'Character style Inline code' })
        .getByTestId('style-sample')
        .locator('.aw-mark-run');
      const box = await marked.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(10);
    });
  });
});
