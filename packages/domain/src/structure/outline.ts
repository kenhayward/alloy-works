import { z } from 'zod';

import { marksAsASet } from '../content/model/canonical.js';
import { checkInlineContent, contentDocumentSchema, newScope } from '../content/model/document.js';
import {
  artifactIdentifierSchema as artifactIdentifier,
  nodeIdentifierSchema as nodeIdentifier,
} from '../content/model/identifier.js';
import { inlineNodeSchema, type InlineNode } from '../content/model/inline.js';
import { hasText } from '../content/model/text.js';
import { canonicalJson } from '../stored/canonical.js';
import { migrateStored, type MigrationChain } from '../stored/migrate.js';
import { storableEverywhere, storableText } from '../stored/storable.js';

/**
 * Schema 2 adds `front` to `matter` (publishing.md, decision M; STR-064). Nothing else changed, so a
 * schema 1 outline this product wrote reads as schema 2 member for member: schema 1's parse refused
 * `front`, so it holds none. A schema 1 row that holds some anyway was never written by this product,
 * and the migration refuses it rather than adopting it as front matter.
 */
export const OUTLINE_SCHEMA_VERSION = 2;

/**
 * Where a top-level node sits in a published document, inherited by its subtree (STR-016): front
 * matter - a preface, acknowledgements - then the body, then appendices. Front matter comes first
 * (STR-064); the body and appendices may interleave, as they always could.
 */
