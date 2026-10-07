import { randomBytes } from 'node:crypto';
import {
  applyOutlineOperation,
  blockIdentifierFrom,
  checkDocumentParameters,
  checkWrittenValues,
  decide,
  materialiseTemplate,
  OUTLINE_SCHEMA_VERSION,
  outlineDocumentSchema,
  readOutline,
  resolveTemplate,
  seededValues,
  walkOutline,
  writtenValues,
  type DocumentParameters,
  type EffectiveField,
  type MetadataFailure,
  type MetadataValues,
  type OutlineDocument,
  type OutlineNode,
  type OutlineOperation,
  type OutlineRules,
  type TemplateParameter,
  type UnresolvedReference,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadFacts, loadReadableSet } from './access-facts.js';
import { readableArtifacts, readableArtifactsAs } from './readable-artifacts.js';
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
import type { TenantTransaction } from './tables.js';
import {
  documentRules,
  readTemplate,
  refusedParameters,
  templateReferences,
  type ParametersRefused,
} from './templates.js';
import {
  createArtifact,
  latestVersion,
  readVersion,
  recordVersion,
  type RecordAnswer,
  type StoredVersion,
  type VersionPosition,
} from './versions.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * 128 bits from `node:crypto`, spelled the way a block identifier is: `packages/domain` takes no
 * randomness from anywhere, so the store supplies it (STR-003's "never reused" is decision 3's
 * argument about 128 bits, not a counter's).
 */
const newNodeIdentifier = () => blockIdentifierFrom(randomBytes(16));

export interface NewDocument {
  readonly spaceId: string;
  readonly title: string;
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
  readonly author: string;
  /** The template to make it from, at its latest version (templates.md); a blank document without. */
  readonly template?: string;
  /** Its template's parameters' values, by name (TP1-G); none for a blank document. */
  readonly parameters?: Readonly<Record<string, unknown>>;
}

/**
 * A parameter's value refused (TP1-G, TP1-H): by its declaration (DAT-020), or - where it seeds a
 * field - by the field's own rule, naming the field (TPL-045).
 */
export interface ParameterInvalid {
  readonly parameter: string;
  readonly rule: string;
  readonly value: string;
  readonly field?: string;
}

/** Parameter values refused at creation or change, each by name; nothing is written. */
export type ParameterValuesRefused =
  | { readonly answer: 'parameter.unknown'; readonly parameters: readonly string[] }
  | { readonly answer: 'parameter.invalid'; readonly problems: readonly ParameterInvalid[] };

export type CreateDocumentAnswer =
  | { readonly answer: 'created'; readonly version: StoredVersion }
  /** This environment holds no such space. */
  | { readonly answer: 'space.missing' }
  /** The title, language or direction is not one the outline accepts. */
  | { readonly answer: 'content.invalid' }
  /** No template by that id that the author may read (TE-I): nothing tells the two apart. */
  | { readonly answer: 'template.missing' }
  /** A reference the template makes does not resolve now (TPL-004), each named; nothing is written. */
  | { readonly answer: 'template.unresolved'; readonly unresolved: readonly UnresolvedReference[] }
  | ParameterValuesRefused
  | ParametersRefused;

/**
 * What one structural act answers: the version chain's own answers, or a refusal from the outline -
 * an operation it cannot take, with the operation's fixed reason.
 */
export type OutlineAnswer =
  RecordAnswer | { readonly answer: 'outline.invalid'; readonly reason: string } | ValuesRefused;

/**
 * Values written that do not fit (templates.md, "Values"): each failure by field, in MET-022's shape;
 * or the document's template no longer resolving, so there is nothing to check them against (TPL-004).
 */
export type ValuesRefused =
  | { readonly answer: 'values.invalid'; readonly failures: readonly MetadataFailure[] }
  | { readonly answer: 'template.unresolved'; readonly unresolved: readonly UnresolvedReference[] };

/** One document as its page reads it: the latest version, and the one space it lives in. */
export interface StoredDocument {
  readonly id: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly version: StoredVersion;
}

/** One document as a listing shows it: its title and number at the latest version, and its space. */
export interface DocumentSummary {
  readonly id: string;
  readonly title: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly revision: number;
  readonly version: number;
  /** When the latest version was made. */
  readonly changedAt: Date;
  /** The sections and the component references in the latest outline, at every depth. */
  readonly sections: number;
  readonly components: number;
  /** The reader's own view: whether the latest publication they may read is of the latest version. */
  readonly publishing: PublishingState;
}

/**
 * Where a document stands against what has been published of it, as one reader may see it: a
 * publication's readership is its own, so this is said of the publications the reader may read.
 */
export type PublishingState = 'published' | 'changedSince' | 'neverPublished';

/**
 * Creates a document and its version 0.1, an outline holding no nodes (STR-054): a document has a
 * version from the moment it exists, as a component does, and nothing in it is filler - an empty
 * outline is a valid document, not an error.
 *
 * Who may create here is `create` on the space, decided by the caller before this is called and in the
 * same transaction; this refuses a space this environment does not hold before anything else, which is
 * where a caller's identifier for another environment's ends up. The title is trimmed and refused if
 * trimming leaves nothing, and the language and direction are checked against the outline's own
 * schema, the way `createComponent` checks a component's header - so `createArtifact` throwing past
 * this point is a bug, not a caller's mistake.
 */
export async function createDocument(
  trx: TenantTransaction,
  input: NewDocument,
): Promise<CreateDocumentAnswer> {
  // Checked here, rather than left to Postgres, so a malformed id is refused as `space.missing` rather
  // than a raised 22P02.
  if (!UUID.test(input.spaceId)) return { answer: 'space.missing' };
  const space = await trx
    .selectFrom('space')
    .select('id')
    .where('id', '=', input.spaceId)
    .executeTakeFirst();
  if (!space) return { answer: 'space.missing' };

  const title = input.title.trim();
  if (
    !outlineDocumentSchema.shape.title.safeParse(title).success ||
    !outlineDocumentSchema.shape.language.safeParse(input.language).success ||
    !outlineDocumentSchema.shape.direction.safeParse(input.direction).success
  ) {
    return { answer: 'content.invalid' };
  }

  const heading = { title, language: input.language, direction: input.direction };
  const given = input.parameters ?? {};
  if (input.template === undefined) {
    // A blank document declares no parameter, so any value given is for one it does not have.
    if (Object.keys(given).length > 0) {
      return { answer: 'parameter.unknown', parameters: Object.keys(given) };
    }
    const content: OutlineDocument = {
      schemaVersion: OUTLINE_SCHEMA_VERSION,
      ...heading,
      nodes: [],
    };
    const version = await createArtifact(trx, {
      author: input.author,
      spaceId: input.spaceId,
      substance: { kind: 'document', content },
    });
    return { answer: 'created', version };
  }

  // From a template (templates.md, "Making a document from a template"): read at its latest version
  // where the author may read it, resolved, and materialised - all in this transaction, so a template
  // that fails any step leaves nothing behind.
  if (!UUID.test(input.template)) return { answer: 'template.missing' };
  const facts = await loadFacts(trx, input.author, { kind: 'artifact', id: input.template });
  if (!facts || !decide('read', facts).allowed) return { answer: 'template.missing' };
  const template = await readTemplate(trx, input.template);
  if (!template) return { answer: 'template.missing' };
  const resolved = resolveTemplate(
    template.definition,
    await templateReferences(trx, template.definition),
  );
  if (!resolved.ok) return { answer: 'template.unresolved', unresolved: resolved.unresolved };
  // Its parameters (TP1-G), in this order: a name it does not declare, each value against its
  // declaration, the template's own parameter checks against what resolves now, and each seeded value
  // against its field - so nothing is written on any refusal (TPL-018).
  const declared = template.definition.parameters ?? [];
  const checked = checkDocumentParameters(declared, given);
  if (checked) return parameterValuesRefused(checked);
  const unusable = refusedParameters(template.definition, resolved);
  if (unusable) return unusable;
  const parameters = present(given);
  const seeded = seededValues(declared, parameters);
  const unfit = checkWrittenValues(resolved.document, seeded);
  if (unfit.length > 0) {
    return {
      answer: 'parameter.invalid',
      problems: unfit.flatMap((failure) =>
        feeding(declared, failure.field).map((parameter) => ({
          parameter,
          rule: failure.rule,
          value: shownValue(parameters[parameter]),
          field: failure.field,
        })),
      ),
    };
  }
  const { outline, values } = materialiseTemplate(resolved, heading, newNodeIdentifier);
  const version = await createArtifact(trx, {
    author: input.author,
    spaceId: input.spaceId,
    // Each seeded field's value over its default (TPL-066's half), once: afterwards it is the author's.
    substance: { kind: 'document', content: outline, values: { ...values, ...seeded }, parameters },
  });
  await trx
    .insertInto('document_template')
    .values({
      document_id: version.artifactId,
      template_id: template.id,
      template_version_id: template.version.id,
    })
    .execute();
  return { answer: 'created', version };
}

/**
 * Checked values as stored: a null, which `checkParameterValues` reads as no value, is left out, so an
 * optional parameter given none is recorded as absent and never as null.
 */
function present(values: Readonly<Record<string, unknown>>): DocumentParameters {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== null && value !== undefined),
  ) as DocumentParameters;
}

