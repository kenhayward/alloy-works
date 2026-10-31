import { describe, expect, it } from 'vitest';
import { withPage } from './testing/page.js';
import { unlocalised } from './testing/words.js';

/**
 * What the pseudo walk calls cut short (`unlocalised`), each over a page of its own, so nothing here
 * depends on what the product draws. Every word is bracketed, as a pseudo-locale marks it.
 */
function page(body: string): string {
  return `<!doctype html><html lang="en-XA"><head><title>A page</title></head><body><main>${body}</main></body></html>`;
}

describe("the pseudo walk's words cut short", () => {
  it('LOC-029 finds words cut short by an ancestor that hides what overflows it, not one that scrolls, nor words hidden for a screen reader', async () => {
    await withPage(async (tab) => {
      await tab.setContent(
        page(
          '<div style="width: 60px; overflow: hidden"><span style="white-space: nowrap">[Welcome to the workspace]</span></div>' +
            '<div style="width: 60px; overflow: auto"><span style="white-space: nowrap">[Scroll to see the rest]</span></div>' +
            '<div style="position: absolute; width: 1px; height: 1px; overflow: hidden"><span style="white-space: nowrap">[Read aloud only]</span></div>' +
            '<div style="width: 400px; overflow: hidden"><span>[Whole]</span></div>',
        ),
      );
      const found = await unlocalised(tab, ['main']);
      expect(found.clipped).toEqual(['[Welcome to the workspace]']);
    });
  });
});
