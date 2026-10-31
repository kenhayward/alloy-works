import { DEFAULT_THEME_ID } from '@alloy-works/db';
import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api, apiAs, edit, makeDocument, words } from './testing/api.js';
import { makeComponent, uploadImage } from './testing/component.js';
import {
  makeDocument as makeDocumentFrom,
  makeTemplate,
  translatedComponent,
} from './testing/fixtures.js';
import { allowPageNoise, withPage } from './testing/page.js';
import { signInFromNode } from './testing/setup.js';
import type { WordKey } from '../../../apps/web/src/words/make.js';
import { chooseLanguage, say, unlocalised } from './testing/words.js';

/**
 * **The interface in pseudo-locales** (the UI plan, UI-J; LOC-029, LOC-042, LOC-004): the surfaces
 * moved into the catalogue, walked in `en-XA` and `ar-XB`, each word made over, none cut short,
 * nothing spilling sideways, no words over other words, and `ar-XB` laid out right to left. Every
 * dialog is walked here or named in `dialogs.test.ts` with why it cannot be (the TE plan, TE-G).
 * Grace walks it, her language chosen for the walk and given back after, so no other walk, as Ada,
 * sees it; Ada walks what administering the environment opens.
 */
interface Surface {
  readonly name: string;
  readonly address: string;
  readonly regions: readonly string[];
  /** What shows once the surface is drawn, in the language walked. */
  readonly ready: (page: Page, language: Language) => Locator;
  /** What opens the dialog over the surface once drawn, answering the dialog. */
  readonly open?: (page: Page, language: Language) => Promise<Locator>;
  /** The renderer file drawing the dialog walked, from `apps/web/src`, which `dialogs.test.ts` counts. */
  readonly dialog?: string;
}

type Language = 'en-XA' | 'ar-XB';

/** What Grace's walk opens its dialogs over, made for each walk. */
interface Graces {
  /** Her component, a word indexed in it. */
  readonly component: { readonly id: string; readonly title: string };
  /** Her component approved and begun in French. */
  readonly translated: { readonly id: string; readonly title: string };
  /** Her document, the component placed in it. */
  readonly document: string;
  /** A token of hers, to be asked about revoking. */
  readonly token: string;
  /** Her component holding a figure. */
  readonly figured: string;
}

/** What Ada's walk opens its dialogs over. */
interface Adas {
  readonly component: { readonly id: string; readonly title: string };
  readonly document: string;
  readonly template: string;
  readonly webhook: string;
  /** A document from the template, which has a newer version since. */
  readonly templated: string;
}

/** The caret at the end of the component's first paragraph. */
async function caret(page: Page): Promise<void> {
  await page.locator('.ProseMirror p').first().click();
  await page.keyboard.press('End');
}

/** Its last word chosen, past the index marker and the full stop. */
async function lastWord(page: Page): Promise<void> {
  await caret(page);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  for (let letter = 0; letter < 'newts'.length; letter++) {
    await page.keyboard.press('Shift+ArrowLeft');
  }
}

/** A dialog the component editor opens by `keys`, from the caret or, `chosen`, a word chosen. */
function fromCaret(
  name: string,
  dialog: string,
  component: string,
  keys: string,
  chosen = false,
): Surface {
  return overEditor(name, dialog, component, async (page) => {
    await (chosen ? lastWord(page) : caret(page));
    await page.keyboard.press(keys);
    return page.getByRole('dialog');
  });
}

function overEditor(
  name: string,
  dialog: string,
  component: string,
  open: (page: Page, language: Language) => Promise<Locator>,
): Surface {
  return {
    name,
    dialog,
    address: `#/components/${component}`,
    regions: ['[role="dialog"]'],
    ready: (page, language) =>
      page.getByRole('button', { name: say(language, 'pm.command.strong'), exact: true }),
    open,
  };
}

/** A dialog a page's button opens, the page drawn once `ready` shows. */
function byButton(
  name: string,
  dialog: string,
  address: string,
  ready: Surface['ready'],
  button: WordKey,
  named: (language: Language) => string | RegExp,
  values?: Record<string, string>,
): Surface {
  return {
    name,
    dialog,
    address,
    regions: ['[role="dialog"]'],
    ready,
    open: async (page, language) => {
      await page
        .getByRole('button', { name: say(language, button, values), exact: true })
        .first()
        .click();
      return page.getByRole('dialog', { name: named(language) });
    },
  };
}

