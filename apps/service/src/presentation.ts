import type { PresentationView } from '@alloy-works/api-contract';
import {
  defaultLayout,
  defaultTheme,
  documentLayout,
  documentTheme,
  readDocument,
  type StoredLayout,
  type StoredTheme,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { publishedPdf, textBlockHeight, textMeasure } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';

/**
 * A theme and a layout as the renderer is given them (themes.md, "The theme in the editor", ET-B): the
 * theme as stored, with the catalogues it names, which the renderer reads by `readTheme` as the publisher
 * does; and of the layout only the measure and the text block's height, by the domain's own rules.
 */
function presentation(theme: StoredTheme, layout: StoredLayout): PresentationView {
  const page = publishedPdf(layout.layout.formats.pdf);
  return {
    theme: {
      versionId: theme.versionId,
      number: theme.number,
      content: theme.content as unknown as Record<string, unknown>,
      catalogues: [...theme.catalogues].map(([versionId, content]) => ({
        versionId,
        content: content as Record<string, unknown>,
      })),
    },
    frame: { measure: textMeasure(page), textHeight: textBlockHeight(page) },
  };
}

export function presentationHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
) {
  return {
    // A component on its own is shown in the environment's theme and layout (ET-A), which anybody
    // signed in may see: they are what every blank document publishes under.
    getPresentation: async (request: FastifyRequest): Promise<PresentationView> =>
      db.withTenant(tenantOf(request), async (trx) =>
        presentation(await defaultTheme(trx), await defaultLayout(trx)),
      ),

    // A document's are its template's, or the environment's for a blank one, as a publish takes them.
    getDocumentPresentation: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<PresentationView> => {
      const { id } = request.params as { id: string };
      // `authorise` never looks at an artifact's kind, so a component's id authorises cleanly here;
      // it is not a document, and answers as none.
      if (!(await readDocument(trx, id))) throw notFound();
      return presentation(await documentTheme(trx, id), await documentLayout(trx, id));
    },
  };
}
