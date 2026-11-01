import type {
  DeleteStyleQuery,
  SaveStyleBody,
  StyleImpactBody,
  StyleImpactView,
  ThemeList,
  ThemeParams,
  ThemeStyleParams,
  ThemeView,
} from '@alloy-works/api-contract';
import {
  latestVersion,
  listThemes,
  readsOnlyShares,
  saveStyle,
  styleImpact,
  themeLatest,
  type EditableStyle,
  type StoredTheme,
  type StyleChangeAnswer,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { AppError } from './errors.js';
import type { SessionPrincipal } from './sessions.js';

/** A theme's id, when it is one: anything else is not found, as another kind's id is. */
async function isTheme(trx: TenantTransaction, id: string): Promise<boolean> {
  return (await latestVersion(trx, id))?.kind === 'theme';
}

async function themeView(trx: TenantTransaction, stored: StoredTheme): Promise<ThemeView> {
  const listed = (await listThemes(trx)).find((each) => each.id === stored.artifactId);
  return {
    id: stored.artifactId,
    name: stored.content.name,
    version: { id: stored.versionId, number: stored.number },
    isDefault: listed?.isDefault ?? false,
    content: stored.content as unknown as Record<string, unknown>,
    catalogues: [...stored.catalogues].map(([versionId, content]) => ({
      versionId,
      content: content as Record<string, unknown>,
    })),
  };
}

/** A change's answer, as the wire answers it: the theme at its new version, or why not. */
async function answered(
  trx: TenantTransaction,
  themeId: string,
  answer: StyleChangeAnswer,
): Promise<ThemeView> {
  switch (answer.answer) {
    case 'recorded':
      return themeView(trx, answer.theme);
    case 'version.unchanged':
      return themeView(trx, await themeLatest(trx, themeId));
    case 'version.precondition':
      throw new AppError(
        409,
        'version.precondition',
        'This theme has a newer version than the one this page opened.',
        undefined,
        { current: answer.current },
      );
    case 'artifact.missing':
      throw notFound();
    case 'style_in_use':
      throw new AppError(
        400,
        'style_in_use',
        `${answer.components} ${answer.components === 1 ? 'component uses' : 'components use'} this style, so it cannot be deleted.`,
        'STY-031',
        { components: answer.components },
      );
    case 'refused':
      throw new AppError(
        400,
        'style_refused',
        'The theme would not read with this change.',
        undefined,
        { refusals: answer.refusals.map(({ code, message }) => ({ code, message })) },
      );
  }
}

/**
 * The theme routes (the SY plan, SY-C): read by anyone signed in, as the presentation is, but by
 * nobody from outside; a style saved, deleted or weighed by `manage_definitions` at the environment.
 */
export function themeHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
) {
  const read = <T>(
    request: FastifyRequest,
    work: (trx: TenantTransaction) => Promise<T>,
    outside: T,
  ) =>
    db.withTenant(tenantOf(request), async (trx) =>
      (await readsOnlyShares(trx, principalOf(request).principalId)) ? outside : work(trx),
    );
  const change = async (
    request: FastifyRequest,
    { trx, principalId }: Authorised,
    openedFrom: string,
    style: EditableStyle | null,
  ): Promise<ThemeView> => {
    const { id, kind, style: styleId } = request.params as ThemeStyleParams;
    if (!(await isTheme(trx, id))) throw notFound();
    return answered(
      trx,
      id,
      await saveStyle(trx, { themeId: id, openedFrom, kind, styleId, style, author: principalId }),
    );
  };
  return {
    listThemes: async (request: FastifyRequest): Promise<ThemeList> => ({
      items: (await read(request, listThemes, [])).map((each) => ({
        ...each,
        version: { ...each.version },
      })),
    }),

    getTheme: async (request: FastifyRequest): Promise<ThemeView> => {
      const { id } = request.params as ThemeParams;
      const view = await read(
        request,
        async (trx) =>
          (await isTheme(trx, id)) ? themeView(trx, await themeLatest(trx, id)) : undefined,
        undefined,
      );
      if (!view) throw notFound();
      return view;
    },

    saveThemeStyle: (request: FastifyRequest, authorised: Authorised) => {
      const { openedFrom, style } = request.body as SaveStyleBody;
      return change(request, authorised, openedFrom, style as unknown as EditableStyle);
    },

    deleteThemeStyle: (request: FastifyRequest, authorised: Authorised) =>
      change(request, authorised, (request.query as DeleteStyleQuery).openedFrom, null),

    getStyleImpact: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<StyleImpactView> => {
      const { id } = request.params as ThemeParams;
      const { kind, style } = request.body as StyleImpactBody;
      if (!(await isTheme(trx, id))) throw notFound();
      const impact = await styleImpact(trx, principalId, { themeId: id, kind, styleId: style });
      return {
        documents: impact.documents.map((each) => ({ ...each })),
        unreadable: impact.unreadable,
      };
    },
  };
}
