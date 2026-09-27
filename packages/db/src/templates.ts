import {
  resolveTemplate,
  templateDefinitionSchema,
  type FieldDefinition,
  type MetadataSchemaDefinition,
  type ResolvedTemplate,
  type TemplateDefinition,
  type TemplateReferences,
  type UnresolvedReference,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { currentDefinition } from './creation.js';
import { readableArtifacts } from './readable-artifacts.js';
import type { TenantTransaction } from './tables.js';
import {
  checkedLimit,
  countOf,
  facetOf,
  isListingRequest,
  keysetPage,
  listingSorts,
  snapshotFor,
  sortColumns,
  visibleIn,
  type FacetCount,
  type Listed,
  type ListingRequest,
  type SortOf,
} from './listing.js';
import { defaultLayout, layoutLatest, type StoredLayout } from './layouts.js';
import { defaultTheme, themeLatest, type StoredTheme } from './themes.js';
import {
  createArtifact,
  latestVersion,
  readVersion,
  recordVersion,
  type StoredVersion,
} from './versions.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A template at one version: which it is, the space it lives in, and its definition (templates.md). */
export interface StoredTemplate {
  readonly id: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly version: StoredVersion;
  readonly definition: TemplateDefinition;
}

export type TemplateAnswer =
  | { readonly answer: 'created' | 'recorded'; readonly template: StoredTemplate }
  | { readonly answer: 'version.unchanged'; readonly template: StoredTemplate }
  /** The latest version is not the one the caller opened from: the template as it now stands. */
  | { readonly answer: 'version.precondition'; readonly current: StoredTemplate }
  /** A reference that does not resolve (TPL-004, TE-L), each named; nothing is written. */
  | { readonly answer: 'template.unresolved'; readonly unresolved: readonly UnresolvedReference[] }
  | { readonly answer: 'space.missing' }
  | { readonly answer: 'template.missing' };

/**
 * What a definition's references name now (templates.md, "Resolving a template"): the kind of every
 * artifact it names, and each metadata schema at its latest version with the fields it groups at
 * theirs. A schema or a field that is not there is simply absent, which resolution names.
 */
export async function templateReferences(
  trx: TenantTransaction,
  definition: TemplateDefinition,
): Promise<TemplateReferences> {
  // An identifier that is not a UUID names nothing, and is left for resolution to name.
  const named = [
    definition.theme,
    definition.layout,
    ...definition.schemas.map((each) => each.schema),
  ].filter((id) => UUID.test(id));
  const rows =
    named.length === 0
      ? []
      : await trx.selectFrom('artifact').select(['id', 'kind']).where('id', 'in', named).execute();
  const kinds = new Map<string, string>(rows.map((row) => [row.id, row.kind]));
  const schemas: MetadataSchemaDefinition[] = [];
  for (const id of new Set(definition.schemas.map((each) => each.schema))) {
    if (kinds.get(id) !== 'metadataSchema') continue;
    const schema = await currentDefinition(trx, 'metadataSchema', id);
    if (schema) schemas.push(schema.definition);
  }
  const fields: FieldDefinition[] = [];
  for (const id of new Set(
    schemas.flatMap((schema) => schema.entries.map((entry) => entry.field)),
  )) {
    const field = await currentDefinition(trx, 'field', id);
    if (field) fields.push(field.definition);
  }
  return { kinds, schemas, fields };
}

/** A template at its latest version, or undefined where this tenant holds no template by that id. */
export async function readTemplate(
  trx: TenantTransaction,
  id: string,
): Promise<StoredTemplate | undefined> {
  const version = await latestVersion(trx, id);
  if (!version || version.kind !== 'template') return undefined;
  return storedTemplate(trx, version);
}

async function storedTemplate(
  trx: TenantTransaction,
  version: StoredVersion,
): Promise<StoredTemplate> {
  const space = await trx
    .selectFrom('artifact as a')
    .innerJoin('space as s', 's.id', 'a.space_id')
    .select(['s.id', 's.name'])
    .where('a.id', '=', version.artifactId)
    .executeTakeFirstOrThrow();
  return {
    id: version.artifactId,
    space,
    version,
    definition: templateDefinitionSchema.parse(version.content),
  };
}

/**
 * Makes a template at 0.1 in a space (TPL-001), from a definition that must read and resolve (TE-L):
 * a definition that does not read is the caller's contract broken and throws, and one naming a
 * reference that does not resolve is refused by name with nothing written.
 */
export async function createTemplate(
  trx: TenantTransaction,
  input: { readonly spaceId: string; readonly definition: unknown; readonly author: string },
): Promise<TemplateAnswer> {
  const definition = templateDefinitionSchema.parse(input.definition);
  if (!UUID.test(input.spaceId)) return { answer: 'space.missing' };
  const space = await trx
    .selectFrom('space')
    .select('id')
    .where('id', '=', input.spaceId)
    .executeTakeFirst();
  if (!space) return { answer: 'space.missing' };
  const resolved = resolveTemplate(definition, await templateReferences(trx, definition));
  if (!resolved.ok) return { answer: 'template.unresolved', unresolved: resolved.unresolved };
  const version = await createArtifact(trx, {
    spaceId: input.spaceId,
    author: input.author,
    substance: { kind: 'template', content: definition },
  });
  return { answer: 'created', template: await storedTemplate(trx, version) };
}

/**
 * Cuts a template's next version from the one its designer opened (VER-056's rules, API-037's
 * precondition), from a whole definition that must read and resolve as a new one must.
 */
export async function recordTemplateVersion(
  trx: TenantTransaction,
  input: {
    readonly templateId: string;
    readonly openedFrom: string;
    readonly definition: unknown;
    readonly author: string;
  },
): Promise<TemplateAnswer> {
  const current = await readTemplate(trx, input.templateId);
  if (!current) return { answer: 'template.missing' };
  const definition = templateDefinitionSchema.parse(input.definition);
  const resolved = resolveTemplate(definition, await templateReferences(trx, definition));
  if (!resolved.ok) return { answer: 'template.unresolved', unresolved: resolved.unresolved };
  const answer = await recordVersion(trx, {
    artifactId: input.templateId,
    openedFrom: input.openedFrom,
    author: input.author,
    substance: { kind: 'template', content: definition },
  });
  switch (answer.answer) {
    case 'recorded':
      return { answer: 'recorded', template: await storedTemplate(trx, answer.version) };
    case 'version.unchanged':
      return { answer: 'version.unchanged', template: await storedTemplate(trx, answer.current) };
    case 'version.precondition':
      return { answer: 'version.precondition', current: await storedTemplate(trx, answer.current) };
    case 'artifact.missing':
      return { answer: 'template.missing' };
  }
}

/** One template as a listing shows it: its name, its space and its latest version. */
export interface TemplateSummary {
  readonly id: string;
  readonly name: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly version: { readonly id: string; readonly revision: number; readonly version: number };
  /** When its latest version was made. */
  readonly changedAt: Date;
}

/**
 * The templates a principal may read, a page at a time by keyset over the sort asked for and then the
 * id, as of the snapshot the walk's first page took (API-007, SCH-022), filtered by the readable set
 * inside the query, the predicate the documents listing uses. Undefined when the tenant holds no such
 * principal.
 */
export async function listReadableTemplates(
  trx: TenantTransaction,
  principalId: string,
  request: ListingRequest<SortOf<'templates'>> = { limit: 100 },
  filter: { readonly spaces?: readonly string[] } = {},
): Promise<
  | (Listed<TemplateSummary> & {
      readonly total: number;
      readonly facets: { readonly spaces: readonly FacetCount[] };
    })
  | undefined
> {
  const limit = checkedLimit(request.limit);
  const sort = request.sort ?? 'name';
  const { types, order: byDefault } = listingSorts.templates[sort];
  if (!isListingRequest(request, types)) {
    throw new Error('A page request names a cursor no listing gave out');
  }
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return undefined;
  const snapshot = await snapshotFor(trx, request.snapshot);
  /** The templates the reader may read, as of the snapshot, with the space filter unless left. */
  const base = (leaving?: 'spaces') =>
    trx
      .selectFrom('artifact as a')
      .innerJoin('space as s', 's.id', 'a.space_id')
      .innerJoinLateral(
        (eb) =>
          eb
            .selectFrom('artifact_version as v')
            .select([
              'v.id as version_id',
              'v.revision_no',
              'v.version_no',
              'v.created_at',
              sql<string>`v.content ->> 'name'`.as('name'),
            ])
            .whereRef('v.artifact_id', '=', 'a.id')
            .where(visibleIn('v.written_by', snapshot))
            .orderBy('v.revision_no', 'desc')
            .orderBy('v.version_no', 'desc')
            .limit(1)
            .as('latest'),
        (join) => join.onTrue(),
      )
      .select(['a.id', 's.id as space_id', 's.name as space_name', 'latest.name'])
      .select(['latest.version_id', 'latest.revision_no', 'latest.version_no', 'latest.created_at'])
      .select(sortColumns([sort === 'name' ? sql`latest.name` : sql`latest.created_at`]))
      .where('a.kind', '=', 'template')
      .where((eb) => readableArtifacts(eb, readable))
      .$if(filter.spaces !== undefined && leaving !== 'spaces', (query) =>
        filter.spaces!.length === 0
          ? query.where(sql<boolean>`false`)
          : query.where('a.space_id', 'in', [...filter.spaces!]),
      );
  const { rows, next } = await keysetPage<{
    id: string;
    name: string;
    space_id: string;
    space_name: string;
    version_id: string;
    revision_no: number;
    version_no: number;
    created_at: Date;
  }>(trx, base(), types, request.order ?? byDefault, limit, request.after);
  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      space: { id: row.space_id, name: row.space_name },
      version: { id: row.version_id, revision: row.revision_no, version: row.version_no },
      changedAt: new Date(row.created_at),
    })),
    next,
    snapshot,
    total: await countOf(trx, base()),
    facets: { spaces: await facetOf(trx, base('spaces'), 'space_id', 'space_name') },
  };
}

