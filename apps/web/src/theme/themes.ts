/**
 * The themes the interface can be shown in, each a `[data-theme]` block of colour tokens in
 * tokens.css. Light is the only one; a second is a new name here and a new block there, and
 * colours.test.ts fails the build if the two lists disagree or a block misses a token.
 */
export const THEMES = ['light'] as const;

export type ThemeName = (typeof THEMES)[number];

/** Shows the interface in a theme, by naming it on the root element the tokens are scoped to. */
export function applyTheme(name: ThemeName, root: HTMLElement = document.documentElement): void {
  root.dataset['theme'] = name;
}
