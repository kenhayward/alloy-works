/** Where a space's bibliography is listed (the CI plan, CI-B). */
export const BIBLIOGRAPHY = '#/bibliography';

const ENTRY = /^#\/bibliography\/([0-9a-f-]{36})$/;

/** What a `#/bibliography/...` address names: an entry by id; null for any other address. */
export function entryAddress(hash: string): string | null {
  return ENTRY.exec(hash)?.[1] ?? null;
}

/** The address of an entry's own page. */
export function entryLink(entry: string): string {
  return `#/bibliography/${entry}`;
}
