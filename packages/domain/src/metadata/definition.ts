import { z } from 'zod';

/**
 * The definition schema version every field, metadata schema and component type payload records
 * (MET-002: adding a data type is a version of this, with a migration and a fixture). One number
 * across the three kinds, so a fixture directory is one version of all three; a version that changes
 * only one kind gives the others an identity step.
 */
export const DEFINITION_SCHEMA_VERSION = 1;

/** What every definition carries, whatever its kind. */
export const definitionIdentity = {
  schemaVersion: z.literal(DEFINITION_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
};
