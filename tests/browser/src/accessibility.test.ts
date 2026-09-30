import type { Locator, Page } from 'playwright-core';
import { describe, it, vi, type TaskMeta } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api, edit, makeDocument, nodesOf, type Client } from './testing/api.js';
import { checkAxe, type Arrival, type Sign } from './testing/axe.js';
import { makeComponent, uploadImage } from './testing/component.js';
import { everyBlock } from './testing/every-block.js';
import { allowPageNoise, withPage } from './testing/page.js';

/**
 * axe-core over every state of the editor and the document view a person reaches, and the screens
 * every way into them passes, each reached by the keyboard or the pointer as a person would (the W13
 * plan's W13.2 and B-I): WCAG 2.2 AA's automatable criteria, over the whole page in each state, at a
 * desktop viewport. What axe cannot decide is written into each test's `meta` for the audit a person
 * makes (CNT-177), never failed on; what it finds fails the test unless the allow-list holds it.
 *
 * **Each state is waited for by its own content** - a list's heading, a table's row, a panel, a dialog
 * - and `checkAxe` refuses to run where that content is not there, or what the state before left is
 * still there. A move inside the app changes the page after the network has gone quiet, so waiting for
 * the network checks the screen before, and passes having checked nothing (the W13.2 review).
 */

/** Waits until each of `gone` has left the page. */
async function leave(...gone: readonly Locator[]): Promise<void> {
  for (const each of gone) await each.waitFor({ state: 'hidden' });
}

/** Waits until the state `arrival` names is on the page: each sign there, each thing it hides gone. */
async function arrive({ shows, hides = [] }: Arrival): Promise<void> {
  const signs: readonly Sign[] = Array.isArray(shows) ? shows : [shows as Sign];
  for (const sign of signs) {
    if ('holds' in sign) {
      await vi.waitFor(
        async () => {
          if (!(await sign.holds())) throw new Error(sign.said);
        },
        { timeout: 30_000, interval: 100 },
      );
    } else {
      await sign.waitFor({ state: 'visible' });
    }
  }
  for (const gone of hides) await gone.waitFor({ state: 'hidden' });
}

/** The editor's surface, the one textbox named for the component's content. */
function surfaceOf(page: Page): Locator {
  return page.getByRole('textbox', { name: /^Content of / });
}

/** Escape pressed until no dialog stands over the page. */
async function closeDialog(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
}

/** The element with the focus, if it is `locator`'s. */
function focused(locator: Locator): Sign {
  return {
    said: `${String(locator)} does not have the focus`,
    holds: () => locator.evaluate((element) => element === document.activeElement),
  };
}

/** The editor's selection standing inside an element `selector` matches, on the surface. */
function cursorIn(page: Page, selector: string): Sign {
  return {
    said: `the cursor is not in ${selector}`,
    holds: () =>
      page.evaluate((within) => {
        const at = document.getSelection()?.anchorNode;
        const element = at instanceof Element ? at : (at?.parentElement ?? null);
        return element?.closest('.ProseMirror')?.contains(element.closest(within)) === true;
      }, selector),
  };
}

/** The panels the editor sets beside the surface, one at a time, by what is chosen. */
const PANELS = ['List', 'Table', 'Preformatted text', 'Figure', 'Image'] as const;
type Panel = (typeof PANELS)[number];

