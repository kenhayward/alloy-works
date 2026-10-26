import { DEFAULT_CATALOGUES_BY_VERSION, DEFAULT_THEME } from '@alloy-works/domain';

/** The environment's default theme and layout, as `GET /v1/presentation` answers them. */
export const DEFAULT_PRESENTATION = {
  theme: {
    versionId: 'theme-version',
    number: '0.5',
    content: DEFAULT_THEME,
    catalogues: [...DEFAULT_CATALOGUES_BY_VERSION].map(([versionId, content]) => ({
      versionId,
      content,
    })),
  },
  frame: { measure: 451.28, textHeight: 697.89 },
};

/** A style a test adds to a catalogue of the default theme, by the catalogue's kind. */
type Added = Readonly<Partial<Record<'paragraph' | 'table' | 'image', readonly unknown[]>>>;

/**
 * The default theme with styles added to what it offers an author to choose besides each place's
 * default (ET-G). Each catalogue keeps the version the theme names it by.
 */
export function presentationWith(added: Added) {
  return {
    ...DEFAULT_PRESENTATION,
    theme: {
      ...DEFAULT_PRESENTATION.theme,
      catalogues: DEFAULT_PRESENTATION.theme.catalogues.map(({ versionId, content }) => {
        const kind = (content as { kind: keyof Added }).kind;
        const more = added[kind];
        const catalogue = content as { styles: unknown[] };
        return {
          versionId,
          content: more ? { ...catalogue, styles: [...catalogue.styles, ...more] } : content,
        };
      }),
    },
  };
}

/**
 * The default theme, whose 0.4 offers Lead, Centred and Small print for running text, Banded for a
 * table and Half width for a figure (ET-H), with what it does not offer: a paragraph style for both
 * running text and a quotation, one for a footnote and one for a quotation alone, and an image style
 * for an image in a line.
 */
export const CHOOSING_PRESENTATION = presentationWith({
  paragraph: [
    {
      id: 'plain',
      name: 'Plain',
      appliesTo: ['text', 'quotation'],
      properties: { spaceAfter: 0 },
    },
    {
      id: 'small-note',
      name: 'Small note',
      appliesTo: ['footnote'],
      properties: { size: 8, lineSpacing: 9.5 },
    },
    {
      id: 'pull-quote',
      name: 'Pull quote',
      appliesTo: ['quotation'],
      properties: { italic: true },
    },
  ],
  image: [
    {
      id: 'icon',
      name: 'Icon',
      appliesTo: ['inlineImage'],
      fixed: { dimension: 'height', value: 1, unit: 'em' },
      maximum: { value: 1, unit: 'measure' },
      placement: 'inline',
    },
  ],
});