/**
 * The template, and the version of it, a document was made from (TPL-025), or undefined for a
 * document made blank. Everything a document takes from its template is read at this version, so a
 * template's later version changes nothing about it (TPL-027).
 */
export async function documentTemplate(
  trx: TenantTransaction,
  documentId: string,
): Promise<{ readonly template: string; readonly version: string } | undefined> {
  const row = await trx
    .selectFrom('document_template')
    .select(['template_id', 'template_version_id'])
    .where('document_id', '=', documentId)
    .executeTakeFirst();
  return row && { template: row.template_id, version: row.template_version_id };
}

/** The definition of the template version a document was made from, or undefined for a blank one. */
async function boundBy(
  trx: TenantTransaction,
  documentId: string,
): Promise<TemplateDefinition | undefined> {
  const link = await documentTemplate(trx, documentId);
  if (!link) return undefined;
  const version = await readVersion(trx, link.version);
  if (!version) throw new Error(`The template version ${link.version} a document names is gone`);
  return templateDefinitionSchema.parse(version.content);
}

/**
 * The layout a document is numbered and published under, at its latest version (templates.md,
 * "Publishing a document made from a template"): the one its recorded template version binds, or the
 * environment's declared layout for a document made blank (TE-F). The page's view, its numbering and
 * a publication request all read it here, so the numbers shown are the numbers that publish (STR-036).
 */
