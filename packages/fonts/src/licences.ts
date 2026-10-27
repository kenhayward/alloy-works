/**
 * Each family the product holds, by the licence file beside it (the UI plan, UF-H): what About shows,
 * the one place a font's licence is shown. Each is the SIL Open Font License 1.1 (ADR-0010), whose
 * text must travel with the faces; the path is under this package, as its exports name it.
 */
export const FONT_LICENCES = [
  { file: 'interface/LICENSE-Plex.txt', families: ['IBM Plex Sans', 'IBM Plex Mono'] },
  { file: 'files/LICENSE-Liberation.txt', families: ['Liberation Serif', 'Liberation Mono'] },
  { file: 'files/LICENSE-STIX.txt', families: ['STIX Two Math'] },
  { file: 'files/LICENSE-NotoNaskhArabic.txt', families: ['Noto Naskh Arabic'] },
] as const;
