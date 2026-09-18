import { z } from 'zod';

import { marksAsASet } from '../content/model/canonical.js';
import { inlineNodeSchema, type InlineNode } from '../content/model/inline.js';
import { canonicalJson } from '../stored/canonical.js';
import { migrateStored, type MigrationChain } from '../stored/migrate.js';

export const OUTLINE_SCHEMA_VERSION = 1;

const bcp47 = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?(-[a-z0-9]{5,8})*$/, 'not a BCP 47 tag');

/** 128 bits as 26 lower-case base32 characters: the spelling `blockIdentifierFrom` already fixes. */
const nodeIdentifier = z.string().regex(/^[a-z2-7]{26}$/, 'not an outline node identifier');

// Duplicates the wire contract's `LowercaseUuid` deliberately: `packages/domain` stays platform-free
// and does not depend on `packages/api-contract`, which is a service-side concern (routes, wire
// codes). One regex, defined twice on purpose, rather than a cross-package dependency for a pattern.
const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const artifactIdentifier = z.string().regex(LOWERCASE_UUID, 'not a lowercase uuid');

/** STR-058: the three REU and LIF name, closed, and absent is not a fourth. */
export const referenceModeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('pinned'), version: artifactIdentifier }),
  z.strictObject({ kind: z.literal('latest') }),
  z.strictObject({ kind: z.literal('approved') }),
]);

/**
 * What both arms carry, because STR-017 and STR-048 are properties of a node's place rather than of
 * what fills it. Every switch is here at schema version 1 even where nothing reads it yet (the plan's
 * decision C): adding one later is a migration of every outline ever stored.
 */
const positional = {
  id: nodeIdentifier,
  numbered: z.boolean(),
  matter: z.enum(['body', 'appendix']),
  pageBreak: z.enum(['none', 'page', 'recto']),
  /** A section's own field values (STR-060). Which schemas apply is TPL-054's, so nothing validates them. */
  values: z.record(z.string(), z.unknown()),
};

export type SectionNode = {
  readonly type: 'section';
  readonly id: string;
  /** Inline content, not a string: CNT-046 puts an equation in a heading, and a heading is a node. */
  readonly title: readonly InlineNode[];
  readonly numbered: boolean;
  readonly matter: 'body' | 'appendix';
  readonly pageBreak: 'none' | 'page' | 'recto';
  readonly values: Record<string, unknown>;
  readonly children: readonly OutlineNode[];
};

export type ReferenceNode = {
  readonly type: 'reference';
  readonly id: string;
  readonly component: string;
  readonly mode: z.infer<typeof referenceModeSchema>;
  readonly numbered: boolean;
  readonly matter: 'body' | 'appendix';
  readonly pageBreak: 'none' | 'page' | 'recto';
  readonly values: Record<string, unknown>;
  readonly children: readonly OutlineNode[];
};

export type OutlineNode = SectionNode | ReferenceNode;

// Written out by hand above and lazily below, the way `blockNodeSchema` is, because a recursive zod
// schema cannot infer its own type.
export const outlineNodeSchema: z.ZodType<OutlineNode> = z.lazy(() =>
  z.discriminatedUnion('type', [sectionNodeSchema, referenceNodeSchema]),
);

export const sectionNodeSchema = z.strictObject({
  type: z.literal('section'),
  ...positional,
  title: z.array(inlineNodeSchema),
  children: z.array(outlineNodeSchema),
});

export const referenceNodeSchema = z.strictObject({
  type: z.literal('reference'),
  ...positional,
  component: artifactIdentifier,
  mode: referenceModeSchema,
  children: z.array(outlineNodeSchema),
});

/**
 * The root, and its members are closed. `nodes` has no minimum, unlike content's: STR-054 makes an
 * empty outline a valid document rather than an error.
 */
export const outlineDocumentSchema = z.strictObject({
  schemaVersion: z.literal(OUTLINE_SCHEMA_VERSION),
  title: z.string().min(1),
  language: bcp47,
  direction: z.enum(['ltr', 'rtl']),
  nodes: z.array(outlineNodeSchema),
});

export type OutlineDocument = z.infer<typeof outlineDocumentSchema>;

/** Depth-first, in document order, with the depth a node sits at. One walk, used by everything. */
export function walkOutline(
  nodes: readonly OutlineNode[],
  visit: (node: OutlineNode, depth: number) => void,
  depth = 1,
): void {
  for (const node of nodes) {
    visit(node, depth);
    walkOutline(node.children, visit, depth + 1);
  }
}

/**
 * The one entry point. One rule the schema cannot express on its own, because it is about a document
 * rather than a node: an identifier is unique within its outline (STR-003), the way a block
 * identifier is unique within its component (CNT-002).
 */
