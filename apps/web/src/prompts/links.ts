/** Where the prompts are listed (the G4 plan, G4-A). */
export const PROMPTS = '#/prompts';

/** The address at which a new prompt is written. */
export const NEW_PROMPT = '#/prompts/new';

const PROMPT = /^#\/prompts\/(new|[0-9a-f-]{36})$/;

/** What a `#/prompts/...` address names: a prompt by id, or `new`; null for any other address. */
export function promptAddress(hash: string): string | null {
  return PROMPT.exec(hash)?.[1] ?? null;
}

/** The address of a prompt's own page. */
export function promptLink(prompt: string): string {
  return `#/prompts/${prompt}`;
}

/** Where the environment's prompt libraries are listed (G4-F). */
export const LIBRARIES = '#/prompts/libraries';

const LIBRARY = /^#\/prompts\/libraries\/(new|[0-9a-f-]{36})$/;

/** What a `#/prompts/libraries/...` address names: a library by id, or `new`; null otherwise. */
export function libraryAddress(hash: string): string | null {
  return LIBRARY.exec(hash)?.[1] ?? null;
}

/** The address of a library's own page. */
export function libraryLink(library: string): string {
  return `#/prompts/libraries/${library}`;
}
