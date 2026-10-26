import { describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { withPage } from './testing/page.js';
import { signInFromNode } from './testing/setup.js';
import { chooseLanguage, say, unlocalised } from './testing/words.js';

/**
 * **The interface in pseudo-locales** (the UI plan, UI-J; LOC-029, LOC-042, LOC-004): the surfaces
 * moved into the catalogue so far, walked in `en-XA` and `ar-XB`, each word made over, none cut short,
 * nothing spilling sideways, and `ar-XB` laid out right to left. Grace walks it, her language chosen
 * for the walk and given back after, so no other walk, as Ada, sees it. The surfaces grow each PR.
 */
const SURFACES: readonly {
  readonly name: string;
  readonly address: string;
  readonly regions: readonly string[];
}[] = [
  { name: 'Home, the header and the rail', address: '#/', regions: ['header', 'nav', 'main'] },
];

/** Each moved surface walked in `language`, its words made over, none cut short, nothing spilling. */
async function walk(language: 'en-XA' | 'ar-XB') {
  const cookie = await signInFromNode('grace');
  await chooseLanguage(cookie, language);
  try {
    await withPage(
      async (page) => {
        for (const surface of SURFACES) {
          await page.goto(`${SERVICE}/${surface.address}`);
          await page
            .getByRole('heading', { level: 2, name: say(language, 'home.needs-your-attention') })
            .waitFor();
          expect(await page.evaluate(() => document.documentElement.lang)).toBe(language);
          expect(await page.evaluate(() => document.documentElement.dir)).toBe(
            language === 'ar-XB' ? 'rtl' : 'ltr',
          );
          const found = await unlocalised(page, surface.regions);
          expect(found.missed, `${surface.name}: words left in English`).toEqual([]);
          expect(found.clipped, `${surface.name}: words cut short`).toEqual([]);
          expect(found.spills, `${surface.name}: wider than the window`).toBe(false);
        }
      },
      { signedInAs: cookie },
    );
  } finally {
    await chooseLanguage(cookie, null);
  }
}

describe('the interface in pseudo-locales (the UI plan, UI-J)', () => {
  it('LOC-042 LOC-029 shows every moved surface expanded and accented, each word made over and none cut short', async () => {
    await walk('en-XA');
  });

  it('LOC-042 LOC-004 shows every moved surface right to left, each word made over and none cut short', async () => {
    await walk('ar-XB');
  });
});
