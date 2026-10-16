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
  /** Required keys removed with a stated reason (TPL-029; the WF6 plan, WF6-B): no longer missing. */
  waived: ReadonlySet<string> = new Set(),
): MissingSection[] {
  const origins = new Set<string>();
  walkOutline(outline.nodes, (node) => {
    if (node.type === 'section' && node.origin !== undefined) origins.add(node.origin);
  });
  const missing: MissingSection[] = [];
  const walk = (sections: readonly StartingSection[]) => {
    for (const each of sections) {
      if (each.required && !origins.has(each.key) && !waived.has(each.key)) {
        missing.push({ key: each.key, title: words(each.title) || each.key });
      }
      walk(each.children);
    }
  };
  walk(definition.outline.sections);
  return missing;
}

/**
 * TPL-044's check (the R9 plan, R9-D): every component the template requires must be the `origin` of
 * some reference of the outline, unless removed with a stated reason.
 */
export function missingComponents(
  definition: TemplateDefinition,
  outline: OutlineDocument,
  waived: ReadonlySet<string> = new Set(),
): { readonly key: string; readonly component: string }[] {
  const origins = new Set<string>();
  walkOutline(outline.nodes, (node) => {
    if (node.type === 'reference' && node.origin !== undefined) origins.add(node.origin);
  });
  return (definition.components ?? [])
    .filter((each) => !origins.has(each.key) && !waived.has(each.key))
    .map((each) => ({ key: each.key, component: each.component }));
}

/**
 * Every required starting section's key, at any depth, and every required component's (TPL-013,
 * TPL-029, TPL-044): each removed only with a reason.
 */
export function requiredKeys(definition: TemplateDefinition): string[] {
  const keys: string[] = (definition.components ?? []).map((each) => each.key);
  const walk = (sections: readonly StartingSection[]) => {
    for (const each of sections) {
      if (each.required) keys.push(each.key);
      walk(each.children);
    }
  };
  walk(definition.outline.sections);
  return keys;
}

/** How a document departs from its template (TPL-028; the WF6 plan, WF6-A). */
export interface Departures {
  /** Each section it has that its template does not: none came from it, or from a key it no longer names. */
  readonly added: readonly { readonly node: string; readonly title: string }[];
  /** Each starting section none of its sections came from, with the reason a required one was removed. */
  readonly missing: readonly {
    readonly key: string;
    readonly title: string;
    readonly required: boolean;
    readonly reason: string | null;
  }[];
}

/**
 * TPL-028: what a document has that its template does not, in the outline's order, and what it lacks,
 * in the template's, found by key as TPL-013 finds a section. `waived` is each required key removed
 * with a reason, and the reason.
 */
export function departures(
  definition: TemplateDefinition,
  outline: OutlineDocument,
  waived: ReadonlyMap<string, string>,
): Departures {
  const keys = new Set<string>();
  const walkKeys = (sections: readonly StartingSection[]) => {
    for (const each of sections) {
      keys.add(each.key);
      walkKeys(each.children);
    }
  };
  walkKeys(definition.outline.sections);
  const origins = new Set<string>();
  const added: { node: string; title: string }[] = [];
  walkOutline(outline.nodes, (node) => {
    if (node.type !== 'section') return;
    if (node.origin !== undefined && keys.has(node.origin)) origins.add(node.origin);
    else added.push({ node: node.id, title: words(node.title) });
  });
  const missing: Departures['missing'][number][] = [];
  const walk = (sections: readonly StartingSection[]) => {
    for (const each of sections) {
      if (!origins.has(each.key)) {
        missing.push({
          key: each.key,
          title: words(each.title) || each.key,
          required: each.required,
          reason: each.required ? (waived.get(each.key) ?? null) : null,
        });
      }
      walk(each.children);
    }
  };
  walk(definition.outline.sections);
  return { added, missing };
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
