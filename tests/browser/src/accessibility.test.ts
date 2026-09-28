import type { Locator, Page } from 'playwright-core';
import { describe, it, type TaskMeta } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api, edit, makeDocument, nodesOf, type Client } from './testing/api.js';
import { checkAxe } from './testing/axe.js';
import { makeComponent, uploadImage } from './testing/component.js';
import { everyBlock } from './testing/every-block.js';
import { allowPageNoise, withPage } from './testing/page.js';

/**
 * axe-core over every state of the editor and the document view a person reaches, and the screens
 * every way into them passes, each reached by the keyboard or the pointer as a person would (the W13
 * plan's W13.2 and B-I): WCAG 2.2 AA's automatable criteria, over the whole page in each state, at a
 * desktop viewport. What axe cannot decide is written into each test's `meta` for the audit a person
 * makes (CNT-177), never failed on; what it finds fails the test unless the allow-list holds it.
 */

/** Waits for the page to settle: the faces in, and the renderer's own requests answered. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.waitForLoadState('networkidle');
}

/** The editor's surface, the one textbox named for the component's content. */
function surfaceOf(page: Page): Locator {
  return page.getByRole('textbox', { name: /^Content of / });
}

/** A dialog standing over the page, by the heading that names it. */
async function dialog(page: Page, name: string | RegExp): Promise<Locator> {
  const found = page.getByRole('dialog', { name });
  await found.waitFor();
  return found;
}

/** Escape pressed until no dialog stands over the page. */
async function closeDialog(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
}

/**
 * A component holding every block and mark, its figure and its inline image uploaded first. Of the
 * Procedure type where `withFields`, so its fields stand beside the text.
 */
async function everyBlockComponent(client: Client, name: string, { withFields = false } = {}) {
  const figure = await uploadImage(client, 'A blue rectangle');
  const image = await uploadImage(client, 'A small blue mark');
  return makeComponent(
    client,
    name,
    everyBlock(figure, image),
    withFields ? { type: 'Procedure' } : {},
  );
}

/** The component's page, opened by its address, its surface drawn and the page settled. */
async function openComponent(page: Page, id: string): Promise<Locator> {
  await page.goto(`${SERVICE}/#/components/${id}`);
  const surface = surfaceOf(page);
  await surface.waitFor();
  await settled(page);
  return surface;
}

