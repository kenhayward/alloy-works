import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

export const ThemeParams = z.object({ id: LowercaseUuid });
export type ThemeParams = z.infer<typeof ThemeParams>;

export const STYLE_KINDS = ['paragraph', 'character', 'table', 'image'] as const;

export const ThemeStyleParams = z.object({
  id: LowercaseUuid,
  kind: z.enum(STYLE_KINDS),
  style: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
});
export type ThemeStyleParams = z.infer<typeof ThemeStyleParams>;

const VersionNumber = z.object({ id: z.string(), number: z.string() });

export const ThemeSummary = z.object({
  id: z.string(),
  name: z.string(),
  version: VersionNumber,
  isDefault: z
    .boolean()
    .describe("The environment's declared theme, which a document with no template is set in"),
});

export const ThemeList = z.object({ items: z.array(ThemeSummary) });
export type ThemeList = z.infer<typeof ThemeList>;

/** A theme at its latest version, as stored, with each catalogue version it names (the SY plan). */
export const ThemeView = ThemeSummary.extend({
  content: z
    .record(z.string(), z.unknown())
    .describe('The theme version as stored, naming its catalogues by version'),
  catalogues: z
    .array(
      z.object({
        versionId: z.string(),
        content: z.record(z.string(), z.unknown()).describe('The catalogue version as stored'),
      }),
    )
    .describe('Each catalogue version the theme names'),
});
export type ThemeView = z.infer<typeof ThemeView>;

export const SaveStyleBody = z.strictObject({
  openedFrom: LowercaseUuid.describe('The theme version the change was made from'),
  style: z
    .record(z.string(), z.unknown())
    .describe("The style as it is to be, in its catalogue's shape, its id the path's"),
});
export type SaveStyleBody = z.infer<typeof SaveStyleBody>;

export const CreateThemeBody = z.strictObject({
  from: LowercaseUuid.describe('The theme to copy, its catalogues copied with it'),
  name: z.string().trim().min(1).max(80),
});
export type CreateThemeBody = z.infer<typeof CreateThemeBody>;

export const RenameThemeBody = z.strictObject({
  openedFrom: LowercaseUuid.describe('The theme version the rename was made from'),
  name: z.string().trim().min(1).max(80),
});
export type RenameThemeBody = z.infer<typeof RenameThemeBody>;

const AllowedIds = z.array(z.string().min(1).max(64)).max(500);
export const AllowStylesBody = z.strictObject({
  openedFrom: LowercaseUuid.describe('The theme version the change was made from'),
  allowed: z
    .strictObject({ paragraph: AllowedIds, table: AllowedIds, image: AllowedIds })
    .partial()
    .describe('The styles authors may choose, by kind; a kind absent allows every style of it'),
});
export type AllowStylesBody = z.infer<typeof AllowStylesBody>;

export const DeleteStyleQuery = z.object({
  openedFrom: LowercaseUuid.describe('The theme version the deletion was made from'),
});
export type DeleteStyleQuery = z.infer<typeof DeleteStyleQuery>;

export const StyleImpactBody = z.strictObject({
  kind: z.enum(STYLE_KINDS),
  style: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
});
export type StyleImpactBody = z.infer<typeof StyleImpactBody>;

export const StyleImpactView = z.object({
  documents: z
    .array(z.object({ id: z.string(), title: z.string() }))
    .describe('The documents it reaches that the caller may read, by title'),
  unreadable: z.int().describe('How many more it reaches that the caller may not read'),
});
export type StyleImpactView = z.infer<typeof StyleImpactView>;

/** A change refused: each of the theme reader's refusals, or the components using a style. */
export const ThemeStyleRefusal = ErrorBody.extend({
  refusals: z
    .array(z.object({ code: z.string(), message: z.string() }))
    .optional()
    .describe('style_refused: each refusal, as the theme reader makes it'),
  components: z
    .int()
    .optional()
    .describe('style_in_use: how many components use the style, whoever may read them'),
});

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const notFound = { description: 'No such theme in this environment', schema: ErrorBody } as const;
// Decided at the theme: one the caller may not manage is answered as one that is not there.
const notManaged = {
  description: 'No such theme, or the caller may not manage definitions',
  schema: ErrorBody,
} as const;
const forbidden = { description: 'The caller may not manage definitions', schema: ErrorBody };
// Decided at the theme, as a vocabulary's refresh is, so one that is not here is not found.
const managed = {
  check: 'permission',
  permission: 'manage_definitions',
  target: { artifact: 'id' },
} as const;
const changed = {
  200: { description: 'The theme at its new version', schema: ThemeView },
  400: {
    description:
      '`style_refused`: the theme would not read with the change, each refusal named, or the style given is another than the path names. `style_in_use`: components use the style, so it is not deleted',
    schema: ThemeStyleRefusal,
  },
  401: unauthenticated,
  403: forbidden,
  404: notManaged,
  409: {
    description: '`version.precondition`: the theme has a newer version than `openedFrom`',
    schema: ErrorBody,
  },
} as const;

