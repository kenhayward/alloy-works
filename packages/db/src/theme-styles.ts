import { randomUUID } from 'node:crypto';
import {
  readCatalogue,
  readTheme,
  type CharacterStyle,
  type ImageStyle,
  type ParagraphStyle,
  type TableStyle,
  type Theme,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { labelled, recordEvent } from './audit.js';
import type { TenantTransaction } from './tables.js';
import { documentThemeId } from './templates.js';
import {
  addCatalogueVersion,
  addThemeVersion,
  themeLatest,
  type StoredTheme,
  type ThemeStoreRefusal,
} from './themes.js';
import { readableAmong, styleUseCount, usingStyle } from './uses.js';
import { createThemePart, latestVersion, lockArtifact } from './versions.js';

/** The kinds of style an administrator edits one at a time (the SY plan, SY-F). */
export type EditableStyleKind = 'paragraph' | 'character' | 'table' | 'image';
export type EditableStyle = ParagraphStyle | CharacterStyle | TableStyle | ImageStyle;

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface ThemeSummary {
  readonly id: string;
  readonly name: string;
  readonly version: { readonly id: string; readonly number: string };
  /** The environment's declared theme: what a document with no template is set in. */
  readonly isDefault: boolean;
}

/** Every theme in the environment, at its latest version, by name. */
export async function listThemes(trx: TenantTransaction): Promise<ThemeSummary[]> {
  const { rows } = await sql<{
    id: string;
    version_id: string;
    revision_no: number;
    version_no: number;
    name: string;
    is_default: boolean;
  }>`
    select a.id, latest.id as version_id, latest.revision_no, latest.version_no,
           latest.content ->> 'name' as name, d.theme_id is not null as is_default
      from artifact a
      cross join lateral (
        select v.id, v.kind, v.revision_no, v.version_no, v.content from artifact_version v
         where v.artifact_id = a.id
         order by v.revision_no desc, v.version_no desc
         limit 1
      ) latest
      left join theme_default d on d.theme_id = a.id
     where latest.kind = 'theme'`.execute(trx);
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      version: { id: row.version_id, number: `${row.revision_no}.${row.version_no}` },
      isDefault: row.is_default,
    }))
    .sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id));
}

export interface StyleChange {
  readonly themeId: string;
  /** The theme version the change was made from: a stale one is answered `version.precondition`. */
  readonly openedFrom: string;
  readonly kind: EditableStyleKind;
  readonly styleId: string;
  /** The style as it is to be, or null to delete it. */
  readonly style: EditableStyle | null;
  readonly author: string;
}

export type StyleChangeAnswer =
  | { readonly answer: 'recorded'; readonly theme: StoredTheme }
  | { readonly answer: 'version.unchanged' }
  | { readonly answer: 'version.precondition'; readonly current: string }
  | { readonly answer: 'artifact.missing' }
  | { readonly answer: 'style_in_use'; readonly components: number }
  | { readonly answer: 'refused'; readonly refusals: readonly ThemeStoreRefusal[] };

const refused = (code: ThemeStoreRefusal['code'], message: string): StyleChangeAnswer => ({
  answer: 'refused',
  refusals: [{ code, message }],
});

/**
 * **A style added, changed or deleted** (the SY plan, SY-C): the catalogue's next version and the
 * theme's next version naming it, in the caller's transaction. The theme is read with the changed
 * catalogue before anything is written, so every refusal the reader makes is made first; a deletion
 * waits until no component uses the style (STY-031). Audited `style.changed` with the properties that
 * changed (STY-032).
 */