describe('accessibility in a browser, against WCAG 2.2 AA', () => {
  it('passes axe on the screen a person meets signed out', async ({ task }) => {
    // The renderer asks who is signed in, and the service answers 401, which the browser reports in
    // the page's console as a failed load: what signed out is, and not the page's own noise.
    allowPageNoise();
    await withPage(
      async (page) => {
        await page.goto(SERVICE);
        await page.getByRole('link', { name: 'Sign in' }).waitFor();
        await settled(page);
        await checkAxe(page, 'signed out', task.meta);
      },
      { signedIn: false },
    );
  });

  it('passes axe on the screens every way into the editor passes: home, the lists, search, API tokens and Administration', async ({
    task,
  }) => {
    await withPage(async (page) => {
      const check = (state: string) => checkAxe(page, state, task.meta);
      await page.goto(`${SERVICE}/#/`);
      await page.getByRole('heading', { level: 1 }).waitFor();
      await settled(page);
      await check('home');

      // Each list, by the workspace's own links, as a person moves between them.
      for (const [link, state] of [
        ['Components', 'the components list'],
        ['Documents', 'the documents list'],
        ['Publications', 'the publications list'],
        ['Templates', 'the templates list'],
      ] as const) {
        await page.goto(`${SERVICE}/#/components`);
        await page
          .getByRole('navigation', { name: 'Workspace' })
          .getByRole('link', { name: link })
          .click();
        await settled(page);
        await check(state);
      }

      await page
        .getByRole('navigation', { name: 'Workspace' })
        .getByRole('link', { name: 'Search' })
        .click();
      await page.getByRole('searchbox', { name: 'Search' }).fill('printer');
      await page.keyboard.press('Enter');
      await settled(page);
      await check('the search page with results');

      // The account's menu, and the two modals it opens.
      const account = page.getByRole('button', { name: /Ada/ });
      await account.click();
      await check('the account menu open');
      await page.getByRole('button', { name: 'API tokens' }).click();
      await page.getByRole('heading', { name: 'API tokens' }).waitFor();
      await settled(page);
      await check('API tokens');
      await page.getByRole('button', { name: 'New token' }).click();
      await page.getByRole('heading', { name: 'New token' }).waitFor();
      await settled(page);
      await check('a new API token');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');

      await account.click();
      await page.getByRole('button', { name: 'Administration' }).click();
      await page.getByRole('heading', { name: 'Administration' }).waitFor();
      await settled(page);
      await check('Administration');
      const sections = page.getByRole('navigation', { name: 'Sections' });
      for (const section of ['Spaces', 'People', 'Roles', 'Groups']) {
        await sections.getByRole('button', { name: section }).click();
        await settled(page);
        await check(`Administration, ${section}`);
      }
      await page.getByRole('button', { name: 'New group' }).click();
      await page.getByRole('heading', { name: 'New group' }).waitFor();
      await check('Administration, a new group');
    });
  });

  it('CNT-176 the component editor passes axe with every block and mark, each dialog and each panel', async ({
    task,
  }) => {
    const client = api();
    const made = await everyBlockComponent(client, 'Every block', { withFields: true });
    const meta: TaskMeta = task.meta;

    await withPage(async (page) => {
      const check = (state: string) => checkAxe(page, state, meta);
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      const surface = await openComponent(page, made.id);
      await check('the component editor as opened');

      // The cursor in each block kind, by the pointer; a panel stands beside some of them.
      const at = async (state: string, target: Locator, panel?: string) => {
        await target.click();
        if (panel !== undefined) await page.getByRole('group', { name: panel }).waitFor();
        await settled(page);
        await check(state);
      };
      await at('the cursor among the nine marks', surface.getByText('emphasis', { exact: true }));
      await at(
        'the cursor in a numbered list, the List panel open',
        surface.getByText('A numbered item'),
        'List',
      );
      await at(
        'the cursor in a bulleted list, the List panel open',
        surface.getByText('A bulleted item'),
        'List',
      );
      await at('the cursor in a definition list', surface.getByText('A definition.'));
      await at(
        'the cursor in a table cell, the Table panel open',
        surface.getByText('Measured', { exact: true }),
        'Table',
      );
      await at('the cursor in a merged cell', surface.getByText('Merged across two'), 'Table');
      await at('the cursor in a quotation', surface.getByText('A quoted passage.'));
      await at(
        'the cursor in preformatted text, its panel open',
        surface.getByText('select 1'),
        'Preformatted text',
      );
      await at(
        'a figure chosen, the Figure panel open',
        surface.getByRole('img', { name: 'A blue rectangle' }),
      );
      await at(
        'an inline image chosen, its panel open',
        surface.getByRole('img', { name: /^The image/ }),
      );
      await at('a footnote open', surface.getByRole('img', { name: 'Footnote' }));
      await at('a cross-reference chosen', surface.getByText('Table: The table'));
      await at('a block equation chosen', surface.getByRole('math').last());
      await at('an inline equation chosen', surface.getByRole('math').first());

      // Each dialog, from the toolbar or its shortcut, over what it acts on.
      await surface.getByRole('link', { name: 'a link' }).dblclick();
      await page.getByRole('button', { name: 'Link', exact: true }).click();
      await dialog(page, 'Link');
      await settled(page);
      await check('the Link dialog');
      await closeDialog(page);

      await surface.getByText('in another language').dblclick();
      await page.getByRole('button', { name: 'Language', exact: true }).click();
      await dialog(page, 'Language');
      await settled(page);
      await check('the Language dialog');
      await closeDialog(page);

      const last = surface.getByText('The last paragraph.');
      await last.click();
      await page.keyboard.press('End');
      await page.keyboard.press('ControlOrMeta+Alt+x');
      await dialog(page, 'Reference');
      await settled(page);
      await check('the Reference dialog');
      await closeDialog(page);

      await last.click();
      await page.keyboard.press('End');
      await page.keyboard.press('ControlOrMeta+Shift+e');
      const equation = await dialog(page, 'Equation');
      await equation.getByRole('textbox').first().fill('x^{2}');
      await settled(page);
      await check('the Equation dialog');
      await closeDialog(page);

      await last.click();
      await page.getByRole('button', { name: 'Symbols' }).click();
      await dialog(page, /Symbol/);
      await settled(page);
      await check('the symbol palette');
      await closeDialog(page);

      await last.click();
      await page.getByRole('button', { name: 'Figure', exact: true }).click();
      await dialog(page, 'Figure');
      await settled(page);
      await check('the Figure dialog');
      await closeDialog(page);

      await last.click();
      await page.getByRole('button', { name: 'Image', exact: true }).click();
      await dialog(page, 'Image');
      await settled(page);
      await check('the Image dialog');
      await closeDialog(page);

      // A paste from a web page, and the report of what admission changed.
      await last.click();
      await page.keyboard.press('End');
      await page.evaluate(async () => {
        const html = '<p style="color: red">Pasted <font face="serif">text</font></p>';
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob(['Pasted text'], { type: 'text/plain' }),
          }),
        ]);
      });
      await page.keyboard.press('ControlOrMeta+v');
      await page.getByRole('region', { name: /paste/i }).waitFor();
      await settled(page);
      await check('the paste report');

      await page.evaluate(async () => {
        await navigator.clipboard.writeText('Some *Markdown*, pasted.');
      });
      await last.click();
      await page.getByRole('button', { name: 'Paste as Markdown' }).click();
      await surface.getByText('Markdown', { exact: true }).waitFor();
      await settled(page);
      await check('pasted as Markdown');

      // The title strip's fields.
      await page.getByRole('textbox', { name: 'Title' }).click();
      await check('the title field');
      await page.getByRole('button', { name: /^Base language/ }).click();
      await settled(page);
      await check('the base language open');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /^Base direction/ }).click();
      await settled(page);
      await check('the base direction open');
      await page.keyboard.press('Escape');

      // The fields beside the text.
      await page.getByRole('combobox', { name: 'Owner' }).focus();
      await check('the Fields panel');

      // Recovery: the author's saved text listed.
      await page.getByRole('button', { name: 'Saved text' }).click();
      const recovery = page.getByRole('region', { name: /saved text|recover/i });
      await recovery.waitFor();
      await settled(page);
      await check('the Recovery panel');
    });
  });

  it('CNT-176 the component editor passes axe with a save that failed', async ({ task }) => {
    const client = api();
    const made = await makeComponent(client, 'A failing save', [
      {
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [{ type: 'text', value: 'Words.', marks: [] }],
      },
    ]);
    // The service is made to refuse every save, which the page reports in its console as a
    // failed load: provoked on purpose.
    allowPageNoise();
    await withPage(async (page) => {
      const surface = await openComponent(page, made.id);
      await page.route('**/v1/components/*/iterations/**', (route) =>
        route.request().method() === 'PUT'
          ? route.fulfill({ status: 503, body: '' })
          : route.continue(),
      );
      await surface.getByText('Words.').click();
      await page.keyboard.press('End');
      await page.keyboard.type(' More.');
      await page.getByText('Not saved', { exact: true }).waitFor({ timeout: 30_000 });
      await checkAxe(page, 'a save that failed', task.meta);
    });
  });

  it('CNT-176 the document view passes axe in Reading and Authoring, with its outline, versions, lists, preview and publishing', async ({
    task,
  }) => {
    const client = api();
    const component = await everyBlockComponent(client, 'Every block, placed');
    let document = await makeDocument(client, 'The document view', [
      'Introduction',
      ['Methods', 'Measures'],
    ]);
    document = await edit(client, document, {
      operation: 'insert',
      parent: nodesOf(document)[0]!.id,
      position: 0,
      node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
    });
    const methods = nodesOf(document)[1]!;

    await withPage(async (page) => {
      const check = (state: string) => checkAxe(page, state, task.meta);
      await page.goto(`${SERVICE}/#/documents/${document.id}`);
      await page.getByRole('tree', { name: 'Outline' }).waitFor();
      await surfaceTextShown(page);
      await check('the document view as opened');

      await page.getByRole('radio', { name: 'Reading' }).check();
      await settled(page);
      await check('the document view in Reading');
      await page.getByRole('radio', { name: 'Authoring' }).check();
      await settled(page);
      await check('the document view in Authoring');

      await page.getByLabel('Show boundaries').check();
      await settled(page);
      await check('boundaries shown');

      const tree = page.getByRole('tree', { name: 'Outline' });
      await tree.getByRole('treeitem', { name: 'Methods', exact: false }).first().click();
      await settled(page);
      await check('a section chosen in the outline');

      await page.goto(`${SERVICE}/#/documents/${document.id}/nodes/${methods.children[0]!.id}`);
      await tree.waitFor();
      await surfaceTextShown(page);
      await check('a section arrived at by a link');

      // The version chooser, on the placed component's label.
      await page
        .getByRole('button', { name: /choose the version of/ })
        .first()
        .click();
      await page
        .getByRole('menu', { name: /^Versions of / })
        .getByRole('menuitemradio', { name: /^Version / })
        .first()
        .waitFor();
      await settled(page);
      await check('the version chooser open');
      await page.keyboard.press('Escape');

      // A section's title editor, and the Equation dialog beside it.
      await tree.getByRole('treeitem', { name: 'Methods', exact: false }).first().click();
      await page.getByRole('textbox', { name: 'Title' }).click();
      await check('a section title being edited');
      await page.getByRole('button', { name: 'Equation', exact: true }).click();
      await dialog(page, 'Equation');
      await settled(page);
      await check('the Equation dialog over a section title');
      await closeDialog(page);

      // The removal asked about.
      await page.getByRole('button', { name: 'Remove section' }).click();
      await page.getByRole('group', { name: 'Confirm removal' }).waitFor();
      await check('the removal asked about');
      await page
        .getByRole('group', { name: 'Confirm removal' })
        .getByRole('button', { name: 'Keep' })
        .click();

      // The component opened in place, for editing inside the document.
      await page
        .getByRole('region', { name: "The document's text" })
        .getByText('The last paragraph.')
        .click();
      await surfaceOf(page).waitFor();
      await settled(page);
      await check('a component open in place');
      await page.getByRole('button', { name: 'Done editing' }).click();

      // A preview asked for, and shown in its pane.
      await page.getByRole('button', { name: 'Preview', exact: true }).click();
      await page.getByRole('region', { name: 'Preview' }).waitFor();
      await page.getByRole('button', { name: 'Close the preview' }).waitFor();
      await settled(page);
      await check('the preview pane');
      await page.getByRole('button', { name: 'Close the preview' }).click();

      // Published, and the publication's own page.
      await page
        .getByRole('button', { name: /^Publish as/ })
        .first()
        .click();
      await page.getByText('Publishing...').waitFor();
      await page.getByText('Publishing...').waitFor({ state: 'detached', timeout: 120_000 });
      await settled(page);
      await check('published');
      await page.getByRole('link', { name: 'Open the publication' }).click();
      await settled(page);
      await check('the publication page');
    });
  });
});

/** The document's text drawn: its first heading shown, and the page settled. */
async function surfaceTextShown(page: Page): Promise<void> {
  await page
    .getByRole('heading', { name: /Introduction/ })
    .first()
    .waitFor();
  await settled(page);
}
