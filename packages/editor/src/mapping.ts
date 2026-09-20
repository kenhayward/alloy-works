import {
  parseContentDocument,
  type BlockNode,
  type ContentDocument,
  type InlineNode,
  type Mark,
} from '@alloy-works/domain';
import type { Mark as EditorMark, Node } from 'prosemirror-model';

import { editorSchema } from './schema.js';

/** A stored document opened for editing, or the names of what this editor cannot yet change. */
export type Opened =
  | { readonly editable: true; readonly doc: Node }
  | { readonly editable: false; readonly unsupported: readonly string[] };

/**
 * Every node type and mark in the blocks that the slice's schema has no counterpart for, once each.
 *
 * The marks are read off `editorSchema` rather than listed again here, so a mark the schema gains is
 * carried by the mapping the moment it is declared, and one it loses is refused by name rather than
 * dropped. Today that leaves `condition`, `suggestion` and `comment` - the three annotations nothing
 * in T1 can create (content-model.md).
 */
function unsupportedIn(blocks: readonly BlockNode[]): string[] {
  const found = new Set<string>();
  for (const block of blocks) {
    if (block.type !== 'paragraph') {
      found.add(block.type);
      continue;
    }
    for (const inline of block.content) {
      if (inline.type !== 'text') found.add(inline.type);
      else {
        for (const mark of inline.marks) {
          if (!(mark.type in editorSchema.marks)) found.add(`mark:${mark.type}`);
        }
      }
    }
  }
  return [...found];
}

/**
 * One stored mark as the editor holds it: the same members, less the discriminator the editor keeps
 * in the mark's type. A member the stored form leaves out - a `hyperlink` with no `title` - takes the
 * schema's default of null, which `markOf` writes back out as absence rather than as null.
 */
function toMark(mark: Mark): EditorMark {
  const { type, ...attrs } = mark;
  return editorSchema.marks[type]!.create(attrs);
}

/**
 * One stored run as the editor holds it, or nothing where it has no text. ProseMirror refuses an
 * empty text node, and the stored form has no room for one either: `parseContentDocument` drops a
 * run with no value (issue #154), so nothing this mapping is handed after a parse can carry one and
 * the drop is an identity rather than a loss.
 */
function toRun(inline: InlineNode): Node[] {
  const text = inline as Extract<InlineNode, { type: 'text' }>;
  if (text.value === '') return [];
  return [editorSchema.text(text.value, text.marks.map(toMark))];
}

/**
 * The stored document as the editor holds it. Total over what it accepts and refuses the rest by name,
 * so opening never loses anything: a component holding a list, an equation or a mark this schema has
 * no counterpart for opens read-only, saying why, rather than being edited into something without them.
 */
export function toEditor(document: ContentDocument): Opened {
  const unsupported = unsupportedIn(document.content);
  if (unsupported.length > 0) return { editable: false, unsupported };
  const paragraphs = document.content.map((block) => {
    const paragraph = block as Extract<BlockNode, { type: 'paragraph' }>;
    return editorSchema.node(
      'paragraph',
      { id: paragraph.id, style: paragraph.style },
      paragraph.content.flatMap(toRun),
    );
  });
  return {
    editable: true,
    doc: editorSchema.node(
      'doc',
      { title: document.title, language: document.language, direction: document.direction },
      paragraphs,
    ),
  };
}

/**
 * One editor mark as the stored model holds it.
 *
 * **An attribute reading null is omitted, never written.** Every mark schema is a `strictObject` and
 * an optional member - a `hyperlink`'s `title` - is `z.string().optional()`, which refuses null; the
 * editor has no absence to spell, so a mark with no title carries `title: null` instead and this is
 * where the two meet. Dropping every null rather than `title` alone is the safe direction: a member
 * the stored form requires is refused by name by `markSchema` whether it arrives null or absent,
 * while a member it only allows is the one that has to be absent.
 */
function markOf(mark: EditorMark): unknown {
  const members: Record<string, unknown> = { type: mark.type.name };
  for (const [name, value] of Object.entries(mark.attrs)) {
    if (value !== null) members[name] = value;
  }
  return members;
}

/**
 * The runs of one paragraph as the stored model holds them: one run per text node, carrying its marks.
 *
 * It cannot read `textContent`, which joins every text node into one string: two adjacent runs whose
 * marks differ do not merge in ProseMirror, and joining them would throw the marks away. The runs
 * come back in the editor's order, and each run's marks in the **schema's** declaration order, which
 * `Mark.setFrom` sorts by; canonicalisation treats a run's marks as a set, so that order is never a
 * spurious version. `parseContentDocument` merges back any two adjacent runs the editor left split
 * carrying one mark set, so what this returns has one stored spelling (issue #154).
 */
function runsOf(paragraph: Node): unknown[] {
  const runs: unknown[] = [];
  paragraph.forEach((text) => {
    runs.push({ type: 'text', value: text.text ?? '', marks: text.marks.map(markOf) });
  });
  return runs;
}

/**
 * The editor's document as the stored model holds it, through `parseContentDocument` - so what the
 * renderer sends has already met every rule the service will apply again (component-editor.md,
 * "Invariants the editor holds"). A block with no identifier is refused here, and never reaches storage.
 */
export function fromEditor(doc: Node): ContentDocument {
  const content: unknown[] = [];
  doc.forEach((paragraph, _offset, index) => {
    const id: unknown = paragraph.attrs.id;
    if (typeof id !== 'string') throw new Error(`Block ${index} has no identifier`);
    content.push({
      type: 'paragraph',
      id,
      style: paragraph.attrs.style as string,
      content: runsOf(paragraph),
    });
  });
  return parseContentDocument({
    schemaVersion: 1,
    title: doc.attrs.title as string,
    language: doc.attrs.language as string,
    direction: doc.attrs.direction as string,
    content,
  });
}
