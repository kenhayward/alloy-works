import { carryForward } from '../metadata/carry.js';
import type { MetadataValues } from '../metadata/values.js';
import {
  OUTLINE_SCHEMA_VERSION,
  parseOutlineDocument,
  type OutlineDocument,
  type OutlineMatter,
} from '../structure/outline.js';

import type { StartingSection } from './definition.js';
import { placeAtTop } from './placement.js';
import type { ResolvedComponent, ResolvedTemplate } from './resolve.js';

/** What a document starts with when it is made from a template (templates.md, step 3 and 4). */
export interface MaterialisedTemplate {
  readonly outline: OutlineDocument;
  /** The document's own values, for its version 0.1. */
  readonly values: MetadataValues;
}

/**
 * The starting outline written as a document's own (TPL-062): each starting section a section node
 * with a new identifier, its title and switches, the key it came from as `origin`, and values seeded
 * from the section level's effective fields by `carryForward`, as a component's are from its type's;
 * the document's values seeded the same way from the document level's. The outline is parsed before it
 * is answered, so it is held to every rule a stored outline is, and shares nothing with the template.
 *
 * Each required component is placed as a reference carrying its key as `origin`, with its mode (TPL-014;
 * the R9 plan, R9-B): at the start or end of its starting section, or at the top level's, where the
 * start follows the front matter and the end precedes the appendices that close the outline.
 */
export function materialiseTemplate(
  template: Extract<ResolvedTemplate, { ok: true }>,
  heading: Pick<OutlineDocument, 'title' | 'language' | 'direction'>,
  newIdentifier: () => string,
): MaterialisedTemplate {
  const reference = (component: ResolvedComponent) => requiredReference(component, newIdentifier);
  const placed = (section: string | null, at: 'start' | 'end') =>
    template.components
      .filter((each) => each.place.section === section && each.place.at === at)
      .map(reference);
  const node = (section: StartingSection): unknown => ({
    type: 'section',
    id: newIdentifier(),
    title: section.title,
    origin: section.key,
    numbered: section.numbered,
    matter: section.matter,
    pageBreak: section.pageBreak,
    values: carryForward({}, template.section).values,
    children: [
      ...placed(section.key, 'start'),
      ...section.children.map(node),
      ...placed(section.key, 'end'),
    ],
  });
  const nodes = placeAtTop(
    template.outline.sections.map(node) as { matter: OutlineMatter }[],
    template.components
      .filter((each) => each.place.section === null)
      .map((each) => ({
        matter: each.place.matter ?? 'body',
        at: each.place.at,
        node: reference(each) as { matter: OutlineMatter },
      })),
  );
  const outline = parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: heading.title,
    language: heading.language,
    direction: heading.direction,
    nodes,
  });
  return { outline, values: carryForward({}, template.document).values };
}

/**
 * A required component placed as a reference (TPL-014; R9-B): its key as `origin`, its mode, and its
 * matter where it sits at the top level. Made the same way when a document is made and when a move
 * adds it (#660).
 */
export function requiredReference(
  component: Pick<ResolvedComponent, 'component' | 'key' | 'place'> & {
    readonly mode?: ResolvedComponent['mode'] | undefined;
  },
  newIdentifier: () => string,
) {
  return {
    type: 'reference' as const,
    id: newIdentifier(),
    component: component.component,
    mode: component.mode ?? { kind: 'approved' as const },
    origin: component.key,
    numbered: true,
    matter: component.place.section === null ? (component.place.matter ?? 'body') : 'body',
    pageBreak: 'none' as const,
    values: {},
    children: [],
  };
}
