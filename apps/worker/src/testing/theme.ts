import {
  FIRST_DEFAULT_CATALOGUES_BY_VERSION,
  FIRST_DEFAULT_THEME,
  readTheme,
  type ResolvedTheme,
} from '@alloy-works/domain';

/**
 * The product's default theme, read as the store reads the seeded one (themes 1, ruling R4): what a
 * test hands `assemble` for a document under a layout, as `publicationInputs` hands the job the theme a
 * request was made under. Read once, through the one reader, so a test never sets a document from a
 * theme the store would refuse. At its 0.1, the version template 12 was measured against: 0.2's
 * quotation asks for contextual spacing, which template 12 cannot read (themes 2, ruling R3).
 */
export const defaultTheme: ResolvedTheme = (() => {
  const read = readTheme(FIRST_DEFAULT_THEME, FIRST_DEFAULT_CATALOGUES_BY_VERSION);
  if (!read.ok) throw new Error(read.refusals.map((each) => each.message).join('\n'));
  return read.theme;
})();
