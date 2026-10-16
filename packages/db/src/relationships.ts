import {
  endsRefused,
  resolveAssignedFields,
  validate,
  type EndRefusal,
  type MetadataFailure,
  type MetadataSchemaDefinition,
  type FieldDefinition,
  type RelationshipEnd,
  type RelationshipTypeDefinition,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { artifactPlace, recordEvent } from './audit.js';
import { currentDefinition } from './creation.js';
import type { TenantTransaction } from './tables.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A relationship as it is read (the R8 plan, R8-D). */
export interface StoredRelationship {
  readonly id: string;
  readonly type: string;
  readonly from: RelationshipEnd;
  readonly to: RelationshipEnd;
  readonly values: Readonly<Record<string, unknown>>;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly changedAt: Date;
}

/** An end as it is asked for: an artifact, and the version to pin, or none to float. */
export interface EndAsked {
  readonly artifact: string;
  readonly version?: string | null | undefined;
}

export type RelationshipAnswer =
  | { readonly answer: 'made' | 'changed'; readonly relationship: StoredRelationship }
  | { readonly answer: 'type.missing' }
  | { readonly answer: 'end.missing'; readonly end: 'from' | 'to' }
  | { readonly answer: 'end.refused'; readonly refusal: EndRefusal }
  | { readonly answer: 'version.foreign'; readonly end: 'from' | 'to' }
  | { readonly answer: 'cardinality.full'; readonly end: 'from' | 'to' }
  | { readonly answer: 'cycle' }
  | { readonly answer: 'values.invalid'; readonly failures: readonly MetadataFailure[] };

interface Row {
  id: string;
  type_id: string;
  from_id: string;
  from_kind: string;
  from_version: string | null;
  to_id: string;
  to_kind: string;
  to_version: string | null;
  field_values: unknown;
  created_by: string;
  created_at: Date;
  changed_at: Date;
}

const stored = (row: Row): StoredRelationship => ({
  id: row.id,
  type: row.type_id,
  from: { artifact: row.from_id, kind: row.from_kind, version: row.from_version },
  to: { artifact: row.to_id, kind: row.to_kind, version: row.to_version },
  values: row.field_values as Record<string, unknown>,
  createdBy: row.created_by,
  createdAt: row.created_at,
  changedAt: row.changed_at,
});

/** A relationship type at its latest version, or undefined where none is stored by that id. */
export async function relationshipType(
  trx: TenantTransaction,
  id: string,
): Promise<RelationshipTypeDefinition | undefined> {
  if (!UUID.test(id)) return undefined;
  return (await currentDefinition(trx, 'relationshipType', id))?.definition;
}

/** A relationship, or undefined where this environment holds none by that id. */
export async function readRelationship(
  trx: TenantTransaction,
  id: string,
): Promise<StoredRelationship | undefined> {
  if (!UUID.test(id)) return undefined;
  const { rows } = await sql<Row>`select * from relationship where id = ${id}`.execute(trx);
  return rows[0] && stored(rows[0]);
}

/** An end's artifact and kind, its version held to belong to it; or why not. */
async function endOf(
  trx: TenantTransaction,
  asked: EndAsked,
  end: 'from' | 'to',
): Promise<RelationshipEnd | RelationshipAnswer> {
  if (!UUID.test(asked.artifact)) return { answer: 'end.missing', end };
  const artifact = await trx
    .selectFrom('artifact')
    .select(['id', 'kind'])
    .where('id', '=', asked.artifact)
    .executeTakeFirst();
  if (!artifact) return { answer: 'end.missing', end };
  const version = asked.version ?? null;
  if (version !== null) {
    const held =
      UUID.test(version) &&
      (await trx
        .selectFrom('artifact_version')
        .select('id')
        .where('id', '=', version)
        .where('artifact_id', '=', asked.artifact)
        .executeTakeFirst());
    if (!held) return { answer: 'version.foreign', end };
  }
  return { artifact: artifact.id, kind: artifact.kind, version };
}

/** The fields a type's schemas assign, at the current definitions (REL-010, REL-053). */
async function typeFields(trx: TenantTransaction, type: RelationshipTypeDefinition) {
  const schemas: MetadataSchemaDefinition[] = [];
  const fields: FieldDefinition[] = [];
  for (const assignment of type.schemas) {
    const schema = await currentDefinition(trx, 'metadataSchema', assignment.schema);
    if (!schema) continue;
    schemas.push(schema.definition);
    for (const entry of schema.definition.entries) {
      const field = await currentDefinition(trx, 'field', entry.field);
      if (field && !fields.some((each) => each.id === field.definition.id)) {
        fields.push(field.definition);
      }
    }
  }
  return resolveAssignedFields(`Relationship type ${type.id}`, type.schemas, schemas, fields);
}

/** Whether `start` reaches `goal` along relationships of the type, either end floating or pinned. */
async function reaches(
  trx: TenantTransaction,
  type: string,
  start: string,
  goal: string,
  ignoring: string | null,
): Promise<boolean> {
  const { rows } = await sql<{ found: boolean }>`
    with recursive walk(id) as (
      select ${start}::uuid
      union
      select r.to_id from relationship r join walk w on r.from_id = w.id
       where r.type_id = ${type} and r.id is distinct from ${ignoring}::uuid
    )
    select exists (select 1 from walk where id = ${goal}::uuid) as found`.execute(trx);
  return rows[0]!.found;
}

/**
 * Everything a type asks of a relationship, checked in the caller's transaction (REL-008, REL-010,
 * REL-012, REL-034, REL-042, REL-045, REL-046, REL-049): the ends' kinds and self-reference, each end's
 * cardinality under an advisory lock on that end and type, so two at once cannot both find room; a
 * cycle where the type is acyclic, under a lock on the type; and its field values. `ignoring` is the
 * relationship being changed, which counts against nothing.
 */
async function checked(
  trx: TenantTransaction,
  typeId: string,
  type: RelationshipTypeDefinition,
  from: RelationshipEnd,
  to: RelationshipEnd,
  values: Readonly<Record<string, unknown>>,
  ignoring: string | null,
): Promise<RelationshipAnswer | undefined> {
  const refusal = endsRefused(type, from, to, ignoring === null);
  if (refusal) return { answer: 'end.refused', refusal };
  const keys = [
    ...(type.from.cardinality === 'one' ? [`from:${from.artifact}`] : []),
    ...(type.to.cardinality === 'one' ? [`to:${to.artifact}`] : []),
    ...(type.acyclic ? ['acyclic'] : []),
  ].sort();
  for (const key of keys) {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`relationship:${typeId}:${key}`}, 0))`.execute(
      trx,
    );
  }
  for (const end of ['from', 'to'] as const) {
    if (type[end].cardinality !== 'one') continue;
    const artifact = end === 'from' ? from.artifact : to.artifact;
    const { rows } = await sql<{ n: string }>`
      select count(*) as n from relationship
       where type_id = ${typeId} and ${sql.ref(`${end}_id`)} = ${artifact}
         and id is distinct from ${ignoring}::uuid`.execute(trx);
    if (Number(rows[0]!.n) > 0) return { answer: 'cardinality.full', end };
  }
  if (type.acyclic && (await reaches(trx, typeId, to.artifact, from.artifact, ignoring))) {
    return { answer: 'cycle' };
  }
  const failures = validate(await typeFields(trx, type), values);
  if (failures.length > 0) return { answer: 'values.invalid', failures };
  return undefined;
}

/** The audit record of an act on a relationship, on its from end's artifact (REL-011). */
async function audited(
  trx: TenantTransaction,
  kind: 'relationship.made' | 'relationship.changed' | 'relationship.removed',
  relationship: StoredRelationship,
): Promise<void> {
  const place = await artifactPlace(trx, relationship.from.artifact);
  await recordEvent(
    trx,
    {
      kind,
      subject: { kind: relationship.from.kind, id: relationship.from.artifact } as never,
      space: place.space,
      detail: { type: relationship.type, relationship: relationship.id },
    } as never,
    place.labels,
  );
}

/**
 * A relationship made (REL-001, REL-008, REL-010, REL-011, REL-013, REL-043; the R8 plan, R8-D,
 * R8-E): of a declared type, between two ends it permits, each pinned or floating, with the fields its
 * type assigns. Who may relate the two ends is the caller's to have decided.
 */
export async function makeRelationship(
  trx: TenantTransaction,
  input: {
    readonly by: string;
    readonly type: string;
    readonly from: EndAsked;
    readonly to: EndAsked;
    readonly values?: Readonly<Record<string, unknown>>;
  },
): Promise<RelationshipAnswer> {
  const type = await relationshipType(trx, input.type);
  if (!type) return { answer: 'type.missing' };
  const from = await endOf(trx, input.from, 'from');
  if ('answer' in from) return from;
  const to = await endOf(trx, input.to, 'to');
  if ('answer' in to) return to;
  const values = input.values ?? {};
  const refused = await checked(trx, input.type, type, from, to, values, null);
  if (refused) return refused;
  const { rows } = await sql<Row>`
    insert into relationship (type_id, from_id, from_kind, from_version, to_id, to_kind, to_version,
                              field_values, created_by)
    values (${input.type}, ${from.artifact}, ${from.kind}, ${from.version}, ${to.artifact},
            ${to.kind}, ${to.version}, ${JSON.stringify(values)}::jsonb, ${input.by})
    returning *`.execute(trx);
  const relationship = stored(rows[0]!);
  await audited(trx, 'relationship.made', relationship);
  return { answer: 'made', relationship };
}

/**
 * A relationship changed (REL-033, REL-034; R8-E): its fields, and either end re-targeted or
 * re-pinned, each change validated as creation is, against the type as it stands; audited.
 */
export async function changeRelationship(
  trx: TenantTransaction,
  input: {
    readonly id: string;
    readonly from?: EndAsked;
    readonly to?: EndAsked;
    readonly values?: Readonly<Record<string, unknown>>;
  },
): Promise<RelationshipAnswer | { readonly answer: 'missing' }> {
  const held = await readRelationship(trx, input.id);
  if (!held) return { answer: 'missing' };
  const type = await relationshipType(trx, held.type);
  if (!type) return { answer: 'type.missing' };
  const from = input.from ? await endOf(trx, input.from, 'from') : held.from;
  if ('answer' in from) return from;
  const to = input.to ? await endOf(trx, input.to, 'to') : held.to;
  if ('answer' in to) return to;
  const values = input.values ?? held.values;
  const refused = await checked(trx, held.type, type, from, to, values, held.id);
  if (refused) return refused;
  const { rows } = await sql<Row>`
    update relationship
       set from_id = ${from.artifact}, from_kind = ${from.kind}, from_version = ${from.version},
           to_id = ${to.artifact}, to_kind = ${to.kind}, to_version = ${to.version},
           field_values = ${JSON.stringify(values)}::jsonb, changed_at = now()
     where id = ${held.id}
    returning *`.execute(trx);
  const relationship = stored(rows[0]!);
  await audited(trx, 'relationship.changed', relationship);
  return { answer: 'changed', relationship };
}

/** A relationship removed, and the removal recorded (REL-011; R8-E). */
export async function removeRelationship(
  trx: TenantTransaction,
  id: string,
): Promise<{ readonly answer: 'removed' | 'missing' }> {
  const held = await readRelationship(trx, id);
  if (!held) return { answer: 'missing' };
  await sql`delete from relationship where id = ${id}`.execute(trx);
  await audited(trx, 'relationship.removed', held);
  return { answer: 'removed' };
}

/**
 * How many relationships of a type a new version of it would leave invalid (REL-054; R8-C): an end
 * whose kind it no longer permits, an artifact related to itself where it no longer may be, or an end
 * now holding more than one where its cardinality became one, or values its fields now refuse.
 */
export async function brokenByType(
  trx: TenantTransaction,
  typeId: string,
  next: RelationshipTypeDefinition,
): Promise<number> {
  const { rows } = await sql<Row>`select * from relationship where type_id = ${typeId}`.execute(
    trx,
  );
  const held = rows.map(stored);
  const count = (end: 'from' | 'to') => {
    const per = new Map<string, number>();
    for (const each of held) per.set(each[end].artifact, (per.get(each[end].artifact) ?? 0) + 1);
    return per;
  };
  const crowded = {
    from: next.from.cardinality === 'one' ? count('from') : new Map<string, number>(),
    to: next.to.cardinality === 'one' ? count('to') : new Map<string, number>(),
  };
  const fields = await typeFields(trx, next);
  return held.filter(
    (each) =>
      endsRefused(next, each.from, each.to, false) !== undefined ||
      (crowded.from.get(each.from.artifact) ?? 0) > 1 ||
      (crowded.to.get(each.to.artifact) ?? 0) > 1 ||
      validate(fields, each.values).length > 0,
  ).length;
}
