import { z } from 'zod';

/**
 * The atom of the CCMS: a titled, typed, independently revisable piece of content that a
 * publication assembles rather than owns. Everything else in the domain will be built over this.
 */
export const componentTypes = ['topic', 'concept', 'task', 'reference'] as const;

export type ComponentType = (typeof componentTypes)[number];

export const componentSchema = z.object({
  id: z.uuid(),
  type: z.enum(componentTypes),
  // A component is defined by being reusable, and a component nobody can identify in a picker is
  // not reusable - so a blank title is a domain error, not a presentation problem.
  title: z.string().refine((value) => value.trim().length > 0, {
    message: 'A component needs a title',
  }),
  body: z.string(),
  revision: z.int().min(1),
});

export type Component = z.infer<typeof componentSchema>;

export type ComponentDraft = Pick<Component, 'type' | 'title' | 'body'>;

/** Validates an untrusted value - anything read from storage, IPC or the network. */
export function parseComponent(value: unknown): Component {
  return componentSchema.parse(value);
}

export function createComponent(draft: ComponentDraft): Component {
  return parseComponent({ ...draft, id: globalThis.crypto.randomUUID(), revision: 1 });
}

/**
 * Returns the next revision. The component passed in is left alone: revisions are values, so a
 * caller holding an earlier one keeps holding exactly what it read.
 */
export function reviseComponent(component: Component, changes: Partial<ComponentDraft>): Component {
  return parseComponent({ ...component, ...changes, revision: component.revision + 1 });
}
