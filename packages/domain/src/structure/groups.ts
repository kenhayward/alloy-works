import type { GroupMember } from '../reuse/group.js';
import type { OutlineApplied } from './operations.js';
import {
  parseOutlineDocument,
  walkOutline,
  type OutlineDocument,
  type OutlineNode,
  type ReferenceNode,
} from './outline.js';

/**
 * Placing a component group and taking another of its versions, over the outline alone (the CG plan,
 * CG-F, CG-G, CG-I; REU-061, REU-062): pure, as every outline act is. Which group version, and that the
 * author may read each member, are the caller's to decide.
 */

/** A group at one version, as placing and taking it need it. */
export interface PlacedGroupVersion {
  readonly id: string;
  readonly version: string;
  readonly members: readonly GroupMember[];
}

/** One placed group's run: where it is, and its members' node ids in order. */
export interface GroupPlacement {
  readonly placement: string;
  readonly group: string;
  readonly version: string;
  /** The section holding it, or null at the top of the document. */
  readonly parent: string | null;
  readonly nodes: readonly string[];
}

const UNSTORABLE = 'This operation would produce an outline that cannot be stored';
const NO_PLACEMENT = 'There is no such placed group in this outline';
export const INSIDE_RUN = 'A node goes before or after a placed group, never among its members';

/** Every placed group's run, in document order. */
export function groupPlacements(outline: OutlineDocument): GroupPlacement[] {
  const runs = new Map<string, GroupPlacement & { nodes: string[] }>();
  const walk = (nodes: readonly OutlineNode[], parent: string | null) => {
    for (const node of nodes) {
      if (node.type === 'reference' && node.group !== undefined) {
        const run = runs.get(node.group.placement);
        if (run) run.nodes.push(node.id);
        else {
          runs.set(node.group.placement, {
            placement: node.group.placement,
            group: node.group.id,
            version: node.group.version,
            parent,
            nodes: [node.id],
          });
        }
      }
      walk(node.children, node.id);
    }
  };
  walk(outline.nodes, null);
  return [...runs.values()];
}

/** The placement a node is a member of, or undefined. */
export function placementOf(outline: OutlineDocument, node: string): string | undefined {
  let found: string | undefined;
  walkOutline(outline.nodes, (each) => {
    if (each.id === node && each.type === 'reference') found = each.group?.placement;
  });
  return found;
}

/**
 * Whether a node at `position` among `siblings` would stand among a run's members: between two of one
 * placement. Where a new node, or one moved, may not go (CG-G).
 */
export function insideRun(siblings: readonly OutlineNode[], position: number): boolean {
  const before = siblings[position - 1];
  const after = siblings[position];
  const placement = (node: OutlineNode | undefined) =>
    node?.type === 'reference' ? node.group?.placement : undefined;
  const left = placement(before);
  return left !== undefined && left === placement(after);
}

function childrenOf(
  nodes: readonly OutlineNode[],
  parent: string | null,
): readonly OutlineNode[] | undefined {
  if (parent === null) return nodes;
  let found: OutlineNode | undefined;
  walkOutline(nodes, (node) => {
    if (node.id === parent) found = node;
  });
  return found?.type === 'section' ? found.children : undefined;
}

/** `parent`'s children made `make(children)`, wherever it sits. */
function withChildren(
  nodes: readonly OutlineNode[],
  parent: string | null,
  make: (children: readonly OutlineNode[]) => readonly OutlineNode[],
): readonly OutlineNode[] {
  if (parent === null) return make(nodes);
  return nodes.map((node) =>
    node.id === parent
      ? ({ ...node, children: make(node.children) } as OutlineNode)
      : ({ ...node, children: withChildren(node.children, parent, make) } as OutlineNode),
  );
}

function stored(outline: OutlineDocument, nodes: readonly OutlineNode[]): OutlineApplied {
  try {
    return { applied: true, outline: parseOutlineDocument({ ...outline, nodes }) };
  } catch {
    return { applied: false, reason: UNSTORABLE };
  }
}

const memberNode = (
  id: string,
  member: GroupMember,
  marker: ReferenceNode['group'] & object,
): ReferenceNode => ({
  type: 'reference',
  id,
  component: member.component,
  mode: { kind: 'pinned', version: member.version },
  numbered: true,
  matter: 'body',
  pageBreak: 'none',
  values: {},
  group: marker,
  children: [],
});