export const outlineMatterSchema = z.enum(['front', 'body', 'appendix']);
export type OutlineMatter = z.infer<typeof outlineMatterSchema>;

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
  matter: outlineMatterSchema,
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
  readonly matter: OutlineMatter;
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
  readonly matter: OutlineMatter;
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
 * applied by `checkInlineContent`, the walk `parseContentDocument` runs, so a title is checked by the
 * same code a component's paragraph is and never by a copy of it.
 *
 * The same walk holds every identifier inside a title - a footnote's and its paragraphs' - unique
 * within that title. Anything in a title is reached through its node, as anything in a component is
 * through its occurrence, so the title is the scope, as the component is for a block.
 *
 * **What a heading may hold is what the content model allows** - a footnote, an image, a binding, an
 * equation (CNT-046), a variable (REU-019) - validated identically. Word allows a footnote in a
 * heading, and nothing in the corpus or structure.md narrows it; a narrower rule would be a second
 * inline vocabulary to keep in step with the first. A cross-reference in a heading targets an outline
 * node and nothing else, and shows a number or a page, never a title that could loop back to its own
 * (`checkInlineContent`).
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
 *
 * **A transform, not a refinement**: what it hands on is what the walk returns, so a footnote in a
 * title is stored with its paragraphs as parsed (issue #124) and two spellings of one title are one
 * canonical string and one digest. The wire body's published schema is the array it takes in.
 */
export const sectionTitleSchema = z.array(inlineNodeSchema).transform((title, context) => {
  let parsed: InlineNode[] = title;
  try {
    parsed = checkInlineContent(title, 'title', newScope());
  } catch {
    context.addIssue({
      code: 'custom',
      message: 'A title holds inline content the content model refuses',
    });
  }
  const words = title.map((inline) => (inline.type === 'text' ? inline.value : '')).join('');
  if (!hasText(words)) context.addIssue({ code: 'custom', message: 'A section needs a title' });
  if (!storableEverywhere(title)) {
    context.addIssue({
      code: 'custom',
      message: 'A title holds a character that cannot be stored',
    });
  }
  return parsed;
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

/**
 * Depth-first, in document order, with the depth a node sits at. One walk, used by everything - over a
 * stored outline's nodes and over a view's alike.
 */
export function walkOutline<Node extends { readonly children: readonly Node[] }>(
  nodes: readonly Node[],
  visit: (node: Node, depth: number) => void,
  depth = 1,
): void {
  for (const node of nodes) {
    visit(node, depth);
    walkOutline(node.children, visit, depth + 1);
  }
}

/**
 * How deep an outline may nest. STR-007 asks for nine levels and this is well above it; it exists
 * because a recursive parse of an unbounded tree overflows the stack - between 500 and 800 levels in
 * Node, and fewer in a browser - so a stored outline deep enough would read as unreadable to everyone,
 * on every read, for ever. Bounded here, a deeper one is refused when it is written instead.
 */
export const MAXIMUM_OUTLINE_DEPTH = 64;

/**
 * The bound, checked before the schema recurses into the value and without recursing itself, so a
 * value of any depth is refused by the bound and never by the stack.
 */
function refuseTooDeep(value: unknown): void {
  if (typeof value !== 'object' || value === null || !('nodes' in value)) return;
  const pending: { readonly nodes: unknown; readonly depth: number }[] = [
    { nodes: value.nodes, depth: 1 },
  ];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (!Array.isArray(next.nodes)) continue;
    for (const node of next.nodes as unknown[]) {
      if (next.depth > MAXIMUM_OUTLINE_DEPTH) {
        throw new Error(`An outline nests no deeper than ${MAXIMUM_OUTLINE_DEPTH} levels`);
      }
      if (typeof node === 'object' && node !== null && 'children' in node) {
        pending.push({ nodes: node.children, depth: next.depth + 1 });
      }
    }
  }
}

/**
 * The one entry point. Four rules the schema cannot express on its own, because each is about a
 * document rather than a node:
 *
 * - an identifier is unique within its outline (STR-003), the way a block identifier is unique within
 *   its component (CNT-002);
 * - the outline nests no deeper than `MAXIMUM_OUTLINE_DEPTH`;
 * - **`matter` is set at the top level alone**: a top-level node carries it and its subtree inherits
 *   it (STR-016), so a node below the top level is `body` and never says otherwise. One rule here,
 *   rather than a refusal in `set`, another in `insert` and a third in `move`, covers every path that
 *   could put an appendix at a depth - an operation's result comes back through this parse.
 * - **front matter comes first** (STR-064): a top-level `front` node follows only other front matter,
 *   so a document reads its front matter, then the rest. Named by the node, as the rule above is.
 */
export function parseOutlineDocument(value: unknown): OutlineDocument {
  refuseTooDeep(value);
  const outline = outlineDocumentSchema.parse(value);
  refuseAcrossTheTree(outline.nodes);
  return outline;
}

/**
 * A top-level node that no non-front top-level node precedes: where Front matter may be set. The same
 * rule `refuseAcrossTheTree` holds a whole outline to, asked of one node, so the panel can offer only
 * what the parse would take. A node below the top level, or not in `nodes` at all, is never one.
 */
export function mayBeFront(nodes: readonly { id: string; matter: string }[], id: string): boolean {
  for (const node of nodes) {
    if (node.id === id) return true;
    if (node.matter !== 'front') return false;
  }
  return false;
}

/** The three rules about the whole tree, for a stored outline and a view alike. */
function refuseAcrossTheTree(
  nodes: readonly {
    readonly id: string;
    readonly matter: string;
    readonly children: readonly unknown[];
  }[],
): void {
  const seen = new Set<string>();
  walkOutline(nodes as readonly OutlineViewNode[], (node, depth) => {
    if (seen.has(node.id)) {
      throw new Error(`Outline node identifier ${node.id} is used more than once in this document`);
    }
    seen.add(node.id);
    if (depth > 1 && node.matter !== 'body') {
      throw new Error(`Outline node ${node.id} sets its matter below the top level`);
    }
  });
  let begun = false;
  for (const node of nodes) {
    if (node.matter !== 'front') begun = true;
    else if (begun) {
      throw new Error(
        `Outline node ${node.id} is front matter after the rest of the outline has begun`,
      );
    }
  }
}

/**
 * **An outline as a reader is shown it** (structure.md, "Who is shown what"). access.md makes a thing
 * a reader may not read indistinguishable from one that does not exist, and a document's grants do not
 * reach its components - so a reference to a component the reader may not read is shown with its
 * `component` and a pinned `mode.version` withheld as `null`. The node itself stays, with its
 * identifier, its type, its mode's kind and its switches, so it can still be moved, removed and given a
 * page break; nothing about what it points at is shown.
 *
 * **A view is never stored, and nothing is computed from one.** The digests, the versions and every
 * operation's result are the stored outline's (`parseOutlineDocument`); a view reads back through
 * `readOutlineView` alone, and a stored-outline parse refuses it.
 */
export type ReferenceViewNode = Omit<ReferenceNode, 'component' | 'mode' | 'children'> & {
  readonly component: string | null;
  readonly mode:
    | { readonly kind: 'pinned'; readonly version: string | null }
    | { readonly kind: 'latest' }
    | { readonly kind: 'approved' };
  readonly children: readonly OutlineViewNode[];
};

export type SectionViewNode = Omit<SectionNode, 'children'> & {
  readonly children: readonly OutlineViewNode[];
};

export type OutlineViewNode = SectionViewNode | ReferenceViewNode;

export type OutlineView = Omit<OutlineDocument, 'nodes'> & {
  readonly nodes: readonly OutlineViewNode[];
};

const outlineViewNodeSchema: z.ZodType<OutlineViewNode> = z.lazy(() =>
  z.discriminatedUnion('type', [sectionViewNodeSchema, referenceViewNodeSchema]),
);

// Extended from the stored schemas, never restated, so every rule a stored node is held to - the title
// rule above among them - holds for a view too, and only the two withheld members are widened.
const sectionViewNodeSchema = sectionNodeSchema.extend({
  children: z.array(outlineViewNodeSchema),
});

const referenceViewNodeSchema = referenceNodeSchema.extend({
  component: artifactIdentifier.nullable(),
  mode: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('pinned'), version: artifactIdentifier.nullable() }),
    referenceModeSchema.options[1],
    referenceModeSchema.options[2],
  ]),
  children: z.array(outlineViewNodeSchema),
});

