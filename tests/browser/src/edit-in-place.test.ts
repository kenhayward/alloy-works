import type { Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';

import { SERVICE } from './testing/addresses.js';
import { api, edit, makeDocument } from './testing/api.js';
import { makeComponent, uploadImage } from './testing/component.js';
import { everyBlock } from './testing/every-block.js';
import { withPage } from './testing/page.js';

/**
 * Clicking into a document's text, in the pinned Chromium (the EP plan, EP2): nothing moves, the words
 * never leave the page, and one rule says which part is open.
 */
const para = (id: string, value: string) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [{ type: 'text', value, marks: [] }],
});
const item = (id: string, value: string) => ({ content: [para(id, value)] });

const words = (lead: string) =>
  `${lead} The objective of this exercise is to record what each system says, and to keep it. `.repeat(
    2,
  );

async function twoParts() {
  const client = api();
  const stamp = String(Date.now());
  const first = await makeComponent(client, `First ${stamp}`, [
    para('a1', words('First words.')),
    {
      type: 'list',
      id: 'l1',
      kind: 'ordered',
      start: 1,
      format: 'decimal',
      items: [item('i1', 'One thing to do.'), item('i2', 'Another thing to do.')],
    },
    para('a2', 'Last words of the first.'),
  ] as never);
  const second = await makeComponent(client, `Second ${stamp}`, [
    para('b1', words('Following words.')),
  ] as never);
  let made = await makeDocument(client, `Editing in place ${stamp}`, []);
  for (const [position, component] of [first, second].entries()) {
    made = await edit(client, made, {
      operation: 'insert',
      parent: null,
      position,
      node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
    });
  }
  return { document: made.id, first: first.id };
}

/** Where each named run of words stands, to the tenth of a pixel. */
const standing = (page: Page) =>
  page.evaluate(() => {
    const at = (text: string) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (node.textContent?.startsWith(text)) {
          const box = node.parentElement!.getBoundingClientRect();
          return [box.left, box.top, box.height].map((each) => Math.round(each * 10) / 10);
        }
      }
      return null;
    };
    return {
      first: at('First words.'),
      list: at('Another thing'),
      last: at('Last words'),
      next: at('Following words.'),
    };
  });

/** Each frame from here on: whether the words are on the page, and whether the next part moved. */
const watchFrames = (page: Page) =>
  page.evaluate(() => {
    const seen = window as unknown as { frames_: string[]; stop_: boolean };
    seen.frames_ = [];
    seen.stop_ = false;
    const has = (text: string) =>
      (document.querySelector('.aw-canvas')?.textContent ?? '').includes(text);
    const next = () => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (node.textContent?.startsWith('Following words.')) {
          return Math.round(node.parentElement!.getBoundingClientRect().top);
        }
      }
      return null;
    };
    const tick = () => {
      if (seen.stop_) return;
      seen.frames_.push(`${has('First words.')}:${has('ZED')}:${next()}`);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

const framesSeen = (page: Page) =>
  page.evaluate(() => {
    const seen = window as unknown as { frames_: string[]; stop_: boolean };
    seen.stop_ = true;
    return [...new Set(seen.frames_)];
  });

const edgesOf = (page: Page) =>
  page.evaluate(() => {
    const part = [...document.querySelectorAll('[data-component]')].find((each) =>
      each.textContent?.includes('First words.'),
    )!;
    const rule = getComputedStyle(part, '::before');
    const card = part.querySelector('article');
    const surface = part.querySelector('[class*=surface]');
    return {
      rule: rule.borderInlineStartWidth,
      colour: rule.borderInlineStartColor,
      outline: getComputedStyle(part).outlineStyle,
      card: card === null ? null : getComputedStyle(card).boxShadow,
      surface: surface === null ? null : getComputedStyle(surface).outlineStyle,
    };
  });

/** The line boxes of the words that start with `text`, from the sheet's corner, to the tenth of a pixel. */
const linesOf = (page: Page, text: string) =>
  page.evaluate((words) => {
    const sheet = document.querySelector('.aw-sheet')!.getBoundingClientRect();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node.textContent?.startsWith(words)) {
        const range = document.createRange();
        range.selectNodeContents(node);
        return [...range.getClientRects()].map((box) =>
          [
            box.left - sheet.left,
            box.right - sheet.left,
            box.top - sheet.top,
            box.bottom - sheet.top,
          ].map((each) => Math.round(each * 10) / 10),
        );
      }
    }
    return [];
  }, text);

