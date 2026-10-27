import { formats } from '../words/words.js';

/**
 * An arrow key as the interface's direction reads it (the UI plan, UI-G; LOC-004): right to left,
 * ArrowLeft goes on and ArrowRight goes back, so a handler written left to right reads
 * `inlineKey(event.key)` and needs no other change. Every other key is itself.
 */
export function inlineKey(key: string): string {
  if (formats().language.direction === 'ltr') return key;
  return key === 'ArrowLeft' ? 'ArrowRight' : key === 'ArrowRight' ? 'ArrowLeft' : key;
}

/** Which way the inline axis runs on the screen: 1 left to right, -1 right to left (UI-G). */
export const inlineSign = (): 1 | -1 => (formats().language.direction === 'rtl' ? -1 : 1);
