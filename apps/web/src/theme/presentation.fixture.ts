import { DEFAULT_CATALOGUES_BY_VERSION, DEFAULT_THEME } from '@alloy-works/domain';

/** The environment's default theme and layout, as `GET /v1/presentation` answers them. */
export const DEFAULT_PRESENTATION = {
  theme: {
    versionId: 'theme-version',
    number: '0.3',
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
 * The default theme with styles an author may choose besides each place's default (ET-G): a paragraph
 * style for running text and one for a quotation, a table style, and an image style for a figure and
 * one for an image in a line. Each catalogue keeps the version the theme names it by.
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

export const CHOOSING_PRESENTATION = presentationWith({
  paragraph: [
    { id: 'lead', name: 'Lead', appliesTo: ['text'], properties: { size: 13, spaceAfter: 6 } },
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
  table: [
    {
      id: 'banded',
      name: 'Banded',
      appliesTo: ['table'],
      headerRow: { fill: '#dddddd', bold: true, rule: 'none' },
      headerColumn: { fill: 'none', bold: false, rule: 'none' },
      banding: { fill: '#f2f2f2' },
      rules: {
        outer: { width: 1, colour: '#000000' },
        horizontal: 'none',
        vertical: 'none',
      },
      padding: 4,
      breaks: { repeatHeader: true, keepRowsWhole: false, continuationLabel: false },
    },
  ],
  image: [
    {
      id: 'half-width',
      name: 'Half width',
      appliesTo: ['figure'],
      fixed: { dimension: 'width', value: 0.5, unit: 'measure' },
      maximum: { value: 0.6, unit: 'textHeight' },
      placement: 'block',
      alignment: 'centre',
    },
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
