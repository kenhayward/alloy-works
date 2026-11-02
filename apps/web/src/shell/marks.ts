import type { ThemeName } from '../theme/themes.js';

/** The mark for each theme's ground, served beside the page from `public/`; CSS shows the one that fits. */
export const MARKS: Record<ThemeName, string> = {
  light: 'mark-light.svg',
  dark: 'mark-dark.svg',
};
