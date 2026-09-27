import { carryForward } from '../metadata/carry.js';
import type { MetadataValues } from '../metadata/values.js';
import {
  OUTLINE_SCHEMA_VERSION,
  parseOutlineDocument,
  type OutlineDocument,
} from '../structure/outline.js';

import type { StartingSection } from './definition.js';
import type { ResolvedTemplate } from './resolve.js';

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
 */
export function materialiseTemplate(
  template: Extract<ResolvedTemplate, { ok: true }>,
  heading: Pick<OutlineDocument, 'title' | 'language' | 'direction'>,
  newIdentifier: () => string,
): MaterialisedTemplate {
  const node = (section: StartingSection): unknown => ({
    type: 'section',
    id: newIdentifier(),
    title: section.title,
    origin: section.key,
    numbered: section.numbered,
    matter: section.matter,
    pageBreak: section.pageBreak,
    values: carryForward({}, template.section).values,
    children: section.children.map(node),
  });
  const outline = parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: heading.title,
    language: heading.language,
    direction: heading.direction,
    nodes: template.outline.sections.map(node),
  });
  return { outline, values: carryForward({}, template.document).values };
}