export async function saveStyle(
  trx: TenantTransaction,
  change: StyleChange,
): Promise<StyleChangeAnswer> {
  const theme = await latestVersion(trx, change.themeId);
  if (theme?.kind !== 'theme') return { answer: 'artifact.missing' };
  await lockArtifact(trx, change.themeId);
  const current = await themeLatest(trx, change.themeId);
  if (current.versionId !== change.openedFrom) {
    return { answer: 'version.precondition', current: current.versionId };
  }
  const boundVersion = current.content.catalogues[change.kind];
  const catalogue = readCatalogue(current.catalogues.get(boundVersion));
  if (!catalogue.ok || catalogue.catalogue.kind !== change.kind) {
    throw new Error(`The theme ${change.themeId} binds no ${change.kind} catalogue that reads`);
  }
  const styles = catalogue.catalogue.styles as readonly EditableStyle[];
  const before = styles.find((each) => each.id === change.styleId);
  if (change.style !== null && change.style.id !== change.styleId) {
    return refused(
      'style_missing',
      `The style given is ${change.style.id}, and the change is to ${change.styleId}`,
    );
  }
  if (change.style === null && before === undefined) {
    return refused(
      'style_missing',
      `The ${change.kind} catalogue does not contain the style ${change.styleId}`,
    );
  }
  if (change.style === null && change.kind !== 'character') {
    const components = await styleUseCount(trx, { kind: change.kind, key: change.styleId });
    if (components > 0) return { answer: 'style_in_use', components };
  }
  const next = {
    ...catalogue.catalogue,
    styles:
      change.style === null
        ? styles.filter((each) => each.id !== change.styleId)
        : before === undefined
          ? [...styles, change.style]
          : styles.map((each) => (each.id === change.styleId ? change.style! : each)),
  };

  // Read the theme as it would be, under a name no version holds, before anything is written.
  const unwritten = randomUUID();
  const proposed: Theme = {
    ...current.content,
    catalogues: { ...current.content.catalogues, [change.kind]: unwritten },
  };
  const read = readTheme(proposed, new Map([...current.catalogues, [unwritten, next]]));
  if (!read.ok) return { answer: 'refused', refusals: read.refusals };

  const catalogueVersion = await trx
    .selectFrom('artifact_version')
    .select('artifact_id')
    .where('id', '=', boundVersion)
    .executeTakeFirstOrThrow();
  const catalogueLatest = await latestVersion(trx, catalogueVersion.artifact_id);
  const recordedCatalogue = await addCatalogueVersion(trx, {
    artifactId: catalogueVersion.artifact_id,
    openedFrom: catalogueLatest!.id,
    author: change.author,
    catalogue: next as Parameters<typeof addCatalogueVersion>[1]['catalogue'],
  });
  if (recordedCatalogue.answer === 'refused') return recordedCatalogue;
  if (recordedCatalogue.answer === 'version.unchanged') return { answer: 'version.unchanged' };
  if (recordedCatalogue.answer !== 'recorded') {
    throw new Error(
      `The catalogue ${catalogueVersion.artifact_id} answered ${recordedCatalogue.answer}`,
    );
  }
  const recordedTheme = await addThemeVersion(trx, {
    artifactId: change.themeId,
    openedFrom: current.versionId,
    author: change.author,
    theme: {
      ...current.content,
      catalogues: { ...current.content.catalogues, [change.kind]: recordedCatalogue.version.id },
    },
  });
  if (recordedTheme.answer !== 'recorded') {
    // Read above with the same catalogue, under the theme's lock: anything else is a broken store.
    throw new Error(`The theme ${change.themeId} answered ${recordedTheme.answer}`);
  }
  await recordEvent(
    trx,
    {
      kind: 'style.changed',
      subject: { kind: 'theme', id: change.themeId, version: recordedTheme.version.id },
      detail: {
        catalogue: change.kind,
        style: change.styleId,
        change: change.style === null ? 'deleted' : before === undefined ? 'added' : 'changed',
        properties: before && change.style ? changedProperties(before, change.style) : [],
      },
    },
    [labelled('theme', current.content.name, change.themeId)].filter(
      (label): label is NonNullable<typeof label> => label !== undefined,
    ),
  );
  return { answer: 'recorded', theme: await themeLatest(trx, change.themeId) };
}

/**
 * What a change touched, by name: a stated property where the style has `properties`, and otherwise
 * each member of the style but its identifier.
 */
function changedProperties(before: EditableStyle, after: EditableStyle): string[] {
  const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
  const names = new Set<string>();
  const was = before as unknown as Record<string, unknown>;
  const is = after as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(was), ...Object.keys(is)])) {
    if (key === 'id') continue;
    if (key === 'properties') {
      const a = (was[key] ?? {}) as Record<string, unknown>;
      const b = (is[key] ?? {}) as Record<string, unknown>;
      for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (differs(a[name], b[name])) names.add(name);
      }
    } else if (differs(was[key], is[key])) {
      names.add(key);
    }
  }
  return [...names].sort();
}

export interface StyleImpact {
  /** The documents it reaches that the reader may read, by title. */
  readonly documents: readonly { readonly id: string; readonly title: string }[];
  /** How many more it reaches that the reader may not read. */
  readonly unreadable: number;
}

