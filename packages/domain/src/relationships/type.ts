import { z } from 'zod';

import { assignmentSchema } from '../metadata/component-type.js';
import { definitionIdentity } from '../metadata/definition.js';

/**
 * The kinds a relationship may join (the R19 plan, R19-A): the content people relate - components,
 * documents, publications, assets, templates, query definitions and datasets - never configuration.
 * A type's kinds are drawn from these where it is written; a stored one reads as it was.
 */
export const relatableKinds = Object.freeze([
  'component',
  'document',
  'publication',
  'asset',
  'template',
  'queryDefinition',
  'dataset',
] as const);
export type RelatableKind = (typeof relatableKinds)[number];

/** The kinds a type names that no relationship may join, each once, in its order. */
export function unrelatableKinds(type: RelationshipTypeDefinition): string[] {
  return [...new Set([...type.from.kinds, ...type.to.kinds])].filter(
    (kind) => !(relatableKinds as readonly string[]).includes(kind),
  );
}

/** How many relationships of a type one artifact may hold at an end (REL-042). */
const cardinality = z.enum(['one', 'many']);

/** The permission a user needs on an end's artifact to relate it (REL-035). */
const endPermission = z.enum(['read', 'edit']);

const kinds = z
  .array(z.string().regex(/^[a-z][A-Za-z]*$/))
  .min(1)
  .max(32)
  .refine((each) => new Set(each).size === each.length, 'Each kind once');

/**
 * **A relationship type** (REL-001, REL-004, REL-037, REL-042, REL-045 to REL-047, REL-053; the R8
 * plan, R8-A, R8-B): the environment's, declared as a definition, so its identifier is stable and its
 * name renamable. `from` and `to` name the artifact kinds each end may be and how many relationships
 * of the type one artifact may hold there; `directed` false reads it the same from both ends, where
 * `inverseName` is then its name again.
 */
export const relationshipTypeDefinitionSchema = z.strictObject({
  ...definitionIdentity,
  inverseName: z.string().min(1).max(200),
  directed: z.boolean(),
  from: z.strictObject({ kinds, cardinality, permission: endPermission }),
  to: z.strictObject({ kinds, cardinality, permission: endPermission }),
  selfReference: z.boolean().describe('Whether an artifact may relate to itself (REL-045)'),
  acyclic: z.boolean().describe('Whether a relationship closing a cycle is refused (REL-046)'),
  informational: z
    .boolean()
    .describe('Whether impact reads it as informational rather than hard (REL-023)'),
  /** The metadata schemas whose fields its relationships carry (REL-053). */
  schemas: z.array(assignmentSchema).max(32),
  /** Deprecated: no longer offered for new relationships, still valid where held (REL-037). */
  deprecated: z.strictObject({ replacement: z.string().min(1).optional() }).optional(),
});
export type RelationshipTypeDefinition = z.infer<typeof relationshipTypeDefinitionSchema>;

/** An end of a relationship: its artifact, its kind, and the version it pins, or none (REL-043). */
export interface RelationshipEnd {
  readonly artifact: string;
  readonly kind: string;
  readonly version: string | null;
}

/** Why a relationship of a type cannot join two ends (REL-008, REL-045). */
export type EndRefusal =
  | { readonly refused: 'kind'; readonly end: 'from' | 'to'; readonly kind: string }
  | { readonly refused: 'self' }
  | { readonly refused: 'deprecated' };

/**
 * Whether a type permits these two ends (REL-008, REL-037, REL-045): each end's kind among its kinds,
 * an artifact related to itself only where the type allows it, and a deprecated type for no new
 * relationship. Cardinality and cycles need the store, and are its to check.
 */
export function endsRefused(
  type: RelationshipTypeDefinition,
  from: Pick<RelationshipEnd, 'artifact' | 'kind'>,
  to: Pick<RelationshipEnd, 'artifact' | 'kind'>,
  creating: boolean,
): EndRefusal | undefined {
  if (creating && type.deprecated !== undefined) return { refused: 'deprecated' };
  if (!type.from.kinds.includes(from.kind))
    return { refused: 'kind', end: 'from', kind: from.kind };
  if (!type.to.kinds.includes(to.kind)) return { refused: 'kind', end: 'to', kind: to.kind };
  if (from.artifact === to.artifact && !type.selfReference) return { refused: 'self' };
  return undefined;
}
