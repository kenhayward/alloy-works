import { readPaint } from '@alloy-works/conformance';
import type { Locator, Page } from 'playwright-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { SERVICE } from './testing/addresses.js';
import { api, edit, makeDocument, nodesOf, readDocument, type Client } from './testing/api.js';
import { checkAxe } from './testing/axe.js';
import { makeComponent } from './testing/component.js';
import { approvedTerm, publishPdf } from './testing/fixtures.js';
import { withPage } from './testing/page.js';

/**
 * Terms in the pinned Chromium (the TM plan, TMc), by the keyboard alone: an approved term of the
 * General space applied by typing its abbreviation and pressing Tab on the offer, and the document
 * published, its first use printed expanded. Axe on the offer. Uncited: the jsdom and service tests
 * cite what each demonstrates.
 */

/** An approved term in General, and a document placing a component to use it in. */
async function placeTerm(
  ada: Client,
): Promise<{ document: string; label: string; abbreviation: string }> {
  const { label, abbreviation } = await approvedTerm(ada);
  const component = await makeComponent(ada, 'Health', [
    {
      type: 'paragraph',
      id: 'p1',
      style: 'body',
      content: [{ type: 'text', value: 'Ask the', marks: [] }],
    },
  ]);
  let document = await makeDocument(ada, 'Terms', ['Advice']);
  document = await edit(ada, document, {
    operation: 'insert',
    parent: nodesOf(document)[0]!.id,
    position: 0,
    node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
  });
  return { document: document.id, label, abbreviation };
}

/** Tab pressed until `target` holds the focus: at most `most` presses. */
async function tabTo(page: Page, target: Locator, most = 60) {
  for (let pressed = 0; pressed < most; pressed++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`${String(target)} never took the focus`);
}

describe('terms in Chromium (the TM plan, TMc)', () => {
  let placed: { document: string; label: string; abbreviation: string };
  beforeAll(async () => {
    placed = await placeTerm(api());
  });

  it('applies a term by typing its abbreviation and pressing Tab, and publishes it expanded on first use, by the keyboard', async ({
    task,
  }) => {
    await withPage(async (page) => {
      await page.goto(`${SERVICE}/#/documents/${placed.document}`);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      const text = page.getByRole('region', { name: "The document's text" });
      const opens = text.locator('[data-opens="true"]').first();
      await opens.waitFor();
      await opens.focus();
      await page.keyboard.press('Enter');
      const surface = page.getByRole('textbox', { name: /^Content of / });
      await surface.waitFor();
      await surface.focus();
      await page.keyboard.press('End');

      // Typed, the term is offered at the caret, the caret staying in the surface. The space's terms
      // are read as the editor opens, and an offer is made only on typing, so on a slow runner the
      // last letter is typed again, as a person would, until they have arrived.
      await page.keyboard.type(` ${placed.abbreviation}`);
      const offer = page.getByRole('listbox', { name: 'Suggested terms' });
      const option = offer.getByRole('option', { name: new RegExp(placed.label) });
      await expect
        .poll(
          async () => {
            if (await option.isVisible()) return true;
            await page.keyboard.press('Backspace');
            await page.keyboard.type(placed.abbreviation.slice(-1));
            return option.isVisible();
          },
          { timeout: 30_000, intervals: [500] },
        )
        .toBe(true);
      expect(await option.getAttribute('aria-selected')).toBe('true');
      expect(await surface.getAttribute('aria-activedescendant')).toBe(
        await option.getAttribute('id'),
      );
      expect(await surface.evaluate((element) => element === document.activeElement)).toBe(true);
      await checkAxe(page, 'a term offered as it is typed', task.meta, { shows: [offer, option] });

      // Tab applies it over the word typed.
      await page.keyboard.press('Tab');
      await offer.waitFor({ state: 'hidden' });
      const marked = surface.locator('dfn[data-term]');
      await marked.waitFor();
      expect(await marked.textContent()).toBe(placed.abbreviation);

      // Done, from the Formatting toolbar's one stop.
      const done = page.getByRole('button', { name: 'Done editing' });
      await tabTo(
        page,
        page.getByRole('toolbar', { name: 'Formatting' }).locator('button[tabindex="0"]'),
      );
      await page.keyboard.press('Home');
      await expect
        .poll(() => done.evaluate((element) => element === document.activeElement))
        .toBe(true);
      await page.keyboard.press('Enter');
      await surface.waitFor({ state: 'hidden' });

      // Published, from the Publishing panel: Tab to the panels' one stop, End to choose the last.
      const panels = page.getByRole('tablist', { name: 'Document panels' });
      await tabTo(page, panels.getByRole('tab', { selected: true }), 120);
      await page.keyboard.press('End');
      const publish = page.getByRole('button', { name: /^Publish as/ }).first();
      await tabTo(page, publish, 120);
      await page.keyboard.press('Enter');
      await page.getByRole('link', { name: 'Open the publication' }).waitFor({ timeout: 120_000 });
    });

    // The first use printed as the preferred label and the abbreviation, by the default theme's rule.
    const client = api();
    const pdf = await publishPdf(client, await readDocument(client, placed.document));
    // Spaces aside: a run of painted text may break anywhere.
    const bare = (said: string) => said.replace(/\s+/g, '');
    const printed = bare(
      (await readPaint(pdf)).texts
        .filter((each) => !each.artifact)
        .map((each) => each.text)
        .join(''),
    );
    expect(printed).toContain(bare(`${placed.label} (${placed.abbreviation})`));
  });
});
