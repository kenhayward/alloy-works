import { randomUUID } from 'node:crypto';
import {
  assignmentConflicts,
  brokenDefaults,
  checkSchema,
  componentTypeDefinitionSchema,
  fieldDefinitionSchema,
  metadataSchemaDefinitionSchema,
  nameKey,
  readDefinition,
  schemaConflicts,
  templateDefinitionSchema,
  type BrokenDefault,
  type DefinitionKind,
  type DefinitionOf,
  type MetadataFailure,
  type MetadataSchemaDefinition,
  type Place,
  type SchemaConflict,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';
import { createArtifact, latestVersion, recordVersion, type StoredVersion } from './versions.js';

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
} as const;

/** Every definition of a kind at its latest version, read as stored definitions are. */
async function latestOfKind<K extends DefinitionKind>(
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
  return read;
}

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
  if (
    !version ||
    (version.kind !== 'field' &&
      version.kind !== 'metadataSchema' &&
      version.kind !== 'componentType')
  ) {
    return undefined;
  }
  const kind = version.kind;
  const read = readDefinition(kind, version.content, { artifact: id, version: version.id });
  if (!read.ok)
    throw new Error(`The ${kind} ${id} at ${version.id} does not read: ${read.failure}`);
  return { id, kind, version, definition: read.definition };
}

/** Every field, schema and component type at its latest version, by kind and then name. */
export async function listDefinitions(
  trx: TenantTransaction,
): Promise<readonly DefinitionSummary[]> {
  const all: DefinitionSummary[] = [];
  for (const kind of ['field', 'metadataSchema', 'componentType'] as const) {
    const each = await latestOfKind(trx, kind);
    all.push(
      ...each
        .map((stored) => ({
          id: stored.id,
          kind,
          name: stored.definition.name,
          version: {
            id: stored.version.id,
            revision: stored.version.revision,
            version: stored.version.version,
          },
        }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    );
  }
  return all;
}

/**
 * Every place a schema may be applied at in T1 (definitions.md, "Where a schema applies"): each
 * component type and each level of each template, at their latest versions, with the schemas each
 * assigns there.
 */
export async function placesOf(trx: TenantTransaction): Promise<readonly Place[]> {
  const places: Place[] = [];
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
  for (const row of templates) {
    const template = templateDefinitionSchema.parse(row.content);
    for (const level of ['document', 'section'] as const) {
      const schemas = template.schemas
        .filter((each) => each.level === level)
        .map((each) => each.schema);
      if (schemas.length > 0) {
        places.push({ kind: 'template', id: row.id, name: template.name, level, schemas });
      }
    }
  }
  return places;
}

/**
 * Serialises every write of a definition in this tenant, so the name check and the name's row are one
 * act: the unique index holds the rule, and this keeps a race from reaching it as an exception.
 */
async function holdDefinitions(trx: TenantTransaction): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtext('definition_name'))`.execute(trx);
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
): Promise<DefinitionAnswer | undefined> {
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
  await createArtifact(trx, {
    author: input.author,
    substance: { kind: input.kind, content: definition } as never,
  });
  await trx
    .insertInto('definition_name')
    .values({ artifact_id: id, kind: input.kind, name_key: nameKey(definition.name) })
    .execute();
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
  },
): Promise<DefinitionAnswer> {
  const current = await readDefinitionLatest(trx, input.id);
  if (!current) return { answer: 'definition.missing' };
  const definition = parsers[current.kind].parse({
    ...(input.definition as object),
    id: input.id,
  }) as DefinitionOf[DefinitionKind];
  await holdDefinitions(trx);
  const refused = await refusal(trx, current.kind, definition, input.id);
  if (refused) return refused;
  const answer = await recordVersion(trx, {
    artifactId: input.id,
    openedFrom: input.openedFrom,
    author: input.author,
    substance: { kind: current.kind, content: definition } as never,
  });
  switch (answer.answer) {
    case 'recorded':
      await trx
        .updateTable('definition_name')
        .set({ name_key: nameKey(definition.name) })
        .where('artifact_id', '=', input.id)
        .execute();
      return { answer: 'recorded', definition: (await readDefinitionLatest(trx, input.id))! };
    case 'version.unchanged':
      return { answer: 'version.unchanged', definition: current };
    case 'version.precondition':
      return { answer: 'version.precondition', current };
    case 'artifact.missing':
      return { answer: 'definition.missing' };
  }
}