const heading = (key: WordKey) => (page: Page, language: Language) =>
  page.getByRole('heading', { level: 1, name: say(language, key), exact: true });

/** The account menu's item `key` opens its dialog. */
function account(name: string, dialog: string, item: (page: Page, language: Language) => Locator) {
  return {
    name,
    dialog,
    address: '#/',
    regions: ['[role="dialog"]'],
    ready: (page: Page, language: Language) =>
      page.getByRole('heading', { level: 2, name: say(language, 'home.needs-your-attention') }),
    open: async (page: Page, language: Language) => {
      await page.locator('header').getByRole('button', { name: /Grace/ }).click();
      await item(page, language).click();
      return page.getByRole('dialog').first();
    },
  } satisfies Surface;
}

/** A document page drawn: its Authoring view offered. */
const documentDrawn = (page: Page, language: Language) =>
  page.getByRole('radio', { name: say(language, 'document.authoring') });

/** The surfaces Grace walks. */
const surfaces = (grace: Graces): readonly Surface[] => [
  {
    name: 'Home, the header and the rail',
    address: '#/',
    regions: ['header', 'nav', 'main'],
    ready: (page, language) =>
      page.getByRole('heading', { level: 2, name: say(language, 'home.needs-your-attention') }),
  },
  {
    name: 'The documents',
    address: '#/documents',
    regions: ['main'],
    ready: heading('document.documents'),
  },
  {
    name: 'The publications',
    address: '#/publications',
    regions: ['main'],
    ready: heading('publishing.publications'),
  },
  {
    name: 'The component editor',
    address: `#/components/${grace.component.id}`,
    regions: ['main'],
    ready: (page, language) =>
      page.getByRole('button', { name: say(language, 'pm.command.strong'), exact: true }),
  },
  // The Index entry dialog over the marker's chip, which says its words in the language (IX-M).
  overEditor(
    'The Index entry dialog',
    'editor/IndexEntryDialog.tsx',
    grace.component.id,
    async (page, language) => {
      const chip = page.locator('[data-index-marker]');
      expect
        .soft(await chip.textContent(), 'The index entry chip: its words')
        .toBe(
          `${say(language, 'pm.index.chip', { entry: 'Newt' })} ${say(language, 'pm.index.prints-nothing')}`,
        );
      await chip.click();
      await page.keyboard.press('ControlOrMeta+Shift+1');
      return page.getByRole('dialog', { name: say(language, 'editor.index-entry') });
    },
  ),
  // The editor's dialogs, each from the caret or a word chosen (the TE plan, TE-G).
  fromCaret(
    'The Link dialog',
    'editor/MarkPrompt.tsx',
    grace.component.id,
    'ControlOrMeta+k',
    true,
  ),
  fromCaret(
    'The Reference dialog',
    'editor/ReferenceDialog.tsx',
    grace.component.id,
    'ControlOrMeta+Alt+x',
  ),
  fromCaret(
    'The Cite dialog',
    'editor/CitationDialog.tsx',
    grace.component.id,
    'ControlOrMeta+Shift+2',
  ),
  fromCaret(
    'The Term dialog',
    'editor/TermDialog.tsx',
    grace.component.id,
    'ControlOrMeta+Alt+g',
    true,
  ),
  fromCaret(
    'The Equation dialog',
    'editor/EquationDialog.tsx',
    grace.component.id,
    'ControlOrMeta+Shift+e',
  ),
  // From its button: Chromium keeps Ctrl+Shift+M for itself.
  overEditor(
    'The symbol palette',
    'editor/SymbolPalette.tsx',
    grace.component.id,
    async (page, l) => {
      await caret(page);
      await page.getByRole('button', { name: say(l, 'pm.command.symbol'), exact: true }).click();
      return page.getByRole('dialog');
    },
  ),
  fromCaret(
    'The Condition dialog',
    'editor/ConditionDialog.tsx',
    grace.component.id,
    'ControlOrMeta+Alt+o',
    true,
  ),
  fromCaret(
    'The Variable dialog',
    'editor/VariableDialog.tsx',
    grace.component.id,
    'ControlOrMeta+Alt+v',
  ),
  fromCaret(
    'The Value dialog',
    'editor/ValueDialog.tsx',
    grace.component.id,
    'ControlOrMeta+Shift+6',
  ),
  overEditor(
    'The Figure dialog',
    'editor/FigureDialog.tsx',
    grace.component.id,
    async (page, l) => {
      await caret(page);
      await page.getByRole('button', { name: say(l, 'editor.figure'), exact: true }).click();
      return page.getByRole('dialog', { name: say(l, 'editor.figure') });
    },
  ),
  {
    // A figure's settings, from its panel with the caret in its caption.
    name: 'The Figure settings dialog',
    dialog: 'editor/FigureSettings.tsx',
    address: `#/components/${grace.figured}`,
    regions: ['[role="dialog"]'],
    ready: (page, language) =>
      page.getByRole('button', { name: say(language, 'pm.command.strong'), exact: true }),
    open: async (page, language) => {
      await page.getByText('The figure', { exact: true }).click();
      await page
        .getByRole('button', {
          name: say(language, 'editor.settings', { named: say(language, 'editor.figure') }),
          exact: true,
        })
        .click();
      return page.getByRole('dialog', { name: say(language, 'editor.figure-settings') });
    },
  },
  // The component's own header: what it may be, where it is used, and its relationships.
  ...(
    [
      ['Dates', 'lifecycle/Dates.tsx', 'lifecycle.dates', 'lifecycle.dates-of'],
      [
        'Effective for',
        'lifecycle/Scope.tsx',
        'lifecycle.effective-for-2',
        'lifecycle.effective-for-3',
      ],
      ['Used in', 'reuse/UsedIn.tsx', 'reuse.used-in', 'reuse.where-is-used'],
      ['Relationships', 'reuse/Relationships.tsx', 'reuse.relationships', 'reuse.relationships-of'],
    ] as const
  ).map(([name, dialog, button, named]) =>
    byButton(
      `The ${name} dialog`,
      dialog,
      `#/components/${grace.component.id}`,
      (page, language) =>
        page.getByRole('button', { name: say(language, 'pm.command.strong'), exact: true }),
      button,
      (language) => say(language, named, { title: grace.component.title }),
    ),
  ),
  // A component approved and begun in French: its translations, and a line begun beside the main.
  byButton(
    'The Translations dialog',
    'translation/Translations.tsx',
    `#/components/${grace.translated.id}`,
    (page, language) =>
      page.getByRole('button', { name: say(language, 'translation.translations'), exact: true }),
    'translation.translations',
    (language) => say(language, 'translation.translations'),
  ),
  byButton(
    'The Begin a line dialog',
    'lifecycle/Lines.tsx',
    `#/components/${grace.translated.id}`,
    (page, language) =>
      page.getByRole('button', { name: say(language, 'lifecycle.begin-a-line'), exact: true }),
    'lifecycle.begin-a-line',
    (language) => say(language, 'lifecycle.begin-a-line'),
  ),
  // The account's menu and what it opens.
  account('The Inbox dialog', 'account/Inbox.tsx', (page, language) =>
    page
      .getByRole('group', { name: say(language, 'shell.account') })
      .getByRole('button')
      .first(),
  ),
  account('The Sessions dialog', 'account/Sessions.tsx', (page, language) =>
    page.getByRole('button', { name: say(language, 'shell.sessions'), exact: true }),
  ),
  {
    ...account('The New token dialog over API tokens', 'account/ApiTokens.tsx', (page, language) =>
      page.getByRole('button', { name: say(language, 'shell.tokens'), exact: true }),
    ),
    open: async (page, language) => {
      await page.locator('header').getByRole('button', { name: /Grace/ }).click();
      await page.getByRole('button', { name: say(language, 'shell.tokens'), exact: true }).click();
      await page
        .getByRole('button', { name: say(language, 'account.new-token'), exact: true })
        .click();
      return page.getByRole('dialog', { name: say(language, 'account.new-token') });
    },
  },
  {
    ...account('The Revoke a token dialog', 'account/TokenTable.tsx', (page, language) =>
      page.getByRole('button', { name: say(language, 'shell.tokens'), exact: true }),
    ),
    open: async (page, language) => {
      await page.locator('header').getByRole('button', { name: /Grace/ }).click();
      await page.getByRole('button', { name: say(language, 'shell.tokens'), exact: true }).click();
      await page
        .getByRole('button', { name: say(language, 'account.revoke-2', { name: grace.token }) })
        .click();
      return page.getByRole('dialog', {
        name: say(language, 'account.revoke-3', { name: grace.token }),
      });
    },
  },
  {
    name: 'The command palette',
    dialog: 'shell/CommandPalette.tsx',
    address: '#/',
    regions: ['[role="dialog"]'],
    ready: (page, language) =>
      page.getByRole('heading', { level: 2, name: say(language, 'home.needs-your-attention') }),
    open: async (page, language) => {
      await page.getByRole('button', { name: say(language, 'shell.search'), exact: true }).click();
      return page.getByRole('dialog', { name: say(language, 'shell.search-and-commands') });
    },
  },
  byButton(
    'The New component dialog',
    'editor/ComponentList.tsx',
    '#/components',
    (page, language) =>
      page.getByRole('button', { name: say(language, 'editor.new-component'), exact: true }),
    'editor.new-component',
    (language) => say(language, 'editor.new-component'),
  ),
  byButton(
    'The New document dialog',
    'structure/DocumentList.tsx',
    '#/documents',
    heading('document.documents'),
    'document.new-document',
    (language) => say(language, 'document.new-document'),
  ),
  // Her document, the component placed in it.
  {
    name: 'The Place from a document dialog',
    dialog: 'structure/PlaceSection.tsx',
    address: `#/documents/${grace.document}`,
    regions: ['[role="dialog"]'],
    ready: documentDrawn,
    open: async (page, language) => {
      await documentDrawn(page, language).check();
      await page
        .getByRole('button', { name: say(language, 'document.place-from-a-document'), exact: true })
        .click();
      return page.getByRole('dialog', { name: say(language, 'document.place-from-a-document') });
    },
  },
  {
    name: 'The Overrides dialog',
    dialog: 'structure/OverrideDialog.tsx',
    address: `#/documents/${grace.document}`,
    regions: ['[role="dialog"]'],
    ready: documentDrawn,
    open: async (page, language) => {
      // Its text drawn first: chosen sooner, Authoring is drawn over again as the text arrives.
      await page.getByText('The pond survey found newts.').waitFor();
      await documentDrawn(page, language).check();
      // A placed component's own line, Overrides on it, is drawn with the boundaries.
      await page
        .getByRole('button', { name: say(language, 'document.show-boundaries'), exact: true })
        .click();
      // Named by the component's place in the text, so found by the message's start; pressed by the
      // keyboard, as the longer line beside the text stands under the side panel, out of the pointer's
      // reach (a finding of TE-G, not yet fixed).
      const [before] = say(language, 'document.overrides-of', { value1: 'HERE' }).split('HERE');
      await page.locator(`button[aria-label^="${before!.trimEnd()}"]`).first().press('Enter');
      return page.getByRole('dialog');
    },
  },
  {
    name: 'The Translation jobs dialog',
    dialog: 'translation/TranslationJobs.tsx',
    address: `#/documents/${grace.document}`,
    regions: ['[role="dialog"]'],
    ready: documentDrawn,
    open: async (page, language) => {
      await page.getByRole('tab', { name: say(language, 'document.publishing') }).click();
      await page
        .getByRole('button', { name: say(language, 'translation.translation-jobs'), exact: true })
        .click();
      return page.getByRole('dialog', { name: say(language, 'translation.translation-jobs') });
    },
  },
  ...listed([
    ['The prompts', '#/prompts', 'prompts.prompts'],
    ['The bibliography', '#/bibliography', 'bibliography.bibliography'],
    ['The terms', '#/terms', 'terms.terms'],
    ['The conversations', '#/conversations', 'conversations.conversations'],
    ['The connections', '#/connections', 'data.connections'],
    ['The query definitions', '#/query-definitions', 'data.query-definitions-2'],
    ['Search', '#/search', 'search.search'],
  ]),
  // Last: typing claims the component's lock and leaves it changed, which nothing after it wants.
  overEditor(
    'The Saved text dialog',
    'editor/RecoveryPanel.tsx',
    grace.component.id,
    async (page, l) => {
      await caret(page);
      await page.keyboard.type(' ');
      await page.getByRole('button', { name: say(l, 'editor.saved-text'), exact: true }).click();
      return page.getByRole('dialog', { name: say(l, 'editor.saved-text') });
    },
  ),
];

