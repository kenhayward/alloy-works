import type { InlineNode } from '@alloy-works/domain';
import { Schema, type Node } from 'prosemirror-model';

import { editorSchema } from './schema.js';

/**
 * **A section title's own small schema** (equations 3, ruling R1): one line of text and inline
 * equations, and nothing else - no marks, no reference, no footnote, no image. A title is inline
 * content in the stored model and may hold all of those (`sectionTitleSchema`), but this is the editor
 * for the part an author writes in the outline panel's field; a title holding anything more keeps the
 * read-only field and its sentence, as it did before an equation could be written there, and that is
 * the caller's to decide from `titleToEditor` answering null.
 *
 * **The root is the line itself**: a textblock at the top, so there is no paragraph to split and no
 * second line to make - `Enter` has nothing to act on but the commit the field binds it to. The
 * equation is the component editor's own node spec, taken from its schema rather than written again,
 * so it is an inline atom selected whole, carries no marks and is spoken by its `alttext` exactly as
 * it is in a paragraph; its node view is equations 1's too (`titleView.ts`).
 */
export const titleSchema = new Schema({
  nodes: {
    doc: { content: '(text | equation)*' },
    text: {},
    equation: editorSchema.spec.nodes.get('equation')!,
  },
  marks: {},
});

/** What a title holds when this editor can hold it: runs of unmarked text, and inline equations. */
export type TitleRun = Extract<InlineNode, { type: 'text' } | { type: 'equation' }>;

/**
 * A stored title as this editor holds it, or null where it holds anything this editor cannot keep -
 * a mark, a cross-reference, a footnote, a variable, an image - which the caller answers by not
 * offering it for editing here, rather than by an edit that would quietly drop what it could not
 * show. An empty run is nothing, and two runs side by side are one text node, as ProseMirror keeps them.
 */
export function titleToEditor(title: readonly InlineNode[]): Node | null {
  const children: Node[] = [];
  for (const inline of title) {
    if (inline.type === 'text') {
      if (inline.marks.length > 0) return null;
      if (inline.value !== '') children.push(titleSchema.text(inline.value));
    } else if (inline.type === 'equation') {
      children.push(
        titleSchema.nodes.equation!.create({ mathml: inline.mathml, latex: inline.latex ?? null }),
      );
    } else {
      return null;
    }
  }
  return titleSchema.node('doc', null, children);
}

/**
 * The title this editor holds, as the stored model spells it: text runs with no marks, and each
 * equation with its MathML and its LaTeX only where one was typed - absent being the stored spelling
 * of none, as `runsOf` spells a paragraph's. Not trimmed: what the author typed, spaces and all; the
 * caller trims what it commits.
 */
export function titleFromEditor(doc: Node): TitleRun[] {
  const runs: TitleRun[] = [];
  doc.forEach((child) => {
    if (child.type.name === 'equation') {
      const { mathml, latex } = child.attrs as { mathml: string; latex: string | null };
      runs.push({ type: 'equation', mathml, ...(latex === null ? {} : { latex }) });
      return;
    }
    runs.push({ type: 'text', value: child.text ?? '', marks: [] });
  });
  return runs;
}
