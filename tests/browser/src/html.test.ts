import { DEFAULT_THEME_ID } from '@alloy-works/db';
import {
  DEFAULT_CATALOGUES,
  DEFAULT_THEME,
  faceFamily,
  type ResolvedParagraphProperties,
} from '@alloy-works/domain';
import {
  approved,
  COMPONENT_TITLE,
  compare,
  EDITOR_DEVIATIONS,
  HEADINGS,
  measurePdf,
  readPaint,
  styledContent,
  type Alignment,
  type Token,
} from '@alloy-works/conformance';
import type { Page } from 'playwright-core';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { api, type Client } from './testing/api.js';
import { SERVICE } from './testing/addresses.js';
import { checkAxe } from './testing/axe.js';
import {
  makeComponent,
  makeDocument,
  makeTemplate,
  png,
  publishHtml,
  uploadImage,
} from './testing/fixtures.js';
import { measureEditor } from './testing/measure.js';
import { withPage } from './testing/page.js';

/**
 * **The HTML reading format in pinned Chromium** (the HT plan, HT-O): each case published through the
 * stack as a PDF and HTML, and its HTML file opened as a reader opens it - axe over it, at 320 CSS
 * pixels wide and with its text at 200% for a page that never scrolls sideways, and every passage in
 * another language marked with its language and direction - and its text measured against the PDF's,
 * as the editor's is. Invented content only.
 */

const ARABIC = 'تقرأ هذه الفقرة من اليمين إلى اليسار.';
const HEBREW = 'פסקה זו נקראת מימין לשמאל.';
const text = (value: string, marks: object[] = []) => ({ type: 'text', value, marks });
const paragraph = (id: string, content: object[]) => ({
  type: 'paragraph',
  id,
  style: 'body',
  content,
});
const marker = (term: string, more: object = {}) => ({ type: 'indexMarker', term, ...more });
const cell = (id: string, content: object[]) => ({
  content: [paragraph(id, content)],
  colspan: 1,
  rowspan: 1,
});

/**
 * Markers in the text, a footnote, a table's caption and its header row, with a sub-entry, a "see"
 * and a "see also" (the IX plan, IX-O): the default layout places an index, which each walk reads.
 */
const INDEXED = [
  paragraph('ix1', [
    text('Ada tempers the brass.'),
    marker('Alloy'),
    marker('Alloy', { sub: 'tempering' }),
    marker('Brass'),
    marker('Copper', { seeAlso: ['Brass', 'Bronze'] }),
    marker('Latten', { see: 'Brass' }),
    {
      type: 'footnote',
      id: 'ixn',
      anchor: { kind: 'span' },
      content: [paragraph('ixn1', [text('Grace weighed the zinc.'), marker('Zinc')])],
    },
  ]),
  {
    type: 'table',
    id: 'ixt',
    style: 'table',
    caption: [text('Grades of bronze'), marker('Bronze', { sub: 'grades' })],
    headerRows: 1,
    headerColumns: 0,
    rows: [
      { cells: [cell('ixh1', [text('Grade')]), cell('ixh2', [text('Tin'), marker('Tin')])] },
      { cells: [cell('ixr1', [text('First')]), cell('ixr2', [text('Tenth')])] },
    ],
  },
];

interface Case {
  readonly name: string;
  readonly pdf: Buffer;
  readonly html: string;
  readonly view: string;
  readonly tokens: readonly Token[];
}

/** A document of one component, under the default theme, published as a PDF and HTML. */
async function published(
  client: Client,
  name: string,
  content: readonly unknown[],
  tokens: readonly Token[],
  own: { language: string; direction: 'ltr' | 'rtl' } = { language: 'en-GB', direction: 'ltr' },
): Promise<Case> {
  const stamp = new Date().toISOString();
  const component = await makeComponent(client, COMPONENT_TITLE.text, content, own);
  const template = await makeTemplate(client, `HTML walked, ${name} ${stamp}`, DEFAULT_THEME_ID);
  const document = await makeDocument(
    client,
    `HTML walked, ${name} ${stamp}`,
    template,
    HEADINGS.map((each) => each.text),
    component,
  );
  const made = await publishHtml(client, document);
  return { name, pdf: made.pdf, html: made.html.toString('utf8'), view: made.view, tokens };
}

const cases: Case[] = [];

beforeAll(async () => {
  const client = api();
  const image = await uploadImage(client, inject('session'), png(60, 40, [200, 30, 30]));
  const { content, tokens } = styledContent(image);
  cases.push(await published(client, 'every styled kind', content, tokens));
  cases.push(
    await published(
      client,
      'Arabic',
      [
        paragraph('ar1', [
          text(`${ARABIC} `),
          text('Ada', [{ type: 'language', id: 'k1', tag: 'en-GB' }]),
        ]),
      ],
      [],
      { language: 'ar', direction: 'rtl' },
    ),
  );
  cases.push(
    await published(
      client,
      'Hebrew',
      [
        paragraph('he1', [
          text('Grace wrote: '),
          text(HEBREW, [{ type: 'language', id: 'k1', tag: 'he' }]),
        ]),
      ],
      [],
    ),
  );
  cases.push(await published(client, 'an index', INDEXED, []));
  // Not walked for nothing: the layout the stack declares places the index.
  if (!cases.at(-1)!.html.includes('<section aria-labelledby="aw-index">')) {
    throw new Error('The index case published no index');
  }
}, 600_000);

/** The file opened as it was saved, every face it sets loaded. */
async function opened(page: Page, html: string): Promise<void> {
  await page.setContent(html);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('main *')].every((element) => {
      const style = getComputedStyle(element);
      const [first] = style.fontFamily.split(',');
      return document.fonts.check(
        `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${first}`,
      );
    }),
  );
}

