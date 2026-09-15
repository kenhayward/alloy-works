import { migrateStored, type MigrationChain } from '../stored/migrate.js';

import { componentTypeDefinitionSchema, type ComponentTypeDefinition } from './component-type.js';
import { DEFINITION_SCHEMA_VERSION } from './definition.js';
import { fieldDefinitionSchema, type FieldDefinition } from './field.js';
import { metadataSchemaDefinitionSchema, type MetadataSchemaDefinition } from './schema.js';

/** The three definition kinds, each an artifact kind versioned by the one mechanism (ADR-0024). */
export const definitionKinds = ['field', 'metadataSchema', 'componentType'] as const;

export type DefinitionKind = (typeof definitionKinds)[number];

export type DefinitionOf = {
  field: FieldDefinition;
  metadataSchema: MetadataSchemaDefinition;
  componentType: ComponentTypeDefinition;
};

/**
 * Empty while there is one definition schema version, for the reason content's chain is: the first
 * change is when a chain nobody built is found to be missing, and by then definitions are stored.
 */
const chains: Record<DefinitionKind, MigrationChain> = {
  field: { subject: 'field definition', current: DEFINITION_SCHEMA_VERSION, migrations: {} },
  metadataSchema: {
    subject: 'metadata schema definition',
    current: DEFINITION_SCHEMA_VERSION,
    migrations: {},
  },
  componentType: {
    subject: 'component type definition',
    current: DEFINITION_SCHEMA_VERSION,
    migrations: {},
  },
};

const parsers: { [K in DefinitionKind]: (value: unknown) => DefinitionOf[K] } = {
  field: (value) => fieldDefinitionSchema.parse(value),
  metadataSchema: (value) => metadataSchemaDefinitionSchema.parse(value),
  componentType: (value) => componentTypeDefinitionSchema.parse(value),
};

/** A stored definition at the current definition schema version. A projection, never a rewrite. */
export function migrateDefinition(kind: DefinitionKind, value: unknown): Record<string, unknown> {
  return migrateStored(value, chains[kind]);
}

export type DefinitionReadOutcome<K extends DefinitionKind> =
  | { ok: true; definition: DefinitionOf[K] }
  | { ok: false; artifact: string; version: string; failure: string };

/**
 * Read a stored definition: migrate it, then parse it. A definition that will not parse is reported
 * with its artifact and version, and yields nothing - the rule CNT-013 sets for content, applied to
 * the definitions content is validated against.
 */
export function readDefinition<K extends DefinitionKind>(
  kind: K,
  value: unknown,
  context: { artifact: string; version: string },
): DefinitionReadOutcome<K> {
  try {
    return { ok: true, definition: parsers[kind](migrateDefinition(kind, value)) };
  } catch (error) {
    return {
      ok: false,
      artifact: context.artifact,
      version: context.version,
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}