/** Those `shown` open, and every other one gone. */
function panels(
  page: Page,
  shown: readonly Panel[],
): { readonly shows: Locator[]; readonly hides: Locator[] } {
  const panel = (name: Panel) => page.getByRole('group', { name, exact: true });
  return {
    shows: shown.map(panel),
    hides: PANELS.filter((name) => !shown.includes(name)).map(panel),
  };
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

/** The component's page, opened by its address, its surface drawn and its save chip saying Saved. */
async function openComponent(page: Page, id: string): Promise<Locator> {
  await page.goto(`${SERVICE}/#/components/${id}`);
  const surface = surfaceOf(page);
  await arrive({ shows: [surface, page.getByText('Saved', { exact: true })] });
  return surface;
}

describe('accessibility in a browser, against WCAG 2.2 AA', () => {
  it('passes axe on the screen a person meets signed out', async ({ task }) => {
    // The renderer asks who is signed in, and the service answers 401, which the browser reports in
    // the page's console as a failed load: what signed out is, and not the page's own noise.
    allowPageNoise(
      /^console\.error: Failed to load resource: .* 401 \(Unauthorized\) \(.*\/v1\/me:/,
    );
    await withPage(
      async (page) => {
        await page.goto(SERVICE);
        const arrival = { shows: page.getByRole('link', { name: 'Sign in' }) };
        await arrive(arrival);
        await checkAxe(page, 'signed out', task.meta, arrival);
      },
      { signedIn: false },
    );
  });

  it('passes axe on the screens every way into the editor passes: home, the lists, search, API tokens and Administration', async ({
    task,
  }) => {
    await withPage(async (page) => {
      const check = async (state: string, arrival: Arrival) => {
        await arrive(arrival);
        await checkAxe(page, state, task.meta, arrival);
      };
      const heading = (name: string, level = 1) =>
        page.getByRole('heading', { name, level, exact: true });

      await page.goto(`${SERVICE}/#/`);
      await check('home', {
        shows: [
          page.locator('#home-heading'),
          page.getByRole('link', { name: /Components/ }).first(),
        ],
      });

      // Each list, by the workspace's own links, as a person moves between them: its heading, and a
      // table of what it lists or its words for none.
      for (const [link, state, none] of [
        ['Components', 'the components list', 'There are no components you may read.'],
        ['Documents', 'the documents list', 'There are no documents you may read.'],
        ['Publications', 'the publications list', 'Nothing has been published that you may read.'],
        ['Templates', 'the templates list', 'There are no templates you may read.'],
      ] as const) {
        await page.goto(`${SERVICE}/#/components`);
        await arrive({ shows: heading('Components') });
        await page
          .getByRole('navigation', { name: 'Workspace' })
          .getByRole('link', { name: link })
          .click();
        const list = page.getByRole('region', { name: link, exact: true });
        await check(state, {
          shows: [heading(link), list.getByRole('table').or(list.getByText(none, { exact: true }))],
        });
      }

      await page
        .getByRole('navigation', { name: 'Workspace' })
        .getByRole('link', { name: 'Search' })
        .click();
      await page.getByRole('searchbox', { name: 'Search' }).fill('printer');
      await page.keyboard.press('Enter');
      await check('the search page with results', {
        shows: page
          .getByRole('heading', { level: 2 })
          .getByRole('link', { name: /printer/ })
          .first(),
      });

      // The account's menu, and the two modals it opens.
      const account = page.getByRole('button', { name: /Ada/ });
      await account.click();
      await check('the account menu open', {
        shows: page.getByRole('group', { name: 'Account' }),
      });
      await page.getByRole('button', { name: 'API tokens' }).click();
      await check('API tokens', {
        shows: [
          heading('API tokens', 2),
          page
            .getByRole('table', { name: 'Your tokens' })
            .or(page.getByText('You have no API tokens.')),
        ],
        hides: [page.getByText('Loading...')],
      });
      await page.getByRole('button', { name: 'New token' }).click();
      await check('a new API token', {
        shows: [heading('New token', 2), page.getByRole('button', { name: 'Create token' })],
      });
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await leave(page.getByRole('dialog'));

      await account.click();
      await page.getByRole('button', { name: 'Administration' }).click();
      const administration = page.getByRole('dialog', { name: 'Administration' });
      await check('Administration', {
        shows: [
          heading('Environment', 3),
          administration.locator('dd', { hasText: 'Development' }),
        ],
      });
      const sections = page.getByRole('navigation', { name: 'Sections' });
      for (const [section, table] of [
        ['Spaces', 'Spaces'],
        ['People and invitations', 'People'],
        ['Roles', 'Roles'],
        ['Groups', 'Groups'],
      ] as const) {
        await sections.getByRole('button', { name: section, exact: true }).click();
        await check(`Administration, ${section}`, {
          shows: [
            heading(section, 3),
            administration
              .getByRole('table', { name: table })
              .getByRole('row')
              .first()
              .or(administration.getByText('There are no groups yet.')),
          ],
        });
      }
      await page.getByRole('button', { name: 'New group' }).click();
      await check('Administration, a new group', { shows: heading('New group', 2) });
    });
  });

  it('CNT-176 the component editor passes axe with every block and mark, each dialog and each panel', async ({
    task,
  }) => {
    const client = api();
    const made = await everyBlockComponent(client, 'Every block', { withFields: true });
    const meta: TaskMeta = task.meta;

    await withPage(async (page) => {
      const check = async (state: string, arrival: Arrival) => {
        await arrive(arrival);
        await checkAxe(page, state, meta, arrival);
      };
      const button = (name: string, pressed?: boolean) =>
        page.getByRole('button', {
          name,
          exact: true,
          ...(pressed === undefined ? {} : { pressed }),
        });
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      const surface = await openComponent(page, made.id);
      await check('the component editor as opened', { shows: surface });

      // The cursor in each block kind, by the pointer: the panels beside the surface those that stand
      // for it and no other, and what else says where the cursor is.
      const at = async (
        state: string,
        target: Locator,
        shown: readonly Panel[],
        ...signs: readonly Sign[]
      ) => {
        await target.click();
        const beside = panels(page, shown);
        await check(state, { shows: [surface, ...beside.shows, ...signs], hides: beside.hides });
      };
      await at(
        'the cursor among the nine marks',
        surface.getByText('emphasis', { exact: true }),
        [],
        button('Emphasis', true),
      );
      await at(
        'the cursor in a numbered list, the List panel open',
        surface.getByText('A numbered item'),
        ['List'],
        button('Numbered list', true),
      );
      await at(
        'the cursor in a bulleted list, the List panel open',
        surface.getByText('A bulleted item'),
        ['List'],
        button('Bulleted list', true),
      );
      await at(
        'the cursor in a definition list',
        surface.getByText('A definition.'),
        [],
        button('Definition list', true),
      );
      await at(
        'the cursor in a table cell, the Table panel open',
        surface.getByText('Measured', { exact: true }),
        ['Table'],
        cursorIn(page, 'td'),
      );
      await at(
        'the cursor in a merged cell',
        surface.getByText('Merged across two'),
        ['Table'],
        cursorIn(page, 'td[colspan="2"]'),
      );
      await at(
        'the cursor in a quotation',
        surface.getByText('A quoted passage.'),
        [],
        cursorIn(page, 'blockquote'),
      );
      await at('the cursor in preformatted text, its panel open', surface.getByText('select 1'), [
        'Preformatted text',
      ]);
      // A figure's panel opens with the cursor in its caption; a click on its picture opens nothing
      // (issue #335).
      await at(
        "the cursor in a figure's caption, the Figure panel open",
        surface.getByText('The figure', { exact: true }),
        ['Figure'],
      );
      await at(
        'an inline image chosen, its panel open',
        surface.getByRole('img', { name: /^The image/ }),
        ['Image'],
      );
      await at(
        'a footnote open',
        surface.getByRole('img', { name: 'Footnote' }),
        [],
        page.getByRole('textbox', { name: 'Footnote text' }),
      );
      await at(
        'a cross-reference chosen',
        surface.getByText('Table: The table'),
        [],
        surface.locator('.ProseMirror-selectednode', { hasText: 'Table: The table' }),
      );
      await at(
        'a block equation chosen',
        surface.getByRole('math').last(),
        [],
        surface
          .locator('.ProseMirror-selectednode')
          .filter({ has: page.getByRole('math', { name: 'a over b' }) }),
      );
      await at(
        'an inline equation chosen',
        surface.getByRole('math').first(),
        [],
        surface
          .locator('.ProseMirror-selectednode')
          .filter({ has: page.getByRole('math', { name: 'x squared' }) }),
      );

      // Each dialog, from the toolbar or its shortcut, over what it acts on.
      const dialog = (name: string): Arrival => ({ shows: page.getByRole('dialog', { name }) });
      await surface.getByRole('link', { name: 'a link' }).dblclick();
      await button('Link').click();
      await check('the Link dialog', {
        shows: [page.getByRole('dialog', { name: 'Link' }).getByRole('textbox').first()],
      });
      await closeDialog(page);

      await surface.getByText('in another language').dblclick();
      await button('Language').click();
      await check('the Language dialog', {
        shows: [page.getByRole('dialog', { name: 'Language' }).getByRole('textbox').first()],
      });
      await closeDialog(page);

      const last = surface.getByText('The last paragraph.');
      await last.click();
      await page.keyboard.press('End');
      await page.keyboard.press('ControlOrMeta+Alt+x');
      await check('the Reference dialog', {
        shows: page.getByRole('dialog', { name: 'Reference' }).getByRole('radio').first(),
      });
      await closeDialog(page);

      await last.click();
      await page.keyboard.press('End');
      await page.keyboard.press('ControlOrMeta+Shift+e');
      const equation = page.getByRole('dialog', { name: 'Equation' });
      await arrive({ shows: equation });
      await equation.getByRole('textbox').first().fill('x^{2}');
      await check('the Equation dialog', {
        shows: equation.getByRole('group').getByRole('math').first(),
      });
      await closeDialog(page);

      await last.click();
      await button('Symbols').click();
      await check('the symbol palette', {
        shows: page
          .getByRole('dialog', { name: /Symbol/ })
          .getByRole('grid')
          .first(),
      });
      await closeDialog(page);

      await last.click();
      await button('Figure').click();
      await check('the Figure dialog', dialog('Figure'));
      await closeDialog(page);

      await last.click();
      await button('Image').click();
      await check('the Image dialog', dialog('Image'));
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
      await check('the paste report', {
        shows: [page.getByRole('region', { name: /paste/i }), surface.getByText('Pasted text')],
      });

      await page.evaluate(async () => {
        await navigator.clipboard.writeText('Some *Markdown*, pasted.');
      });
      await last.click();
      await button('Paste as Markdown').click();
      await check('pasted as Markdown', {
        shows: surface.getByRole('emphasis').filter({ hasText: 'Markdown' }),
      });

      // The title strip's fields.
      const title = page.getByRole('textbox', { name: 'Title' });
      await title.click();
      await check('the title field', { shows: focused(title) });
      await page.getByRole('button', { name: /^Base language/ }).click();
      await check('the base language open', {
        shows: page.getByRole('group', { name: /^Base language/ }),
      });
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /^Base direction/ }).click();
      await check('the base direction open', {
        shows: page.getByRole('group', { name: /^Base direction/ }),
        hides: [page.getByRole('group', { name: /^Base language/ })],
      });
      await page.keyboard.press('Escape');

      // The fields beside the text.
      const owner = page.getByRole('combobox', { name: 'Owner' });
      await owner.focus();
      await check('the Fields panel', {
        shows: [page.getByRole('region', { name: 'Fields of Procedure' }), focused(owner)],
        hides: [page.getByRole('group', { name: /^Base direction/ })],
      });

      // Recovery: the author's saved text listed.
      await button('Saved text').click();
      const recovery = page.getByRole('region', { name: 'Saved text' });
      await check('the Recovery panel', {
        shows: recovery
          .getByRole('button', { name: /^Restore / })
          .first()
          .or(recovery.getByText('There is no saved text to restore.')),
        hides: [recovery.getByText('Listing...')],
      });
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
    allowPageNoise(
      /^console\.error: Failed to load resource: .* 503 \(Service Unavailable\) \(.*\/iterations\//,
    );
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
      const notSaved = page.getByText('Not saved', { exact: true });
      await notSaved.waitFor({ timeout: 30_000 });
      await checkAxe(page, 'a save that failed', task.meta, { shows: notSaved });
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
      const check = async (state: string, arrival: Arrival) => {
        await arrive(arrival);
        await checkAxe(page, state, task.meta, arrival);
      };
      const tree = page.getByRole('tree', { name: 'Outline' });
      const text = page.getByRole('region', { name: "The document's text" });
      const drawn = [
        tree,
        text.getByRole('heading', { name: /Introduction/ }),
        text.getByText('The last paragraph.'),
      ] as const;
      // A node's own row: the item holds its children too, and a click at its middle can land on one.
      const row = (name: RegExp) =>
        tree.getByRole('treeitem', { name }).first().locator('[data-row]').first();
      const node = (name: RegExp) => tree.getByRole('treeitem', { name, selected: true }).first();

      await page.goto(`${SERVICE}/#/documents/${document.id}`);
      await check('the document view as opened', { shows: drawn });

      await page.getByRole('radio', { name: 'Reading' }).check();
      await check('the document view in Reading', {
        shows: [...drawn, page.getByRole('article', { name: /in Reading$/ })],
      });
      await page.getByRole('radio', { name: 'Authoring' }).check();
      await check('the document view in Authoring', {
        shows: [
          ...drawn,
          page.getByRole('article', { name: /in Authoring$/ }),
          text.locator('[data-opens="true"]').first(),
        ],
      });

      await page.getByLabel('Show boundaries').check();
      await check('boundaries shown', { shows: page.locator('[data-boundaries="shown"]') });

      await row(/Methods/).click();
      await check('a section chosen in the outline', { shows: node(/Methods/) });

      await page.goto(`${SERVICE}/#/documents/${document.id}/nodes/${methods.children[0]!.id}`);
      await check('a section arrived at by a link', { shows: [...drawn, node(/Measures/)] });

      // The version chooser, on the placed component's label.
      await page
        .getByRole('button', { name: /choose the version of/ })
        .first()
        .click();
      const versions = page.getByRole('menu', { name: /^Versions of / });
      await check('the version chooser open', {
        shows: versions.getByRole('menuitemradio', { name: /^Version / }).first(),
        hides: [versions.getByText('Reading the versions...')],
      });
      await page.keyboard.press('Escape');
      await leave(versions);

      // A section's title editor, and the Equation dialog beside it.
      await row(/Methods/).click();
      await arrive({ shows: node(/Methods/) });
      const title = page.getByRole('textbox', { name: 'Title' });
      await title.click();
      await check('a section title being edited', { shows: focused(title) });
      await page.getByRole('button', { name: 'Equation', exact: true }).click();
      const equation = page.getByRole('dialog', { name: 'Equation' });
      await check('the Equation dialog over a section title', {
        shows: equation.getByRole('textbox').first(),
      });
      await closeDialog(page);

      // The removal asked about.
      await page.getByRole('button', { name: 'Remove section' }).click();
      const question = page.getByRole('group', { name: 'Confirm removal' });
      await check('the removal asked about', { shows: question });
      await question.getByRole('button', { name: 'Keep' }).click();
      await leave(question);

      // The component opened in place, for editing inside the document.
      await text.getByText('The last paragraph.').click();
      await check('a component open in place', {
        shows: [surfaceOf(page), page.getByText('Saved', { exact: true })],
      });
      await page.getByRole('button', { name: 'Done editing' }).click();
      await leave(surfaceOf(page));

      // A preview asked for, and shown in its pane.
      await page.getByRole('button', { name: 'Preview', exact: true }).click();
      const preview = page.getByRole('region', { name: 'Preview', exact: true });
      await check('the preview pane', {
        shows: [
          preview.getByRole('button', { name: 'Download the PDF' }),
          preview.locator('iframe'),
        ],
      });
      await page.getByRole('button', { name: 'Close the preview' }).click();
      await leave(preview);

      // Published, and the publication's own page.
      await page
        .getByRole('button', { name: /^Publish as/ })
        .first()
        .click();
      const opened = page.getByRole('link', { name: 'Open the publication' });
      await opened.waitFor({ timeout: 120_000 });
      await check('published', { shows: opened });
      await opened.click();
      await check('the publication page', {
        shows: [page.locator('#publication-title'), page.getByText(/Not approved/).first()],
        hides: [tree],
      });
    });
  });

  it("passes axe on Connections, New connection and a connection's page, each worked by keyboard alone", async ({
    task,
  }) => {
    await withPage(async (page) => {
      const check = async (state: string, arrival: Arrival) => {
        await arrive(arrival);
        await checkAxe(page, state, task.meta, arrival);
      };
      /** Tab until `target` holds the focus, as a person with no pointer reaches it. */
      const tabTo = async (target: Locator) => {
        for (let presses = 0; presses < 60; presses += 1) {
          if (await target.evaluate((element) => element === document.activeElement)) return;
          await page.keyboard.press('Tab');
        }
        throw new Error(`${String(target)} was never reached by Tab`);
      };

      await page.goto(`${SERVICE}/#/components`);
      await arrive({ shows: page.getByRole('heading', { name: 'Components', level: 1 }) });
      const toConnections = page
        .getByRole('navigation', { name: 'Workspace' })
        .getByRole('link', { name: 'Connections' });
      await tabTo(toConnections);
      await page.keyboard.press('Enter');
      const list = page.getByRole('region', { name: 'Connections', exact: true });
      await check('the connections list', {
        shows: [
          page.getByRole('heading', { name: 'Connections', level: 1 }),
          list
            .getByRole('table')
            .or(list.getByText('There are no connections you may read.', { exact: true })),
        ],
      });

      // New connection, by keyboard: the dialog opens on its first field.
      await tabTo(page.getByRole('button', { name: 'New connection' }));
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'New connection' });
      await check('a new connection', { shows: dialog.getByRole('button', { name: 'Create' }) });
      const name = `Readings ${Date.now()}`;
      for (const [label, value] of [
        ['Name', name],
        ['Host', 'source-postgres'],
        ['Database', 'readings'],
        ['Account', 'reader'],
      ] as const) {
        await tabTo(dialog.getByLabel(label, { exact: true }));
        await page.keyboard.type(value);
      }
      await tabTo(dialog.getByRole('button', { name: 'Create' }));
      await page.keyboard.press('Enter');
      await check('a connection', {
        shows: [
          page.getByRole('heading', { name, level: 1 }),
          page.getByRole('button', { name: 'Save version' }),
        ],
        hides: [dialog],
      });

      // Its password set, which tests it straight after, against the development source.
      const credential = page.getByRole('region', { name: 'Credential' });
      await tabTo(credential.getByLabel('Password'));
      await page.keyboard.type('source-reader-dev-password');
      await tabTo(credential.getByRole('button', { name: 'Set' }));
      await page.keyboard.press('Enter');
      await check('a connection with its password set and tested', {
        shows: [credential.getByText('Connected.'), credential.getByText(/^Set by Ada on /)],
      });

      // Its tables, listed.
      await tabTo(page.getByRole('button', { name: 'List tables' }));
      await page.keyboard.press('Enter');
      const tables = page.getByRole('table', { name: 'Tables and views' });
      await check("a connection's tables", {
        shows: tables.getByRole('cell', { name: 'sample.site', exact: true }),
      });
    });
  });
});