/**
 * **What a style change reaches** (STY-034, STY-067; the SY plan, SY-D): the documents set in this
 * theme - their template's, else the environment's - whose components use the style or a style
 * derived from it. A paragraph style that is a place's or a role's default reaches every such
 * document, since a paragraph there names no style; so does a character style, which every mark of its
 * kind is set in.
 */
export async function styleImpact(
  trx: TenantTransaction,
  by: string,
  target: { readonly themeId: string; readonly kind: EditableStyleKind; readonly styleId: string },
): Promise<StyleImpact> {
  const { theme } = await themeLatest(trx, target.themeId);
  let every = target.kind === 'character';
  const keys = new Set([target.styleId]);
  if (target.kind === 'paragraph') {
    for (const style of theme.paragraphStyles.values()) {
      for (let at: string | undefined = style.id; at !== undefined;) {
        if (at === target.styleId) keys.add(style.id);
        at = at === target.styleId ? undefined : theme.paragraphStyles.get(at)?.basedOn;
      }
    }
    const defaults = new Set([...Object.values(theme.places), ...Object.values(theme.roles)]);
    every = [...keys].some((key) => defaults.has(key));
  }
  const components = every
    ? []
    : (
        await Promise.all(
          [...keys].map((key) =>
            usingStyle(trx, { kind: target.kind as 'paragraph' | 'table' | 'image', key }),
          ),
        )
      ).flatMap((rows) => rows.map((row) => row.id));
  if (!every && components.length === 0) return { documents: [], unreadable: 0 };
  const { rows } = await sql<{ id: string; space_id: string; title: string }>`
    select a.id, a.space_id, latest.content ->> 'title' as title
      from artifact a
      cross join lateral (
        select v.id, v.content from artifact_version v
         where v.artifact_id = a.id
         order by v.revision_no desc, v.version_no desc
         limit 1
      ) latest
     where a.kind = 'document'
       and (${every} or exists (
         select 1 from reference r
          where r.from_version = latest.id and r.to_id = any(${components}::uuid[])))`.execute(trx);
  const inTheme = [];
  for (const row of rows) {
    if ((await documentThemeId(trx, row.id)) === target.themeId) inTheme.push(row);
  }
  const shown = await readableAmong(trx, await loadReadableSet(trx, by), inTheme);
  return {
    documents: shown
      .map(({ id, title }) => ({ id, title }))
      .sort((a, b) => compare(a.title, b.title) || compare(a.id, b.id)),
    unreadable: shown.total - shown.length,
  };
}

export type DuplicateAnswer =
  | { readonly answer: 'created'; readonly theme: StoredTheme }
  | { readonly answer: 'artifact.missing' }
  | { readonly answer: 'refused'; readonly refusals: readonly ThemeStoreRefusal[] };

/**
 * **A theme of an environment's own** (STY-072; the SY plan, SY-B): a copy of one, named, whose
 * catalogues are new artifacts holding what the original's held, so a style changed in either never
 * reaches the other, and each catalogue's chain has one writer. Read whole before anything is written.
 */
export async function duplicateTheme(
  trx: TenantTransaction,
  input: { readonly themeId: string; readonly name: string; readonly author: string },
): Promise<DuplicateAnswer> {
  const theme = await latestVersion(trx, input.themeId);
  if (theme?.kind !== 'theme') return { answer: 'artifact.missing' };
  const original = await themeLatest(trx, input.themeId);
  const named: Theme = { ...original.content, name: input.name.trim() };
  const read = readTheme(named, original.catalogues);
  if (!read.ok) return { answer: 'refused', refusals: read.refusals };
  const catalogues: Record<string, string> = {};
  for (const [kind, version] of Object.entries(original.content.catalogues)) {
    if (version === undefined) continue;
    const made = await createThemePart(trx, {
      author: input.author,
      // As the original's version holds it, at whichever shape it was written in.
      substance: {
        kind: 'catalogue',
        content: original.catalogues.get(version),
      } as Parameters<typeof createThemePart>[1]['substance'],
    });
    catalogues[kind] = made.id;
  }
  const made = await createThemePart(trx, {
    author: input.author,
    substance: { kind: 'theme', content: { ...named, catalogues } as Theme },
  });
  return { answer: 'created', theme: await themeLatest(trx, made.artifactId) };
}
