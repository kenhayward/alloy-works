import {
  DEFAULT_CATALOGUES_BY_VERSION,
  DEFAULT_THEME,
  readTheme,
  type ResolvedTheme,
  type Typeface,
} from '@alloy-works/domain';

/**
 * The product's default theme, read as the store reads the seeded one (themes 1, ruling R4): what a
 * test hands `assemble` for a document under a layout, as `publicationInputs` hands the job the theme a
 * request was made under. Read once, through the one reader, so a test never sets a document from a
 * theme the store would refuse. As it stands, at its 0.6, the version migration 0048 seeds: 0.2's table
 * and image styles and quotation set off by its own spaces and contextual spacing (themes 2, ruling
 * R3), 0.3's maths face for Word, 0.4's styles an author may choose (ET-H), each table and figure
 * style saying where its caption sits, where it always stood (W14.5), and the value catalogue beside
 * the six, which sets nothing a publication prints until a value is printed (B1).
 */
export const defaultTheme: ResolvedTheme = (() => {
  const read = readTheme(DEFAULT_THEME, DEFAULT_CATALOGUES_BY_VERSION);
  if (!read.ok) throw new Error(read.refusals.map((each) => each.message).join('\n'));
  return read.theme;
})();

/**
 * Noto Naskh Arabic as a theme declares it (the UI plan, UF-A), its metrics its own `hhea`'s. No default
 * theme names it until UIg.
 */
export const NASKH: Typeface = {
  id: 'naskh',
  family: 'Noto Naskh Arabic',
  files: [
    {
      sha256: 'c34fdbd98af4dbc45ca192a23d2eeb77032add83086f5fe32957d23b3f36b221',
      weight: 'regular',
      posture: 'normal',
    },
    {
      sha256: '380ac34b249d336e1a43c21053df440594e1e3db8f75fabd4d85b649ca1ea4c6',
      weight: 'bold',
      posture: 'normal',
    },
  ],
  licence: 'OFL-1.1',
  embedding: { pdf: true, word: true },
  ascent: 1.069,
  descent: 0.634,
};

/** The default theme with the Naskh declared and the serif falling back to it (UF-B). */
export const naskhTheme: ResolvedTheme = (() => {
  const read = readTheme(
    {
      ...DEFAULT_THEME,
      typefaces: [
        ...DEFAULT_THEME.typefaces.map((face) =>
          face.id === 'serif' ? { ...face, fallback: ['naskh'] } : face,
        ),
        NASKH,
      ],
    },
    DEFAULT_CATALOGUES_BY_VERSION,
  );
  if (!read.ok) throw new Error(read.refusals.map((each) => each.message).join('; '));
  return read.theme;
})();
