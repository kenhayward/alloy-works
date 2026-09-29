import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { COMPONENT_TITLE, HEADINGS, IMAGES, styledContent } from './styled.js';
import {
  contraryTheme,
  EDITOR_SEEDS,
  generatedTheme,
  readMeasuredTheme,
  styleSeeds,
  WORD_SEEDS,
  type ThemeContent,
} from './themes.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** A theme's content with where each figure is placed taken out, which is all the Word mode may move. */
const unplaced = (content: ThemeContent) => ({
  ...content,
  catalogues: {
    ...content.catalogues,
    image: {
      ...content.catalogues.image,
      styles: content.catalogues.image.styles.map(({ placement: _, ...rest }) => rest),
    },
  },
});

const figurePlacements = (content: ThemeContent) =>
  content.catalogues.image.styles
    .filter((style) => style.placement !== 'inline')
    .map((style) => style.placement);

describe('the kit the editor and Word are measured by (the W15 plan, W15-C and W15-F)', () => {
  // Taken from `tests/browser/src/testing/` before the move, by the same hash: the browser suite
  // measures the same fixture under the same themes as it did.
  it("keeps W13.4's fixture and its themes exactly as they were before the move", () => {
    expect(
      hash({
        made: styledContent('00000000-0000-4000-8000-000000000001'),
        HEADINGS,
        COMPONENT_TITLE,
        IMAGES,
      }),
    ).toBe('5a2dc743d924f2929331590cb21d789b7ad761a1648dd8c77c66146c0472e25a');
    expect(hash(contraryTheme().content)).toBe(
      '6178a004581e3be10a3f936bfa497f2e50d244bafcfd307b7eb82378ad52078c',
    );
    // W13.4's own seeds, whatever ALLOY_BROWSER_STYLE_SEEDS asks the suites to measure.
    expect(
      [1301, 1302, 1303].map((seed, index) => hash(generatedTheme(index + 1, seed).content)),
    ).toEqual([
      '1acbcfa112b768b67d70aaa61f5fbdc0867865045b205946c21df781852749a7',
      '34aac17edff46d056344deae20e3653237e9e10207333350057ae9c071d6e42d',
      '2e7d9e1f6c481ae3ba733b09916489c34cab82e2da36e998f0c19d2fd42434f2',
    ]);
  });

  it("reads the seeds the editor is measured under from ALLOY_BROWSER_STYLE_SEEDS, W13.4's three where it is not set", () => {
    expect(EDITOR_SEEDS).toEqual(styleSeeds(process.env.ALLOY_BROWSER_STYLE_SEEDS));
    expect(styleSeeds(undefined)).toEqual([1301, 1302, 1303]);
    expect(styleSeeds('11, 22,33')).toEqual([11, 22, 33]);
  });

  it('generates a theme for Word that may float a figure and differs from the same seed for the editor in nothing else', () => {
    expect(WORD_SEEDS).toEqual([1501, 1502, 1503]);
    const seeds = [...EDITOR_SEEDS, ...WORD_SEEDS];
    for (const [index, seed] of seeds.entries()) {
      const editor = generatedTheme(index + 1, seed).content;
      const word = generatedTheme(index + 1, seed, { forWord: true }).content;
      expect(figurePlacements(editor).every((placement) => placement === 'block')).toBe(true);
      expect(unplaced(word)).toEqual(unplaced(editor));
    }
    const floated = WORD_SEEDS.flatMap((seed, index) =>
      figurePlacements(generatedTheme(index + 6, seed, { forWord: true }).content),
    );
    expect(floated).toContain('float');
    expect(floated).toContain('block');
  });

  it('makes every theme it measures one the theme reader accepts, as the store and a publish read it', () => {
    const themes = [
      contraryTheme(),
      ...EDITOR_SEEDS.map((seed, index) => generatedTheme(index + 1, seed)),
      ...WORD_SEEDS.map((seed, index) => generatedTheme(index + 6, seed, { forWord: true })),
    ];
    for (const { name, content } of themes) {
      const read = readMeasuredTheme(content);
      expect(read.name).toBe(name);
      expect(read.paragraphStyles.size).toBeGreaterThan(0);
    }
  });

  it('throws on a theme the reader refuses, naming it, rather than measuring it', () => {
    const { content } = contraryTheme();
    const [first, ...rest] = content.catalogues.paragraph.styles;
    const broken: ThemeContent = {
      theme: { ...content.theme, name: 'Broken' },
      catalogues: {
        ...content.catalogues,
        paragraph: {
          ...content.catalogues.paragraph,
          styles: [{ ...first!, properties: { ...first!.properties, size: -1 } }, ...rest],
        },
      },
    };
    expect(() => readMeasuredTheme(broken)).toThrow(/^Broken does not read: /);
  });
});