/** The parameters that seed a field, by name. */
function feeding(declared: readonly TemplateParameter[], field: string): string[] {
  return declared.filter((each) => each.feeds.field === field).map((each) => each.name);
}

/** A value as a refusal names it: text as it is, anything else as JSON (DAT-020's spelling). */
function shownValue(value: unknown): string {
  return value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
}

/** The domain's refusal of parameter values, as the store answers it. */
function parameterValuesRefused(
  refused: NonNullable<ReturnType<typeof checkDocumentParameters>>,
): ParameterValuesRefused {
  return refused.code === 'parameter_unknown'
    ? { answer: 'parameter.unknown', parameters: refused.parameters }
    : { answer: 'parameter.invalid', problems: refused.problems };
}

/**
 * A document at its latest version, with its space. Undefined when this environment holds no such
 * artifact, or holds one that is not a document: `authorise` never looks at an artifact's kind, so
 * this is where a component's id on a document's route is turned away.
 */
export async function readDocument(
  trx: TenantTransaction,
  id: string,
): Promise<StoredDocument | undefined> {
  const version = await latestVersion(trx, id);
  if (!version || version.kind !== 'document') return undefined;
  const space = await trx
    .selectFrom('artifact as a')
    .innerJoin('space as s', 's.id', 'a.space_id')
    .select(['s.id', 's.name'])
    .where('a.id', '=', id)
    .executeTakeFirstOrThrow();
  return { id, space, version };
}