export function parseOutlineDocument(value: unknown): OutlineDocument {
  const outline = outlineDocumentSchema.parse(value);
  const seen = new Set<string>();
  walkOutline(outline.nodes, (node) => {
    if (seen.has(node.id)) {
      throw new Error(`Outline node identifier ${node.id} is used more than once in this document`);
    }
    seen.add(node.id);
  });
  return outline;
}

// Created now rather than at the first schema change, because a chain nobody built is discovered to
// be missing on the day it is needed.
export const outlineMigrationChain: MigrationChain = {
  subject: 'outline',
  current: OUTLINE_SCHEMA_VERSION,
  migrations: {},
};

export function migrateOutline(value: unknown): unknown {
  return migrateStored(value, outlineMigrationChain);
}

export type OutlineReadOutcome =
  | { ok: true; outline: OutlineDocument }
  | { ok: false; artifact: string; version: string; failure: string };

export function readOutline(
  value: unknown,
  context: { artifact: string; version: string },
): OutlineReadOutcome {
  try {
    return { ok: true, outline: parseOutlineDocument(migrateOutline(value)) };
  } catch (error) {
    return {
      ok: false,
      artifact: context.artifact,
      version: context.version,
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * An outline's canonical form, and the input to its `content_hash`.
 *
 * **The shared rule is the wrong one here**, and this is the correction structure.md names. A section
 * title is inline content, inline content carries `marks`, and CNT-003 makes marks a set - so two
 * identical outlines whose marks were built in different orders would otherwise produce two strings,
 * two digests, and a `recordVersion` that records a version saying nothing new. Measured: under
 * `canonicalJson` they differ; under this they do not.
 *
 * `marksAsASet` is the content model's own rule (`content/model/canonical.ts`), reused rather than
 * copied - a second copy is the one way this could drift from what the content model actually does.
 *
 * **It cannot simply be handed to `canonicalJson` as the outline's one array-order rule**, the way
 * `canonicalise` hands it to a component's whole content document. `canonicalJson`'s order rule is
 * keyed on the member name alone, at every level of the value it walks - and a node's `values` is an
 * arbitrary metadata record (STR-060) sitting in that same tree. A metadata field whose identifier
 * happens to be `marks` would then be sorted as though it were a section title's formatting, silently
 * reordering - or, worse, collapsing two different values to one digest - a value that is not content
 * at all. `canonicaliseVersion`'s own comment names exactly this trap for a component's values
 * (MET-030), and `structure/outline.test.ts` pins a section reaching it the same way. So the tree is
 * composed member by member instead, the way `canonicaliseVersion` composes a version: `marksAsASet`
 * reaches only a node's `title`, and every other member - `values` among them - takes the plain rule,
 * where no array is a set.
 */
export function canonicaliseOutline(outline: OutlineDocument): string {
  const members: readonly (readonly [string, string])[] = [
    ['direction', canonicalJson(outline.direction)],
    ['language', canonicalJson(outline.language)],
    ['nodes', canonicaliseOutlineNodes(outline.nodes)],
    ['schemaVersion', canonicalJson(outline.schemaVersion)],
    ['title', canonicalJson(outline.title)],
  ];
  return `{${members.map(([name, value]) => `${JSON.stringify(name)}:${value}`).join(',')}}`;
}

function canonicaliseOutlineNodes(nodes: readonly OutlineNode[]): string {
  return `[${nodes.map(canonicaliseOutlineNode).join(',')}]`;
}

function canonicaliseOutlineNode(node: OutlineNode): string {
  // `values` is deliberately last and deliberately plain: it never reaches `marksAsASet`, however
  // deep a caller nests an array inside it, because it is a section's own metadata, not content.
  const members: readonly (readonly [string, string])[] =
    node.type === 'section'
      ? [
          ['children', canonicaliseOutlineNodes(node.children)],
          ['id', canonicalJson(node.id)],
          ['matter', canonicalJson(node.matter)],
          ['numbered', canonicalJson(node.numbered)],
          ['pageBreak', canonicalJson(node.pageBreak)],
          ['title', canonicalJson(node.title, marksAsASet)],
          ['type', canonicalJson(node.type)],
          ['values', canonicalJson(node.values)],
        ]
      : [
          ['children', canonicaliseOutlineNodes(node.children)],
          ['component', canonicalJson(node.component)],
          ['id', canonicalJson(node.id)],
          ['matter', canonicalJson(node.matter)],
          ['mode', canonicalJson(node.mode)],
          ['numbered', canonicalJson(node.numbered)],
          ['pageBreak', canonicalJson(node.pageBreak)],
          ['type', canonicalJson(node.type)],
          ['values', canonicalJson(node.values)],
        ];
  return `{${members.map(([name, value]) => `${JSON.stringify(name)}:${value}`).join(',')}}`;
}
