import type { InlineNode } from '../content/model/inline.js';
import type { MetadataFailure } from '../metadata/failure.js';
import type { EffectiveField } from '../metadata/resolve.js';
import { validate } from '../metadata/validate.js';
import type { MetadataValues } from '../metadata/values.js';
import { walkOutline, type OutlineDocument } from '../structure/outline.js';

import type { StartingSection, TemplateDefinition } from './definition.js';

/** A required starting section no section of the document came from, by its key and its words. */
export interface MissingSection {
  readonly key: string;
  readonly title: string;
}

/** A metadata failure, and the node whose values it belongs to: `null` for the document's own. */
export type NodeFailure = MetadataFailure & { readonly node: string | null };

/** A title's words, for naming a section to an author. */
function words(title: readonly InlineNode[]): string {
  return title
    .map((inline) => (inline.type === 'text' ? inline.value : ''))
    .join('')
    .trim();
}

/**
 * TPL-013's check (templates.md, "Publishing a document made from a template"): every required
 * starting section, at any depth, must be the `origin` of some section of the outline - found by its
 * key, so a retitled or moved one still counts and a section the author titled alike does not. Named
 * by the starting section's own title, in the template's order.
 */
export function missingSections(
  definition: TemplateDefinition,
  outline: OutlineDocument,
): MissingSection[] {
  const origins = new Set<string>();
  walkOutline(outline.nodes, (node) => {
    if (node.type === 'section' && node.origin !== undefined) origins.add(node.origin);
  });
  const missing: MissingSection[] = [];
  const walk = (sections: readonly StartingSection[]) => {
    for (const each of sections) {
      if (each.required && !origins.has(each.key)) {
        missing.push({ key: each.key, title: words(each.title) || each.key });
      }
      walk(each.children);
    }
  };
  walk(definition.outline.sections);
  return missing;
}

/**
 * TPL-055's check: the document's values against the document-level fields, and each section's
 * against the section-level ones, by `validate` - every failure, each with the node it belongs to. A
 * component reference's values are its component's own, and are not checked here.
 */
export function valueFailures(
  fields: {
    readonly document: readonly EffectiveField[];
    readonly section: readonly EffectiveField[];
  },
  outline: OutlineDocument,
  values: MetadataValues,
): NodeFailure[] {
  const failures: NodeFailure[] = validate(fields.document, values).map((each) => ({
    ...each,
    node: null,
  }));
  walkOutline(outline.nodes, (node) => {
    if (node.type !== 'section') return;
    for (const each of validate(fields.section, node.values))
      failures.push({ ...each, node: node.id });
  });
  return failures;
}
