import { beforeAll, describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api, edit, makeDocument, nodesOf, words, type Client } from './testing/api.js';
import { checkAxe } from './testing/axe.js';
import { generalSpace, makeComponent } from './testing/component.js';
import { withPage } from './testing/page.js';

/**
 * Component groups in the pinned Chromium (the CG plan): listed under Components' Kind filter, a
 * group's page worked by the keyboard, and a document holding one, its members marked as a run and the
 * group named in the Part panel, each held to axe.
 */

const para = (id: string, text: string) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [{ type: 'text', value: text, marks: [] }],
});

interface Made {
  readonly group: string;
  readonly title: string;
  readonly document: string;
}

/** Two components, a group of them, and a document placing it in its one section. */
async function made(client: Client): Promise<Made> {
  const stamp = new Date().toISOString();
  const first = await makeComponent(client, 'Group boilerplate', [
    para('b1', 'Boilerplate words.'),
  ]);
  const second = await makeComponent(client, 'Group warning', [para('w1', 'Warning words.')]);
  const space = await generalSpace(client);
  const title = `SOP references ${stamp}`;
  const group = await client.POST('/v1/spaces/{space}/component-groups', {
    params: { path: { space } },
    body: { title, members: [{ component: first.id }, { component: second.id }] },
  });
  if (!group.data) throw new Error(`a group answered ${group.response.status}`);
  let document = await makeDocument(client, 'Holding a group', []);
  document = await edit(client, document, {
    operation: 'insert',
    parent: null,
    position: 0,
    node: { type: 'section', title: words('References') },
  });
  const section = nodesOf(document)[0]!.id;
  // Its draft version named, since none is approved yet.
  const placed = await client.POST('/v1/documents/{id}/groups', {
    params: { path: { id: document.id } },
    body: {
      openedFrom: document.version.id,
      group: group.data.id,
      version: group.data.version.id,
      parent: section,
      position: 0,
    },
  });
  if (!placed.data) throw new Error(`placing answered ${placed.response.status}`);
  return { group: group.data.id, title, document: document.id };
}

describe('component groups, in Chromium (the CG plan)', () => {
  let fixture: Made;
  beforeAll(async () => {
    fixture = await made(api());
  });

  it('REU-060 lists component groups under the Kind filter, held to axe', async ({ task }) => {
    await withPage(async (page) => {
      await page.goto(`${SERVICE}/#/components`);
      await page.getByRole('radio', { name: 'Component groups' }).check();
      const table = page.getByRole('table', { name: 'Component groups' });
      await table.getByRole('link', { name: fixture.title }).waitFor();
      await checkAxe(page, 'Components listing component groups', task.meta, { shows: table });
    });
  });

  it("REU-060 works a group's page by the keyboard and saves its next version, held to axe", async ({
    task,
  }) => {
    await withPage(async (page) => {
      await page.goto(`${SERVICE}/#/component-groups/${fixture.group}`);
      const heading = page.getByRole('heading', { name: fixture.title, level: 1 });
      await heading.waitFor();
      const members = page.getByRole('list', { name: 'Members' });
      await checkAxe(page, "a component group's page", task.meta, { shows: members });
      const down = members.getByRole('button', { name: /^Move Group boilerplate .* down$/ });
      await down.focus();
      await page.keyboard.press('Enter');
      const names = await members.getByRole('link').allTextContents();
      expect(names[0]).toMatch(/^Group warning/);
      const save = page.getByRole('button', { name: 'Save as a new version' });
      await save.focus();
      await page.keyboard.press('Enter');
      await page.getByRole('status').filter({ hasText: 'Saved as version 0.2.' }).waitFor();
    });
  });

  it('REU-061 marks a placed group as one run and names it in the Part panel, held to axe', async ({
    task,
  }) => {
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1920, height: 1000 });
      await page.goto(`${SERVICE}/#/documents/${fixture.document}`);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      const run = page.locator('[role="treeitem"][data-group-run]');
      await run.first().waitFor();
      expect(await run.count()).toBe(2);
      expect(await run.first().getAttribute('aria-describedby')).toMatch(/-group/);
      await page.getByText('Boilerplate words.').first().click();
      const said = page.getByText(/^Part of the component group /);
      await said.waitFor();
      expect(await said.textContent()).toContain(fixture.title);
      await page.getByRole('button', { name: 'Remove group' }).waitFor();
      await checkAxe(page, 'a document holding a component group', task.meta, { shows: said });
    });
  });
});