/** The zoom the sheet sets, and the zoom the open editor's text is set at. */
const zooms = (page: Page) =>
  page.evaluate(() => {
    const of = (element: Element | null) =>
      element === null ? null : getComputedStyle(element).getPropertyValue('--aw-zoom');
    return {
      sheet: of(document.querySelector('.aw-canvas.aw-sheet')),
      open: of(document.querySelector("[data-in-place='true'] .aw-canvas")),
    };
  });

const expectWithin = (found: number[][], wanted: number[][], by: number) => {
  expect(found.length).toBe(wanted.length);
  found.forEach((line, row) =>
    line.forEach((value, at) =>
      expect(Math.abs(value - wanted[row]![at]!)).toBeLessThanOrEqual(by),
    ),
  );
};

describe('a component open in place stands still (the in-place-steadiness handoff)', () => {
  const FIRST = 'First words.';

  const holdsOpen = async (page: Page) => {
    await page.getByRole('toolbar', { name: 'Part toolbar' }).waitFor();
    await page.getByRole('textbox', { name: /^Content of / }).waitFor();
  };

  it('CNT-075 sets its text where the sheet set it, and a press moves nothing, at Fit and at each zoom', async () => {
    const { document: id } = await twoParts();
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1500, height: 1000 });
      await page.goto(`${SERVICE}/#/documents/${id}`);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      for (const zoom of ['fit', '0.75', '1', '1.5']) {
        await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption(zoom);
        await page.getByText(FIRST).first().waitFor();
        await page.waitForTimeout(100);
        const read = await linesOf(page, FIRST);
        expect(read.length).toBeGreaterThan(0);
        await page.getByText(FIRST).first().click();
        await holdsOpen(page);
        const said = await zooms(page);
        expect(said.open, zoom).toBe(said.sheet);
        const open = await linesOf(page, FIRST);
        expectWithin(open, read, 0.5);
        // A press and its release, in the text: nothing moves, and it stays open.
        const box = await page.getByText(FIRST).first().boundingBox();
        await page.mouse.move(box!.x + 40, box!.y + 8);
        await page.mouse.down();
        expect(await linesOf(page, FIRST)).toEqual(open);
        expect((await zooms(page)).open).toBe(said.sheet);
        await page.mouse.up();
        await holdsOpen(page);
        expect(await linesOf(page, FIRST)).toEqual(open);
        // A slow press, then a click in a list inside it: still open, and nothing has moved.
        await page.mouse.down();
        await page.waitForTimeout(600);
        await page.mouse.up();
        await page.getByText('Another thing to do.').first().click();
        await page.waitForTimeout(300);
        await holdsOpen(page);
        expect(await linesOf(page, FIRST)).toEqual(open);
        await page.getByRole('button', { name: 'Done editing' }).first().click();
        await page.getByRole('textbox', { name: /^Content of / }).waitFor({ state: 'detached' });
      }
    });
  });

  it('CNT-075 keeps the rule to its own part, over its editor, and under the gutter', async () => {
    const { document: id } = await twoParts();
    await withPage(async (page) => {
      await page.goto(`${SERVICE}/#/documents/${id}`);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      await page.getByText(FIRST).first().click();
      await holdsOpen(page);
      const rule = await page.evaluate((first) => {
        const part = [...document.querySelectorAll('[data-component]')].find((each) =>
          each.textContent?.includes(first),
        )!;
        const drawn = getComputedStyle(part, '::before');
        return {
          z: drawn.zIndex,
          height: parseFloat(drawn.height),
          part: part.getBoundingClientRect().height,
          top: drawn.top,
          pointer: drawn.pointerEvents,
          gutter: [...document.querySelectorAll('[class*=gutter]')].map(
            (each) => getComputedStyle(each).zIndex,
          )[0],
        };
      }, FIRST);
      expect(rule.z).toBe('1');
      expect(rule.top).toBe('0px');
      expect(rule.height).toBeCloseTo(rule.part, 0);
      expect(rule.pointer).toBe('none');
      if (rule.gutter !== undefined) expect(Number(rule.gutter)).toBeGreaterThan(1);
    });
  });
});

