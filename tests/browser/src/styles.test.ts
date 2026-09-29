import { writeFileSync } from 'node:fs';
import { DEFAULT_THEME_ID } from '@alloy-works/db';
import {
  DEFAULT_CATALOGUES,
  DEFAULT_THEME,
  faceFamily,
  type ResolvedParagraphProperties,
} from '@alloy-works/domain';
import { describe, expect, inject, it } from 'vitest';
import { api, type Client, type DocumentView } from './testing/api.js';
import { SERVICE } from './testing/addresses.js';
import {
  approved,
  compare,
  compareImages,
  compareMarkers,
  compareMathsFace,
  compareRules,
  type Alignment,
  type Difference,
  type Largest,
} from './testing/compare.js';
import {
  makeComponent,
  makeDocument,
  makeTemplate,
  png,
  publishPdf,
  uploadImage,
} from './testing/fixtures.js';
import {
  editorImages,
  editorMarkers,
  editorMathsFace,
  editorRules,
  measureEditor,
  measurePdf,
  pdfImages,
  pdfMarkers,
  pdfMathsFace,
  pdfRules,
} from './testing/measure.js';
import { withPage } from './testing/page.js';
import { readPaint } from './testing/pdf.js';
import { writeTheme, type ThemeToWrite } from './testing/store.js';
import { COMPONENT_TITLE, HEADINGS, IMAGES, styledContent, type Token } from './testing/styled.js';
import { contraryTheme, generatedTheme } from './testing/themes.js';

/**
 * **The editor measured against the PDF** (the W13 plan's W13.4 and B-M; ADR-0014's method), for
 * STY-080, which it answers since issues #331 - the step into a line held open by something taller or
 * deeper than its text - and #333 - where the document view stands a section's heading - were fixed
 * and their steps and starts compared. One component holding a token at the head of every block and run the theme styles (`styled.ts`) is
 * placed in a document under each of five themes - the default, one differing from it in every
 * property the editor projects, and three generated from seeds - and each document is published
 * through the stack and read in the document view's Reading mode, which CNT-075 holds the same as the
 * editing surface. Each token is measured in both (`measure.ts`) and compared (`compare.ts`): every
 * length within half a point, and every face, weight, posture, colour, underline and fill exactly.
 */

declare module 'vitest' {
  interface TaskMeta {
    /** The generated themes' seeds, and the largest difference each property showed, and where. */
    measuredStyle?: {
      seeds: readonly number[];
      largest: Record<string, { by: number; theme: string }>;
    };
  }
}

/** The three seeds the generated themes are made from; another set can be tried by the variable. */
const SEEDS = (process.env.ALLOY_BROWSER_STYLE_SEEDS ?? '1301,1302,1303')
  .split(',')
  .map((each) => Number(each.trim()));

/** The default layout's margin, inside and outside alike: where the measure starts on every page. */
const MARGIN = 72;

interface Measured {
  readonly theme: string;
  readonly differences: readonly Difference[];
}

/** The fixture's tokens, the headings' first. */
function everyToken(tokens: readonly Token[]): Token[] {
  return [...HEADINGS, COMPONENT_TITLE, ...tokens];
}

/**
 * What a token's line is aligned by: a caption's, its role's style; the line holding an equation, the
 * text's default, which that paragraph is in. A style states its alignment or takes its catalogue's.
 */
function alignmentOf(write: ThemeToWrite | null): (token: Token) => Alignment {
  const catalogue = write?.catalogues.paragraph ?? DEFAULT_CATALOGUES.paragraph;
  const theme = write?.theme ?? DEFAULT_THEME;
  const of = (id: string) => {
    const style = catalogue.styles.find((each) => each.id === id)!;
    const stated = style.properties as Partial<ResolvedParagraphProperties>;
    return (stated.alignment ?? catalogue.base.alignment) as Alignment;
  };
  return (token) => of(token.where === 'caption' ? theme.roles.caption : theme.places.text);
}

