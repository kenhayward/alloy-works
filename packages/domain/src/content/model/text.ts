/**
 * Whether a title has any text once whitespace is trimmed away - the one rule every title is held to.
 * `titleAccepted` in `packages/editor` is this function, re-exported beside the command it gates, and a
 * section title in an outline is held to it over its text runs (`structure/outline.ts`), so the
 * renderer, the editor and the store cannot disagree about what a blank title is.
 */
export const hasText = (text: string): boolean => text.trim() !== '';
