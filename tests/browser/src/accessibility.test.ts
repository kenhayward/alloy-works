import type { Locator, Page } from 'playwright-core';
import { describe, expect, it, vi, type TaskMeta } from 'vitest';
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

      // Each list, by the module rail's links, as a person moves between them: its heading, and a
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
          .getByRole('navigation', { name: 'Modules' })
          .getByRole('link', { name: link })
          .click();
        const list = page.getByRole('region', { name: link, exact: true });
        await check(state, {
          shows: [heading(link), list.getByRole('table').or(list.getByText(none, { exact: true }))],
        });
      }

      // The chosen component beside the list (LG6a).
      await page.goto(`${SERVICE}/#/components`);
      await page
        .getByRole('button', { name: /^Show .+ here$/ })
        .first()
        .click();
      await check('the chosen component beside the list', {
        shows: page.getByRole('list', { name: 'Versions' }),
      });

      // Search, from search and commands in the header (ADR-0046).
      await page
        .getByRole('button', { name: 'Search components, documents, or run a command' })
        .click();
      const commands = page.getByRole('dialog', { name: 'Search and commands' });
      await commands.getByRole('combobox', { name: 'Search or go to' }).fill('printer');
      await check('search and commands', {
        shows: commands.getByRole('option', { name: 'Search for "printer"' }),
      });
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

      // Administration is a page, opened by Admin at the rail's foot (ADR-0049).
      await page
        .getByRole('navigation', { name: 'Modules' })
        .getByRole('link', { name: 'Admin' })
        .click();
      const administration = page.getByRole('region', { name: 'Administration' });
      await check('Administration', {
        shows: [heading('Overview', 1), administration.locator('dd', { hasText: 'Development' })],
      });
      const sections = page.getByRole('navigation', { name: 'Sections of Administration' });
      for (const [section, table] of [
        ['Spaces', 'Spaces'],
        ['People', 'People'],
        ['Roles', 'Roles'],
        ['Groups', 'Groups'],
      ] as const) {
        await sections.getByRole('link', { name: new RegExp(`^${section}`) }).click();
        await check(`Administration, ${section}`, {
          shows: [
            heading(section, 1),
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
        // Nest and Lift alone on the toolbar's second line (ADR-0053).
        'the cursor in a definition list, the List panel open',
        surface.getByText('A definition.'),
        ['List'],
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

      // The fields beside the text, in Attributes: the Table tab was chosen as the cursor entered the
      // component's table (ADR-0052).
      await page
        .getByRole('tablist', { name: 'Component panels' })
        .getByRole('tab', { name: 'Attributes' })
        .click();
      const owner = page.getByRole('combobox', { name: 'Owner' });
      await owner.focus();
      await check('the Fields panel', {
        shows: [page.getByRole('region', { name: 'Fields of Procedure' }), focused(owner)],
        hides: [page.getByRole('group', { name: /^Base direction/ })],
      });

      // The panels beside it, named in words (LG6b): Versions and Access, then Attributes again.
      const componentPanels = page.getByRole('tablist', { name: 'Component panels' });
      await componentPanels.getByRole('tab', { name: 'Versions' }).click();
      await check('the Versions panel', {
        shows: page
          .getByRole('tabpanel', { name: 'Versions' })
          .getByRole('list', { name: 'Versions' }),
      });
      await componentPanels.getByRole('tab', { name: 'Access' }).click();
      await check('the Access panel', {
        shows: page
          .getByRole('tabpanel', { name: 'Access' })
          .getByText(/is set on its access page/),
      });
      await componentPanels.getByRole('tab', { name: 'Attributes' }).click();

      // Recovery: the author's saved text listed in its dialog, and what recovering one changes.
      await button('Saved text').click();
      const recovery = page.getByRole('dialog', { name: 'Saved text' });
      const first = recovery.getByRole('button', { name: /^The text saved at / }).first();
      await check('the Saved text dialog', {
        shows: first.or(recovery.getByText('There is no saved text to recover.')),
        hides: [recovery.getByText('Listing...')],
      });
      if ((await first.count()) > 0) {
        await first.click();
        const changes = recovery.getByRole('region', { name: 'What restoring it changes' });
        await check('the Saved text dialog showing what recovering changes', {
          shows: changes,
          hides: [changes.getByText('Reading...')],
        });
      }
      await recovery.getByRole('button', { name: 'Cancel' }).click();
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

      // The panels beside the text, named in words (LG6c): the lists, then publishing.
      const documentPanels = page.getByRole('tablist', { name: 'Document panels' });
      await documentPanels.getByRole('tab', { name: 'Lists' }).click();
      await check('the Lists panel', {
        shows: page.getByRole('tabpanel', { name: 'Lists' }),
      });
      await documentPanels.getByRole('tab', { name: 'Publishing' }).click();
      await check('the Publishing panel', {
        shows: page.getByRole('button', { name: /^Publish as/ }).first(),
      });

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
        .getByRole('navigation', { name: 'Modules' })
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
      // The S3 fields, the longest choice among them, each fit inside the dialog's own edges.
      await dialog.getByRole('combobox', { name: /^Type/ }).selectOption('s3');
      const overflowing = await dialog.evaluate((box) => {
        const edge = box.getBoundingClientRect().right;
        return [...box.querySelectorAll('input, select, textarea')]
          .filter((field) => field.getBoundingClientRect().right > edge)
          .map((field) => field.closest('label')?.textContent ?? field.tagName);
      });
      expect(overflowing).toEqual([]);
      await dialog.getByRole('combobox', { name: /^Type/ }).selectOption('postgres');
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

      // Its tabs (ADR-0050), reached by the arrows from the one chosen.
      const tabs = page.getByRole('tablist', { name: 'Connection' });
      const nextTab = async (from: string) => {
        await tabTo(tabs.getByRole('tab', { name: from }));
        await page.keyboard.press('ArrowRight');
      };

      // Its password set, which tests it straight after, against the development source.
      await nextTab('Settings');
      const credential = page.getByRole('tabpanel', { name: 'Credential' });
      await tabTo(credential.getByLabel('Password'));
      await page.keyboard.type('source-reader-dev-password');
      await tabTo(credential.getByRole('button', { name: 'Set' }));
      await page.keyboard.press('Enter');
      await check('a connection with its password set and tested', {
        shows: [credential.getByText('Connected.'), credential.getByText(/^Set by Ada on /)],
      });

      // Its tables, listed.
      await nextTab('Credential');
      await tabTo(page.getByRole('button', { name: 'List tables' }));
      await page.keyboard.press('Enter');
      const tables = page.getByRole('table', { name: 'Tables and views' });
      await check("a connection's tables", {
        shows: tables.getByRole('cell', { name: 'sample.site', exact: true }),
      });

      // What uses it, and its More actions open.
      await nextTab('Tables');
      await check("a connection's uses", {
        shows: page
          .getByRole('tabpanel', { name: /^Used by/ })
          .getByRole('region', { name: 'Documents' }),
      });
      await tabTo(page.getByRole('button', { name: `More actions for ${name}` }));
      await page.keyboard.press('Enter');
      await check("a connection's More actions", {
        shows: page.getByRole('menuitem', { name: 'Retire' }),
      });
      await page.keyboard.press('Escape');
    });
  });
  it("passes axe on Query definitions and a definition's steps, each worked by keyboard alone", async ({
    task,
  }) => {
    // A connection on the development source as `reader`, its password set and tested read-only, so
    // SQL may be written against it; made through the API, as a person's would be on its page.
    const client = api();
    const spaces = await client.GET('/v1/spaces', { params: { query: { limit: '100' } } });
    const general = spaces.data?.items.find((each) => each.name === 'General');
    if (!general) throw new Error('No General space to make a connection in');
    const connectionName = `Sampled ${Date.now()}`;
    const made = await client.POST('/v1/spaces/{space}/connections', {
      params: { path: { space: general.id } },
      body: {
        settings: {
          schemaVersion: 1,
          name: connectionName,
          description: '',
          type: 'postgres',
          source: {
            host: 'source-postgres',
            port: 5432,
            database: 'readings',
            account: 'reader',
            tls: 'require',
          },
          identity: { kind: 'service' },
          retired: false,
        },
      },
    });
    if (!made.data) throw new Error(`The connection was not made: ${made.response.status}`);
    const set = await client.PUT('/v1/connections/{id}/credential', {
      params: { path: { id: made.data.id } },
      body: { secret: 'source-reader-dev-password' },
    });
    if (set.data?.test.outcome !== 'ok') {
      throw new Error(`The connection did not test clean: ${JSON.stringify(set.data)}`);
    }

    await withPage(async (page) => {
      const check = async (state: string, arrival: Arrival) => {
        await arrive(arrival);
        await checkAxe(page, state, task.meta, arrival);
      };
      /** Tab until `target` holds the focus, as a person with no pointer reaches it. */
      const tabTo = async (target: Locator) => {
        for (let presses = 0; presses < 120; presses += 1) {
          if (await target.evaluate((element) => element === document.activeElement)) return;
          await page.keyboard.press('Tab');
        }
        throw new Error(`${String(target)} was never reached by Tab`);
      };

      /** Opens a tab of the definition's page (ADR-0050): Tab to the chosen one, then the arrows. */
      const openTab = async (name: string) => {
        const tabs = page.getByRole('tablist', { name: 'Query definition' });
        await tabTo(tabs.getByRole('tab', { selected: true }));
        for (let presses = 0; presses < 8; presses += 1) {
          const at = await tabs.getByRole('tab', { selected: true }).textContent();
          if (at?.startsWith(name)) return;
          await page.keyboard.press('ArrowRight');
        }
        throw new Error(`The ${name} tab was never chosen`);
      };

      await page.goto(`${SERVICE}/#/components`);
      await arrive({ shows: page.getByRole('heading', { name: 'Components', level: 1 }) });
      await tabTo(
        page
          .getByRole('navigation', { name: 'Modules' })
          .getByRole('link', { name: 'Query definitions' }),
      );
      await page.keyboard.press('Enter');
      const list = page.getByRole('region', { name: 'Query definitions', exact: true });
      await check('the query definitions list', {
        shows: [
          page.getByRole('heading', { name: 'Query definitions', level: 1 }),
          list
            .getByRole('table')
            .or(list.getByText('There are no query definitions you may read.', { exact: true })),
        ],
      });

      // A new one, by keyboard, on the connection just made.
      await tabTo(page.getByRole('button', { name: 'New query definition' }));
      await page.keyboard.press('Enter');
      const connection = page.getByLabel('Connection', { exact: true });
      await check('a new query definition', {
        shows: [page.getByRole('heading', { name: 'New query definition', level: 1 }), connection],
      });
      await tabTo(connection);
      await page.keyboard.type(connectionName);
      await vi.waitFor(
        async () => {
          const chosen = await connection.evaluate(
            (element) => (element as HTMLSelectElement).selectedOptions[0]?.textContent,
          );
          if (chosen !== connectionName) throw new Error(`${chosen} is chosen`);
        },
        { timeout: 10_000 },
      );
      const title = `Site by id ${Date.now()}`;
      await tabTo(page.getByLabel('Title', { exact: true }));
      await page.keyboard.type(title);
      await openTab('Query');
      // The builder is offered first; Ada may write SQL on the connection, so SQL is offered too, and
      // chosen by the arrow keys from the radio button Tab reaches.
      await tabTo(page.getByRole('radio', { name: 'Builder', exact: true }));
      await page.keyboard.press('ArrowDown');
      await tabTo(page.getByLabel('SQL text', { exact: true }));
      await page.keyboard.type('select id, name from sample.site where id = {{site}} order by id');
      await tabTo(page.getByRole('button', { name: 'Add parameter' }));
      await page.keyboard.press('Enter');
      const parameter = page.getByRole('group', { name: 'Parameter 1' });
      await tabTo(parameter.getByLabel('Name', { exact: true }));
      await page.keyboard.type('site');
      await tabTo(parameter.getByLabel('Type', { exact: true }));
      await page.keyboard.type('Integer');
      await check('a statement and its parameter', { shows: [parameter] });

      // Described by the source, each column proposed and confirmed.
      await openTab('Columns');
      await tabTo(page.getByRole('button', { name: 'Describe' }));
      await page.keyboard.press('Enter');
      const columns = page.getByRole('table', { name: 'Columns' });
      await check('its columns proposed', {
        shows: [columns.getByRole('button', { name: 'Confirm id' })],
      });
      for (const name of ['id', 'name']) {
        await tabTo(columns.getByRole('button', { name: `Confirm ${name}` }));
        await page.keyboard.press('Enter');
      }
      await check('its columns confirmed', {
        shows: page.getByRole('button', { name: 'Save version' }),
      });

      // Run against a sample value.
      await openTab('Sample');
      const sample = page.getByRole('tabpanel', { name: 'Sample' });
      await tabTo(sample.getByLabel('site', { exact: true }));
      await page.keyboard.type('1');
      await tabTo(sample.getByRole('button', { name: 'Run sample' }));
      await page.keyboard.press('Enter');
      await check('a sample run', {
        shows: [
          sample.getByRole('table', { name: 'The first rows' }),
          sample.getByRole('button', { name: 'Checksum' }),
        ],
      });

      // Its checksum, shown beside its button as the focus reaches it.
      await tabTo(sample.getByRole('button', { name: 'Checksum' }));
      await check('a checksum shown', { shows: page.getByRole('tooltip') });

      // Saved, and its own page.
      await tabTo(page.getByRole('button', { name: 'Save version' }));
      await page.keyboard.press('Enter');
      await check('a query definition', {
        shows: [
          page.getByRole('heading', { name: title, level: 1 }),
          page.getByText('Version 0.1'),
        ],
      });
    });
  });
  it("passes axe on a built query definition's steps, each worked by keyboard alone", async ({
    task,
  }) => {
    // A connection on the development source as `reader`, made through the API and tested clean.
    const client = api();
    const spaces = await client.GET('/v1/spaces', { params: { query: { limit: '100' } } });
    const general = spaces.data?.items.find((each) => each.name === 'General');
    if (!general) throw new Error('No General space to make a connection in');
    const connectionName = `Built ${Date.now()}`;
    const made = await client.POST('/v1/spaces/{space}/connections', {
      params: { path: { space: general.id } },
      body: {
        settings: {
          schemaVersion: 1,
          name: connectionName,
          description: '',
          type: 'postgres',
          source: {
            host: 'source-postgres',
            port: 5432,
            database: 'readings',
            account: 'reader',
            tls: 'require',
          },
          identity: { kind: 'service' },
          retired: false,
        },
      },
    });
    if (!made.data) throw new Error(`The connection was not made: ${made.response.status}`);
    const set = await client.PUT('/v1/connections/{id}/credential', {
      params: { path: { id: made.data.id } },
      body: { secret: 'source-reader-dev-password' },
    });
    if (set.data?.test.outcome !== 'ok') {
      throw new Error(`The connection did not test clean: ${JSON.stringify(set.data)}`);
    }

    await withPage(async (page) => {
      const check = async (state: string, arrival: Arrival) => {
        await arrive(arrival);
        await checkAxe(page, state, task.meta, arrival);
      };
      /** Tab until `target` holds the focus, as a person with no pointer reaches it. */
      const tabTo = async (target: Locator) => {
        for (let presses = 0; presses < 160; presses += 1) {
          if (await target.evaluate((element) => element === document.activeElement)) return;
          await page.keyboard.press('Tab');
        }
        throw new Error(`${String(target)} was never reached by Tab`);
      };

      /** Opens a tab of the definition's page (ADR-0050): Tab to the chosen one, then the arrows. */
      const openTab = async (name: string) => {
        const tabs = page.getByRole('tablist', { name: 'Query definition' });
        await tabTo(tabs.getByRole('tab', { selected: true }));
        for (let presses = 0; presses < 8; presses += 1) {
          const at = await tabs.getByRole('tab', { selected: true }).textContent();
          if (at?.startsWith(name)) return;
          await page.keyboard.press('ArrowRight');
        }
        throw new Error(`The ${name} tab was never chosen`);
      };
      /** Chooses an option of a select by typing its text, then waits until it is chosen. */
      const choose = async (select: Locator, text: string) => {
        await tabTo(select);
        await page.keyboard.type(text);
        await vi.waitFor(
          async () => {
            const chosen = await select.evaluate(
              (element) => (element as HTMLSelectElement).selectedOptions[0]?.textContent,
            );
            if (chosen !== text) throw new Error(`${chosen} is chosen`);
          },
          { timeout: 10_000 },
        );
      };

      await page.goto(`${SERVICE}/#/query-definitions/new`);
      const connection = page.getByLabel('Connection', { exact: true });
      await arrive({
        shows: [page.getByRole('heading', { name: 'New query definition', level: 1 }), connection],
      });
      await choose(connection, connectionName);
      const title = `Readings by site ${Date.now()}`;
      await tabTo(page.getByLabel('Title', { exact: true }));
      await page.keyboard.type(title);
      await openTab('Query');
      // The SQL it runs is closed at the card's foot (PQ-A): opened, as an author checking it would.
      await tabTo(page.locator('summary', { hasText: 'The SQL it runs' }));
      await page.keyboard.press('Enter');
      await check('a new built query', {
        shows: [
          page.getByRole('radio', { name: 'Builder', exact: true }),
          page.getByRole('button', { name: 'Describe the source' }),
          page.getByRole('figure', { name: 'The SQL it runs' }),
        ],
      });

      // The source's tables and views, and one chosen.
      await tabTo(page.getByRole('button', { name: 'Describe the source' }));
      await page.keyboard.press('Enter');
      const table = page.getByLabel('Table or view', { exact: true });
      await arrive({ shows: table });
      await choose(table, 'sample.site');
      const columns = page.getByRole('region', { name: 'Columns to return' });
      for (const name of ['id', 'name']) {
        await tabTo(columns.getByRole('checkbox', { name, exact: true }));
        await page.keyboard.press('Space');
      }
      await check('a table and its columns chosen', {
        shows: [columns.getByLabel('Name of name', { exact: true })],
      });

      // A parameter, and a filter on it.
      await tabTo(page.getByRole('button', { name: 'Add parameter' }));
      await page.keyboard.press('Enter');
      const parameter = page.getByRole('group', { name: 'Parameter 1' });
      await tabTo(parameter.getByLabel('Name', { exact: true }));
      await page.keyboard.type('site');
      await tabTo(parameter.getByLabel('Type', { exact: true }));
      await page.keyboard.type('Integer');
      await tabTo(page.getByRole('button', { name: 'Add a filter' }));
      await page.keyboard.press('Enter');
      await check('a filter on a parameter', {
        shows: [
          page.getByLabel('Comparison of filter 1', { exact: true }),
          page.getByText(/OPERATOR\(pg_catalog\.=\) \(\$1::pg_catalog\.int8\)/),
        ],
      });

      // Grouped and counted.
      await tabTo(page.getByRole('checkbox', { name: 'Group and summarise' }));
      await page.keyboard.press('Space');
      await tabTo(page.getByRole('button', { name: 'Add a summary' }));
      await page.keyboard.press('Enter');
      await check('grouped, with a summary', {
        shows: [
          page.getByLabel('Summary 1', { exact: true }),
          page.getByText(/pg_catalog\.count\(\*\) AS "count"/),
        ],
      });

      // Described by the source, each column proposed and confirmed.
      await openTab('Columns');
      await tabTo(page.getByRole('button', { name: 'Describe', exact: true }));
      await page.keyboard.press('Enter');
      const declared = page.getByRole('table', { name: 'Columns' });
      await check('its columns proposed', {
        shows: [declared.getByRole('button', { name: 'Confirm count' })],
      });
      for (const name of ['id', 'name', 'count']) {
        await tabTo(declared.getByRole('button', { name: `Confirm ${name}` }));
        await page.keyboard.press('Enter');
      }
      await check('its columns confirmed', {
        shows: page.getByRole('button', { name: 'Save version' }),
      });

      // Run against a sample value.
      await openTab('Sample');
      const sample = page.getByRole('tabpanel', { name: 'Sample' });
      await tabTo(sample.getByLabel('site', { exact: true }));
      await page.keyboard.type('1');
      await tabTo(sample.getByRole('button', { name: 'Run sample' }));
      await page.keyboard.press('Enter');
      // From the top: where the keys left the page, a step's checkbox stood under the sticky header
      // band, and axe measured it as crowded by the band's link (LG6e). Nothing is under it here.
      await page.evaluate(() => window.scrollTo(0, 0));
      await check('a built query sampled', {
        shows: [
          sample.getByRole('table', { name: 'The first rows' }),
          sample.getByRole('button', { name: 'Checksum' }),
        ],
      });

      // Saved, and its own page, opened in the builder.
      await tabTo(page.getByRole('button', { name: 'Save version' }));
      await page.keyboard.press('Enter');
      await arrive({ shows: page.getByRole('heading', { name: title, level: 1 }) });
      await openTab('Query');
      await check('a built query definition', {
        shows: [
          page.getByRole('heading', { name: title, level: 1 }),
          page.getByText('Version 0.1'),
          page.getByLabel('Column of filter 1', { exact: true }),
        ],
      });

      // Its rows, and what uses it.
      await openTab('Rows');
      await check("a definition's rows", {
        shows: page.getByRole('tabpanel', { name: 'Rows' }).getByRole('group', { name: 'Key' }),
      });
      await openTab('Used by');
      await check('what uses a definition', {
        shows: page.getByText('No component binds this query definition yet.'),
      });
    });
  });
});
