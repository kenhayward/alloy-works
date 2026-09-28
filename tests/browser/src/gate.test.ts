import { describe, expect, it } from 'vitest';
import { allowPageNoise, withPage } from './testing/page.js';

/**
 * The page's console, gated as the jsdom suite's is (the W13 plan's B-H): an error, a warning or an
 * uncaught exception in the page fails the test that caused it, naming what was said.
 */
describe('the page console gate', () => {
  it('fails a test whose page logs an error, naming it', async () => {
    await expect(
      withPage(async (page) => {
        await page.setContent('<script>console.error("the page broke")</script>');
      }),
    ).rejects.toThrow(/console\.error: the page broke/);
  });

  it('fails a test whose page logs a warning, naming it', async () => {
    await expect(
      withPage(async (page) => {
        await page.setContent('<script>console.warn("the page is unsure")</script>');
      }),
    ).rejects.toThrow(/console\.warning: the page is unsure/);
  });

  it('fails a test whose page throws and nothing catches it, naming it', async () => {
    await expect(
      withPage(async (page) => {
        await page.setContent('<script>throw new Error("nobody caught this")</script>');
      }),
    ).rejects.toThrow(/uncaught: nobody caught this/);
  });

  it('lets a test that provokes noise on purpose say which', async () => {
    allowPageNoise(/on purpose/);
    await withPage(async (page) => {
      await page.setContent('<script>console.error("on purpose")</script>');
    });
  });

  it('still fails a test that allowed some noise on any other console error, naming it', async () => {
    allowPageNoise(/on purpose/);
    await expect(
      withPage(async (page) => {
        await page.setContent(
          '<script>console.error("on purpose"); console.error("by accident")</script>',
        );
      }),
    ).rejects.toThrow(/not quiet[\s\S]*console\.error: by accident/);
  });

  it('still fails a test that allowed some noise on an uncaught exception, naming it', async () => {
    allowPageNoise(/on purpose/);
    await expect(
      withPage(async (page) => {
        await page.setContent(
          '<script>console.error("on purpose"); throw new Error("nobody caught this")</script>',
        );
      }),
    ).rejects.toThrow(/uncaught: nobody caught this/);
  });

  it('re-arms for the next test', async () => {
    await expect(
      withPage(async (page) => {
        await page.setContent('<script>console.error("not on purpose")</script>');
      }),
    ).rejects.toThrow(/console\.error: not on purpose/);
  });

  it('passes a quiet page', async () => {
    await withPage(async (page) => {
      await page.setContent('<p>Nothing to say.</p>');
      expect(await page.textContent('p')).toBe('Nothing to say.');
    });
  });
});
