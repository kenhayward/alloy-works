import { describe, expect, it } from 'vitest';
import { checkAxe } from './testing/axe.js';
import { withPage } from './testing/page.js';

/**
 * The allow-list `checkAxe` compares axe's violations with, held exact (the W13 plan's B-I): a
 * violation not on it fails, one on it passes only in the state it names, and one on it that axe no
 * longer finds fails until it is taken off. What axe cannot decide goes into the test's `meta`, and is
 * never failed on. Each over a page of its own, so nothing here depends on what the product draws.
 */

/** A page that is otherwise whole - a language, a title, a main landmark and a heading - around `body`. */
function page(body: string): string {
  return `<!doctype html><html lang="en"><head><title>A page</title></head><body><main><h1>A page</h1>${body}</main></body></html>`;
}

/** An image with no alternative: axe's `image-alt`, a WCAG 2.0 A violation, on `img`. */
const NO_ALTERNATIVE = page('<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">');

/** Text over a gradient, whose contrast axe cannot measure and hands to a person. */
const UNDECIDED = page(
  '<p style="background-image: linear-gradient(#ffffff, #000000); color: #808080">Words over a gradient</p>',
);

const QUIET = page('<p>Nothing wrong here.</p>');

describe("checkAxe's allow-list", () => {
  it('fails a violation the allow-list does not hold, naming its rule, its element and what axe measured', async ({
    task,
  }) => {
    await withPage(async (tab) => {
      await tab.setContent(NO_ALTERNATIVE);
      await expect(checkAxe(tab, 'a page', task.meta, { allowed: [] })).rejects.toThrow(
        /in a page:\nviolations not on the allow-list:\nimage-alt at img\n[\s\S]*<img src=/,
      );
    });
  });

  it('passes a violation the allow-list holds, in the state it names and no other', async ({
    task,
  }) => {
    const allowed = [{ state: 'a page', rule: 'image-alt', target: 'img', issue: 1 }];
    await withPage(async (tab) => {
      await tab.setContent(NO_ALTERNATIVE);
      await checkAxe(tab, 'a page', task.meta, { allowed });
      await expect(checkAxe(tab, 'another page', task.meta, { allowed })).rejects.toThrow(
        /violations not on the allow-list:\nimage-alt at img/,
      );
    });
  });

  it('fails an allowed violation axe no longer finds, until it is taken off', async ({ task }) => {
    const allowed = [{ state: 'a page', rule: 'image-alt', target: 'img', issue: 1 }];
    await withPage(async (tab) => {
      await tab.setContent(QUIET);
      await expect(checkAxe(tab, 'a page', task.meta, { allowed })).rejects.toThrow(
        /allowed, and no longer found - take them off:\nimage-alt at img/,
      );
    });
  });

  it("writes what axe could not decide into the test's meta, and passes", async ({ task }) => {
    await withPage(async (tab) => {
      await tab.setContent(UNDECIDED);
      await checkAxe(tab, 'a gradient', task.meta, { allowed: [] });
    });
    expect(task.meta.axe?.engine).toBe('4.13.0');
    expect(task.meta.axe?.incomplete['a gradient']).toContainEqual({
      state: 'a gradient',
      rule: 'color-contrast',
      target: 'p',
    });
  });
});
