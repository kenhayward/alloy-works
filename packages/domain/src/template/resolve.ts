import type { FieldDefinition } from '../metadata/field.js';
import {
  DefinitionConflictError,
  resolveAssignedFields,
  type EffectiveField,
} from '../metadata/resolve.js';
import type { MetadataSchemaDefinition } from '../metadata/schema.js';

import type { TemplateComponent, TemplateDefinition } from './definition.js';

/**
 * What the service found of a required component for its creator (the R9 plan, R9-C): the version its
 * mode chooses and the query definitions that version's bindings name; or a pin to a version not its
 * own, or no approved revision to follow. A component the creator may not read, or that is no
 * component, has no entry at all.
 */
export type FoundComponent =
  | {
      readonly state: 'found';
      readonly version: string;
      readonly bindings: readonly string[];
    }
  | { readonly state: 'foreign' | 'unapproved' };

/** A required component as resolved: the version it is placed at, and its declared mode and place. */
export interface ResolvedComponent extends TemplateComponent {
  readonly mode: NonNullable<TemplateComponent['mode']>;
  readonly version: string;
}

/**
 * What the service found for a template's references (templates.md, "Resolving a template"): the kind
 * of each artifact it names, and each metadata schema's latest definition with the fields they group.
 * An identifier with no entry in `kinds` names no artifact at all.
 */
export interface TemplateReferences {
  readonly kinds: ReadonlyMap<string, string>;
  readonly schemas: readonly MetadataSchemaDefinition[];
  readonly fields: readonly FieldDefinition[];
  /**
   * Each required component the creator may read, by its key in the template (R9-C): two keys may
   * name one component in two modes. Absent where nobody asked as a creator, so nothing is checked.
   */
  readonly components?: ReadonlyMap<string, FoundComponent>;
  /** The query definitions the creator may read, among those the components' bindings name. */
  readonly definitions?: ReadonlySet<string>;
}

/** A reference that does not resolve, by what it is (TPL-004). */
export type UnresolvedReference =
  | { readonly reference: 'theme' | 'layout' | 'schema' | 'field'; readonly id: string }
  | { readonly reference: 'requires'; readonly id: string; readonly field: string }
  | {
      readonly reference: 'component';
      readonly id: string;
      readonly key: string;
      readonly why: 'missing' | 'foreign' | 'unapproved';
    }
  | { readonly reference: 'query'; readonly id: string; readonly key: string }
  | {
      readonly reference: 'conflict';
      readonly id: string;
      readonly level: 'document' | 'section';
      readonly schemas: readonly string[];
    };

export type ResolvedTemplate =
  | {
      readonly ok: true;
      readonly theme: string;
      readonly layout: string;
      readonly outline: TemplateDefinition['outline'];
      readonly changes: TemplateDefinition['changes'];
      /** The fields that apply to a document made from it, and to each of its sections (TPL-054). */
      readonly document: readonly EffectiveField[];
      readonly section: readonly EffectiveField[];
      /** Each required component, in the definition's order (TPL-014). */
      readonly components: readonly ResolvedComponent[];
      /** The query definitions their bindings name, each once: the template's query set (TPL-070). */
      readonly querySet: readonly string[];
    }
  | { readonly ok: false; readonly unresolved: readonly UnresolvedReference[] };

/**
 * A template against what its references name now (TPL-053, TPL-004): its theme a theme, its layout a
 * layout, each schema a metadata schema whose fields are all found, and each `requires` a field that
 * schema still groups. Every reference that does not resolve is named, in the order the definition
 * gives them; where all do, the effective fields at each level come from the same resolution a
 * component type's assignments go through (MET-007), and two schemas at one level whose defaults for a
 * field disagree are named rather than one chosen.
 */
export function resolveTemplate(
  definition: TemplateDefinition,
  found: TemplateReferences,
): ResolvedTemplate {
  const unresolved: UnresolvedReference[] = [];
  if (found.kinds.get(definition.theme) !== 'theme') {
    unresolved.push({ reference: 'theme', id: definition.theme });
  }
  if (found.kinds.get(definition.layout) !== 'layout') {
    unresolved.push({ reference: 'layout', id: definition.layout });
  }
  const schemaById = new Map(found.schemas.map((schema) => [schema.id, schema]));
  const fieldIds = new Set(found.fields.map((field) => field.id));
  for (const assignment of definition.schemas) {
    const schema =
      found.kinds.get(assignment.schema) === 'metadataSchema'
        ? schemaById.get(assignment.schema)
        : undefined;
    if (schema === undefined) {
      unresolved.push({ reference: 'schema', id: assignment.schema });
      continue;
    }
    for (const entry of schema.entries) {
      if (!fieldIds.has(entry.field)) unresolved.push({ reference: 'field', id: entry.field });
    }
    const grouped = new Set(schema.entries.map((entry) => entry.field));
    for (const field of assignment.requires) {
      if (!grouped.has(field)) unresolved.push({ reference: 'requires', id: schema.id, field });
    }
  }
  // Each required component, at the version its mode chooses, and the definitions its bindings name
  // (TPL-070; ADR-0062): every one must be there for the creator to read.
  const components: ResolvedComponent[] = [];
  const querySet: string[] = [];
  for (const each of found.components === undefined ? [] : (definition.components ?? [])) {
    const component = found.components!.get(each.key);
    if (component === undefined || component.state !== 'found') {
      unresolved.push({
        reference: 'component',
        id: each.component,
        key: each.key,
        why: component === undefined ? 'missing' : component.state,
      });
      continue;
    }
    components.push({
      ...each,
      mode: each.mode ?? { kind: 'approved' },
      version: component.version,
    });
    for (const query of component.bindings) {
      if (!found.definitions?.has(query)) {
        unresolved.push({ reference: 'query', id: query, key: each.key });
      } else if (!querySet.includes(query)) querySet.push(query);
    }
  }
  if (unresolved.length > 0) return { ok: false, unresolved };

  const at = (level: 'document' | 'section'): EffectiveField[] | UnresolvedReference => {
    try {
      return resolveAssignedFields(
        `The template's ${level} level`,
        definition.schemas.filter((assignment) => assignment.level === level),
        found.schemas,
        found.fields,
      );
    } catch (error) {
      if (!(error instanceof DefinitionConflictError)) throw error;
      return { reference: 'conflict', id: error.field, level, schemas: error.schemas };
    }
  };
  const document = at('document');
  const section = at('section');
  const conflicts = [document, section].filter(
    (each): each is UnresolvedReference => !Array.isArray(each),
  );
  if (conflicts.length > 0) return { ok: false, unresolved: conflicts };
  return {
    ok: true,
    theme: definition.theme,
    layout: definition.layout,
    outline: definition.outline,
    changes: definition.changes,
    document: document as EffectiveField[],
    section: section as EffectiveField[],
    components,
    querySet,
  };
}