/** Narrowing the documents listing: to these spaces, and these publishing states (SCH-064). */
export interface DocumentFilter {
  readonly spaces?: readonly string[];
  readonly publishing?: readonly PublishingState[];
}

/**
 * The documents a principal may read, a page at a time by keyset over the sort asked for and then the
 * id, as of the snapshot the walk's first page took (API-007, SCH-022), filtered by the readable set
 * inside the query (access.md, "The readable set"), the predicate `listReadableComponents` uses, and by
 * space and publishing state, each a facet counted without its own (SCH-064). Whether each is published
 * is read from the latest publication of it the reader may read, as of that snapshot too, so a walk's
 * pages agree. Undefined when the tenant holds no such principal.
 */
export async function listReadableDocuments(
  trx: TenantTransaction,
  principalId: string,
  request: ListingRequest<SortOf<'documents'>> = { limit: 100 },
  filter: DocumentFilter = {},
): Promise<
  | (Listed<DocumentSummary> & {
      readonly total: number;
      readonly facets: {
        readonly spaces: readonly FacetCount[];
        readonly publishing: readonly FacetCount[];
      };
    })
  | undefined
> {
  const limit = checkedLimit(request.limit);
  const sort = request.sort ?? 'title';
  const { types, order: byDefault } = listingSorts.documents[sort];
  if (!isListingRequest(request, types)) {
    throw new Error('A page request names a cursor no listing gave out');
  }
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return undefined;
  const snapshot = await snapshotFor(trx, request.snapshot);

  // The latest version's state against the latest publication the reader may read, as of the snapshot.
  const publishing = sql<PublishingState>`case
    when published.document_version_id is null then 'neverPublished'
    when published.document_version_id = latest.version_id then 'published'
    else 'changedSince' end`;

  /** The documents the reader may read, as of the snapshot, with every filter but `leaving`. */
  const base = (leaving?: keyof DocumentFilter) =>
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
              sql<string>`v.content ->> 'title'`.as('title'),
              // Every node's type, at any depth: the outline holds nothing else with one.
              sql<number>`jsonb_array_length(jsonb_path_query_array(v.content, 'strict $.**.type ? (@ == "section")'))`.as(
                'sections',
              ),
              sql<number>`jsonb_array_length(jsonb_path_query_array(v.content, 'strict $.**.type ? (@ == "reference")'))`.as(
                'components',
              ),
            ])
            .whereRef('v.artifact_id', '=', 'a.id')
            .where(visibleIn('v.written_by', snapshot))
            .orderBy('v.revision_no', 'desc')
            .orderBy('v.version_no', 'desc')
            .limit(1)
            .as('latest'),
        (join) => join.onTrue(),
      )
      .leftJoinLateral(
        (eb) =>
          eb
            .selectFrom('publication as p')
            .innerJoin('artifact as pa', 'pa.id', 'p.id')
            .select('p.document_version_id')
            .whereRef('p.document_id', '=', 'a.id')
            .where(readableArtifactsAs('pa', readable))
            .where(visibleIn('p.written_by', snapshot))
            .orderBy('p.published_at', 'desc')
            .orderBy('pa.created_at', 'desc')
            .limit(1)
            .as('published'),
        (join) => join.onTrue(),
      )
      .select(['a.id', 's.id as space_id', 's.name as space_name', 'latest.title'])
      .select(['latest.revision_no', 'latest.version_no', 'latest.version_id', 'latest.created_at'])
      .select(['latest.sections', 'latest.components'])
      .select(publishing.as('publishing'))
      .select(sortColumns([sort === 'title' ? sql`latest.title` : sql`latest.created_at`]))
      .where('a.kind', '=', 'document')
      .where((eb) => readableArtifacts(eb, readable))
      .$if(filter.spaces !== undefined && leaving !== 'spaces', (query) =>
        filter.spaces!.length === 0
          ? query.where(sql<boolean>`false`)
          : query.where('a.space_id', 'in', [...filter.spaces!]),
      )
      .$if(filter.publishing !== undefined && leaving !== 'publishing', (query) =>
        query.where(sql<boolean>`${publishing} = any(${[...filter.publishing!]}::text[])`),
      );
  const { rows, next } = await keysetPage<{
    id: string;
    title: string;
    space_id: string;
    space_name: string;
    revision_no: number;
    version_no: number;
    version_id: string;
    created_at: Date;
    sections: number;
    components: number;
    publishing: PublishingState;
  }>(trx, base(), types, request.order ?? byDefault, limit, request.after);

  return {
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      space: { id: row.space_id, name: row.space_name },
      revision: row.revision_no,
      version: row.version_no,
      changedAt: new Date(row.created_at),
      sections: Number(row.sections),
      components: Number(row.components),
      publishing: row.publishing,
    })),
    next,
    snapshot,
    total: await countOf(trx, base()),
    facets: {
      spaces: await facetOf(trx, base('spaces'), 'space_id', 'space_name'),
      publishing: await facetOf(trx, base('publishing'), 'publishing', 'publishing'),
    },
  };
}

