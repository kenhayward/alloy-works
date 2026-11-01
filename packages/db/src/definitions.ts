import { randomUUID } from 'node:crypto';
import {
  assignmentConflicts,
  brokenDefaults,
  checkSchema,
  componentTypeDefinitionSchema,
  fieldDefinitionSchema,
  metadataSchemaDefinitionSchema,
  definitionKinds,
  nameKey,
  variableDefinitionSchema,
  type VariableDefinition,
  conditionAxisDefinitionSchema,
  relationshipTypeDefinitionSchema,
  unrelatableKinds,
  type ConditionAxisDefinition,
  axisValues,
  AXIS_VOCABULARY_VALUES,
  type AxisValue,
  type StoredProfile,
  type RelationshipTypeDefinition,
  readDefinition,
  schemaConflicts,
  templateDefinitionSchema,
  type BrokenDefault,
  type DefinitionKind,
  type DefinitionOf,
  type MetadataFailure,
  type MetadataSchemaDefinition,
  type SchemaPlace,
  type SchemaConflict,
  sourcedEditRefusals,
  type Vocabulary,
  vocabularyChangeRefusals,
  vocabularyDefinitionSchema,
} from '@alloy-works/domain';
import { brokenByType } from './relationships.js';
import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';
import { createArtifact, latestVersion, recordVersion, type StoredVersion } from './versions.js';
import {
  checkedLimit,
  isListingRequest,
  keysetPage,
  listingSorts,
  snapshotFor,
  sortColumns,
  visibleIn,
  type Listed,
  type ListingRequest,
  type SortOf,
} from './listing.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A definition at one version: which it is, its kind, and its payload as it reads (definitions.md). */
export interface StoredDefinition<K extends DefinitionKind = DefinitionKind> {
  readonly id: string;
  readonly kind: K;
  readonly version: StoredVersion;
  readonly definition: DefinitionOf[K];
}

/** One definition as a listing shows it. */
export interface DefinitionSummary {
  readonly id: string;
  readonly kind: DefinitionKind;
  readonly name: string;
  /**
   * A variable's, an axis's or a vocabulary's key, which text or an import names it by (R5b, R6-A;
   * the VO plan, VO-I); absent for every other kind.
   */
  readonly key?: string;
  readonly version: { readonly id: string; readonly revision: number; readonly version: number };
}

/**
 * What making or changing a definition answers (definitions.md, "Making and changing"): the definition,
 * or the version chain's own answers, or the first check it failed - every failure of that check.
 */
export type DefinitionAnswer =
  | { readonly answer: 'created' | 'recorded'; readonly definition: StoredDefinition }
  | { readonly answer: 'version.unchanged'; readonly definition: StoredDefinition }
  | { readonly answer: 'version.precondition'; readonly current: StoredDefinition }
  | { readonly answer: 'definition.missing' }
  /** A field or schema it names that is not there, and each `requires` its schema does not group. */
  | {
      readonly answer: 'definition.unresolved';
      readonly missing: readonly string[];
      readonly requires: readonly MetadataFailure[];
    }
  /** A default of its own that its field refuses (`checkSchema`). */
  | { readonly answer: 'definition.invalid'; readonly failures: readonly MetadataFailure[] }
  /** MET-031: another definition of its kind holds the name, compared folded. */
  | {
      readonly answer: 'definition.name_taken';
      readonly holder: { readonly id: string; readonly name: string };
    }
  /** MET-008: two schemas the type assigns give a field different defaults. */
  | { readonly answer: 'assignment.conflict'; readonly failures: readonly MetadataFailure[] }
  /** MET-040: the schema's default would differ from another's where both are applied. */
  | { readonly answer: 'schema.conflict'; readonly conflicts: readonly SchemaConflict[] }
  /** MET-037: the field's next version would refuse a schema's default for it. */
  | { readonly answer: 'field.breaks_default'; readonly broken: readonly BrokenDefault[] };

const parsers = {
  field: fieldDefinitionSchema,
  metadataSchema: metadataSchemaDefinitionSchema,
  componentType: componentTypeDefinitionSchema,
  variable: variableDefinitionSchema,
  conditionAxis: conditionAxisDefinitionSchema,
  relationshipType: relationshipTypeDefinitionSchema,
  vocabulary: vocabularyDefinitionSchema,
} as const;

