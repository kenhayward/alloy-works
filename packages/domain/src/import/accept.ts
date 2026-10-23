import type { BlockNode } from '../content/model/blocks.js';
import { inBlocks, type ProposedChange } from './changes.js';
import type { ImportIdentity, ImportPolicy } from './structure.js';

/**
 * Accepting an import (the IM plan, IM-F, IM-H, IM-I): each reference within it resolved to what it
 * names in the document being made, and each Word author attributed as the tenant's policy says,
 * once, then (IMP-032).
 */

/** A component being made, with its identity and its outline node chosen before it is written. */
export interface AcceptedComponent {
  readonly component: string;
  readonly node: string;
  readonly headings: readonly string[];
  readonly blocks: readonly BlockNode[];
}

/**
 * A component's blocks with each reference to a `block` resolved (IMP-006): to its own block, to a
 * block of another component of the import, or to the outline node of the heading it named; one it
 * cannot resolve - outside the import, unretargeted (IMP-034) - is left as it is, and named.
 */
export function resolveReferences(
  own: AcceptedComponent,
  within: {
    readonly components: readonly AcceptedComponent[];
    readonly sections: readonly { readonly node: string; readonly headings: readonly string[] }[];
    /** Where each block the reader identified was admitted. */
    readonly anchors: Readonly<Record<string, string>>;
  },
): { readonly blocks: readonly BlockNode[]; readonly unresolved: readonly string[] } {
  const unresolved: string[] = [];
  const target = (block: string): object | undefined => {
    if (inBlocks(own.blocks, block)) return { kind: 'block', block };
    const admitted = within.anchors[block] ?? block;
    if (inBlocks(own.blocks, admitted)) return { kind: 'block', block: admitted };
    const other = within.components.find((each) => inBlocks(each.blocks, admitted));
    if (other) return { kind: 'component', component: other.component, block: admitted };
    const heading = [...within.sections, ...within.components].find((each) =>
      each.headings.includes(block),
    );
    if (heading) return { kind: 'node', node: heading.node };
    unresolved.push(block);
    return undefined;
  };
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (typeof value !== 'object' || value === null) return value;
    const node = value as Record<string, unknown>;
    const out = Object.fromEntries(Object.entries(node).map(([key, each]) => [key, walk(each)]));
    const was = node.target as { kind?: unknown; block?: unknown } | undefined;
    if (node.type === 'crossReference' && was?.kind === 'block' && typeof was.block === 'string') {
      const found = target(was.block);
      if (found) out.target = found;
    }
    return out;
  };
  return { blocks: walk(own.blocks) as BlockNode[], unresolved };
}

/** A member an identity may be mapped to: by email, or by name for its importer to confirm. */
export interface ImportMember {
  readonly id: string;
  readonly email: string | null;
  readonly name: string | null;
}

const same = (left: string | null, right: string | null) =>
  left !== null && right !== null && left.trim().toLowerCase() === right.trim().toLowerCase();

/** The member an identity matches (IM-I): one exact email, else one exact name, else none. */
export function matchIdentity(
  identity: ImportIdentity,
  members: readonly ImportMember[],
): { readonly match: 'email' | 'name' | 'none'; readonly member: string | null } {
  const byEmail = members.filter((member) => same(member.email, identity.email));
  if (byEmail.length === 1) return { match: 'email', member: byEmail[0]!.id };
  const byName = members.filter((member) => same(member.name, identity.name));
  if (byName.length === 1) return { match: 'name', member: byName[0]!.id };
  return { match: 'none', member: null };
}

/**
 * What a Word author's suggestion or comment is attributed to (IMP-010): the Word author as text,
 * and the member it matched, unless the policy keeps nothing. Attribution alone: what an import makes
 * is always made by its importer, since a file's names and emails are whatever its writer typed. A
 * name match counts only where its importer confirmed that member.
 */
export function attributionOf(
  name: string,
  applied: {
    readonly policy: ImportPolicy;
    readonly identities: readonly ImportIdentity[];
    readonly members: readonly ImportMember[];
    /** The member each name match was confirmed as, by the identity's name. */
    readonly confirmed: Readonly<Record<string, string>>;
  },
): { readonly member: string | null; readonly attributedTo: string | null } {
  const asText = { member: null, attributedTo: `${name} (from Word)` };
  if (applied.policy === 'discard') return { member: null, attributedTo: null };
  if (applied.policy === 'keep') return asText;
  const identity = applied.identities.find((each) => each.name === name) ?? {
    name,
    email: null,
    carries: [],
  };
  const { match, member } = matchIdentity(identity, applied.members);
  if (match === 'email' || (match === 'name' && applied.confirmed[name] === member)) {
    return { ...asText, member };
  }
  return asText;
}

/** A component's blocks with one author's changes made: what their suggestion proposes (IMP-005). */
export function suggestedBlocks(
  blocks: readonly BlockNode[],
  changes: readonly ProposedChange[],
): BlockNode[] {
  return blocks.flatMap((block) => {
    const change = changes.find((each) => each.block === block.id);
    return change ? [...change.proposed] : [block];
  });
}