/**
 * Which of these components the principal may read, for the view a reader is shown of an outline
 * (structure.md, "Who is shown what"): a reference to any other has its component withheld. Filtered
 * by the one readable-set predicate every listing uses (`readableArtifacts`), inside the query, so it
 * cannot disagree with what `GET /v1/components` lists. An id that is not a component in this
 * environment - another environment's, a document's, none at all - is never in the answer. Empty when
 * the tenant holds no such principal.
 */
export async function readableComponents(
  trx: TenantTransaction,
  principalId: string,
  components: readonly string[],
): Promise<ReadonlySet<string>> {
  const asked = [...new Set(components)].filter((id) => UUID.test(id));
  if (asked.length === 0) return new Set();
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return new Set();
  const rows = await trx
    .selectFrom('artifact as a')
    .select('a.id')
    .where('a.id', 'in', asked)
    .where('a.kind', '=', 'component')
    .where((eb) => readableArtifacts(eb, readable))
    .execute();
  return new Set(rows.map((row) => row.id));
}

/**
 * The one answer every refused reference target gets, whatever was wrong with it: no such artifact,
 * another environment's, a definition, a document - this one included - a component the author may
 * not read, or a pinned version of some other artifact. One sentence, so the refusal cannot be used to
 * learn whether an identifier exists (access.md: a thing you may not read is indistinguishable from
 * one that does not exist).
 */
