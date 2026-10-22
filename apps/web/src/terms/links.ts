/** Where a space's terms are listed (the TM plan, TM-A). */
export const TERMS = '#/terms';

const TERM = /^#\/terms\/([0-9a-f-]{36})$/;

/** What a `#/terms/...` address names: a term by id; null for any other address. */
export function termAddress(hash: string): string | null {
  return TERM.exec(hash)?.[1] ?? null;
}

/** The address of a term's own page. */
export function termLink(term: string): string {
  return `#/terms/${term}`;
}