/** Every definition of a kind at its latest version, read as stored definitions are. */
export async function latestOfKind<K extends DefinitionKind>(
  trx: TenantTransaction,
  kind: K,
): Promise<StoredDefinition<K>[]> {
  const rows = await trx
    .selectFrom('artifact as a')
    .innerJoinLateral(
      (eb) =>
        eb
          .selectFrom('artifact_version as v')
          .select('v.id')
          .whereRef('v.artifact_id', '=', 'a.id')
          .orderBy('v.revision_no', 'desc')
          .orderBy('v.version_no', 'desc')
          .limit(1)
          .as('latest'),
      (join) => join.onTrue(),
    )
    .select(['a.id', 'latest.id as version_id'])
    .where('a.kind', '=', kind)
    .orderBy('a.id')
    .execute();
  const read: StoredDefinition<K>[] = [];
  for (const row of rows) {
    const stored = await readDefinitionLatest(trx, row.id);
    if (stored?.kind === kind) read.push(stored as StoredDefinition<K>);
  }
  // By name, then identifier, so what a refusal lists is in an order a person can follow and the
  // same every time.
  return read.sort((a, b) => byName(a.definition.name, a.id, b.definition.name, b.id));
}

const byName = (aName: string, aId: string, bName: string, bId: string) =>
  aName < bName ? -1 : aName > bName ? 1 : aId < bId ? -1 : aId > bId ? 1 : 0;

/**
 * A definition at its latest version, or undefined where this tenant holds no field, schema or
 * component type by that id. A stored payload that does not read is a broken store, and throws.
 */
export async function readDefinitionLatest(
  trx: TenantTransaction,
  id: string,
): Promise<StoredDefinition | undefined> {
  if (!UUID.test(id)) return undefined;
  const version = await latestVersion(trx, id);
  if (!version || !(definitionKinds as readonly string[]).includes(version.kind)) {
    return undefined;
  }
  const kind = version.kind as DefinitionKind;
  const read = readDefinition(kind, version.content, { artifact: id, version: version.id });
  if (!read.ok)
    throw new Error(`The ${kind} ${id} at ${version.id} does not read: ${read.failure}`);
  return { id, kind, version, definition: read.definition };
}

/**
 * Every field, metadata schema and component type, a page at a time by each one's latest name and then
 * id, as of the walk's first page (API-007, SCH-022): a definition renamed is a new version, so a walk
 * holds its order. Read by whoever may read definitions, which the route decides.
 */
export async function listDefinitions(
  trx: TenantTransaction,
  request: ListingRequest<SortOf<'definitions'>> = { limit: 100 },
): Promise<Listed<DefinitionSummary>> {
  const limit = checkedLimit(request.limit);
  const { types, order } = listingSorts.definitions.name;
  if (!isListingRequest(request, types)) {
    throw new Error('A page request names a cursor no listing gave out');
  }
  const snapshot = await snapshotFor(trx, request.snapshot);
  const inner = trx
    .selectFrom('artifact as a')
    .innerJoinLateral(
      (eb) =>
        eb
          .selectFrom('artifact_version as v')
          .select(['v.id', 'v.revision_no', 'v.version_no', 'v.content'])
          .whereRef('v.artifact_id', '=', 'a.id')
          .where(visibleIn('v.written_by', snapshot))
          .orderBy('v.revision_no', 'desc')
          .orderBy('v.version_no', 'desc')
          .limit(1)
          .as('latest'),
      (join) => join.onTrue(),
    )
    .select([
      'a.id',
      'a.kind',
      'latest.id as version_id',
      'latest.revision_no',
      'latest.version_no',
    ])
    .select(sql<string>`latest.content ->> 'name'`.as('name'))
    .select(sql<string | null>`latest.content ->> 'key'`.as('key'))
    .select(sortColumns([sql`latest.content ->> 'name'`]))
    .where('a.kind', 'in', [...definitionKinds]);
  const { rows, next } = await keysetPage<{
    id: string;
    kind: DefinitionKind;
    version_id: string;
    revision_no: number;
    version_no: number;
    name: string;
    key: string | null;
  }>(trx, inner, types, request.order ?? order, limit, request.after, request.language);
  return {
    items: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      ...((row.kind === 'variable' || row.kind === 'conditionAxis' || row.kind === 'vocabulary') &&
      row.key !== null
        ? { key: row.key }
        : {}),
      version: { id: row.version_id, revision: row.revision_no, version: row.version_no },
    })),
    next,
    snapshot,
  };
}