/**
 * Opens the document in the document view's Reading mode, at the printed size, and waits for it to be
 * drawn whole before anything is measured: the page's own title the document's, the page in Reading,
 * the canvas in the document's theme at 100%, every token in it, every image loaded and sized by its
 * style, and every face its text is set in loaded - a measurement taken earlier would read the screen
 * before, or half this one, and could agree with the PDF by chance.
 */
async function measureView(
  opened: DocumentView,
  tokens: readonly Token[],
): Promise<{
  shown: Awaited<ReturnType<typeof measureEditor>>;
  images: Awaited<ReturnType<typeof editorImages>>;
  rules: Awaited<ReturnType<typeof editorRules>>;
  maths: string | undefined;
  markers: Awaited<ReturnType<typeof editorMarkers>>;
}> {
  return withPage(async (page) => {
    // Wide enough that the column holds the measure without scrolling it sideways.
    await page.setViewportSize({ width: 1700, height: 1000 });
    await page.goto(`${SERVICE}/#/documents/${opened.id}`);
    const title = (opened.outline as { title?: string }).title;
    expect(title).toMatch(/^Measured style, /);
    await expect.poll(() => page.locator('#document-title').textContent()).toBe(title);
    await page.getByRole('radio', { name: 'Reading' }).click();
    await expect.poll(() => page.locator('#document-mode').textContent()).toBe('in Reading');
    const canvas = page.locator('section.aw-canvas');
    // The printed size: at any other zoom every length is scaled, and measured as that.
    await expect
      .poll(() => canvas.evaluate((element) => element.style.getPropertyValue('--aw-zoom')))
      .toBe('1');
    await page.waitForFunction(
      ({ words, labels }) => {
        const text = document.querySelector<HTMLElement>('section.aw-canvas');
        if (!text) return false;
        // As drawn, a block's words apart from the next block's, as `textContent` would not keep them.
        const shown = new Set(text.innerText.split(/\s+/));
        if (!words.every((word) => shown.has(word))) return false;
        if (!labels.every((label) => text.querySelector(`pre[data-language="${label}"]`))) {
          return false;
        }
        // Every image loaded, and sized by its style: `useStyledImages` sets each one's width.
        const images = [...text.querySelectorAll('img')];
        if (
          !images.every((image) => image.complete && image.naturalWidth > 0 && image.style.width)
        ) {
          return false;
        }
        // And every face the text is set in, loaded: asked of each styled element's own font.
        return [
          ...text.querySelectorAll('[data-style], [data-role], code, [class*="aw-mark-"]'),
        ].every((element) => {
          const style = getComputedStyle(element);
          return document.fonts.check(
            `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
          );
        });
      },
      {
        words: tokens.filter((each) => each.where !== 'label').map((each) => each.text),
        labels: tokens.filter((each) => each.where === 'label').map((each) => each.text),
      },
      { timeout: 30_000 },
    );
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const families = Object.fromEntries(
      DEFAULT_THEME.typefaces.map((face) => [faceFamily(face.id), face.family]),
    );
    const shown = await measureEditor(
      page,
      tokens.map((each) => each.text),
      families,
    );
    return {
      shown,
      images: await editorImages(page),
      rules: await editorRules(
        page,
        tokens.filter((each) => each.where === 'cell').map((each) => each.text),
        shown,
      ),
      maths: await editorMathsFace(page, families),
      markers: await editorMarkers(
        page,
        tokens.filter((each) => each.where === 'list').map((each) => each.text),
        families,
      ),
    };
  });
}

async function measureTheme(
  client: Client,
  name: string,
  themeId: string,
  write: ThemeToWrite | null,
  component: string,
  tokens: readonly Token[],
  largest: Largest,
): Promise<Measured> {
  const stamp = new Date().toISOString();
  const template = await makeTemplate(client, `Measured style, ${name} ${stamp}`, themeId);
  const document = await makeDocument(
    client,
    `Measured style, ${name} ${stamp}`,
    template,
    HEADINGS.map((each) => each.text),
    component,
  );
  const paint = await readPaint(await publishPdf(client, document));
  const all = everyToken(tokens);
  const printed = measurePdf(
    paint,
    all.map((each) => each.text),
    MARGIN,
  );
  const { shown, images, rules, maths, markers } = await measureView(document, all);
  const listed = all.filter((each) => each.where === 'list').map((each) => each.text);
  const cells = all.filter((each) => each.where === 'cell').map((each) => each.text);
  if (process.env.ALLOY_BROWSER_STYLE_DUMP) {
    writeFileSync(
      `${process.env.ALLOY_BROWSER_STYLE_DUMP}/${name.replace(/\W+/g, '-')}.json`,
      JSON.stringify(
        all.map((each) => ({
          token: each.text,
          editor: shown.get(each.text),
          pdf: printed.get(each.text),
        })),
        null,
        1,
      ),
    );
  }
  const alignment = alignmentOf(write);
  return {
    theme: name,
    differences: [
      ...compare(all, shown, printed, alignment, (property, by) => largest(name, property, by)),
      ...compareImages(IMAGES, images, pdfImages(paint, MARGIN), shown, printed, (property, by) =>
        largest(name, property, by),
      ),
      ...compareMarkers(all, markers, pdfMarkers(paint, listed, printed, MARGIN), (property, by) =>
        largest(name, property, by),
      ),
      ...compareMathsFace(
        'Ze1',
        maths,
        printed.get('Ze1') && pdfMathsFace(paint, printed.get('Ze1')!, MARGIN),
      ),
      ...compareRules(
        all,
        rules,
        pdfRules(paint, cells, printed, rules, MARGIN),
        shown,
        printed,
        (property, by) => largest(name, property, by),
      ),
    ],
  };
}

describe('the editor measured against the PDF', () => {
  it('STY-080 sets what it measures where the PDF prints it, under the default, a contrary and three generated themes: each length within half a point, and each face, weight, posture, colour, underline and fill exactly', async ({
    task,
  }) => {
    const client = api();
    const image = await uploadImage(client, inject('session'), png(60, 40, [200, 30, 30]));
    const { content, tokens } = styledContent(image);
    const component = await makeComponent(client, COMPONENT_TITLE.text, content);

    const contrary = contraryTheme();
    const generated = SEEDS.map((seed, index) => generatedTheme(index + 1, seed));
    const themes: { name: string; id: string; write: ThemeToWrite | null }[] = [
      { name: 'Default', id: DEFAULT_THEME_ID, write: null },
      ...[contrary, ...generated].map((each) => ({
        name: each.name,
        id: each.artifacts.theme,
        write: each.write,
      })),
    ];
    for (const each of [contrary, ...generated]) await writeTheme(each.artifacts, each.write);

    // The largest difference found for each property, over every theme, for the record.
    const most = new Map<string, { by: number; theme: string }>();
    const largest: Largest = (theme, property, by) => {
      const kind = property.replace(/ from .*$/, '');
      if ((most.get(kind)?.by ?? -1) < by)
        most.set(kind, { by: Math.round(by * 100) / 100, theme });
    };
    const measured: Measured[] = [];
    for (const theme of themes) {
      measured.push(
        await measureTheme(client, theme.name, theme.id, theme.write, component, tokens, largest),
      );
    }

    task.meta.measuredStyle = { seeds: SEEDS, largest: Object.fromEntries(most) };
    const found = measured.flatMap(({ theme, differences }) =>
      differences.map((each) => ({ theme, ...each })),
    );
    if (process.env.ALLOY_BROWSER_STYLE_DUMP) {
      writeFileSync(
        `${process.env.ALLOY_BROWSER_STYLE_DUMP}/found.json`,
        JSON.stringify({ largest: Object.fromEntries(most), found }, null, 1),
      );
    }
    // Approved deviations pass (STY-060), and none is approved between the editor and the PDF.
    expect(found.filter((each) => !approved(each))).toEqual([]);
  }, 900_000);
});
