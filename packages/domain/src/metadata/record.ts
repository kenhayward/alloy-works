import { canonicalJson } from '../stored/canonical.js';

import type { NotCarried } from './carry.js';
import type { ComponentTypeDefinition } from './component-type.js';
import type { FieldDefinition } from './field.js';
import type { DefinitionKind } from './migrate.js';
import type { MetadataSchemaDefinition } from './schema.js';
import type { MetadataValues } from './values.js';

/**
 * A definition at a version. `version` is opaque here: it is whatever identifies the artifact version
 * row, which the service loaded the payload from and which `version_definition` points at.
 */
export type Versioned<T> = { readonly version: string; readonly definition: T };

export type DefinitionRef = {
  readonly kind: DefinitionKind;
  readonly id: string;
  readonly version: string;
};

/**
 * The definition versions a component's next version is written against (MET-018): the type, each
 * schema it assigns, and each field those schemas group - and nothing else it was handed. The service
 * passes the current versions, and stamps the list on the version at promotion (MET-017).
 *
 * Sorted by kind, then identifier, then version, because the definitions a version records are a set
 * and the version digest serialises them in one order (ADR-0024).
 */
export function definitionsFor(
  type: Versioned<ComponentTypeDefinition>,
  schemas: readonly Versioned<MetadataSchemaDefinition>[],
  fields: readonly Versioned<FieldDefinition>[],
): DefinitionRef[] {
  const schemaById = byId(schemas, 'schema');
  const fieldById = byId(fields, 'field');
  const refs = new Map<string, DefinitionRef>();
  const add = (kind: DefinitionKind, id: string, version: string) =>
    refs.set(`${kind}:${id}`, { kind, id, version });

  add('componentType', type.definition.id, type.version);
  for (const assignment of type.definition.assignments) {
    const schema = schemaById.get(assignment.schema);
    if (!schema) {
      throw new Error(
        `Component type ${type.definition.id} assigns schema ${assignment.schema}, which was not supplied`,
      );
    }
    add('metadataSchema', schema.definition.id, schema.version);
    for (const entry of schema.definition.entries) {
      const field = fieldById.get(entry.field);
      if (!field) {
        throw new Error(
          `Schema ${schema.definition.id} groups field ${entry.field}, which was not supplied`,
        );
      }
      add('field', field.definition.id, field.version);
    }
  }

  return [...refs.values()].sort(
    (a, b) => compare(a.kind, b.kind) || compare(a.id, b.id) || compare(a.version, b.version),
  );
}

function byId<T extends { readonly id: string }>(
  list: readonly Versioned<T>[],
  kind: string,
): Map<string, Versioned<T>> {
  const map = new Map<string, Versioned<T>>();
  for (const each of list) {
    if (map.has(each.definition.id)) {
      throw new Error(`Two versions of ${kind} ${each.definition.id} were supplied`);
    }
    map.set(each.definition.id, each);
  }
  return map;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The canonical serialisation of a version's metadata values, as the version digest takes them
 * (ADR-0024): content's rules - members in lexicographic order, strings in NFC, no insignificant
 * whitespace - and every array in the order given, since MET-030 makes the order part of a value.
 */
export function canonicaliseValues(values: MetadataValues): string {
  return canonicalJson(values);
}

/** The canonical serialisation of the values a version did not carry, sorted by field. */
export function canonicaliseNotCarried(notCarried: readonly NotCarried[]): string {
  return canonicalJson([...notCarried].sort((a, b) => compare(a.field, b.field)));
}
