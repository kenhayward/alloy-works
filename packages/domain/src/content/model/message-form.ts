import { pluralCategory, type PluralCategory } from '../../interface/plurals.js';

import { EXACT_ARMS, type MessageArmKey, type MessageFormNode } from './inline.js';

/** A canonical decimal with its trailing fractional zeros dropped: `1.50` is `1.5`, `2.00` is `2`. */
const numerically = (value: string): string =>
  value.includes('.') ? value.replace(/0+$/u, '').replace(/\.$/u, '') : value;

/**
 * **The arm a value selects** (the MF plan, MF-A, MF-B): an exact arm where the value equals it
 * numerically, so `1.00` meets `=1`, before any category; else the category the language's CLDR rules
 * give the value at its column's scale - or that category, missing, where the form has no arm for it.
 * One function for the publish and the editor, so the two cannot select differently.
 */
export function armFor(
  arms: MessageFormNode['arms'],
  value: string,
  scale: number,
  language: string,
): { readonly arm: MessageArmKey } | { readonly missing: PluralCategory } {
  const exact = `=${numerically(value)}`;
  if ((EXACT_ARMS as readonly string[]).includes(exact) && arms[exact as MessageArmKey]) {
    return { arm: exact as MessageArmKey };
  }
  const category = pluralCategory(language, value, scale);
  return arms[category] === undefined ? { missing: category } : { arm: category };
}
