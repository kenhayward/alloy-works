import type { Locator, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { apiAs, words } from './testing/api.js';
import { makeComponent } from './testing/component.js';
import { allowPageNoise, withPage } from './testing/page.js';
import { signInFromNode } from './testing/setup.js';
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
    // Its toolbar: the header's dates, reuse and style move with their own folders (UIc, UId).
    name: 'The component editor',
    address: `#/components/${component}`,
    regions: ['[role="toolbar"]'],
    ready: (page, language) =>
      page.getByRole('button', { name: say(language, 'pm.command.strong'), exact: true }),
  },
];

/** Each moved surface walked in `language`, its words made over, none cut short, nothing spilling. */
async function walk(language: Language) {
  // The editor asks for the query definitions Grace may not read, for its Value command, and the
  // service answers 403, which the browser reports as a failed load: her permissions, not noise.
  allowPageNoise(
    /^console\.error: Failed to load resource: .* 403 \(Forbidden\) \(.*\/v1\/definitions:/,
  );
  const cookie = await signInFromNode('grace');
  const component = await makeComponent(await apiAs('grace'), 'Pseudo', [
    { type: 'paragraph', id: 'b1', style: 'body', content: words('The pond survey found newts.') },
  ]);
  await chooseLanguage(cookie, language);
  try {
    await withPage(
      async (page) => {
        for (const surface of surfaces(component.id)) {
          await page.goto(`${SERVICE}/${surface.address}`);
          await surface.ready(page, language).waitFor();
          expect(await page.evaluate(() => document.documentElement.lang)).toBe(language);
          expect(await page.evaluate(() => document.documentElement.dir)).toBe(
            language === 'ar-XB' ? 'rtl' : 'ltr',
          );
          const found = await unlocalised(page, surface.regions);
          expect(found.missed, `${surface.name}: words left in English`).toEqual([]);
          expect(found.clipped, `${surface.name}: words cut short`).toEqual([]);
          expect(found.spills, `${surface.name}: wider than the window`).toEqual([]);
          // An icon's button has no text to walk: its name is what a screen reader says.
          const names = await page.$$eval(
            surface.regions.map((region) => `${region} [aria-label]`).join(', '),
            (labelled) => labelled.map((each) => each.getAttribute('aria-label') ?? ''),
          );
          expect(
            names.filter((name) => /[A-Za-z]{2,}/.test(name) && !/[[\]]/.test(name)),
            `${surface.name}: names left in English`,
          ).toEqual([]);
        }
      },
      { signedInAs: cookie },
    );
  } finally {
    await chooseLanguage(cookie, null);
  }
}

describe('the interface in pseudo-locales (the UI plan, UI-J)', () => {
  it('shows every moved surface expanded and accented, each word made over and none cut short', async () => {
    await walk('en-XA');
  });

  it('shows every moved surface right to left, each word made over and none cut short', async () => {
    await walk('ar-XB');
  });
});
