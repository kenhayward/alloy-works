import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { apiAs, words } from './testing/api.js';
import { makeComponent } from './testing/component.js';
import { allowPageNoise, withPage } from './testing/page.js';
import { signInFromNode } from './testing/setup.js';
import type { WordKey } from '../../../apps/web/src/words/make.js';
import { chooseLanguage, say, unlocalised } from './testing/words.js';

/**
 * **The interface in pseudo-locales** (the UI plan, UI-J; LOC-029, LOC-042, LOC-004): the surfaces
 * moved into the catalogue so far, walked in `en-XA` and `ar-XB`, each word made over, none cut short,
 * nothing spilling sideways, and `ar-XB` laid out right to left. Grace walks it, her language chosen
 * for the walk and given back after, so no other walk, as Ada, sees it. The surfaces grow each PR.
 */
interface Surface {
  readonly name: string;
  readonly address: string;
  readonly regions: readonly string[];
  /** What shows once the surface is drawn, in the language walked. */
  readonly ready: (page: Page, language: Language) => Locator;
  /** What opens the surface once drawn, where it is a dialog over another. */
  readonly open?: (page: Page, language: Language) => Promise<void>;
  /** The renderer file drawing the dialog walked, from `apps/web/src`, which `dialogs.test.ts` counts. */
  readonly dialog?: string;
}

type Language = 'en-XA' | 'ar-XB';

/** The surfaces moved so far, a component of Grace's own among them. */
const surfaces = (component: string): readonly Surface[] => [
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
    ready: (page, language) =>
      page.getByRole('heading', { level: 1, name: say(language, 'document.documents') }),
  },
  {
    name: 'The publications',
    address: '#/publications',
    regions: ['main'],
    ready: (page, language) =>
      page.getByRole('heading', { level: 1, name: say(language, 'publishing.publications') }),
  },
  {
    name: 'The component editor',
    address: `#/components/${component}`,
    regions: ['main'],
    ready: (page, language) =>
      page.getByRole('button', { name: say(language, 'pm.command.strong'), exact: true }),
  },
  {
    // The Index entry dialog over the marker's chip, which says its words in the language (IX-M).
    name: 'The Index entry dialog',
    dialog: 'editor/IndexEntryDialog.tsx',
    address: `#/components/${component}`,
    regions: ['[role="dialog"]'],
    ready: (page, language) =>
      page.getByRole('button', { name: say(language, 'pm.command.strong'), exact: true }),
    open: async (page, language) => {
      const chip = page.locator('[data-index-marker]');
      expect
        .soft(await chip.textContent(), 'The index entry chip: its words')
        .toBe(
          `${say(language, 'pm.index.chip', { entry: 'Newt' })} ${say(language, 'pm.index.prints-nothing')}`,
        );
      await chip.click();
      await page.keyboard.press('ControlOrMeta+Shift+1');
      await page.getByRole('dialog', { name: say(language, 'editor.index-entry') }).waitFor();
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
];

/** Administration's sections, walked by Ada, who administers the environment. */
const administration: readonly Surface[] = listed([
  ['Administration, its overview', '#/admin/overview', 'admin.overview'],
  ['Administration, its spaces', '#/admin/spaces', 'admin.spaces'],
  ['Administration, its people', '#/admin/people', 'admin.people'],
  ['Administration, its groups', '#/admin/groups', 'admin.groups'],
  ['Administration, its roles', '#/admin/roles', 'admin.roles'],
  // The policy and its history (the TE plan, TE-D).
  ['Administration, its translation policy', '#/admin/translation', 'admin.translation'],
]);

/** Pages whose first heading names them, each walked whole. */
function listed(pages: readonly (readonly [string, string, WordKey])[]): Surface[] {
  return pages.map(([name, address, heading]) => ({
    name,
    address,
    regions: ['main'],
    ready: (page, language) =>
      page.getByRole('heading', { level: 1, name: say(language, heading), exact: true }),
  }));
}

/**
 * Each surface walked in `language` by Grace, and Administration's by Ada, each person's language
 * chosen for the walk and given back after: words made over, none cut short, nothing spilling.
 */
async function walk(language: Language) {
  // The editor asks for the query definitions Grace may not read, for its Value command, and the
  // service answers 403, which the browser reports as a failed load: her permissions, not noise.
  allowPageNoise(
    /^console\.error: Failed to load resource: .* 403 \(Forbidden\) \(.*\/v1\/definitions:/,
  );
  const cookie = await signInFromNode('grace');
  const component = await makeComponent(await apiAs('grace'), 'Pseudo', [
    {
      type: 'paragraph',
      id: 'b1',
      style: 'body',
      content: [...words('The pond survey found newts.'), { type: 'indexMarker', term: 'Newt' }],
    },
  ]);
  await walkAs(cookie, language, surfaces(component.id));
  await walkAs(await signInFromNode('ada'), language, administration);
}

async function walkAs(cookie: string, language: Language, walked: readonly Surface[]) {
  await chooseLanguage(cookie, language);
  try {
    await withPage(
      async (page) => {
        for (const surface of walked) {
          await page.goto(`${SERVICE}/${surface.address}`);
          // Every surface walked whatever another finds, so one run names them all.
          const drawn = await surface
            .ready(page, language)
            .waitFor()
            .then(() => true)
            .catch(() => false);
          expect.soft(drawn, `${surface.name}: never drawn in ${language}`).toBe(true);
          if (!drawn) continue;
          await surface.open?.(page, language);
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
  it('LOC-042 shows every moved surface expanded and accented, each word made over and none cut short', async () => {
    await walk('en-XA');
  });

  it('LOC-042 shows every moved surface right to left, each word made over and none cut short', async () => {
    await walk('ar-XB');
  });
});
