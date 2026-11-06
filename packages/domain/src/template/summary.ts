import type { InlineNode } from '../content/model/inline.js';

import { instantiateOf, type StartingSection, type TemplateDefinition } from './definition.js';

/** A template as a gallery shows it (the ND plan, ND-H), read from its definition alone. */
export interface TemplateSummaryCounts {
  readonly description: string | null;
  /** Its starting sections, at every depth. */
  readonly sections: number;
  /** Its values, and of them those a document must be given. */
  readonly values: number;
  readonly requiredValues: number;
  /** Its components, by how each is placed (TPL-075). */
  readonly copied: number;
  readonly referenced: number;
  /** Its first five top-level sections' titles, as plain text. */
  readonly headings: readonly string[];
}

const plain = (title: readonly InlineNode[]) =>
  title
    .map((inline) => (inline.type === 'text' ? inline.value : ''))
    .join('')
    .trim();

/** What `GET /v1/templates` says of a template beside its name (ND-H). Pure. */
export function templateSummary(definition: TemplateDefinition): TemplateSummaryCounts {
  const count = (sections: readonly StartingSection[]): number =>
    sections.reduce((total, each) => total + 1 + count(each.children), 0);
  const parameters = definition.parameters ?? [];
  const components = definition.components ?? [];
  const copied = components.filter((each) => instantiateOf(definition, each) === 'copy').length;
  return {
    description: definition.description ?? null,
    sections: count(definition.outline.sections),
    values: parameters.length,
    requiredValues: parameters.filter((each) => each.required).length,
    copied,
    referenced: components.length - copied,
    headings: definition.outline.sections.slice(0, 5).map((each) => plain(each.title) || each.key),
  };
}