/**
 * A group placed (CG-F; REU-061): one ordinary reference per member, in its order, pinned to the
 * version the group version pins, each marked with the group and one new placement id, under a
 * section (or at the top) at `position`, never among another run's members. A reference is never
 * placed for a section here, so the template's changes are not asked (TPL-015 holds sections).
 */
export function placeGroup(
  outline: OutlineDocument,
  input: {
    readonly parent: string | null;
    readonly position: number;
    readonly group: PlacedGroupVersion;
  },
  newIdentifier: () => string,
): OutlineApplied {
  const children = childrenOf(outline.nodes, input.parent);
  if (children === undefined) {
    return { applied: false, reason: 'A group is placed in a section of this outline' };
  }
  if (!Number.isInteger(input.position) || input.position < 0 || input.position > children.length) {
    return { applied: false, reason: 'The position is past the end of these children' };
  }
  if (insideRun(children, input.position)) return { applied: false, reason: INSIDE_RUN };
  if (input.group.members.length === 0) {
    return { applied: false, reason: 'The group holds no component' };
  }
  const marker = { id: input.group.id, version: input.group.version, placement: newIdentifier() };
  const run = input.group.members.map((member) => memberNode(newIdentifier(), member, marker));
  return stored(
    outline,
    withChildren(outline.nodes, input.parent, (siblings) => [
      ...siblings.slice(0, input.position),
      ...run,
      ...siblings.slice(input.position),
    ]),
  );
}

/** What taking a group version changes (CG-I): said first, and what the take does. */
export interface GroupChange {
  /** Members the new version adds, by component, in its order. */
  readonly added: readonly string[];
  /** Members it drops, by component, in the run's order. */
  readonly removed: readonly string[];
  readonly kept: number;
  /** Local overrides on the members it drops, which go with them. */
  readonly overridesDropped: number;
}

export type GroupTaken =
  | { readonly applied: true; readonly outline: OutlineDocument; readonly change: GroupChange }
  | { readonly applied: false; readonly reason: string };

/**
 * Another version of a placed group taken (CG-I; REU-062): the run rewritten in the new version's
 * order, each kept member (matched by component) keeping its node id, its overrides and its other
 * switches, each new one a new reference with a new id, each dropped one gone, and all repinned and
 * remarked with the new version.
 */
export function takeGroupVersion(
  outline: OutlineDocument,
  placement: string,
  group: PlacedGroupVersion,
  newIdentifier: () => string,
): GroupTaken {
  const run = groupPlacements(outline).find((each) => each.placement === placement);
  if (!run) return { applied: false, reason: NO_PLACEMENT };
  if (run.group !== group.id) {
    return { applied: false, reason: 'That version is of another group' };
  }
  const siblings = childrenOf(outline.nodes, run.parent) ?? outline.nodes;
  const members = siblings.filter(
    (node): node is ReferenceNode =>
      node.type === 'reference' && node.group?.placement === placement,
  );
  const byComponent = new Map(members.map((node) => [node.component, node]));
  const wanted = new Set(group.members.map((each) => each.component));
  const marker = { id: group.id, version: group.version, placement };
  const rewritten = group.members.map((member): ReferenceNode => {
    const kept = byComponent.get(member.component);
    if (kept === undefined) return memberNode(newIdentifier(), member, marker);
    return { ...kept, mode: { kind: 'pinned', version: member.version }, group: marker };
  });
  const dropped = members.filter((node) => !wanted.has(node.component));
  const change: GroupChange = {
    added: group.members
      .filter((each) => !byComponent.has(each.component))
      .map((each) => each.component),
    removed: dropped.map((node) => node.component),
    kept: members.length - dropped.length,
    overridesDropped: dropped.reduce((sum, node) => sum + (node.overrides?.length ?? 0), 0),
  };
  const first = siblings.indexOf(members[0]!);
  const applied = stored(
    outline,
    withChildren(outline.nodes, run.parent, (children) => [
      ...children.slice(0, first),
      ...rewritten,
      ...children.slice(first + members.length),
    ]),
  );
  return applied.applied ? { ...applied, change } : applied;
}

/** A placed group removed as one ("Remove group"; CG-G): its run gone, nothing else. */
export function removeGroup(outline: OutlineDocument, placement: string): OutlineApplied {
  const run = groupPlacements(outline).find((each) => each.placement === placement);
  if (!run) return { applied: false, reason: NO_PLACEMENT };
  const gone = new Set(run.nodes);
  return stored(
    outline,
    withChildren(outline.nodes, run.parent, (children) =>
      children.filter((node) => !gone.has(node.id)),
    ),
  );
}
