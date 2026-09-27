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