/**
 * Every vocabulary at its latest version, by name (the VO plan, VO-A): read by anyone signed in, so
 * the route, not `listDefinitions`, serves them.
 */
export const listVocabularies = (trx: TenantTransaction) => latestOfKind(trx, 'vocabulary');

/**
 * Every place a schema may be applied at in T1 (definitions.md, "Where a schema applies"): each
 * component type and each level of each template, at their latest versions, with the schemas each
 * assigns there.
 */
export async function placesOf(trx: TenantTransaction): Promise<readonly SchemaPlace[]> {
  const places: SchemaPlace[] = [];
  for (const type of await latestOfKind(trx, 'componentType')) {
    places.push({
      kind: 'componentType',
      id: type.id,
      name: type.definition.name,
      schemas: type.definition.assignments.map((each) => each.schema),
    });
  }
  const templates = await trx
    .selectFrom('artifact as a')
    .innerJoinLateral(
      (eb) =>
        eb
          .selectFrom('artifact_version as v')
          .select('v.content')
          .whereRef('v.artifact_id', '=', 'a.id')
          .orderBy('v.revision_no', 'desc')
          .orderBy('v.version_no', 'desc')
          .limit(1)
          .as('latest'),
      (join) => join.onTrue(),
    )
    .select(['a.id', 'latest.content'])
    .where('a.kind', '=', 'template')
    .orderBy('a.id')
    .execute();
  const read = templates
    .map((row) => ({ id: row.id, template: templateDefinitionSchema.parse(row.content) }))
    .sort((a, b) => byName(a.template.name, a.id, b.template.name, b.id));
  for (const { id, template } of read) {
    for (const level of ['document', 'section'] as const) {
      const schemas = template.schemas
        .filter((each) => each.level === level)
        .map((each) => each.schema);
      if (schemas.length > 0) {
        places.push({ kind: 'template', id, name: template.name, level, schemas });
      }
    }
  }
  return places;
}

/**
 * Serialises every write of a definition in this tenant, so the name check and the name's row are one
 * act: the unique index holds the rule, and this keeps a race from reaching it as an exception. An
 * advisory lock is the cluster's, and every tenant is a schema of one database, so the key carries the
 * tenant's schema: two tenants never wait on each other.
 */