const REFERENCE_REFUSED = 'The component is not one this outline can reference';

/**
 * What an operation would have the outline point at: an inserted reference's component and pinned
 * version, or the component of the reference a `set` pins. Undefined when it points at nothing new -
 * and for a `set` whose node is missing or is a section, which the operation refuses on its own.
 */
function targetOf(
  outline: OutlineDocument,
  operation: OutlineOperation,
): { readonly component: string; readonly version: string | null } | undefined {
  if (operation.operation === 'insert' && operation.node.type === 'reference') {
    const { component, mode } = operation.node;
    return { component, version: mode.kind === 'pinned' ? mode.version : null };
  }
  if (operation.operation === 'set' && operation.mode?.kind === 'pinned') {
    let node: OutlineNode | undefined;
    walkOutline(outline.nodes, (each) => {
      if (each.id === operation.node) node = each;
    });
    if (node?.type !== 'reference') return undefined;
    return { component: node.component, version: operation.mode.version };
  }
  return undefined;
}

/**
 * Whether the author may point an outline at this target: a **component**, in this environment, that
 * the author may **read**, decided by the same facts and the same `decide` every route uses; and a
 * pinned version that **belongs to that component**. A document references components alone in T1,
 * so its own id - the only way a cycle could close (structure.md) - is refused with the rest.
 */
async function mayReference(
  trx: TenantTransaction,
  author: string,
  target: { readonly component: string; readonly version: string | null },
): Promise<boolean> {
  if (!UUID.test(target.component)) return false;
  const artifact = await trx
    .selectFrom('artifact')
    .select('kind')
    .where('id', '=', target.component)
    .executeTakeFirst();
  if (artifact?.kind !== 'component') return false;
  const facts = await loadFacts(trx, author, { kind: 'artifact', id: target.component });
  if (!facts || !decide('read', facts).allowed) return false;
  if (target.version === null) return true;
  const version = await readVersion(trx, target.version);
  return version?.artifactId === target.component;
}

/**
 * One structural act, and one version (structure.md, "Editing the outline"). There is no document
 * lock and there cannot be one: `component_lock`'s check constraint refuses a document at the
 * database (COL-N02).
 *
 * The operation is applied to the version the caller **opened from**, never to the latest, so the
 * store never rebases one person's act onto another's; `recordVersion` then takes the advisory lock,
 * finds the latest and answers `version.precondition` with it when somebody moved first. An act that
 * changes nothing - a node put back where it was - is answered `version.unchanged` by the same digest
 * comparison, and the chain keeps no row for it (decision K).
 */
export async function editOutline(
  trx: TenantTransaction,
  input: {
    readonly artifactId: string;
    readonly openedFrom: string;
    readonly author: string;
    readonly operation: OutlineOperation;
  },
): Promise<OutlineAnswer> {
  const opened = await readVersion(trx, input.openedFrom);
  if (!opened || opened.artifactId !== input.artifactId || opened.kind !== 'document') {
    return { answer: 'artifact.missing' };
  }
  const read = readOutline(opened.content, { artifact: input.artifactId, version: opened.id });
  // A stored outline that does not read is a broken store, not the caller's mistake: thrown, as
  // `currentDefinition` throws on a definition that does not read, so the service logs it and answers
  // a 500. The failure names internal shapes, and a thrown error never reaches the wire.
  if (!read.ok) {
    throw new Error(
      `The document ${input.artifactId} at ${opened.id} does not read: ${read.failure}`,
    );
  }
  // Checked before the operation is applied, in this transaction, so what is recorded points only
  // at what the author may read: nothing is stored that a later rule would have to refuse.
  const target = targetOf(read.outline, input.operation);
  if (target && !(await mayReference(trx, input.author, target))) {
    return { answer: 'outline.invalid', reason: REFERENCE_REFUSED };
  }
  // Held to the document's template (TPL-015, STR-060): its recorded version's changes always, and
  // its section-level fields where a section's values are written, which needs it to resolve now.
  const rules = await documentRules(trx, input.artifactId);
  let held: OutlineRules = {};
  if (rules.bound) {
    const writesValues =
      input.operation.operation === 'set' && input.operation.values !== undefined;
    if (!rules.resolved.ok && writesValues) {
      return { answer: 'template.unresolved', unresolved: rules.resolved.unresolved };
    }
    held = rules.resolved.ok
      ? { changes: rules.changes, sectionFields: rules.resolved.section }
      : { changes: rules.changes };
  }
  const applied = applyOutlineOperation(read.outline, input.operation, newNodeIdentifier, held);
  if (!applied.applied) {
    return applied.failures
      ? { answer: 'values.invalid', failures: applied.failures }
      : { answer: 'outline.invalid', reason: applied.reason };
  }
  return recordVersion(trx, {
    artifactId: input.artifactId,
    openedFrom: input.openedFrom,
    author: input.author,
    // The document's values and parameters are not the outline's to change, so they are carried as
    // they stand (TP1-E).
    substance: {
      kind: 'document',
      content: applied.outline,
      values: opened.values,
      parameters: opened.parameters,
    },
  });
}

