import type { OutlineApplied, OutlineRules } from './operations.js';
import {
  parseOutlineDocument,
  walkOutline,
  type OutlineDocument,
  type OutlineNode,
  type SectionNode,
} from './outline.js';

/** The most references one placement makes: a section placing more is split by its author first. */
export const PLACE_MAX = 200;

type Mode = Extract<OutlineNode, { type: 'reference' }>['mode'];

/**
 * The components a section places, one per occurrence, at any depth and in reading order (the R2
 * plan, R2-F); undefined where the node is no section of this outline.
 */
export function referencesUnder(outline: OutlineDocument, section: string): string[] | undefined {
  let found: OutlineNode | undefined;
  walkOutline(outline.nodes, (node) => {
    if (node.id === section) found = node;
  });
  if (found?.type !== 'section') return undefined;
  const components: string[] = [];
  walkOutline(found.children, (node) => {
    if (node.type === 'reference') components.push(node.component);
  });
  return components;
}

/**
 * Another document's section placed into this one in one act (REU-054): a new section, the author's,
 * under `parent` at `position`, titled as the author says, holding one new reference per occurrence
 * in the mode each is given. Nothing is shared with the section it was found in (STR-004), and no
 * value is copied: the new section's are empty, as any inserted section's are, for the author's own
 * template to fill (STR-060). Held to the template's changes as an inserted section is (TPL-015).
 */
export function placeSection(
  outline: OutlineDocument,
  input: {
    readonly parent: string | null;
    readonly position: number;
    readonly title: SectionNode['title'];
    readonly references: readonly { readonly component: string; readonly mode: Mode }[];
  },
  newIdentifier: () => string,
  rules: OutlineRules = {},
): OutlineApplied {
  if (rules.changes !== undefined && !rules.changes.add) {
    return {
      applied: false,
      reason: "This document's template does not allow sections to be added",
    };
  }
  if (input.references.length === 0) {
    return { applied: false, reason: 'The section places no component' };
  }
  if (input.references.length > PLACE_MAX) {
    return { applied: false, reason: `A placement makes at most ${PLACE_MAX} references` };
  }
  let children: readonly OutlineNode[] | undefined =
    input.parent === null ? outline.nodes : undefined;
  if (input.parent !== null) {
    walkOutline(outline.nodes, (node) => {
      if (node.id === input.parent) children = node.children;
    });
  }
  if (children === undefined)
    return { applied: false, reason: 'The parent is not in this outline' };
  if (!Number.isInteger(input.position) || input.position < 0 || input.position > children.length) {
    return { applied: false, reason: 'The position is past the end of these children' };
  }
  // At the top, after any front matter: the new section is body matter, which never precedes it.
  const leadingFront = outline.nodes.findIndex((node) => node.matter !== 'front');
  const at =
    input.parent === null
      ? Math.max(input.position, leadingFront < 0 ? outline.nodes.length : leadingFront)
      : input.position;
  const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };
  const section: OutlineNode = {
    ...base,
    id: newIdentifier(),
    type: 'section',
    title: input.title,
    children: input.references.map((each): OutlineNode => ({
      ...base,
      id: newIdentifier(),
      type: 'reference',
      component: each.component,
      mode: each.mode,
      children: [],
    })),
  };
  const splice = (nodes: readonly OutlineNode[]): OutlineNode[] =>
    input.parent === null
      ? [...nodes.slice(0, at), section, ...nodes.slice(at)]
      : nodes.map((node) =>
          node.id === input.parent
            ? {
                ...node,
                children: [
                  ...node.children.slice(0, input.position),
                  section,
                  ...node.children.slice(input.position),
                ],
              }
            : { ...node, children: splice(node.children) },
        );
  const nodes = splice(outline.nodes);
  const firstNotFront = nodes.findIndex((node) => node.matter !== 'front');
  if (firstNotFront >= 0 && nodes.slice(firstNotFront).some((node) => node.matter === 'front')) {
    return { applied: false, reason: 'Front matter comes before the rest of the outline' };
  }
  try {
    return { applied: true, outline: parseOutlineDocument({ ...outline, nodes }) };
  } catch {
    return {
      applied: false,
      reason: 'This operation would produce an outline that cannot be stored',
    };
  }
}

/**
 * How much a component holds (REU-046): its top-level blocks, and the characters of the text runs
 * anywhere within them. Read from stored content its writer checked.
 */
export function contentSize(content: unknown): { blocks: number; characters: number } {
  const blocks =
    typeof content === 'object' &&
    content !== null &&
    Array.isArray((content as { content?: unknown }).content)
      ? (content as { content: unknown[] }).content.length
      : 0;
  let characters = 0;
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === 'object' && value !== null) {
      const node = value as Record<string, unknown>;
      if (node['type'] === 'text' && typeof node['value'] === 'string') {
        characters += [...node['value']].length;
      }
      Object.values(node).forEach(walk);
    }
  };
  walk((content as { content?: unknown } | null)?.content);
  return { blocks, characters };
}
