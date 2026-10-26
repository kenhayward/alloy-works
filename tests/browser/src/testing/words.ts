import { makeWords, type WordKey } from '../../../../apps/web/src/words/make.js';
import type { Page } from 'playwright-core';
import { API } from './addresses.js';

/**
 * **What the interface says, in a language** (the UI plan, UI-J): a catalogue message as a run in
 * that language shows it, so a walk in a pseudo-locale finds what it finds in English.
 */
export const say = (
  language: string,
  key: WordKey,
  values?: Record<string, string | number>,
): string => makeWords(language).words(key, values);

/** Chooses `language` for whoever `cookie` signs in, through the person's own preferences. */
export async function chooseLanguage(cookie: string, language: string | null): Promise<void> {
  const answer = await fetch(`${API}/v1/me/preferences`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ interfaceLanguage: language }),
  });
  if (!answer.ok) throw new Error(`choosing ${language} answered ${answer.status}`);
}

/** What a page shows that a pseudo-locale should have made over, and what it cut short or spilled. */
export interface Unlocalised {
  /** Visible interface text with no pseudo brackets: a word left in English. */
  readonly missed: readonly string[];
  /** Interface words cut short where they stand. */
  readonly clipped: readonly string[];
  /** What stands past the window's edge, so the page scrolls sideways: each element and its words. */
  readonly spills: readonly string[];
}

/**
 * The interface words in `regions` a pseudo-locale left in English or cut short (UI-J; LOC-042,
 * LOC-029). Text marked `data-content` is a person's content, never the interface's, and may be cut
 * by design; numbers and punctuation say nothing in a language.
 */
export function unlocalised(page: Page, regions: readonly string[]): Promise<Unlocalised> {
  return page.evaluate((selectors) => {
    const missed: string[] = [];
    const clipped: string[] = [];
    const content = (node: Node) => node.parentElement?.closest('[data-content]') !== null;
    for (const selector of selectors) {
      for (const region of document.querySelectorAll(selector)) {
        const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const text = node.textContent ?? '';
          if (!/[A-Za-z]{2,}/.test(text) || content(node)) continue;
          const element = node.parentElement!;
          const style = getComputedStyle(element);
          if (style.visibility === 'hidden' || style.display === 'none') continue;
          if (element.getClientRects().length === 0) continue;
          if (!/[[\]]/.test(text)) missed.push(text.trim());
          const cuts =
            style.overflowX === 'hidden' ||
            style.overflowX === 'clip' ||
            style.textOverflow === 'ellipsis';
          if (cuts && element.scrollWidth > element.clientWidth + 1) clipped.push(text.trim());
        }
      }
    }
    return {
      missed,
      clipped,
      spills:
        document.documentElement.scrollWidth > window.innerWidth + 1
          ? [...document.querySelectorAll('body *')]
              .filter((each) => {
                const box = each.getBoundingClientRect();
                return box.width > 0 && (box.right > window.innerWidth + 1 || box.left < -1);
              })
              .filter(
                (each) =>
                  ![...each.children].some((child) => {
                    const box = child.getBoundingClientRect();
                    return box.right > window.innerWidth + 1 || box.left < -1;
                  }),
              )
              .map(
                (each) =>
                  `${each.tagName.toLowerCase()}.${each.className}: ${(each.textContent ?? '').trim().slice(0, 60)}`,
              )
          : [],
    };
  }, regions);
}