export async function documentLayout(
  trx: TenantTransaction,
  documentId: string,
): Promise<StoredLayout> {
  const bound = await boundBy(trx, documentId);
  return bound ? layoutLatest(trx, bound.layout) : defaultLayout(trx);
}

/**
 * What a document's template holds it to (templates.md, "What an author may change" and "Values"):
 * nothing for a blank document; otherwise the `changes` of the template version it recorded
 * (TPL-015), and that version resolved against the definitions as they are now (TE-K) for the fields
 * its values and its sections' may hold. Resolution may fail where a schema has since changed, which
 * refuses a value written, and nothing else.
 */
export type DocumentRules =
  | { readonly bound: false }
  | {
      readonly bound: true;
      /** The template version the document recorded, as it says it. */
      readonly definition: TemplateDefinition;
      readonly changes: TemplateDefinition['changes'];
      readonly resolved: ResolvedTemplate;
      /** The schemas it assigns, at their latest versions, as far as they were found: for naming. */
      readonly schemas: readonly MetadataSchemaDefinition[];
    };

export async function documentRules(
  trx: TenantTransaction,
  documentId: string,
): Promise<DocumentRules> {
  const bound = await boundBy(trx, documentId);
  if (!bound) return { bound: false };
  const references = await templateReferences(trx, bound);
  return {
    bound: true,
    definition: bound,
    changes: bound.changes,
    resolved: resolveTemplate(bound, references),
    schemas: references.schemas,
  };
}

/** The theme a document is published under, as `documentLayout` reads its layout (STY-025). */
export async function documentTheme(
  trx: TenantTransaction,
  documentId: string,
): Promise<StoredTheme> {
  const bound = await boundBy(trx, documentId);
  return bound ? themeLatest(trx, bound.theme) : defaultTheme(trx);
}
