import { checkValue } from './check-value.js';
import type { ComponentTypeDefinition } from './component-type.js';
import { indexDefinitions, requireDefinition } from './definition-index.js';
import type { MetadataRule } from './failure.js';
import type { FieldDefinition } from './field.js';
import type { MetadataSchemaDefinition } from './schema.js';
import { sameValue } from './values.js';

/**
 * One field as it applies to a component of a type (metadata.md, Resolution). The array
 * `resolveComponentFields` returns is in resolution order - assignment order, then entry order, first
 * occurrence - so the order is the array's rather than a member's.
 */
export type EffectiveField = {
  readonly field: FieldDefinition;
  /** Any entry says required, or any assignment lists the field in `requires`. */
  readonly required: boolean;
  /** Every schema that made it required: an entry by its schema, an assignment by the schema assigned. */
  readonly requiredBy: readonly string[];
  readonly fixed: boolean;
  readonly fixedBy: readonly string[];
  /** Absent when no entry declares one. `from` is every schema declaring it - all alike, or resolution threw. */
  readonly default?: { readonly value: unknown; readonly from: readonly string[] };
};

/**
 * A default resolution cannot use: entries that disagree about it (`rule` is `defaultConflict`), or a
 * default the field version it was given refuses (`rule` is the field's rule that refused it, such as
 * `maxLength`). Either is a definition problem for an administrator, never a validation failure for an
 * author. MET-008 and MET-035 would refuse the first upstream and MET-037 the second, and none of those
 * refusals is designed yet - so a resolver that picked a default silently, or applied one its field
 * refuses, would turn those gaps into wrong data, and for a fixed field into a value no author can
 * correct.
 */
export class DefinitionConflictError extends Error {
  readonly field: string;
  readonly schemas: readonly string[];
  readonly rule: MetadataRule;

  constructor(field: string, schemas: readonly string[], rule: MetadataRule, message: string) {
    super(message);
    this.name = 'DefinitionConflictError';
    this.field = field;
    this.schemas = schemas;
    this.rule = rule;
  }
}

type Draft = {
  field: FieldDefinition;
  requiredBy: string[];
  fixedBy: string[];
  defaults: { value: unknown; schema: string }[];
};

const addOnce = (list: string[], id: string) => {
  if (!list.includes(id)) list.push(id);
};

/**
 * The effective fields for a component of `type` (MET-007, MET-009, MET-013).
 *
 * Takes the type and the definitions at specific versions and nothing about any document, so no
 * document can contribute a field. Which versions is the caller's: current ones while authoring,
 * recorded ones when checking a stored version (MET-017).
 *
 * A `requires` naming a field the assigned schema does not group is ignored: `checkAssignment`
 * refuses one when it is saved, and a later schema version can still leave one behind. Nothing is
 * lost - a field is effective only through a schema entry, so the stray has no field to make required.
 */
export function resolveComponentFields(
  type: ComponentTypeDefinition,
  schemas: readonly MetadataSchemaDefinition[],
  fields: readonly FieldDefinition[],
): EffectiveField[] {
  const schemaById = indexDefinitions('schema', schemas, (schema) => schema.id);
  const fieldById = indexDefinitions('field', fields, (field) => field.id);
  const drafts = new Map<string, Draft>();

  for (const assignment of type.assignments) {
    const schema = requireDefinition(
      schemaById,
      assignment.schema,
      `Component type ${type.id} assigns schema ${assignment.schema}`,
    );
    for (const entry of schema.entries) {
      const field = requireDefinition(
        fieldById,
        entry.field,
        `Schema ${schema.id} groups field ${entry.field}`,
      );
      let draft = drafts.get(field.id);
      if (!draft) {
        draft = { field, requiredBy: [], fixedBy: [], defaults: [] };
        drafts.set(field.id, draft);
      }
      if (entry.required) addOnce(draft.requiredBy, schema.id);
      if (entry.fixed) addOnce(draft.fixedBy, schema.id);
      if (entry.default !== undefined)
        draft.defaults.push({ value: entry.default, schema: schema.id });
    }
    const grouped = new Set(schema.entries.map((entry) => entry.field));
    for (const id of assignment.requires) {
      const draft = drafts.get(id);
      if (grouped.has(id) && draft) addOnce(draft.requiredBy, schema.id);
    }
  }

  return [...drafts.values()].map(toEffective);
}

function toEffective(draft: Draft): EffectiveField {
  const base = {
    field: draft.field,
    required: draft.requiredBy.length > 0,
    requiredBy: draft.requiredBy,
    fixed: draft.fixedBy.length > 0,
    fixedBy: draft.fixedBy,
  };
  const [first] = draft.defaults;
  if (!first) return base;
  const schemas = draft.defaults.map((each) => each.schema);
  const disagrees = draft.defaults.some((each) => !sameValue(each.value, first.value));
  if (disagrees) {
    throw new DefinitionConflictError(
      draft.field.id,
      schemas,
      'defaultConflict',
      `Field ${draft.field.id} has different defaults in schemas ${schemas.join(' and ')}`,
    );
  }
  // The defaults agree, so checking one checks them all - against the field version this resolution
  // was given, which need not be the version the schema's default was saved against.
  const [refused] = checkValue(draft.field, first.value);
  if (refused) {
    throw new DefinitionConflictError(
      draft.field.id,
      schemas,
      refused.rule,
      `Field ${draft.field.id} refuses the default in schemas ${schemas.join(' and ')}: ${refused.rule}, ${refused.detail}`,
    );
  }
  return { ...base, default: { value: first.value, from: schemas } };
}
