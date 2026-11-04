import { describe, expect, it } from 'vitest';

import { SERVICE } from './testing/addresses.js';
import { api, edit, makeDocument, nodesOf } from './testing/api.js';
import { makeComponent } from './testing/component.js';
import { withPage } from './testing/page.js';

/** Titles typed where they stand on the page, in the pinned Chromium (the EP plan, EP6). */
const para = (id: string, value: string) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [{ type: 'text', value, marks: [] }],
});

async function aDocument() {
  const client = api();
  const stamp = String(Date.now());
  const first = await makeComponent(client, `Heading one ${stamp}`, [
    para('a1', 'First words.'),
  ] as never);
  const second = await makeComponent(client, `Heading two ${stamp}`, [
    para('b1', 'Second words.'),
  ] as never);
  let made = await makeDocument(client, `Titles ${stamp}`, ['Method']);
  const section = nodesOf(made)[0]!.id;
  for (const [position, component] of [first, second].entries()) {
    made = await edit(client, made, {
      operation: 'insert',
      parent: section,
      position,
      node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
    });
  }
  return { client, id: made.id, first: first.id, stamp };
}

describe('titles typed where they stand, in Chromium', () => {
  it('CNT-191 retitles a section in its heading, moving nothing, committing on Enter and cancelling on Esc', async () => {
    const { id } = await aDocument();
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1920, height: 1000 });
      await page.goto(`${SERVICE}/#/documents/${id}`);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      const canvas = page.locator('section.aw-canvas');
      const heading = canvas.getByRole('heading', { name: /Method/ });
      await heading.waitFor();
      const before = (await heading.boundingBox())!;

      await canvas.getByText('Method', { exact: true }).click();
      const field = heading.getByRole('textbox');
      await field.waitFor();
      const open = (await heading.boundingBox())!;
      expect(open.y).toBeCloseTo(before.y, 0);
      expect(open.height).toBeCloseTo(before.height, 0);

      // Open in the heading and the panel together: the outline's one act answers both.
      await page.keyboard.type(' typed');
      await page.keyboard.press('Enter');
      await canvas.getByRole('heading', { name: /Method typed/ }).waitFor();
      await expect.poll(() => heading.getByRole('textbox').count()).toBe(0);
      await page.getByRole('treeitem', { name: /Method typed/ }).waitFor();

      await canvas.getByText('Method typed', { exact: true }).click();
      await page.keyboard.type(' not this');
      await page.keyboard.press('Escape');
      await expect.poll(() => canvas.getByText('Method typed', { exact: true }).count()).toBe(1);
      await page.reload();
      await canvas.getByText('Method typed', { exact: true }).waitFor();
    });
  });

  it('CNT-191 retitles a component in its heading, saved with its session, and keeps it on moving on', async () => {
    const { client, id, first, stamp } = await aDocument();
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1920, height: 1000 });
      await page.goto(`${SERVICE}/#/documents/${id}`);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      const canvas = page.locator('section.aw-canvas');
      await canvas.getByText('First words.').waitFor();
      const before = (await canvas.getByText('First words.').boundingBox())!;

      await canvas
        .getByRole('heading', { name: /Heading one/ })
        .getByText(`Heading one ${stamp}`)
        .click();
      const field = canvas.getByRole('heading', { name: /Heading one/ }).getByRole('textbox');
      await field.waitFor();
      await expect.poll(() => field.evaluate((own) => own === document.activeElement)).toBe(true);
      await page.keyboard.type(' typed');

      // Enter moves on into the text.
      await page.keyboard.press('Enter');
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label')))
        .toMatch(/^Content of /);
      expect((await canvas.getByText('First words.').boundingBox())!.y).toBeCloseTo(before.y, 0);

      await canvas.getByText('Second words.').click();
      await page.getByRole('textbox', { name: /^Content of Heading two/ }).waitFor();
      // Not back to the title the listing read on opening the page.
      await canvas.getByRole('heading', { name: /^1\.1 Heading one .* typed$/ }).waitFor();
    });
    const { data } = await client.GET('/v1/components/{id}', { params: { path: { id: first } } });
    expect((data!.content as { title: string }).title).toMatch(/ typed$/);
  });
});