/**
 * A document's own values, written whole as its next version with the outline unchanged (templates.md,
 * "Values"): each checked against the document-level fields of its template, resolved now (TE-K), and
 * refused by name where it does not fit - a blank document has no field to hold one. Required is not
 * checked here but at publication (TPL-055). The version chain's precondition and unchanged answers are
 * `recordVersion`'s, as for an outline act.
 */
export async function recordDocumentValues(
  trx: TenantTransaction,
  input: {
    readonly documentId: string;
    readonly openedFrom: string;
    readonly author: string;
    readonly values: MetadataValues;
  },
): Promise<RecordAnswer | ValuesRefused> {
  const opened = await readVersion(trx, input.openedFrom);
  if (!opened || opened.artifactId !== input.documentId || opened.kind !== 'document') {
    return { answer: 'artifact.missing' };
  }
  const read = readOutline(opened.content, { artifact: input.documentId, version: opened.id });
  if (!read.ok) {
    throw new Error(
      `The document ${input.documentId} at ${opened.id} does not read: ${read.failure}`,
    );
  }
  const rules = await documentRules(trx, input.documentId);
  let fields: readonly EffectiveField[] = [];
  if (rules.bound) {
    if (!rules.resolved.ok) {
      return { answer: 'template.unresolved', unresolved: rules.resolved.unresolved };
    }
    fields = rules.resolved.document;
  }
  const failures = checkWrittenValues(fields, input.values);
  if (failures.length > 0) return { answer: 'values.invalid', failures };
  return recordVersion(trx, {
    artifactId: input.documentId,
    openedFrom: input.openedFrom,
    author: input.author,
    substance: {
      kind: 'document',
      content: read.outline,
      values: writtenValues(fields, input.values),
      // Carried as they stand (TP1-E): values are not parameters.
      parameters: opened.parameters,
    },
  });
}

/** A parameter that is not changeable given another value than the version opened holds (TPL-021). */
export type ParametersFixed = {
  readonly answer: 'parameter.fixed';
  readonly parameters: readonly string[];
};

/** Two parameter values, the same by their JSON: a list in its order. */
const sameParameter = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A document's parameters, written whole as its next version with its outline and values unchanged
 * (templates.md, "Recorded on the document"; TP1-H): checked against the declarations of the template
 * version it was made from (TP1-F) as at creation, and refused `parameter.fixed` where one that is not
 * changeable differs from the version opened - an unchanged one passes. A seeded field is not
 * rewritten: seeding happens once (TE-P).
 */
