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
