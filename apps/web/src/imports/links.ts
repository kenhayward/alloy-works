const IMPORT = /^#\/imports\/([0-9a-f-]{36})$/;

/** What a `#/imports/...` address names: an import by id; null for any other address. */
export function importAddress(hash: string): string | null {
  return IMPORT.exec(hash)?.[1] ?? null;
}

/** The address of an import's own page (the IM plan). */
export function importLink(id: string): string {
  return `#/imports/${id}`;
}