/** Administration's sections, and what administering opens, walked by Ada. */
const administration = (ada: Adas): readonly Surface[] => [
  ...listed([
    ['Administration, its overview', '#/admin/overview', 'admin.overview'],
    ['Administration, its spaces', '#/admin/spaces', 'admin.spaces'],
    ['Administration, its people', '#/admin/people', 'admin.people'],
    ['Administration, its groups', '#/admin/groups', 'admin.groups'],
    ['Administration, its roles', '#/admin/roles', 'admin.roles'],
    // The policy and its history (the TE plan, TE-D).
    ['Administration, its translation policy', '#/admin/translation', 'admin.translation'],
    // Connecting CT Studio (API-074).
    ['Administration, its CT Studio', '#/admin/ctstudio', 'admin.ct-studio'],
  ]),
  byButton(
    'The Connect CT Studio dialog',
    'admin/CtStudio.tsx',
    '#/admin/ctstudio',
    heading('admin.ct-studio'),
    'admin.connect-a-space',
    (language) => say(language, 'admin.connect-a-space-to-ct-studio'),
  ),
  byButton(
    'The New space dialog',
    'admin/SpaceDialogs.tsx',
    '#/admin/spaces',
    heading('admin.spaces'),
    'admin.new-space',
    (language) => say(language, 'admin.new-space'),
  ),
  byButton(
    'The Invite people dialog',
    'admin/People.tsx',
    '#/admin/people',
    heading('admin.people'),
    'admin.invite-people',
    (language) => say(language, 'admin.invite-people'),
  ),
  {
    // Asked, never acted on: Grace stays.
    name: 'The Erase dialog',
    dialog: 'admin/Erase.tsx',
    address: '#/admin/people',
    regions: ['[role="dialog"]'],
    ready: heading('admin.people'),
    open: async (page, language) => {
      // By the keyboard: a row scrolled under the header opens its menu there, out of the pointer's reach.
      await page
        .getByRole('button', {
          name: say(language, 'parts.more-actions-for', { subject: 'Grace' }),
        })
        .first()
        .press('Enter');
      await page.getByRole('menuitem', { name: say(language, 'admin.erase-2') }).press('Enter');
      return page.getByRole('dialog', { name: say(language, 'admin.erase', { name: 'Grace' }) });
    },
  },
  byButton(
    'The New group dialog',
    'admin/Groups.tsx',
    '#/admin/groups',
    heading('admin.groups'),
    'admin.new-group',
    (language) => say(language, 'admin.new-group'),
  ),
  byButton(
    'The New secret dialog',
    'admin/Webhooks.tsx',
    '#/admin/webhooks',
    heading('admin.webhooks'),
    'admin.new-secret-for',
    (language) => say(language, 'admin.make-a-new-secret-for', { url: ada.webhook }),
    { url: ada.webhook },
  ),
  byButton(
    'The New connection dialog',
    'data/Connections.tsx',
    '#/connections',
    heading('data.connections'),
    'data.new-connection',
    (language) => say(language, 'data.new-connection'),
  ),
  byButton(
    'The Delete dialog',
    'lifecycle/Delete.tsx',
    `#/components/${ada.component.id}`,
    (page, language) =>
      page.getByRole('button', { name: say(language, 'lifecycle.delete-2'), exact: true }),
    'lifecycle.delete-2',
    (language) => say(language, 'lifecycle.delete', { title: ada.component.title }),
  ),
  byButton(
    'The Place a hold dialog',
    'lifecycle/Hold.tsx',
    `#/components/${ada.component.id}`,
    (page, language) =>
      page.getByRole('button', { name: say(language, 'lifecycle.place-a-hold'), exact: true }),
    'lifecycle.place-a-hold',
    (language) => say(language, 'lifecycle.place-a-hold-on', { title: ada.component.title }),
  ),
  {
    // Submit and Return are the workflow's own names, content, not the catalogue's.
    name: 'The reason Return asks for',
    dialog: 'lifecycle/Workflow.tsx',
    address: `#/documents/${ada.document}`,
    regions: ['[role="dialog"]'],
    ready: (page) => page.getByRole('button', { name: 'Submit', exact: true }),
    open: async (page) => {
      await page.getByRole('button', { name: 'Submit', exact: true }).click();
      await page.getByRole('button', { name: 'Return', exact: true }).click();
      return page.getByRole('dialog');
    },
  },
  {
    name: 'The translated titles dialog',
    dialog: 'translation/TranslatedTitles.tsx',
    address: `#/documents/${ada.document}`,
    regions: ['[role="dialog"]'],
    ready: documentDrawn,
    open: async (page, language) => {
      await page.getByRole('tab', { name: say(language, 'document.publishing') }).click();
      await page
        .getByRole('combobox', { name: say(language, 'publishing.publish-in') })
        .selectOption('fr');
      await page
        .getByRole('button', { name: say(language, 'translation.translate-titles'), exact: true })
        .click();
      return page.getByRole('dialog', {
        name: say(language, 'translation.titles-in', { language: 'fr' }),
      });
    },
  },
  byButton(
    'The Move to a newer template dialog',
    'structure/TemplateLine.tsx',
    `#/documents/${ada.templated}`,
    (page, language) =>
      page.getByRole('button', {
        name: say(language, 'document.move-to-version', { number: '0.2' }),
      }),
    'document.move-to-version',
    (language) =>
      say(language, 'document.move-to-version-2', { name: ada.template, number: '0.2' }),
    { number: '0.2' },
  ),
  {
    name: 'The Generate documents dialog',
    dialog: 'structure/GenerateDialog.tsx',
    address: '#/templates',
    regions: ['[role="dialog"]'],
    ready: (page, language) =>
      page.getByRole('button', {
        name: say(language, 'document.generate-documents-from-2', { name: ada.template }),
      }),
    open: async (page, language) => {
      await page
        .getByRole('button', {
          name: say(language, 'document.generate-documents-from-2', { name: ada.template }),
        })
        .click();
      return page.getByRole('dialog');
    },
  },
];