describe('clicking into a document, in Chromium', () => {
  it('moves nothing on opening, keeps the words on the page, and marks the part with one rule', async () => {
    const { document: id } = await twoParts();
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1920, height: 1000 });
      await page.goto(`${SERVICE}/#/documents/${id}`);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      const target = page.getByText('First words.').first();
      await target.waitFor();
      await page.waitForTimeout(500);
      const before = await standing(page);

      // Held back, so that a frame without the words could not be missed.
      await page.route('**/v1/components/*', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        await route.continue();
      });
      await watchFrames(page);
      await target.click();
      await page.locator('.ProseMirror').first().waitFor();
      await page.waitForTimeout(300);
      const frames = await framesSeen(page);

      expect(frames.filter((each) => each.startsWith('false'))).toEqual([]);
      expect(new Set(frames.map((each) => each.split(':')[2])).size, frames.join(' ')).toBe(1);
      expect(await standing(page)).toEqual(before);

      const edges = await edgesOf(page);
      expect(edges.rule).toBe('3px');
      expect(edges.outline).toBe('none');
      expect(edges.card).toBe('none');
      expect(edges.surface).toBe('none');
    });
  });

  it('keeps a part holding every kind of block within a few pixels, and never sideways', async () => {
    const client = api();
    const image = await uploadImage(client, 'A small square');
    const figure = await uploadImage(client, 'A blue rectangle');
    const every = await makeComponent(client, `Every block ${Date.now()}`, [
      para('e0', 'First words.'),
      ...everyBlock(figure, image),
    ] as never);
    const after = await makeComponent(client, 'What follows', [
      para('n1', 'Following words.'),
    ] as never);
    let made = await makeDocument(client, `Every block ${Date.now()}`, []);
    for (const [position, component] of [every, after].entries()) {
      made = await edit(client, made, {
        operation: 'insert',
        parent: null,
        position,
        node: { type: 'reference', component: component.id, mode: { kind: 'latest' } },
      });
    }
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1920, height: 1000 });
      await page.goto(`${SERVICE}/#/documents/${made.id}`);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      const target = page.getByText('First words.').first();
      await target.waitFor();
      await page.waitForTimeout(800);
      const before = await standing(page);
      await target.click();
      await page.locator('.ProseMirror').first().waitFor();
      await page.waitForTimeout(800);
      const now = await standing(page);
      expect(now.first).toEqual(before.first);
      // Sideways not at all, whatever the panels (a table's tab once widened them by 120px). Down the
      // page, an inline equation and the end of the text still give a few pixels: #973.
      expect(now.next![0]).toBe(before.next![0]);
      expect(Math.abs(now.next![1]! - before.next![1]!)).toBeLessThan(6);
    });
  });

  it('takes the keys typed while it opens, and keeps the words on the page on closing', async () => {
    const { document: id } = await twoParts();
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1920, height: 1000 });
      await page.goto(`${SERVICE}/#/documents/${id}`);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      const target = page.getByText('First words.').first();
      await target.waitFor();
      await page.waitForTimeout(500);

      await page.route('**/v1/components/*', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        await route.continue();
      });
      await target.click();
      await page.keyboard.type('ZED');
      await page.locator('.ProseMirror').first().waitFor();
      await expect.poll(() => page.locator('.ProseMirror').first().textContent()).toContain('ZED');
      await page.unroute('**/v1/components/*');

      // The save answered, and then closed: the words stand from the click on.
      await page.waitForTimeout(3000);
      await watchFrames(page);
      await page.getByRole('button', { name: 'Done editing' }).click();
      await page.locator('.ProseMirror').first().waitFor({ state: 'detached' });
      await page.waitForTimeout(800);
      const frames = await framesSeen(page);
      expect(frames.filter((each) => each.split(':')[1] === 'false')).toEqual([]);
    });
  });

  it("stands one toolbar over the part, in the reader's theme, its acts still as a table is entered", async () => {
    const client = api();
    const image = await uploadImage(client, 'A small mark');
    const figure = await uploadImage(client, 'A blue rectangle');
    const every = await makeComponent(client, `Every block ${Date.now()}`, [
      para('e0', 'First words.'),
      ...everyBlock(figure, image),
    ] as never);
    const made = await edit(client, await makeDocument(client, `One toolbar ${Date.now()}`, []), {
      operation: 'insert',
      parent: null,
      position: 0,
      node: { type: 'reference', component: every.id, mode: { kind: 'latest' } },
    });
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1920, height: 700 });
      await page.goto(`${SERVICE}/#/documents/${made.id}`);
      await page.evaluate(() => {
        document.documentElement.dataset['theme'] = 'dark';
      });
      await page.getByRole('radio', { name: 'Authoring' }).check();
      const target = page.getByText('First words.').first();
      await target.waitFor();
      await target.click();
      const bar = page.getByRole('toolbar', { name: 'Part toolbar' });
      await bar.waitFor();

      // Not the paper's light, whatever the sheet takes.
      const ground = await bar.evaluate((own) => getComputedStyle(own).backgroundColor);
      const paper = await page
        .locator('.aw-sheet')
        .first()
        .evaluate((own) => getComputedStyle(own).backgroundColor);
      expect(ground).not.toBe(paper);

      // Above the part, heading and all, at its end.
      const part = (await page.locator('[data-component]').first().boundingBox())!;
      const box = (await bar.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(part.y);
      expect(box.x + box.width).toBeCloseTo(part.x + part.width, 0);

      const done = bar.getByRole('button', { name: 'Done editing' });
      const before = (await done.boundingBox())!;
      await page.locator('[data-component] figure.aw-table td').first().click();
      const table = bar.getByRole('button', { name: /settings/ });
      await table.waitFor();
      const after = (await done.boundingBox())!;
      expect(after.x).toBeCloseTo(before.x, 0);
      expect(after.y).toBeCloseTo(before.y, 0);

      // Scrolled down the part it stays in view.
      await page.evaluate(() => {
        const scrolled = [document.scrollingElement, ...document.querySelectorAll('*')].find(
          (each) =>
            each !== null &&
            each.scrollHeight > each.clientHeight + 200 &&
            ['auto', 'scroll'].includes(getComputedStyle(each).overflowY) &&
            each.querySelector('[data-component]') !== null,
        );
        scrolled?.scrollBy(0, 400);
      });
      await page.waitForTimeout(200);
      const stuck = (await bar.boundingBox())!;
      expect(stuck.y).toBeGreaterThanOrEqual(0);
      expect(stuck.y).toBeLessThan(120);
    });
  });

  it('CNT-074 shows who holds a part in the gutter, moving no text, and in Authoring only', async () => {
    const { document: id } = await twoParts();
    const back = new Date(Date.now() + 45 * 60_000).toISOString();
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1920, height: 1000 });
      // Someone else's, as the service would say it: one signed-in user has no one else to hold it.
      await page.addInitScript(
        ({ texts, expectedRelease }) => {
          const real = window.fetch.bind(window);
          window.fetch = async (input, init) => {
            const response = await real(input, init);
            const url = input instanceof Request ? input.url : String(input);
            if (!url.endsWith(texts)) return response;
            const body = (await response.json()) as { occurrences: { lock: unknown }[] };
            body.occurrences[0]!.lock = {
              holder: { id: 'grace', name: 'Grace' },
              expectedRelease,
              yours: false,
              session: null,
            };
            return new Response(JSON.stringify(body), {
              status: response.status,
              headers: response.headers,
            });
          };
        },
        { texts: `/v1/documents/${id}/texts`, expectedRelease: back },
      );
      await page.goto(`${SERVICE}/#/documents/${id}`);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      const theirs = page.getByRole('button', { name: /^Grace is editing this component/ });
      await theirs.waitFor();
      const amber = await theirs.evaluate((own) => getComputedStyle(own).color);

      // A short part's stack wraps sideways, and never runs into the next part's.
      const stack = await theirs.evaluate((own) => {
        const gutter = own.parentElement!;
        gutter.style.insetBlockEnd = 'auto';
        gutter.style.height = '20px';
        const copy = own.cloneNode(true) as HTMLElement;
        gutter.appendChild(copy);
        const [a, b] = [own.getBoundingClientRect(), copy.getBoundingClientRect()];
        copy.remove();
        gutter.style.removeProperty('inset-block-end');
        gutter.style.removeProperty('height');
        return { sameRow: a.top === b.top, apart: b.left >= a.right };
      });
      expect(stack).toEqual({ sameRow: true, apart: true });

      await theirs.click();
      await expect
        .poll(() => page.getByText(/^Grace is editing this component/).count())
        .toBeGreaterThan(0);

      // Yours appears at the first change, in the other colour, and moves nothing.
      const words = page.getByText('Following words.').first();
      await words.click();
      await page.getByRole('toolbar', { name: 'Part toolbar' }).waitFor();
      const before = (await words.boundingBox())!;
      expect(
        await page.getByRole('button', { name: 'You are editing this component.' }).count(),
      ).toBe(0);
      await page.keyboard.type('x');
      const mine = page.getByRole('button', { name: 'You are editing this component.' });
      await mine.waitFor();
      expect(await mine.evaluate((own) => getComputedStyle(own).color)).not.toBe(amber);
      expect((await words.boundingBox())!.y).toBeCloseTo(before.y, 0);

      // Reading stays clean.
      await page.getByRole('button', { name: 'Done editing' }).click();
      const reading = page.getByRole('radio', { name: 'Reading' });
      await reading.click();
      await expect.poll(() => reading.isChecked()).toBe(true);
      await expect.poll(() => theirs.count()).toBe(0);
    });
  });

  it('CNT-077 goes back from the text through the toolbar to the text, then out, by Shift-F6', async () => {
    const { document: id } = await twoParts();
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1920, height: 1000 });
      await page.goto(`${SERVICE}/#/documents/${id}`);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      await page.getByText('First words.').first().click();
      const bar = page.getByRole('toolbar', { name: 'Part toolbar' });
      await bar.waitFor();
      const surface = page.getByRole('textbox', { name: /^Content of / });
      const holds = (locator: typeof bar) =>
        locator.evaluate((own) => own.contains(document.activeElement));
      // On from the text to a toolbar, and straight back.
      await page.keyboard.press('F6');
      await page.keyboard.press('Shift+F6');
      await expect.poll(() => holds(surface)).toBe(true);
      await page.keyboard.press('ArrowRight');
      // Backwards from the text, the panels and the toolbar come before the application.
      for (let pressed = 0; pressed < 12 && !(await holds(bar)); pressed++) {
        await page.keyboard.press('Shift+F6');
      }
      expect(await holds(bar)).toBe(true);
      // The formatting toolbar, the text, then out of the page.
      await page.keyboard.press('Shift+F6');
      await page.keyboard.press('Shift+F6');
      await expect.poll(() => holds(surface)).toBe(true);
      await page.keyboard.press('Shift+F6');
      await expect
        .poll(() =>
          page.evaluate(() => document.activeElement?.closest('section.aw-canvas') === null),
        )
        .toBe(true);
    });
  });

  it('CNT-077 goes from the text to the toolbar and on to the application by F6', async () => {
    const { document: id } = await twoParts();
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1920, height: 1000 });
      await page.goto(`${SERVICE}/#/documents/${id}`);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      await page.getByText('First words.').first().click();
      const bar = page.getByRole('toolbar', { name: 'Part toolbar' });
      await bar.waitFor();
      // The formatting toolbar, then this one.
      await page.keyboard.press('F6');
      await page.keyboard.press('F6');
      await expect
        .poll(() => bar.evaluate((own) => own.contains(document.activeElement)))
        .toBe(true);
      await page.keyboard.press('F6');
      // Out of the editor's ring, not held in it.
      await expect
        .poll(() =>
          page.evaluate(() => document.activeElement?.closest('[data-app-region]') !== null),
        )
        .toBe(true);
      await expect
        .poll(() =>
          page.evaluate(() => document.activeElement?.closest('section.aw-canvas') === null),
        )
        .toBe(true);
    });
  });

  it('shows the rule alone on hover, in forced colours too', async () => {
    const { document: id } = await twoParts();
    await withPage(async (page) => {
      await page.setViewportSize({ width: 1920, height: 1000 });
      await page.goto(`${SERVICE}/#/documents/${id}`);
      await page.getByRole('radio', { name: 'Authoring' }).check();
      const target = page.getByText('First words.').first();
      await target.waitFor();
      await target.hover();
      expect((await edgesOf(page)).rule).toBe('3px');
      expect((await edgesOf(page)).outline).toBe('none');

      await page.emulateMedia({ forcedColors: 'active' });
      const { colour } = await edgesOf(page);
      const ground = await target.evaluate(
        (element) => getComputedStyle(element.closest('.aw-canvas')!).backgroundColor,
      );
      expect(colour).not.toBe(ground);
    });
  });
});
