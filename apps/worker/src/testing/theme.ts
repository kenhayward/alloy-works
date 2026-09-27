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
 * theme the store would refuse. As it stands, at its 0.4, the version migration 0034 seeds: 0.2's table
 * and image styles and quotation set off by its own spaces and contextual spacing (themes 2, ruling
 * R3), 0.3's maths face for Word, and the styles an author may choose (ET-H).
 */
export const defaultTheme: ResolvedTheme = (() => {
  const read = readTheme(DEFAULT_THEME, DEFAULT_CATALOGUES_BY_VERSION);
  if (!read.ok) throw new Error(read.refusals.map((each) => each.message).join('\n'));
  return read.theme;
})();
