import { z } from 'zod';

import { marksAsASet } from '../content/model/canonical.js';
import {
  contentDocumentSchema,
  refuseForbiddenFootnoteContent,
} from '../content/model/document.js';
import { inlineNodeSchema, type InlineNode } from '../content/model/inline.js';
import { hasText } from '../content/model/text.js';
import { canonicalJson } from '../stored/canonical.js';
import { migrateStored, type MigrationChain } from '../stored/migrate.js';
import { storableEverywhere, storableText } from '../stored/storable.js';

export const OUTLINE_SCHEMA_VERSION = 1;

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

/**
 * A section title: inline content, held to the content model's own rules rather than to the bare
 * shape of an inline node. `inlineNodeSchema` leaves a footnote's `content` open (`z.array(z.unknown())`)
 * because the recursion between blocks and inlines closes in `blocks.ts`; CNT-129's restriction is
 * applied by `refuseForbiddenFootnoteContent`, the walk `parseContentDocument` runs, so a title is
 * checked by the same code a component's paragraph is and never by a copy of it.
 *
 * **What a heading may hold is what the content model allows** - a footnote, an image, a binding, an
 * equation (CNT-046), a variable (REU-019) - validated identically. Word allows a footnote in a
 * heading, and nothing in the corpus or structure.md narrows it; a narrower rule would be a second
 * inline vocabulary to keep in step with the first.
 *
 * **A title has text**: its text runs, joined, are not blank once trimmed - `hasText`, the rule the
 * editor's `titleAccepted` is, so an API caller cannot store the untitled section the panel refuses.
 * A title of only an equation or an image is refused with the rest: a title is also what names a node
 * in the contents, in an announcement and to a screen reader, and those read its words.
 *
 * **And every string in it is one Postgres can store** (`storableEverywhere`), however deep - a NUL or
 * half of a surrogate pair fails the insert, which would otherwise be answered as our failure.
 *
 * One schema for every place a title enters: the node below, an inserted section and a retitle
 * (`operations.ts`), so a title the store would refuse is refused at the wire body instead.
 */
export const sectionTitleSchema = z.array(inlineNodeSchema).superRefine((title, context) => {
  try {
    refuseForbiddenFootnoteContent(title);
  } catch {
    context.addIssue({ code: 'custom', message: 'A footnote in a title holds paragraphs alone' });
  }
  const words = title.map((inline) => (inline.type === 'text' ? inline.value : '')).join('');
  if (!hasText(words)) context.addIssue({ code: 'custom', message: 'A section needs a title' });
  if (!storableEverywhere(title)) {
    context.addIssue({
      code: 'custom',
      message: 'A title holds a character that cannot be stored',
    });
  }
});

export const sectionNodeSchema = z.strictObject({
  type: z.literal('section'),
  ...positional,
  title: sectionTitleSchema,
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
  // The one title rule, and the one storable rule, that a section title is held to above.
  title: z
    .string()
    .refine(hasText, 'A document needs a title')
    .refine(storableText, 'A title holds a character that cannot be stored'),
  // The content model's own tag rule, as creation and the editor's header read it: one rule, not two.
  language: contentDocumentSchema.shape.language,
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
