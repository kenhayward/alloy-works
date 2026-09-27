import type { createApiClient, PresentationView } from '@alloy-works/api-client';
import { projectFontFaces, readTheme, type ResolvedTheme } from '@alloy-works/domain';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { faceUrl } from './faces.js';

type Client = ReturnType<typeof createApiClient>;

/**
 * The theme and layout a page's text is set in (themes.md, "The theme in the editor"): the theme read
 * by `readTheme`, the reader the publisher reads it by (STY-035, ET-B); the two lengths of the layout's
 * page an image style is a share of; and the typefaces the renderer holds none of, by family, which the
 * editor shows rather than hides (STY-070).
 */
export type Presentation =
  | { readonly state: 'loading' }
  | { readonly state: 'failed' }
  | {
      readonly state: 'ready';
      readonly theme: ResolvedTheme;
      readonly frame: PresentationView['frame'];
      readonly unheld: readonly string[];
    };

const PresentationContext = createContext<Presentation | null>(null);

/**
 * Reads the presentation a page is set in - the environment's, or with `document` that document's, as
 * a publish would take them (ET-A) - and declares the theme's faces from the renderer's own copy of the
 * pinned files (STY-039, ET-C). Whatever it holds, its children render: a presentation that has not
 * arrived, or cannot be read, leaves the text as it was, and says which.
 */
export function PresentationProvider({
  client,
  document,
  children,
}: {
  client: Client;
  document?: string;
  children: ReactNode;
}) {
  const [presentation, setPresentation] = useState<Presentation>({ state: 'loading' });
  const [faces, setFaces] = useState('');

  useEffect(() => {
    let live = true;
    setPresentation({ state: 'loading' });
    const asked =
      document === undefined
        ? client.GET('/v1/presentation')
        : client.GET('/v1/documents/{id}/presentation', { params: { path: { id: document } } });
    asked.then(
      ({ data }) => {
        if (!live) return;
        const read =
          data &&
          readTheme(
            data.theme.content,
            new Map(data.theme.catalogues.map((each) => [each.versionId, each.content])),
          );
        if (!data || !read || !read.ok) {
          setFaces('');
          setPresentation({ state: 'failed' });
          return;
        }
        const projected = projectFontFaces(read.theme, faceUrl);
        setFaces(projected.css);
        setPresentation({
          state: 'ready',
          theme: read.theme,
          frame: data.frame,
          unheld: projected.unheld,
        });
      },
      () => {
        if (!live) return;
        setFaces('');
        setPresentation({ state: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [client, document]);

  return (
    <PresentationContext.Provider value={presentation}>
      {faces !== '' && <style data-aw-faces="">{faces}</style>}
      {children}
    </PresentationContext.Provider>
  );
}

/** The presentation a page is set in, or null outside any provider, where text is set as it was. */
export function usePresentation(): Presentation | null {
  return useContext(PresentationContext);
}