const outlineViewSchema = outlineDocumentSchema.extend({
  nodes: z.array(outlineViewNodeSchema),
});

/**
 * The view a reader is shown of a stored outline: a copy, with the component and any pinned version
 * withheld from every reference whose component `mayRead` refuses. The outline given is not changed.
 */
export function withholdComponents(
  outline: OutlineDocument,
  mayRead: (component: string) => boolean,
): OutlineView {
  const withhold = (node: OutlineNode): OutlineViewNode => {
    const children = node.children.map(withhold);
    if (node.type === 'section' || mayRead(node.component)) return { ...node, children };
    const mode =
      node.mode.kind === 'pinned' ? { kind: 'pinned' as const, version: null } : node.mode;
    return { ...node, component: null, mode, children };
  };
  return { ...outline, nodes: outline.nodes.map(withhold) };
}

export type OutlineViewReadOutcome =
  | { ok: true; outline: OutlineView }
  | { ok: false; artifact: string; version: string; failure: string };

/**
 * A view as the renderer receives one, held to every rule a stored outline is, except that a
 * reference's component and pinned version may be withheld. A view is made from an outline already
 * at the current schema version, so it has no migration chain to go through.
 */
export function readOutlineView(
  value: unknown,
  context: { artifact: string; version: string },
): OutlineViewReadOutcome {
  try {
    refuseTooDeep(value);
    const view = outlineViewSchema.parse(value);
    refuseAcrossTheTree(view.nodes);
    return { ok: true, outline: view };
  } catch (error) {
    return {
      ok: false,
      artifact: context.artifact,
      version: context.version,
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}

// Created before the first schema change, because a chain nobody built is discovered to be missing on
// the day it is needed - and that day was schema 2.
export const outlineMigrationChain: MigrationChain = {
  subject: 'outline',
  current: OUTLINE_SCHEMA_VERSION,
  migrations: {
    // Schema 2 only widened `matter`, so a schema 1 outline is a schema 2 outline as it stands and
    // `migrateStored` restamps the version - a read-time projection: the stored bytes never change.
    // Except one holding `front`, which schema 1 could not store: forged or corrupt, so unreadable.
    1: (value) => {
      refuseFrontInSchema1(value.nodes);
      return value;
    },
  },
};

/**
 * Walked without recursing, as `refuseTooDeep` is, because a migration runs before the depth bound
 * does and a stored value of any depth must be refused by a rule, never by the stack. Anything that is
 * not a node is left for the parse to refuse.
 */
function refuseFrontInSchema1(nodes: unknown): void {
  const pending: unknown[] = [nodes];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (!Array.isArray(next)) continue;
    for (const node of next as unknown[]) {
      if (typeof node !== 'object' || node === null) continue;
      if ('matter' in node && node.matter === 'front') {
        throw new Error(
          'Stored outline at schema version 1 holds front matter, which schema 1 could not',
        );
      }
      if ('children' in node) pending.push(node.children);
    }
  }
}

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

/**
 * A section title's canonical form: the one its outline's canonical form holds for it, marks a set
 * (CNT-003) and members in order, so two spellings of one title are one string. Exported for a caller
 * that must tell whether two titles are the same title - the outline panel's field, comparing what it
 * sent with what came back (equations 3, ruling R2) - which words alone cannot, once a title holds an
 * equation whose words are only its alternative. The same function `canonicaliseOutlineNode` uses,
 * so the panel and the digest cannot disagree about what counts as a change.
 */
export function canonicaliseTitle(title: readonly InlineNode[]): string {
  return canonicalJson(title, marksAsASet);
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
          ['title', canonicaliseTitle(node.title)],
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