/** Pages whose first heading names them, each walked whole. */
function listed(pages: readonly (readonly [string, string, WordKey])[]): Surface[] {
  return pages.map(([name, address, key]) => ({
    name,
    address,
    regions: ['main'],
    ready: heading(key),
  }));
}

/** A paragraph of Grace's, a word in it indexed. */
const indexed = [
  {
    type: 'paragraph',
    id: 'b1',
    style: 'body',
    content: [...words('The pond survey found newts.'), { type: 'indexMarker', term: 'Newt' }],
  },
];

/** What Grace's walk needs, made fresh for each walk, as it changes some of it. */
async function graces(): Promise<Graces> {
  const grace = await apiAs('grace');
  const component = await makeComponent(grace, 'Pseudo', indexed);
  let document = await makeDocument(grace, 'Pseudo', ['Introduction']);
  document = await edit(grace, document, {
    operation: 'insert',
    parent: null,
    position: 0,
    node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
  });
  const token = `Pseudo ${Date.now().toString(36)}`;
  const issued = await grace.POST('/v1/tokens', {
    body: { name: token, scopes: [], expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
  });
  if (!issued.data) throw new Error(`a token answered ${issued.response.status}`);
  return {
    component,
    translated: await translatedComponent(api()),
    document: document.id,
    token,
    figured: (
      await makeComponent(grace, 'Pseudo figure', [
        {
          type: 'figure',
          id: 'b1',
          // Uploaded as Ada, into General, where Grace reads it.
          asset: await uploadImage(api(), 'A blue rectangle'),
          imageStyle: 'figure',
          caption: words('The figure'),
          alternative: { kind: 'own', text: 'A blue rectangle' },
        },
      ])
    ).id,
  };
}

/** What Ada's walk needs: her own component and document, a template and a webhook. */
async function adas(): Promise<Adas> {
  const ada = api();
  const component = await makeComponent(ada, 'Pseudo', indexed);
  const document = await makeDocument(ada, 'Pseudo', ['Introduction']);
  const template = `Pseudo ${Date.now().toString(36)}`;
  const made = await makeTemplate(ada, template, DEFAULT_THEME_ID);
  const templated = await makeDocumentFrom(ada, `${template} document`, made, [], component.id);
  const read = await ada.GET('/v1/templates/{id}', { params: { path: { id: made } } });
  if (!read.data) throw new Error(`reading the template answered ${read.response.status}`);
  const moved = await ada.POST('/v1/templates/{id}/versions', {
    params: { path: { id: made } },
    body: {
      openedFrom: read.data.version.id,
      // The same template, its sections no longer to be reordered: version 2.
      definition: {
        ...read.data.definition,
        changes: { add: true, remove: true, reorder: false },
      } as never,
    },
  });
  if (!moved.data) throw new Error(`a template version answered ${moved.response.status}`);
  const identity = await ada.POST('/v1/service-identities', { body: { name: template } });
  if (!identity.data) throw new Error(`an identity answered ${identity.response.status}`);
  const webhook = 'https://source-http/hooks';
  const hooked = await ada.POST('/v1/webhooks', {
    body: { serviceIdentity: identity.data.id, url: webhook, eventTypes: ['content.version_cut'] },
  });
  if (!hooked.data) throw new Error(`a webhook answered ${hooked.response.status}`);
  return { component, document: document.id, template, webhook, templated: templated.id };
}

/**
 * Each surface walked in `language` by Grace, and Administration's by Ada, each person's language
 * chosen for the walk and given back after: words made over, none cut short, nothing spilling, and
 * no words over other words.
 */
async function walk(language: Language) {
  // The editor asks for the query definitions Grace may not read, for its Value command, and the
  // service answers 403, which the browser reports as a failed load: her permissions, not noise.
  allowPageNoise(
    /^console\.error: Failed to load resource: .* 403 \(Forbidden\) \(.*\/v1\/definitions:/,
  );
  const [grace, ada] = await Promise.all([graces(), adas()]);
  await walkAs(await signInFromNode('grace'), language, surfaces(grace));
  await walkAs(await signInFromNode('ada'), language, administration(ada));
}

/** Until what `dialog` says holds still, as one that reads what it shows fills in late. */
async function settled(dialog: Locator): Promise<void> {
  let was = '';
  for (let tries = 0; tries < 20; tries++) {
    const now = await dialog.innerText();
    if (now === was) return;
    was = now;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function walkAs(cookie: string, language: Language, walked: readonly Surface[]) {
  await chooseLanguage(cookie, language);
  try {
    await withPage(
      async (page) => {
        // A dialog that does not open says so in seconds, not the default thirty.
        page.setDefaultTimeout(15_000);
        let stale = false;
        for (const surface of walked) {
          await page.goto(`${SERVICE}/${surface.address}`);
          // A dialog left open, or a page never drawn, stays over a hash's change: drawn afresh.
          if (stale) await page.reload();
          stale = true;
          // Every surface walked whatever another finds, so one run names them all.
          const drawn = await surface
            .ready(page, language)
            .waitFor()
            .then(() => true)
            .catch(() => false);
          expect.soft(drawn, `${surface.name}: never drawn in ${language}`).toBe(true);
          if (!drawn) continue;
          stale = surface.open !== undefined;
          if (surface.open) {
            const shown = await surface
              .open(page, language)
              .then(async (dialog) => {
                await dialog.waitFor();
                await settled(dialog);
                return true;
              })
              // What failed, and the call log's last word on why.
              .catch((error: unknown) => {
                const said = String(error).split('\n');
                return `${said[0]} ${said.at(-1)}`;
              });
            expect.soft(shown, `${surface.name}: never opened in ${language}`).toBe(true);
            if (shown !== true) continue;
          }
          expect.soft(await page.evaluate(() => document.documentElement.lang)).toBe(language);
          expect
            .soft(await page.evaluate(() => document.documentElement.dir))
            .toBe(language === 'ar-XB' ? 'rtl' : 'ltr');
          const found = await unlocalised(page, surface.regions);
          expect.soft(found.missed, `${surface.name}: words left in English`).toEqual([]);
          expect.soft(found.clipped, `${surface.name}: words cut short`).toEqual([]);
          expect.soft(found.spills, `${surface.name}: wider than the window`).toEqual([]);
          expect.soft(found.overlaps, `${surface.name}: words over words`).toEqual([]);
          // An icon's button has no text to walk: its name is what a screen reader says. A name that
          // is content, a space's, is marked `data-content-name`.
          const names = await page.$$eval(
            surface.regions
              .map((region) => `${region} [aria-label]:not([data-content-name])`)
              .join(', '),
            (labelled) => labelled.map((each) => each.getAttribute('aria-label') ?? ''),
          );
          expect
            .soft(
              names.filter((name) => /[A-Za-z]{2,}/.test(name) && !/[[\]]/.test(name)),
              `${surface.name}: names left in English`,
            )
            .toEqual([]);
        }
      },
      { signedInAs: cookie },
    );
  } finally {
    await chooseLanguage(cookie, null);
  }
}

describe('the interface in pseudo-locales (the UI plan, UI-J)', () => {
  it('LOC-042 LOC-029 shows every moved surface and every dialog expanded and accented, each word made over, none cut short and none over another', async () => {
    await walk('en-XA');
  }, 600_000);

  it('LOC-042 LOC-029 LOC-004 shows every moved surface and every dialog right to left, each word made over, none cut short and none over another', async () => {
    await walk('ar-XB');
  }, 600_000);
});