/**
 * Themes (the SY plan, SY-C): read by anyone signed in, as the presentation is; each style added,
 * changed or deleted, and its reach weighed, by `manage_definitions` at the environment.
 */
export const themeRoutes = {
  listThemes: {
    operationId: 'listThemes',
    method: 'GET',
    path: '/v1/themes',
    summary: "The environment's themes, each at its latest version",
    tenantScoped: true,
    access: { check: 'session' },
    responses: {
      200: { description: 'Every theme, by name', schema: ThemeList },
      401: unauthenticated,
    },
  },
  getTheme: {
    operationId: 'getTheme',
    method: 'GET',
    path: '/v1/themes/{id}',
    summary: 'A theme at its latest version, with the catalogues it names',
    tenantScoped: true,
    access: { check: 'session' },
    params: ThemeParams,
    responses: {
      200: { description: 'The theme', schema: ThemeView },
      401: unauthenticated,
      404: notFound,
    },
  },
  createTheme: {
    operationId: 'createTheme',
    method: 'POST',
    path: '/v1/themes',
    summary: 'Make a theme by copying another, with catalogues of its own',
    tenantScoped: true,
    access: { check: 'permission', permission: 'manage_definitions', target: { tenant: true } },
    body: CreateThemeBody,
    responses: {
      200: { description: 'The theme made, at 0.1', schema: ThemeView },
      400: {
        description: '`style_refused`: the copy would not read under its name',
        schema: ThemeStyleRefusal,
      },
      401: unauthenticated,
      403: forbidden,
      404: { description: 'No theme `from` names in this environment', schema: ErrorBody },
    },
  },
  renameTheme: {
    operationId: 'renameTheme',
    method: 'PUT',
    path: '/v1/themes/{id}/name',
    summary: 'Rename a theme, as its next version',
    tenantScoped: true,
    access: managed,
    params: ThemeParams,
    body: RenameThemeBody,
    responses: changed,
  },
  allowThemeStyles: {
    operationId: 'allowThemeStyles',
    method: 'PUT',
    path: '/v1/themes/{id}/allowed',
    summary: 'Set the styles a theme allows authors, as its next version',
    tenantScoped: true,
    access: managed,
    params: ThemeParams,
    body: AllowStylesBody,
    responses: changed,
  },
  declareTheme: {
    operationId: 'declareTheme',
    method: 'POST',
    path: '/v1/themes/{id}/default',
    summary: "Make a theme the environment's, which a document with no template is set in",
    tenantScoped: true,
    access: managed,
    params: ThemeParams,
    responses: {
      200: { description: 'The theme, now the environment’s', schema: ThemeView },
      401: unauthenticated,
      403: forbidden,
      404: notManaged,
    },
  },
  saveThemeStyle: {
    operationId: 'saveThemeStyle',
    method: 'PUT',
    path: '/v1/themes/{id}/styles/{kind}/{style}',
    summary: "Add or change a style in a theme's catalogue",
    tenantScoped: true,
    access: managed,
    params: ThemeStyleParams,
    body: SaveStyleBody,
    responses: changed,
  },
  deleteThemeStyle: {
    operationId: 'deleteThemeStyle',
    method: 'DELETE',
    path: '/v1/themes/{id}/styles/{kind}/{style}',
    summary: "Delete a style no component uses from a theme's catalogue",
    tenantScoped: true,
    access: managed,
    params: ThemeStyleParams,
    query: DeleteStyleQuery,
    responses: changed,
  },
  getStyleImpact: {
    operationId: 'getStyleImpact',
    method: 'POST',
    path: '/v1/themes/{id}/impact',
    summary: 'The documents a change to a style would reach',
    tenantScoped: true,
    access: managed,
    params: ThemeParams,
    body: StyleImpactBody,
    // A question, not an act: nothing is recorded, so a repeat asks again.
    idempotencyKey: false,
    responses: {
      200: { description: 'The documents it reaches', schema: StyleImpactView },
      401: unauthenticated,
      403: forbidden,
      404: notManaged,
    },
  },
} as const satisfies Record<string, RouteContract>;
