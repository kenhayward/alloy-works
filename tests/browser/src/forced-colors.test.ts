import { describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api, edit, makeDocument, nodesOf } from './testing/api.js';
import { makeComponent } from './testing/component.js';
import { withPage } from './testing/page.js';

const para = (value: string) => ({
  type: 'paragraph',
  id: 'b1',
  style: 'body',
  content: [{ type: 'text', value, marks: [] }],
});

/**
 * Annotations in a high-contrast mode (collaboration.md, Telling them apart): a comment's anchor and a
 * redline's insertions and deletions each keep a mark that is not colour - a border, an underline, a
 * strike and words - under `forced-colors: active`, where the system takes every colour away.
 */
describe('annotations in forced colours', () => {
  it('CNT-138 tells a comment anchor and a redline’s insertions and deletions apart without colour, in a high-contrast mode', async () => {
    const client = api();
    const component = await makeComponent(client, 'Annotated', [para('Set the tray, then wait.')]);
    const { data: read } = await client.GET('/v1/components/{id}', {
      params: { path: { id: component.id } },
    });
    if (!read) throw new Error('reading the component answered nothing');
    const version = read.version.id;
    const thread = await client.POST('/v1/components/{id}/threads', {
      params: { path: { id: component.id } },
      body: {
        version,
        anchor: { kind: 'span', block: 'b1', quote: 'the tray', before: 'Set ' },
        parts: [{ text: 'Which tray?' }],
      } as never,
    });
    if (!thread.data) throw new Error(`starting a thread answered ${thread.response.status}`);
    const suggested = await client.POST('/v1/components/{id}/suggestions', {
      params: { path: { id: component.id } },
      body: {
        version,
        content: { ...read.content, content: [para('Set the lid, then wait.')] },
      },
    });
    if (!suggested.data) throw new Error(`suggesting answered ${suggested.response.status}`);
    let document = await makeDocument(client, 'Forced colours', ['Method']);
    document = await edit(client, document, {
      operation: 'insert',
      parent: nodesOf(document)[0]!.id,
      position: 0,
      node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
    });

    await withPage(
      async (page) => {
        await page.goto(`${SERVICE}/#/documents/${document.id}`);
        await page.getByRole('radio', { name: 'Review' }).check();
        const text = page.getByRole('region', { name: "The document's text" });
        const anchor = text.locator('mark[data-thread]', { hasText: 'the tray' });
        await anchor.waitFor({ state: 'visible' });
        expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
        // The anchor keeps a border beneath it when its highlight is taken away.
        expect(
          await anchor.evaluate((element) => {
            const style = getComputedStyle(element);
            return [style.borderBottomStyle, Number.parseFloat(style.borderBottomWidth) > 0];
          }),
        ).toEqual(['solid', true]);

        await page
          .getByRole('tablist', { name: 'Document panels' })
          .getByRole('tab', { name: 'Suggestions' })
          .click();
        const panel = page.getByRole('tabpanel', { name: 'Suggestions' });
        await panel.getByRole('button', { name: / on / }).first().click();
        const redline = panel.getByRole('list', { name: 'What it changes' });
        const added = redline.locator('ins').first();
        const removed = redline.locator('del').first();
        await added.waitFor({ state: 'visible' });
        // Underlined and struck through, and each said in words, whatever colour the system draws.
        expect(
          await added.evaluate((element) => getComputedStyle(element).textDecorationLine),
        ).toBe('underline');
        expect(
          await removed.evaluate((element) => getComputedStyle(element).textDecorationLine),
        ).toBe('line-through');
        expect(await added.textContent()).toMatch(/^Added: /);
        expect(await removed.textContent()).toMatch(/^Removed: /);
      },
      { forcedColors: true },
    );
  });
});
