import type { Locator, Page } from 'playwright-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api, type Client } from './testing/api.js';
import { checkAxe } from './testing/axe.js';
import { generalSpace } from './testing/component.js';
import { withPage } from './testing/page.js';

/**
 * Template parameters in the pinned Chromium (the TP1 plan, task 5), by the keyboard alone: a document
 * made in New document from a template asking for a required date, a choice and a changeable text
 * that seeds the Reviewer field; the seeded field read; the text changed in the Parameters panel; its
 * History opened; axe over the form and the panel. Uncited: the jsdom tests cite what a person sees.
 */

/** A template over development's Report - its theme, layout and Review schema - with three parameters. */
async function makeTemplate(client: Client): Promise<{ name: string; reviewer: string }> {
  const { data: listed } = await client.GET('/v1/templates', {
    params: { query: { limit: '100' } },
  });
  const report = listed?.items.find((each) => each.name === 'Report');
  if (!report) throw new Error('The development environment has no Report template');
  const { data: read } = await client.GET('/v1/templates/{id}', {
    params: { path: { id: report.id } },
  });
  const definition = read!.definition as Record<string, unknown> & {
    parameters: { name: string; feeds: { field: string } }[];
  };
  const reviewer = definition.parameters.find((each) => each.name === 'reviewer')!.feeds.field;
  const name = `Inspection ${Date.now()}`;
  const { data, error, response } = await client.POST('/v1/spaces/{space}/templates', {
    params: { path: { space: await generalSpace(client) } },
    body: {
      definition: {
        ...definition,
        name,
        parameters: [
          {
            name: 'due',
            type: { base: 'date' },
            required: true,
            list: false,
            changeable: false,
            feeds: { arguments: true },
          },
          {
            name: 'region',
            type: { base: 'text' },
            required: true,
            list: false,
            permitted: { values: ['North', 'South'] },
            changeable: false,
            feeds: { arguments: true },
          },
          {
            name: 'reviewer',
            type: { base: 'text' },
            required: false,
            list: false,
            changeable: true,
            feeds: { field: reviewer, arguments: false },
          },
        ],
      },
    } as never,
  });
  if (!data) {
    throw new Error(`making a template answered ${response.status}: ${JSON.stringify(error)}`);
  }
  return { name, reviewer };
}

/** Tab pressed until `target` holds the focus: at most `most` presses. */
async function tabTo(page: Page, target: Locator, most = 60) {
  for (let pressed = 0; pressed < most; pressed++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`${String(target)} never took the focus`);
}

describe('template parameters, in Chromium (the TP1 plan, task 5)', () => {
  let template = '';
  beforeAll(async () => {
    template = (await makeTemplate(api())).name;
  });

  it('makes a document from a template by the keyboard, asking for its parameters, and changes one in the Parameters panel', async ({
    task,
  }) => {
    await withPage(async (page) => {
      await page.goto(`${SERVICE}/#/documents`);
      const opener = page.getByRole('button', { name: 'New document' });
      await opener.waitFor();
      await page.locator('body').focus();
      await tabTo(page, opener);
      await page.keyboard.press('Enter');
      const form = page.getByRole('dialog');
      const chooser = form.getByLabel('Template');
      await form.getByRole('option', { name: `${template} (General)` }).waitFor({
        state: 'attached',
      });
      await tabTo(page, chooser);
      await chooser.selectOption({ label: `${template} (General)` });
      const due = form.getByLabel('due (required)');
      await due.waitFor();

      // Create waits for the required ones, and says so.
      const create = form.getByRole('button', { name: 'Create' });
      expect(await create.getAttribute('aria-disabled')).toBe('true');
      await expect
        .poll(() => form.getByText('Fill in due and region to create the document.').isVisible())
        .toBe(true);
      await checkAxe(page, 'New document asking for parameters', task.meta, {
        shows: [due, create],
      });

      await tabTo(page, form.getByLabel('Title'));
      await page.keyboard.type('An inspection');
      await tabTo(page, due);
      // Filled, not typed: a date control orders its parts by the browser's own language, which the
      // pinned Chromium does not take from the page's, so no one order of keys is the same everywhere.
      await due.fill('2026-10-31');
      expect(await due.inputValue()).toBe('2026-10-31');
      const region = form.getByLabel('region (required)');
      await tabTo(page, region);
      await page.keyboard.press('ArrowDown');
      expect(await region.inputValue()).toBe('North');
      await tabTo(page, form.getByLabel('reviewer', { exact: true }));
      await page.keyboard.type('Grace');
      await tabTo(page, create);
      expect(await create.getAttribute('aria-disabled')).toBeNull();
      await page.keyboard.press('Enter');

      // The document, its field seeded by the parameter, in its Document panel (LG6c).
      await page
        .getByRole('tablist', { name: 'Document panels' })
        .getByRole('tab', { name: 'Document' })
        .click();
      const panel = page.getByRole('region', { name: 'Parameters' });
      await panel.waitFor();
      const fields = page.getByRole('region', { name: 'Fields of this document' });
      await expect
        .poll(() => fields.getByRole('textbox', { name: /^Reviewer/ }).inputValue())
        .toBe('Grace');
      expect(await panel.getByLabel('due (required)').inputValue()).toBe('2026-10-31');
      expect(await panel.getByLabel('region (required)').isDisabled()).toBe(true);

      // The changeable one changed, saved a pause later as the next version.
      const reviewer = panel.getByLabel('reviewer', { exact: true });
      await tabTo(page, reviewer);
      await page.keyboard.press('End');
      await page.keyboard.type(' Hopper');
      await page.getByText('Version 0.2 in General').waitFor();

      // Its history, opened by the keyboard.
      const history = panel.getByRole('button', { name: 'History' });
      await tabTo(page, history);
      await page.keyboard.press('Enter');
      const changes = panel.getByRole('list', { name: 'Changes to the parameters' });
      await expect.poll(() => changes.getByRole('listitem').count()).toBe(2);
      expect(await changes.getByRole('listitem').first().textContent()).toMatch(
        /^Version 0\.2, by .+: reviewer Grace Hopper$/,
      );
      await checkAxe(page, 'the Parameters panel with its history', task.meta, {
        shows: [panel, changes],
      });
    });
  });
});
