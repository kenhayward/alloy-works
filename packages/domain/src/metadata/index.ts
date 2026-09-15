export { DEFINITION_SCHEMA_VERSION } from './definition.js';

export { dataTypes, fieldDefinitionSchema } from './field.js';
export type { DataType, FieldDefinition } from './field.js';

export { metadataSchemaDefinitionSchema, checkSchema } from './schema.js';
export type { MetadataSchemaDefinition, SchemaEntry } from './schema.js';

export { componentTypeDefinitionSchema } from './component-type.js';
export type { Assignment, ComponentTypeDefinition } from './component-type.js';

export { definitionKinds, migrateDefinition, readDefinition } from './migrate.js';
export type { DefinitionKind, DefinitionOf, DefinitionReadOutcome } from './migrate.js';

export { canonicaliseDecimal } from './lexical.js';
export type { MetadataFailure, MetadataRule } from './failure.js';
export type { MetadataValues, UserValue } from './values.js';

export { checkValue } from './check-value.js';
export { resolveComponentFields, DefinitionConflictError } from './resolve.js';
export type { EffectiveField } from './resolve.js';
export { checkAssignment } from './check-assignment.js';
export { validate } from './validate.js';
export { checkUserValues, principalIdsIn } from './users.js';
export type { Principal, PrincipalLookup } from './users.js';
export { carryForward } from './carry.js';
export type { CarriedForward, NotCarried } from './carry.js';
export { definitionsFor, canonicaliseValues, canonicaliseNotCarried } from './record.js';
export type { DefinitionRef, Versioned } from './record.js';