/** Whether the page scrolls sideways: wider than its window. */
const scrollsSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

describe('the HTML reading format in pinned Chromium (the HT plan, HT-O)', () => {
  it('PUB-056 holds each case to WCAG 2.2 AA and axe best practice, with no violation', async ({
    task,
  }) => {
    for (const each of cases) {
      await withPage(async (page) => {
        await opened(page, each.html);
        await checkAxe(page, `the HTML of ${each.name}`, task.meta, {
          shows: page.locator('main h1').first(),
          bestPractice: true,
        });
        // And at a phone's width, where a wide block scrolls in its own region.
        await page.setViewportSize({ width: 320, height: 640 });
        await checkAxe(page, `the HTML of ${each.name}, 320 pixels wide`, task.meta, {
          shows: page.locator('main h1').first(),
          bestPractice: true,
        });
      });
    }
  });

  it('PUB-056 reflows each case at 320 CSS pixels wide and with its text at 200%, never scrolling the page sideways', async () => {
    for (const each of cases) {
      await withPage(async (page) => {
        await opened(page, each.html);
        await page.setViewportSize({ width: 320, height: 640 });
        expect(await scrollsSideways(page), `${each.name} at 320 pixels`).toBe(false);
        await page.setViewportSize({ width: 1280, height: 800 });
        // Every size the canvas sets is made against its zoom, so its text at twice its size is this.
        await page.evaluate(() =>
          document.querySelector<HTMLElement>('.aw-canvas')!.style.setProperty('--aw-zoom', '2'),
        );
        const body = await page.evaluate(
          () => getComputedStyle(document.querySelector('main p[data-style]')!).fontSize,
        );
        expect(parseFloat(body), `${each.name}'s text at 200%`).toBeGreaterThan(20);
        expect(await scrollsSideways(page), `${each.name} with its text at 200%`).toBe(false);
      });
    }
  });

  it('PUB-056 marks every passage in another language with its language and its direction, in Arabic and in Hebrew', async () => {
    for (const each of cases) {
      await withPage(async (page) => {
        await opened(page, each.html);
        // Every passage that declares a language says its direction too; an image's and an
        // equation's language is their description's, which has none.
        const undirected = await page.evaluate(() =>
          [...document.querySelectorAll('body [lang]:not(img, math)')]
            .filter((element) => !element.hasAttribute('dir'))
            .map((element) => element.outerHTML.slice(0, 80)),
        );
        expect(undirected, each.name).toEqual([]);
      });
    }
    const [, arabic, hebrew] = cases;
    await withPage(async (page) => {
      await opened(page, arabic!.html);
      const component = page.locator('main section[lang="ar"]').first();
      await expect.poll(() => component.getAttribute('dir')).toBe('rtl');
      expect(await component.evaluate((element) => element.matches(':dir(rtl)'))).toBe(true);
      const english = component.locator('[lang="en-GB"]');
      expect(await english.textContent()).toBe('Ada');
      expect(await english.evaluate((element) => element.matches(':dir(ltr)'))).toBe(true);
    });
    await withPage(async (page) => {
      await opened(page, hebrew!.html);
      const passage = page.locator('main [lang="he"]');
      expect(await passage.textContent()).toBe(HEBREW);
      expect(await passage.evaluate((element) => element.matches(':dir(rtl)'))).toBe(true);
    });
  });

  it("shows the HTML in place through the service's own route, sandboxed so it runs nothing", async () => {
    const [kinds] = cases;
    await withPage(async (page) => {
      const answer = await page.goto(`${SERVICE}${kinds!.view}`);
      expect(answer?.status()).toBe(200);
      expect(answer?.headers()['content-security-policy']).toMatch(/^sandbox; default-src 'none'/);
      await expect.poll(() => page.locator('main h1').first().isVisible()).toBe(true);
      // Sandboxed: the document's origin is opaque, so it reaches no cookie of the service's.
      expect(await page.evaluate(() => window.origin)).toBe('null');
    });
  });

  it('sets the text of every styled kind where the PDF prints it, as the editor does: each length within half a point, every face, weight, posture and colour exactly', async () => {
    const [kinds] = cases;
    const tokens = [...HEADINGS, COMPONENT_TITLE, ...kinds!.tokens];
    const shown = await withPage(async (page) => {
      // Wide enough that the column holds the measure.
      await page.setViewportSize({ width: 1700, height: 1000 });
      await opened(page, kinds!.html);
      const families = Object.fromEntries(
        DEFAULT_THEME.typefaces.map((face) => [faceFamily(face.id), face.family]),
      );
      return measureEditor(
        page,
        tokens.map((each) => each.text),
        families,
        { root: '.aw-canvas', outside: 'header, nav, button' },
      );
    });
    const printed = measurePdf(
      await readPaint(kinds!.pdf),
      tokens.map((each) => each.text),
      72,
    );
    const found = compare(tokens, shown, printed, alignmentOf);
    expect(found.filter((each) => !approved(each, EDITOR_DEVIATIONS))).toEqual([]);
  });
});

/** What a token's line is aligned by in the default theme: a caption's, its role's; else the text's. */
function alignmentOf(token: Token): Alignment {
  const catalogue = DEFAULT_CATALOGUES.paragraph;
  const id = token.where === 'caption' ? DEFAULT_THEME.roles.caption : DEFAULT_THEME.places.text;
  const style = catalogue.styles.find((each) => each.id === id)!;
  const stated = style.properties as Partial<ResolvedParagraphProperties>;
  return (stated.alignment ?? catalogue.base.alignment) as Alignment;
}
