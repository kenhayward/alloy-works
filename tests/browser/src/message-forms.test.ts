import type { Page } from 'playwright-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api, edit, makeDocument, nodesOf, type Client } from './testing/api.js';
import { checkAxe } from './testing/axe.js';
import { generalSpace, makeComponent } from './testing/component.js';
import { withPage } from './testing/page.js';

/**
 * A message form in the pinned Chromium (the MF plan, MF-G), against the development source the
 * `sources` profile runs: a form over a site's id - 1 at the weir - placed and resolved through the
 * API. Uncited: the page's jsdom tests cite what a person sees, and these hold it to axe and the
 * keyboard alone.
 */

const READER = { account: 'reader', password: 'source-reader-dev-password' };

const words = (value: string) => ({ type: 'text', value, marks: [] });

/** A connection to the source, a definition of a site, and a document resolving a form over it. */
async function placeForm(client: Client): Promise<string> {
  const space = await generalSpace(client);
  const stamp = new Date().toISOString();
  const connection = await client.POST('/v1/spaces/{space}/connections', {
    params: { path: { space } },
    body: {
      settings: {
        schemaVersion: 1,
        name: `Forms source ${stamp}`,
        description: 'The development source.',
        type: 'postgres',
        source: {
          host: 'source-postgres',
          port: 5432,
          database: 'readings',
          account: READER.account,
          tls: 'require',
        },
        identity: { kind: 'service' },
        retired: false,
      },
    },
  });
  if (!connection.data) throw new Error(`a connection answered ${connection.response.status}`);
  const credential = await client.PUT('/v1/connections/{id}/credential', {
    params: { path: { id: connection.data.id } },
    body: { secret: READER.password },
  });
  if (!credential.data) throw new Error(`its credential answered ${credential.response.status}`);
  const definition = await client.POST('/v1/spaces/{space}/query-definitions', {
    params: { path: { space } },
    body: {
      definition: {
        schemaVersion: 1,
        title: `Site ${stamp}`,
        description: 'One site, by its id.',
        connection: connection.data.id,
        parameters: [{ name: 'site', type: { base: 'integer' }, required: true, list: false }],
        fetch: { kind: 'sql', text: 'select id from sample.site where id = {{site}} order by id' },
        columns: [{ name: 'id', from: { column: 'id' }, type: { base: 'integer' } }],
        key: ['id'],
        order: [{ column: 'id', direction: 'ascending' }],
        empty: 'valid',
        limits: { rows: 100, bytes: 65_536, seconds: 10 },
        retired: false,
      },
    } as never,
  });
  if (!definition.data) throw new Error(`a definition answered ${definition.response.status}`);
  const component = await makeComponent(client, 'Sites recorded', [
    {
      type: 'paragraph',
      id: 'p1',
      style: 'body',
      content: [
        {
          type: 'messageForm',
          id: 'f1',
          kind: 'plural',
          binding: {
            type: 'binding',
            id: 'count',
            query: definition.data.id,
            parameters: { site: { literal: '1' } },
            mode: 'checked',
            take: { column: 'id' },
          },
          arms: {
            '=0': [words('No site recorded')],
            one: [{ type: 'messageValue' }, words(' site recorded')],
            other: [{ type: 'messageValue' }, words(' sites recorded')],
          },
        },
        words('.'),
      ],
    },
  ]);
  let document = await makeDocument(client, 'Sites report', []);
  document = await edit(client, document, {
    operation: 'insert',
    parent: null,
    position: 0,
    node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
  });
  const node = nodesOf(document)[0]!.id;
  const resolved = await client.POST('/v1/documents/{id}/bindings/resolve', {
    params: { path: { id: document.id } },
    body: { bindings: [{ node, binding: 'count' }] },
  });
  if (!resolved.data) throw new Error(`resolving answered ${resolved.response.status}`);
  return document.id;
}

describe('a message form in a document, in Chromium (the MF plan, MF-G)', () => {
  let placed: string;
  beforeAll(async () => {
    placed = await placeForm(api());
  });

  const text = (page: Page) => page.getByRole('region', { name: "The document's text" });
  const form = (page: Page) => text(page).locator('[data-message-form]').first();
  const arms = (page: Page) =>
    page.getByRole('group', { name: 'What the words say for each number' });

  /** Authoring, the component's editor opened by Enter and the form selected by an arrow. */
  async function openForm(page: Page) {
    await page.getByRole('radio', { name: 'Authoring' }).check();
    const opens = text(page).locator('[data-opens="true"]').first();
    await opens.waitFor();
    await opens.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('textbox', { name: /^Content of / }).waitFor();
    for (let pressed = 0; pressed < 3 && !(await arms(page).isVisible()); pressed++) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(100);
    }
    await arms(page).waitFor();
  }

  it('passes axe with a form in Reading and Authoring, and with its arms open', async ({
    task,
  }) => {
    await withPage(async (page) => {
      await page.goto(`${SERVICE}/#/documents/${placed}`);
      await form(page).waitFor();
      expect(await form(page).textContent()).toMatch(/^1 site recorded/);
      for (const mode of ['Reading', 'Authoring'] as const) {
        await page.getByRole('radio', { name: mode }).check();
        await checkAxe(page, `a message form in ${mode}`, task.meta, { shows: form(page) });
      }
      await openForm(page);
      await checkAxe(page, 'a message form open', task.meta, { shows: arms(page) });
    });
  });

  it('reaches an arm by Tab, writes in it from the keyboard, and Escape takes the focus back to the form', async () => {
    await withPage(async (page) => {
      await page.goto(`${SERVICE}/#/documents/${placed}`);
      await openForm(page);
      const one = arms(page).getByRole('textbox', { name: /^one, / });
      for (let pressed = 0; pressed < 6; pressed++) {
        if (await one.evaluate((element) => element === document.activeElement)) break;
        await page.keyboard.press('Tab');
      }
      expect(await one.evaluate((element) => element === document.activeElement)).toBe(true);
      await page.keyboard.press('End');
      await page.keyboard.type(' so far');
      const chip = page.locator('.aw-message-form-chip').first();
      await expect.poll(() => chip.textContent()).toMatch(/^1 site recorded so far/);
      await page.keyboard.press('Escape');
      const surface = page.getByRole('textbox', { name: /^Content of / });
      expect(await surface.evaluate((element) => element === document.activeElement)).toBe(true);
      await expect.poll(() => arms(page).isVisible()).toBe(true);
    });
  });
});