export async function recordDocumentParameters(
  trx: TenantTransaction,
  input: {
    readonly documentId: string;
    readonly openedFrom: string;
    readonly author: string;
    readonly parameters: Readonly<Record<string, unknown>>;
  },
): Promise<RecordAnswer | ParameterValuesRefused | ParametersFixed> {
  const opened = await readVersion(trx, input.openedFrom);
  if (!opened || opened.artifactId !== input.documentId || opened.kind !== 'document') {
    return { answer: 'artifact.missing' };
  }
  const read = readOutline(opened.content, { artifact: input.documentId, version: opened.id });
  if (!read.ok) {
    throw new Error(
      `The document ${input.documentId} at ${opened.id} does not read: ${read.failure}`,
    );
  }
  const rules = await documentRules(trx, input.documentId);
  const declared = rules.bound ? (rules.definition.parameters ?? []) : [];
  const checked = checkDocumentParameters(declared, input.parameters);
  if (checked) return parameterValuesRefused(checked);
  const given = present(input.parameters);
  const fixed = declared
    .filter((each) => !each.changeable)
    .filter((each) => !sameParameter(given[each.name], opened.parameters[each.name]))
    .map((each) => each.name);
  if (fixed.length > 0) return { answer: 'parameter.fixed', parameters: fixed };
  return recordVersion(trx, {
    artifactId: input.documentId,
    openedFrom: input.openedFrom,
    author: input.author,
    substance: {
      kind: 'document',
      content: read.outline,
      values: opened.values,
      parameters: given,
    },
  });
}

/** One change to a document's parameters, as its history shows it (TPL-020; TP1-H). */
export interface ParameterChange {
  readonly version: { readonly id: string; readonly revision: number; readonly version: number };
  readonly createdAt: Date;
  readonly author: { readonly id: string; readonly name: string | null } | null;
  /** Its parameters after the change, whole. */
  readonly parameters: DocumentParameters;
  /** The names whose values it changed, sorted: every name it holds, for the first version. */
  readonly changed: readonly string[];
}

/** The most changes one page of a document's parameter history holds. */
export const PARAMETER_HISTORY_MAX = 200;

/**
 * A document's parameter history, newest first (TPL-020; TP1-H): its first version, and each version
 * after it whose parameters differ from the one before, read from the version chain's own author and
 * time over the whole chain, so an outline or values act between two changes is passed over. A version
 * before 0057 reads as no parameters. A page is at most 200, by keyset over the version's number, with
 * where the next begins or null; the chain is append-only, so no snapshot is needed (`listVersions`).
 */
export async function parameterHistory(
  trx: TenantTransaction,
  documentId: string,
  page: { readonly limit: number; readonly after?: VersionPosition },
): Promise<{ readonly items: readonly ParameterChange[]; readonly next: VersionPosition | null }> {
  const limit = Math.min(Math.max(1, Math.trunc(page.limit)), PARAMETER_HISTORY_MAX);
  if (!UUID.test(documentId)) return { items: [], next: null };
  const { after } = page;
  const { rows } = await sql<{
    id: string;
    revision_no: number;
    version_no: number;
    created_at: Date;
    author_id: string | null;
    parameters: Record<string, unknown> | null;
    previous: Record<string, unknown> | null;
    display_name: string | null;
    email: string | null;
  }>`
    select c.id, c.revision_no, c.version_no, c.created_at, c.author_id, c.parameters, c.previous,
      p.display_name, p.email
    from (
      select v.id, v.revision_no, v.version_no, v.created_at, v.author_id, v.parameters,
        lag(v.parameters) over chain as previous, row_number() over chain as position
      from artifact_version v
      where v.artifact_id = ${documentId} and v.kind = 'document'
      window chain as (order by v.revision_no, v.version_no)
    ) c
    left join principal p on p.id = c.author_id
    where (c.position = 1 or c.parameters is distinct from c.previous)
      and (${after === undefined} or (c.revision_no, c.version_no) < (${after?.revision ?? 0}, ${after?.version ?? 0}))
    order by c.revision_no desc, c.version_no desc
    limit ${limit + 1}
  `.execute(trx);
  const shown = rows.slice(0, limit);
  const last = shown[shown.length - 1];
  return {
    items: shown.map((row) => {
      const now = (row.parameters ?? {}) as DocumentParameters;
      const before = (row.previous ?? {}) as DocumentParameters;
      const names = [...new Set([...Object.keys(now), ...Object.keys(before)])].sort();
      return {
        version: { id: row.id, revision: row.revision_no, version: row.version_no },
        createdAt: row.created_at,
        author:
          row.author_id === null
            ? null
            : { id: row.author_id, name: row.display_name ?? row.email ?? null },
        parameters: now,
        changed: names.filter((name) => !sameParameter(now[name], before[name])),
      };
    }),
    next:
      rows.length > limit && last !== undefined
        ? { revision: last.revision_no, version: last.version_no }
        : null,
  };
}
