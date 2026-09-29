import type { Page } from 'playwright-core';
import { describe, expect, inject, it } from 'vitest';
import { api, edit, makeDocument, nodesOf, type Client, type DocumentView } from './testing/api.js';
import { SERVICE } from './testing/addresses.js';
import { makeComponent, png, uploadImage } from './testing/fixtures.js';
import { withPage } from './testing/page.js';

/**
 * **The canvas as a person uses it**, beside what `styles.test.ts` measures (the final review of
 * issues #331 and #333): a line held open as the page holds it must not take the clicks meant for the
 * line above it, and the document view's headings, set as the page sets them, must leave a component's
 * label beside its heading and the editor opened in place its whole width, at 100% and at 50%.
 */

const WORDS = 'The unit is lifted from its box by the two handles at its sides and set down level.';

function paragraph(id: string, content: readonly object[]) {
  return { type: 'paragraph', id, style: 'body', content };
}
const text = (value: string) => ({ type: 'text', value, marks: [] });

/** A component of a paragraph of words and, straight after it, one holding an image in its line. */
async function withAnImage(client: Client, name: string): Promise<string> {
  const image = await uploadImage(client, inject('session'), png(60, 40, [30, 90, 200]));
  return makeComponent(client, `${name} ${new Date().toISOString()}`, [
    paragraph('canvas-words', [text(`Zc0 ${WORDS} ${WORDS}`)]),
    paragraph('canvas-image', [
      text('Zc1 before '),
      { type: 'image', asset: image, imageStyle: 'inline', alternative: { kind: 'inherited' } },
      text(' after'),
    ]),
    paragraph('canvas-after', [text(`Zc2 ${WORDS}`)]),
  ]);
}

/** A document of one section placing `component`. */
async function placing(client: Client, name: string, component: string): Promise<DocumentView> {
  const made = await makeDocument(client, `${name} ${new Date().toISOString()}`, ['Placed']);
  return edit(client, made, {
    operation: 'insert',
    parent: nodesOf(made)[0]!.id,
    position: 0,
    node: { type: 'reference', component, mode: { kind: 'latest' } },
  });
}

