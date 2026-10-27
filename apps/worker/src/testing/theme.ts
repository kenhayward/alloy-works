import {
  DEFAULT_CATALOGUES_BY_VERSION,
  DEFAULT_THEME,
  readTheme,
  type ResolvedTheme,
} from '@alloy-works/domain';

/**
 * The product's default theme, read as the store reads the seeded one (themes 1, ruling R4): what a
 * test hands `assemble` for a document under a layout, as `publicationInputs` hands the job the theme a
 * request was made under. Read once, through the one reader, so a test never sets a document from a
 * theme the store would refuse. As it stands, at its 0.11 (`default.ts` in the domain says what each
 * version added).
 */
export const defaultTheme: ResolvedTheme = (() => {
  const read = readTheme(DEFAULT_THEME, DEFAULT_CATALOGUES_BY_VERSION);
  if (!read.ok) throw new Error(read.refusals.map((each) => each.message).join('\n'));
  return read.theme;
})();

/**
 * The default theme, which since its 0.11 declares Noto Naskh Arabic and has the serif fall back to it
 * (UF-H): kept as its own name so a test that sets Arabic says so.
 */
export const naskhTheme: ResolvedTheme = defaultTheme;
