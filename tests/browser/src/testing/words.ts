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
  /**
   * Two visible text leaves in one layer whose boxes cross by more than a pixel, neither holding the
   * other: each pair's words (the TE plan, TE-G; LOC-029).
   */
  readonly overlaps: readonly string[];
}

/**
 * The interface words in `regions` a pseudo-locale left in English or cut short (UI-J; LOC-042,
 * LOC-029). Text marked `data-content` is a person's content, never the interface's, and may be cut
 * by design; so is a field's value, and a `<time>`, which the locale's own data formats. Numbers and
 * punctuation say nothing in a language.
 *
 * Overlap is measured on every visible text leaf, content too, each box clipped to what its scrolling
 * ancestors show. A layer above its page (a dialog, a menu, a popover) is measured on its own, never
 * against the page beneath it. An overlap meant by design is marked `data-overlaps="<why>"` in the
 * renderer; the threshold stays one pixel.
 */
export function unlocalised(page: Page, regions: readonly string[]): Promise<Unlocalised> {
  return page.evaluate((selectors) => {
    const missed: string[] = [];
    const clipped: string[] = [];
    const overlaps: string[] = [];
    // A person's content, a field's value, and a date or time the locale's own data formats.
    const content = (node: Node) =>
      node.parentElement?.closest('[data-content], textarea, time') !== null;
    const LAYER =
      '[role="dialog"], [role="menu"], [role="listbox"], [role="tooltip"], [popover], [role="alertdialog"]';
    type Box = { left: number; top: number; right: number; bottom: number };
    /** What of `box` its ancestors that clip let show, or null where nothing does. */
    const shown = (element: Element, box: Box): Box | null => {
      let seen = box;
      for (let at: Element | null = element; at !== null; at = at.parentElement) {
        const style = getComputedStyle(at);
        if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
        const edge = at.getBoundingClientRect();
        seen = {
          left: Math.max(seen.left, edge.left),
          top: Math.max(seen.top, edge.top),
          right: Math.min(seen.right, edge.right),
          bottom: Math.min(seen.bottom, edge.bottom),
        };
        if (seen.right - seen.left <= 1 || seen.bottom - seen.top <= 1) return null;
      }
      return seen;
    };
    const holds = (outer: Box, inner: Box) =>
      outer.left <= inner.left + 0.5 &&
      outer.top <= inner.top + 0.5 &&
      outer.right >= inner.right - 0.5 &&
      outer.bottom >= inner.bottom - 0.5;
    const crosses = (a: Box, b: Box) =>
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    for (const selector of selectors) {
      for (const region of document.querySelectorAll(selector)) {
        const leaves: { text: string; layer: Element; lines: Box[]; whole: Box }[] = [];
        const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const text = node.textContent ?? '';
          const owner = node.parentElement;
          // A closed list's options stand where it does, one over another, and are never seen so.
          if (/\S/.test(text) && owner && !owner.closest('[data-overlaps], select, textarea')) {
            const style = getComputedStyle(owner);
            const range = document.createRange();
            range.selectNodeContents(node);
            const lines = [...range.getClientRects()]
              .map((line) => shown(owner, line))
              .filter((line): line is Box => line !== null);
            if (style.visibility !== 'hidden' && Number(style.opacity) > 0 && lines.length > 0) {
              leaves.push({
                text: text.trim().slice(0, 40),
                layer: owner.closest(LAYER) ?? region,
                lines,
                whole: {
                  left: Math.min(...lines.map((line) => line.left)),
                  top: Math.min(...lines.map((line) => line.top)),
                  right: Math.max(...lines.map((line) => line.right)),
                  bottom: Math.max(...lines.map((line) => line.bottom)),
                },
              });
            }
          }
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
          if (cuts && element.scrollWidth > element.clientWidth + 1) {
            clipped.push(text.trim());
            continue;
          }
          // Cut by an ancestor that hides what overflows it, not one that scrolls (LOC-029). One a
          // pixel wide hides its words from sight on purpose, for a screen reader alone.
          const range = document.createRange();
          range.selectNodeContents(node);
          const words = [...range.getClientRects()].filter((line) => line.width > 0);
          for (let at = element.parentElement; at !== null && region.contains(at); at = at.parentElement) {
            const hides = getComputedStyle(at);
            if (hides.overflowX !== 'hidden' && hides.overflowX !== 'clip') continue;
            const edge = at.getBoundingClientRect();
            if (edge.width <= 1 || edge.height <= 1) break;
            if (words.some((line) => line.right > edge.right + 1 || line.left < edge.left - 1)) {
              clipped.push(text.trim());
              break;
            }
          }
        }
        leaves.forEach((one, at) => {
          for (const other of leaves.slice(at + 1)) {
            if (one.layer !== other.layer) continue;
            if (holds(one.whole, other.whole) || holds(other.whole, one.whole)) continue;
            if (one.lines.some((line) => other.lines.some((each) => crosses(line, each))))
              overlaps.push(`"${one.text}" over "${other.text}"`);
          }
        });
      }
    }
    return {
      missed,
      clipped,
      overlaps,
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