/** Opens a document's page, in `mode`, at `zoom`, and waits for its component's text. */
async function openDocument(
  page: Page,
  document: DocumentView,
  mode: 'Reading' | 'Authoring',
  zoom: '1' | '0.5',
): Promise<void> {
  await page.goto(`${SERVICE}/#/documents/${document.id}`);
  await page.getByRole('radio', { name: mode }).check();
  await page.getByLabel('Zoom').selectOption(zoom);
  const canvas = page.locator('section.aw-canvas');
  await expect
    .poll(() => canvas.evaluate((element) => element.style.getPropertyValue('--aw-zoom')))
    .toBe(zoom);
  await canvas.getByText(/^Zc0 /).waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

/** Whether two boxes share any area. */
function overlap(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

describe('the canvas as a person uses it', () => {
  it('puts the caret in the line clicked, where the line below it is held open by an image (the final review of issue #331)', async () => {
    const client = api();
    const component = await withAnImage(client, 'Clicked above an image');
    await withPage(async (page) => {
      await page.goto(`${SERVICE}/#/components/${component}`);
      const surface = page.getByRole('textbox', { name: /^Content of / });
      await surface.getByText(/^Zc1 /).waitFor();
      await expect
        .poll(() =>
          surface.evaluate((root) =>
            [...root.querySelectorAll('img')].every(
              (image) => image.complete && image.style.width !== '',
            ),
          ),
        )
        .toBe(true);
      // The lower half of the last line of the paragraph above the image's, at its words' middle.
      const target = await surface.evaluate((root) => {
        const words = [...root.querySelectorAll('p')].find((each) =>
          (each.textContent ?? '').startsWith('Zc0'),
        )!;
        const range = document.createRange();
        range.selectNodeContents(words);
        const lines = [...range.getClientRects()].filter((each) => each.width > 0);
        const last = lines[lines.length - 1]!;
        return { x: last.left + last.width / 4, y: last.top + last.height * 0.8 };
      });
      await page.mouse.click(target.x, target.y);
      const at = await page.evaluate(() => {
        const node = window.getSelection()?.anchorNode;
        const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
        return (element?.closest('p')?.textContent ?? '').slice(0, 3);
      });
      expect(at, 'the paragraph the caret is in').toBe('Zc0');
    });
  });

  it("stands a component's label beside its heading, not over it (the final review of issue #333)", async () => {
    const client = api();
    const component = await withAnImage(client, 'Labelled');
    const document = await placing(client, 'Labelled', component);
    await withPage(async (page) => {
      // Wide enough that the column is wider than the measure, where the label stands beside it.
      await page.setViewportSize({ width: 1700, height: 1000 });
      await openDocument(page, document, 'Reading', '1');
      const boxes = await page.evaluate(() => {
        const card = document.querySelector('section.aw-canvas [data-component]')!;
        const heading = card.querySelector('h1, h2, h3, h4, h5, h6')!;
        const words = document.createRange();
        words.selectNodeContents(heading);
        return {
          label: card.querySelector('[data-label]')!.getBoundingClientRect().toJSON() as DOMRect,
          words: words.getBoundingClientRect().toJSON() as DOMRect,
          component: card.getBoundingClientRect().toJSON() as DOMRect,
          measure: card.querySelector('.aw-text')!.getBoundingClientRect().width,
        };
      });
      // At the column's edge, not the measure's: the component is the column wide.
      expect(boxes.component.width, JSON.stringify(boxes)).toBeGreaterThan(boxes.measure + 1);
      expect(
        Math.abs(boxes.label.right - boxes.component.right),
        JSON.stringify(boxes),
      ).toBeLessThan(1);
      // And clear of the heading's words.
      expect(overlap(boxes.label, boxes.words), JSON.stringify(boxes)).toBe(false);
    });
  });

  for (const zoom of ['1', '0.5'] as const) {
    it(`opens a component in place the column's width, and leaves its text to the pointer, at ${Number(zoom) * 100}% (the final review of issue #333)`, async () => {
      const client = api();
      const component = await withAnImage(client, `In place at ${zoom}`);
      const document = await placing(client, `In place at ${zoom}`, component);
      await withPage(async (page) => {
        await openDocument(page, document, 'Authoring', zoom);
        // The text, where the pointer lands on it, is the text and not the label over it.
        const hit = await page.evaluate(() => {
          const body = document.querySelector('section.aw-canvas [data-opens="true"]')!;
          const box = body.getBoundingClientRect();
          const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return body.contains(at);
        });
        expect(hit, "the component's text takes the pointer").toBe(true);

        await page.locator('section.aw-canvas').getByText(/^Zc2 /).click();
        const card = page.locator('article[data-in-place="true"]');
        await page.getByRole('textbox', { name: /^Content of / }).waitFor();
        const shown = await card.evaluate((element) => {
          const canvas = element.closest('section.aw-canvas')!;
          const edge = canvas.getBoundingClientRect();
          const style = getComputedStyle(canvas);
          const inside = edge.left + parseFloat(style.borderLeftWidth);
          const toolbar = element.querySelector('[role="toolbar"][aria-label="Formatting"]')!;
          const tops = new Set(
            [...toolbar.querySelectorAll('button')]
              .filter((each) => each.getBoundingClientRect().width > 0)
              .map((each) => Math.round(each.getBoundingClientRect().top)),
          );
          const box = element.getBoundingClientRect();
          return {
            card: { left: box.left, right: box.right, width: box.width },
            column: {
              left: inside + parseFloat(style.paddingLeft),
              right: inside + canvas.clientWidth - parseFloat(style.paddingRight),
            },
            viewport: window.innerWidth,
            rows: tops.size,
          };
        });
        const said = JSON.stringify(shown);
        // The column's width, whatever the zoom - never the measure's, which squeezed it to 301 pixels
        // at 50% - and not clipped at its right.
        expect(shown.card.width, said).toBeGreaterThanOrEqual(
          shown.column.right - shown.column.left - 1,
        );
        expect(shown.card.right, said).toBeLessThanOrEqual(shown.column.right + 0.5);
        expect(shown.card.right, said).toBeLessThanOrEqual(shown.viewport);
        // The Formatting toolbar in the rows the column's width lays it out in: two at 1280 pixels,
        // at any zoom, where the measure's width at 50% made it three.
        expect(shown.rows, said).toBeLessThanOrEqual(2);
      });
    });
  }
});