async function holdDefinitions(trx: TenantTransaction): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtext(current_schema() || ':definition_name'))`.execute(
    trx,
  );
}

/** The definition holding a name of this kind, other than `self`, or undefined. */
async function nameHolder(
  trx: TenantTransaction,
  kind: DefinitionKind,
  name: string,
  self?: string,
): Promise<{ readonly id: string; readonly name: string } | undefined> {
  let query = trx
    .selectFrom('definition_name')
    .select('artifact_id')
    .where('kind', '=', kind)
    .where('name_key', '=', nameKey(name));
  if (self !== undefined) query = query.where('artifact_id', '!=', self);
  const row = await query.executeTakeFirst();
  if (!row) return undefined;
  const holder = await readDefinitionLatest(trx, row.artifact_id);
  return { id: row.artifact_id, name: holder?.definition.name ?? name };
}

/**
 * Every check a definition passes before it is written (definitions.md, "Making and changing"), in
 * order: what it names exists, its own defaults are valid, its name is free, and its kind's check
 * against what uses it. Undefined where it passes them all.
 */
async function refusal(
  trx: TenantTransaction,
  kind: DefinitionKind,
  candidate: DefinitionOf[DefinitionKind],
  self?: string,
  refreshed = false,
): Promise<DefinitionAnswer | undefined> {
  if (kind === 'field') {
    // A vocabulary it draws on is a vocabulary (MET-003; the VO plan, VO-C).
    const field = candidate as DefinitionOf['field'];
    const vocabulary = field.dataType === 'text' ? field.validation.vocabulary : undefined;
    if (
      vocabulary !== undefined &&
      (await readDefinitionLatest(trx, vocabulary))?.kind !== 'vocabulary'
    ) {
      return { answer: 'definition.unresolved', missing: [vocabulary], requires: [] };
    }
  }
  if (kind === 'metadataSchema') {
    const schema = candidate as MetadataSchemaDefinition;
    const fields = [];
    const missing: string[] = [];
    for (const each of schema.entries) {
      const field = await readDefinitionLatest(trx, each.field);
      if (field?.kind === 'field') fields.push(field.definition as DefinitionOf['field']);
      else missing.push(each.field);
    }
    if (missing.length > 0) return { answer: 'definition.unresolved', missing, requires: [] };
    const failures = checkSchema(schema, fields);
    if (failures.length > 0) return { answer: 'definition.invalid', failures };
  }
  if (kind === 'componentType') {
    const type = candidate as DefinitionOf['componentType'];
    const schemas: MetadataSchemaDefinition[] = [];
    const missing: string[] = [];
    for (const each of type.assignments) {
      const schema = await readDefinitionLatest(trx, each.schema);
      if (schema?.kind === 'metadataSchema') {
        schemas.push(schema.definition as MetadataSchemaDefinition);
      } else missing.push(each.schema);
    }
    const failures = missing.length > 0 ? [] : assignmentConflicts(type, schemas);
    const requires = failures.filter((each) => each.rule === 'requires');
    if (missing.length > 0 || requires.length > 0) {
      return { answer: 'definition.unresolved', missing, requires };
    }
    const holder = await nameHolder(trx, kind, candidate.name, self);
    if (holder) return { answer: 'definition.name_taken', holder };
    if (failures.length > 0) return { answer: 'assignment.conflict', failures };
    return undefined;
  }
  if (kind === 'variable') {
    // A field it takes a value from is a field; its key is no other variable's (the R5 plan, R5-A).
    const variable = candidate as VariableDefinition;
    const field = variable.sources.field;
    if (field !== undefined && (await readDefinitionLatest(trx, field))?.kind !== 'field') {
      return { answer: 'definition.unresolved', missing: [field], requires: [] };
    }
    const refused = await keyRefused(trx, 'variable', variable.key, self);
    if (refused) return refused;
  }
  if (kind === 'relationshipType') {
    // Its kinds drawn from those people relate (the R19 plan, R19-A).
    const unrelatable = unrelatableKinds(candidate as RelationshipTypeDefinition);
    if (unrelatable.length > 0) {
      return {
        answer: 'definition.invalid',
        failures: unrelatable.map((each) => ({
          code: 'metadata.unknown' as const,
          field: each,
          rule: 'unknown' as const,
          schemas: [],
          detail: `A relationship cannot join a ${each}: choose a component, document, publication, asset, template, query definition or dataset`,
        })),
      };
    }
  }
  if (kind === 'relationshipType' && self !== undefined) {
    // A change that would leave relationships of the type invalid is refused, counted (REL-054).
    const broken = await brokenByType(trx, self, candidate as RelationshipTypeDefinition);
    if (broken > 0) {
      return {
        answer: 'definition.invalid',
        failures: [
          {
            code: 'metadata.fixed',
            field: self,
            rule: 'fixed',
            schemas: [],
            detail: `${broken} ${broken === 1 ? 'relationship' : 'relationships'} of this type would become invalid`,
          },
        ],
      };
    }
  }
  if (kind === 'conditionAxis') {
    // As a variable's (the R6 plan, R6-A): every condition mark in text names it by its key.
    const axis = candidate as ConditionAxisDefinition;
    if (axis.vocabulary !== undefined) {
      // The vocabulary it draws on is one, of at most an axis's own list's 200 values (VO-E).
      const drawn = await readDefinitionLatest(trx, axis.vocabulary);
      if (drawn?.kind !== 'vocabulary') {
        return { answer: 'definition.unresolved', missing: [axis.vocabulary], requires: [] };
      }
      const held = (drawn.definition as Vocabulary).values.length;
      if (held > AXIS_VOCABULARY_VALUES) return axisTooLarge(axis.vocabulary, held);
    }
    const refused = await keyRefused(trx, 'conditionAxis', axis.key, self);
    if (refused) return refused;
  }
  if (kind === 'vocabulary') {
    // Its key fixed and its own; and a version keeps every value, retired ones too, so the latest
    // alone is checked (LIB-023; the VO plan, VO-B).
    const vocabulary = candidate as Vocabulary;
    const refused = await keyRefused(trx, 'vocabulary', vocabulary.key, self);
    if (refused) return refused;
    const held = self === undefined ? undefined : await readDefinitionLatest(trx, self);
    const dropped = vocabularyChangeRefusals(
      held?.definition as Vocabulary | undefined,
      vocabulary,
    );
    if (dropped.length > 0) {
      return {
        answer: 'definition.invalid',
        failures: dropped.map((each) => ({
          code: 'metadata.fixed' as const,
          field: each,
          rule: 'fixed' as const,
          schemas: [],
          detail: `A vocabulary keeps every value: retire ${each} rather than remove it`,
        })),
      };
    }
    // A sourced one's values are its source's but for their states, which a refresh alone sets
    // (LIB-058; the VO plan, VO-J).
    const sourced = refreshed
      ? []
      : sourcedEditRefusals(held?.definition as Vocabulary | undefined, vocabulary);
    if (sourced.length > 0) {
      return {
        answer: 'definition.invalid',
        failures: sourced.map((detail) => ({
          code: 'metadata.fixed' as const,
          field: detail.slice(0, detail.indexOf(':')),
          rule: 'fixed' as const,
          schemas: [],
          detail: `A sourced vocabulary takes its values from its source: ${detail}`,
        })),
      };
    }
    // One an axis names holds no more values than an axis may (VO-E).
    if (
      self !== undefined &&
      vocabulary.values.length > AXIS_VOCABULARY_VALUES &&
      (await latestOfKind(trx, 'conditionAxis')).some((each) => each.definition.vocabulary === self)
    ) {
      return axisTooLarge(self, vocabulary.values.length);
    }
  }
  const holder = await nameHolder(trx, kind, candidate.name, self);
  if (holder) return { answer: 'definition.name_taken', holder };
  if (kind === 'metadataSchema' && self !== undefined) {
    const schema = candidate as MetadataSchemaDefinition;
    const places = await placesOf(trx);
    const beside = new Set(
      places.filter((place) => place.schemas.includes(self)).flatMap((place) => place.schemas),
    );
    beside.delete(self);
    const schemas: MetadataSchemaDefinition[] = [];
    for (const id of beside) {
      const other = await readDefinitionLatest(trx, id);
      if (other?.kind === 'metadataSchema')
        schemas.push(other.definition as MetadataSchemaDefinition);
    }
    const conflicts = schemaConflicts(schema, places, schemas);
    if (conflicts.length > 0) return { answer: 'schema.conflict', conflicts };
  }
  if (kind === 'field' && self !== undefined) {
    const grouping = (await latestOfKind(trx, 'metadataSchema'))
      .map((each) => each.definition)
      .filter((schema) => schema.entries.some((each) => each.field === self));
    const broken = brokenDefaults(candidate as DefinitionOf['field'], grouping);
    if (broken.length > 0) return { answer: 'field.breaks_default', broken };
  }
  return undefined;
}

/**
 * Makes a definition at 0.1 (MET-041) from its kind and its payload without an id: the id is allocated
 * here (DE-B). A payload that does not read is the caller's contract broken, and throws; a definition
 * that fails a check is refused by name, with nothing written.
 */
export async function createDefinition(
  trx: TenantTransaction,
  input: { readonly kind: DefinitionKind; readonly definition: unknown; readonly author: string },
): Promise<DefinitionAnswer> {
  const id = randomUUID();
  const definition = parsers[input.kind].parse({
    ...(input.definition as object),
    id,
  }) as DefinitionOf[DefinitionKind];
  await holdDefinitions(trx);
  const refused = await refusal(trx, input.kind, definition);
  if (refused) return refused;
  // `createArtifact` holds the name, as it does for a definition made any other way.
  await createArtifact(trx, {
    author: input.author,
    substance: { kind: input.kind, content: definition } as never,
  });
  return { answer: 'created', definition: (await readDefinitionLatest(trx, id))! };
}

/**
 * Cuts a definition's next version from the one its manager opened (MET-041, API-037), from a whole
 * payload without an id, checked as a new one is and against everything that uses it.
 */
export async function recordDefinitionVersion(
  trx: TenantTransaction,
  input: {
    readonly id: string;
    readonly openedFrom: string;
    readonly definition: unknown;
    readonly author: string;
    /** A vocabulary's version made by a refresh from its source, which may change its values (VO-J). */
    readonly refreshed?: true;
  },
): Promise<DefinitionAnswer> {
  const current = await readDefinitionLatest(trx, input.id);
  if (!current) return { answer: 'definition.missing' };
  const definition = parsers[current.kind].parse({
    ...(input.definition as object),
    id: input.id,
  }) as DefinitionOf[DefinitionKind];
  await holdDefinitions(trx);
  const refused = await refusal(trx, current.kind, definition, input.id, input.refreshed === true);
  if (refused) return refused;
  const answer = await recordVersion(trx, {
    artifactId: input.id,
    openedFrom: input.openedFrom,
    author: input.author,
    substance: { kind: current.kind, content: definition } as never,
  });
  switch (answer.answer) {
    case 'recorded':
      // `recordVersion` renamed it, as it renames a definition changed any other way.
      return { answer: 'recorded', definition: (await readDefinitionLatest(trx, input.id))! };
    case 'version.unchanged':
      return { answer: 'version.unchanged', definition: current };
    case 'version.precondition':
      return { answer: 'version.precondition', current };
    case 'artifact.missing':
      return { answer: 'definition.missing' };
  }
}

/**
 * A keyed definition's key refused: changed from the one it was made with, which content names it
 * by (#644's review; the R6 plan, R6-A), or another of its kind's.
 */
async function keyRefused(
  trx: TenantTransaction,
  kind: 'variable' | 'conditionAxis' | 'vocabulary',
  key: string,
  self: string | undefined,
): Promise<DefinitionAnswer | undefined> {
  if (self !== undefined) {
    const held = (await readDefinitionLatest(trx, self))?.definition as
      { readonly key: string } | undefined;
    if (held !== undefined && held.key !== key) {
      return {
        answer: 'definition.invalid',
        failures: [
          {
            code: 'metadata.fixed',
            field: self,
            rule: 'fixed',
            schemas: [],
            detail: `${{ variable: 'A variable', conditionAxis: 'An axis', vocabulary: 'A vocabulary' }[kind]} keeps its key, ${held.key}`,
          },
        ],
      };
    }
  }
  const keyed = (await latestOfKind(trx, kind)).find(
    (each) => each.definition.key === key && each.id !== self,
  );
  return keyed
    ? { answer: 'definition.name_taken', holder: { id: keyed.id, name: keyed.definition.name } }
    : undefined;
}

/**
 * What a profile names that the environment does not declare (REU-022; R6-B): an axis by its key, a
 * value as `axis.value`; empty where every one is declared.
 */
export async function profileUnknown(
  trx: TenantTransaction,
  profile: StoredProfile,
): Promise<string[]> {
  const axes = await axesByKey(trx);
  return Object.entries(profile.values).flatMap(([key, values]) => {
    const axis = axes.get(key);
    if (axis === undefined) return [key];
    // A retired value is declared still, so a profile already naming it stays valid (LIB-023; VO-E).
    const declared = new Set(axis.values.map((each) => each.key));
    return values.filter((value) => !declared.has(value)).map((value) => `${key}.${value}`);
  });
}

/** An axis and its permitted values, its own or its vocabulary's, as `axisValues` gives them. */
export interface ResolvedAxis {
  readonly definition: ConditionAxisDefinition;
  readonly values: readonly AxisValue[];
}

/**
 * The environment's condition axes by key, each at its latest version with its values resolved
 * (REU-020; R6-A; LIB-022, the VO plan, VO-E): each vocabulary an axis names read once.
 */
export async function axesByKey(trx: TenantTransaction): Promise<Map<string, ResolvedAxis>> {
  const stored = await latestOfKind(trx, 'conditionAxis');
  const vocabularies = new Map<string, Vocabulary>();
  for (const id of new Set(stored.flatMap((each) => each.definition.vocabulary ?? []))) {
    const drawn = await readDefinitionLatest(trx, id);
    if (drawn?.kind === 'vocabulary') vocabularies.set(id, drawn.definition as Vocabulary);
  }
  return new Map(
    stored.map((each) => [
      each.definition.key,
      {
        definition: each.definition,
        values: axisValues(each.definition, (id) => vocabularies.get(id)),
      },
    ]),
  );
}

/** An axis naming a vocabulary of more values than an axis may hold (VO-E). */
const axisTooLarge = (vocabulary: string, held: number): DefinitionAnswer => ({
  answer: 'definition.invalid',
  failures: [
    {
      code: 'metadata.fixed',
      field: vocabulary,
      rule: 'fixed',
      schemas: [],
      detail: `An axis draws on a vocabulary of at most ${AXIS_VOCABULARY_VALUES} values; this one holds ${held}`,
    },
  ],
});

/**
 * The environment's variables by key, each at its latest version (REU-018; the R5 plan, R5-A): what a
 * publish resolves a content `variable` node by.
 */
export async function variablesByKey(
  trx: TenantTransaction,
): Promise<Map<string, VariableDefinition>> {
  const stored = await latestOfKind(trx, 'variable');
  return new Map(stored.map((each) => [each.definition.key, each.definition]));
}
