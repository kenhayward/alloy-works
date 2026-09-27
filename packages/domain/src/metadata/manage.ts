import { checkAssignment } from './check-assignment.js';
import { checkValue } from './check-value.js';
import type { ComponentTypeDefinition } from './component-type.js';
import type { MetadataFailure, MetadataRule } from './failure.js';
import type { FieldDefinition } from './field.js';
import type { MetadataSchemaDefinition } from './schema.js';

/**
 * A definition's name as it is compared for uniqueness (definitions.md, "Names"; MET-031): trimmed,
 * composed and lower-cased, so two spellings a person would read as one name are one name.
 */
export function nameKey(name: string): string {
  return name.trim().normalize('NFC').toLowerCase();
}

/**
 * Every conflict among the schemas a component type assigns (MET-008): a `requires` naming a field its
 * schema does not group, and a pair of schemas giving one field different defaults. `checkAssignment`
 * over each assignment against the ones before it, so each pair is named once, in assignment order.
 * `schemas` holds each assigned schema at the version the type would take, its latest.
 */
export function assignmentConflicts(
  type: ComponentTypeDefinition,
  schemas: readonly MetadataSchemaDefinition[],
): MetadataFailure[] {
  const byId = new Map(schemas.map((schema) => [schema.id, schema]));
  const assigned: MetadataSchemaDefinition[] = [];
  const failures: MetadataFailure[] = [];
  for (const assignment of type.assignments) {
    const schema = byId.get(assignment.schema);
    if (schema === undefined) {
      throw new Error(
        `Component type ${type.id} assigns schema ${assignment.schema}, not supplied`,
      );
    }
    failures.push(...checkAssignment(assigned, { assignment, schema }));
    assigned.push(schema);
  }
  return failures;
}

/**
 * A place a schema is applied at in T1 (definitions.md, "Where a schema applies"): a component type,
 * or one level of a template, with the schemas it assigns there.
 */
export type Place =
  | {
      readonly kind: 'componentType';
      readonly id: string;
      readonly name: string;
      readonly schemas: readonly string[];
    }
  | {
      readonly kind: 'template';
      readonly id: string;
      readonly name: string;
      readonly level: 'document' | 'section';
      readonly schemas: readonly string[];
    };

/** A place as a refusal names it, without the schemas it assigns. */
export type PlaceName =
  | { readonly kind: 'componentType'; readonly id: string; readonly name: string }
  | {
      readonly kind: 'template';
      readonly id: string;
      readonly name: string;
      readonly level: 'document' | 'section';
    };

/** A field a schema's next version would give a default disagreeing with another's, and where. */
export interface SchemaConflict {
  readonly field: string;
  readonly other: string;
  readonly places: readonly PlaceName[];
}

/**
 * MET-040's check: the candidate version of a schema against every schema applied beside it, at every
 * place it is applied - each a default the two give one field differently, grouped by field and other
 * schema with every place it happens at, in the order the places are given. `schemas` holds the other
 * schemas at their latest versions.
 */
export function schemaConflicts(
  candidate: MetadataSchemaDefinition,
  places: readonly Place[],
  schemas: readonly MetadataSchemaDefinition[],
): SchemaConflict[] {
  const byId = new Map(schemas.map((schema) => [schema.id, schema]));
  const grouped = new Map<string, { field: string; other: string; places: PlaceName[] }>();
  for (const place of places) {
    if (!place.schemas.includes(candidate.id)) continue;
    const beside = place.schemas
      .filter((id) => id !== candidate.id)
      .map((id) => byId.get(id))
      .filter((schema): schema is MetadataSchemaDefinition => schema !== undefined);
    const conflicts = checkAssignment(beside, {
      assignment: { schema: candidate.id, requires: [] },
      schema: candidate,
    }).filter((each) => each.rule === 'defaultConflict');
    for (const conflict of conflicts) {
      const other = conflict.schemas.find((id) => id !== candidate.id)!;
      const key = `${conflict.field} ${other}`;
      let group = grouped.get(key);
      if (!group) {
        group = { field: conflict.field, other, places: [] };
        grouped.set(key, group);
      }
      group.places.push(nameOf(place));
    }
  }
  return [...grouped.values()];
}

function nameOf(place: Place): PlaceName {
  return place.kind === 'componentType'
    ? { kind: place.kind, id: place.id, name: place.name }
    : { kind: place.kind, id: place.id, name: place.name, level: place.level };
}

/** A schema's default a field's next version would refuse, and why. */
export interface BrokenDefault {
  readonly schema: string;
  readonly default: unknown;
  readonly rule: MetadataRule;
  readonly detail: string;
}

/**
 * MET-037's check: every default a schema gives the field, at the schema's latest version, against
 * the candidate version of the field - each one it would refuse, with the schema and the default.
 */
export function brokenDefaults(
  candidate: FieldDefinition,
  schemas: readonly MetadataSchemaDefinition[],
): BrokenDefault[] {
  const broken: BrokenDefault[] = [];
  for (const schema of schemas) {
    const entry = schema.entries.find((each) => each.field === candidate.id);
    if (entry?.default === undefined) continue;
    for (const each of checkValue(candidate, entry.default)) {
      broken.push({
        schema: schema.id,
        default: entry.default,
        rule: each.rule,
        detail: each.detail,
      });
    }
  }
  return broken;
}
