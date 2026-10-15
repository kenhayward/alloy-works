import { z } from 'zod';

import { marksAsASet } from '../content/model/canonical.js';
import type { ContentDocument } from '../content/model/document.js';
import { textNodeSchema } from '../content/model/inline.js';
import { artifactIdentifierSchema as artifactIdentifier } from '../content/model/identifier.js';
import { canonicalJson } from '../stored/canonical.js';

/** The most overrides one reference carries: a small difference, not a fork (REU-011). */
export const OVERRIDES_MAX = 20;

/**
 * One local override (REU-011, REU-012; the R4 plan, R4-A): the paragraph `block` of the referenced
 * component, as it stood at its version `against`, replaced in this document by `text` - runs of text
 * with their marks and nothing else, so no number, binding, footnote or cross-reference changes.
 */
export const overrideSchema = z.strictObject({
  block: z.string().min(1).max(256),
  against: artifactIdentifier,
  text: z.array(textNodeSchema).min(1).max(2000),
});
export type Override = z.infer<typeof overrideSchema>;

export const overridesSchema = z
  .array(overrideSchema)
  .min(1)
  .max(OVERRIDES_MAX)
  .refine(
    (overrides) => new Set(overrides.map((each) => each.block)).size === overrides.length,
    'A block is overridden once',
  );

type Paragraph = Extract<ContentDocument['content'][number], { type: 'paragraph' }>;

/** A component's top-level paragraph by its identifier, or undefined. */
function paragraphOf(content: ContentDocument, block: string): Paragraph | undefined {
  const found = content.content.find((each) => each.id === block);
  return found?.type === 'paragraph' ? found : undefined;
}

const same = (a: unknown, b: unknown) =>
  canonicalJson(a, marksAsASet) === canonicalJson(b, marksAsASet);

/**
 * Why these overrides cannot be set, or undefined where each names a top-level paragraph of the
 * component at the version it names (R4-B). `contents` holds each `against` version's content that is
 * the component's own; any other is no version of it.
 */
export function overridesRefusal(
  overrides: readonly Override[],
  contents: ReadonlyMap<string, ContentDocument>,
): string | undefined {
  for (const each of overrides) {
    const content = contents.get(each.against);
    if (!content) return 'An override names a version that is not the component’s';
    if (!paragraphOf(content, each.block)) {
      return 'An override replaces a paragraph of the component, and this is none';
    }
  }
  return undefined;
}

/**
 * The content a reference shows in its document (REU-011, REU-015; R4-C): each override applied where
 * the paragraph it replaces is, canonically, as it stood at `against`; where it has changed or gone, the
 * override is stale - named, and nothing replaced, never applied over a changed paragraph or dropped
 * silently. `originals` holds each `against` version's content.
 */
export function applyOverrides(
  content: ContentDocument,
  overrides: readonly Override[],
  originals: ReadonlyMap<string, ContentDocument>,
): { readonly content: ContentDocument; readonly stale: readonly string[] } {
  const stale: string[] = [];
  const replaced = new Map<string, Override>();
  for (const each of overrides) {
    const now = paragraphOf(content, each.block);
    const was = originals.get(each.against);
    const then = was && paragraphOf(was, each.block);
    if (now && then && same(now, then)) replaced.set(each.block, each);
    else stale.push(each.block);
  }
  if (replaced.size === 0) return { content, stale };
  return {
    content: {
      ...content,
      content: content.content.map((block) => {
        const override = replaced.get(block.id);
        return override && block.type === 'paragraph'
          ? { ...block, content: override.text.map((run) => ({ ...run })) }
          : block;
      }) as ContentDocument['content'],
    },
    stale,
  };
}
