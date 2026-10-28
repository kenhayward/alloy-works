import { z } from 'zod';

import type { ContentDocument } from '../content/model/document.js';
import type { IndexMarkerNode } from '../content/model/inline.js';
import type { Conditions } from '../content/model/marks.js';
import type { OutlineDocument, OutlineNode } from '../structure/outline.js';
import { definitionIdentity } from '../metadata/definition.js';

const key = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

/**
 * **A condition axis** (REU-020; the R6 plan, R6-A): the environment's, declared once, its permitted
 * values a closed list managed as the axis is. A condition mark's `axis` names its key and `values`
 * its values' keys.
 */
export const conditionAxisDefinitionSchema = z.strictObject({
  ...definitionIdentity,
  key,
  values: z
    .array(z.strictObject({ key, label: z.string().min(1).max(200) }))
    .min(1)
    .max(200)
    .refine(
      (values) => new Set(values.map((each) => each.key)).size === values.length,
      'Each value of an axis has a key of its own',
    ),
});
export type ConditionAxisDefinition = z.infer<typeof conditionAxisDefinitionSchema>;

/** **A profile** (REU-022; R6-B): the values a document takes on each axis it names, by key. */
export const profileSchema = z.record(key, z.array(key).min(1).max(200));
export type Profile = z.infer<typeof profileSchema>;

/**
 * A profile as a document declares it and a publish records it (REU-022, REU-053; R6-B): its values,
 * and whether exclusion by an unset axis is accepted, true or absent.
 */
export const storedProfileSchema = z.strictObject({
  values: profileSchema,
  excludeUnset: z.literal(true).optional(),
});
export type StoredProfile = z.infer<typeof storedProfileSchema>;

/** An axis content is conditioned on that the profile does not name, and the block it stands in. */
export interface UnsetAxis {
  readonly axis: string;
  readonly block: string | null;
}

interface ConditionMark {
  readonly type: 'condition';
  readonly axis: string;
  readonly values: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCondition = (mark: unknown): mark is ConditionMark =>
  isRecord(mark) && mark['type'] === 'condition';

/**
 * Every text run's words a value holds, at any depth: the runs of one inline sequence joined as they
 * read, whatever marks split them, and each sequence apart from the next by a space. What the scan
 * looks for (REU-048).
 */
/**
 * Every `axis:value` a piece of content is conditioned on, once each and sorted (SCH-061; the R14 plan,
 * R14-D): a node's or a numbered block's `conditions`, and a condition mark's, wherever they stand in
 * it. Nothing is resolved under a profile.
 */
export function conditionsIn(value: unknown): string[] {
  const found = new Set<string>();
  const add = (axis: unknown, values: unknown) => {
    if (typeof axis !== 'string' || !Array.isArray(values)) return;
    for (const each of values) if (typeof each === 'string') found.add(`${axis}:${each}`);
  };
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const record = node as Record<string, unknown>;
    if (record['type'] === 'condition') add(record['axis'], record['values']);
    if (Array.isArray(record['conditions'])) {
      for (const each of record['conditions'] as unknown[]) {
        if (typeof each === 'object' && each !== null) {
          const condition = each as Record<string, unknown>;
          add(condition['axis'], condition['values']);
        }
      }
    }
    for (const [key, child] of Object.entries(record)) if (key !== 'conditions') walk(child);
  };
  walk(value);
  return [...found].sort();
}

export function wordsOf(value: unknown): string {
  const sequences: string[] = [];
  const walk = (each: unknown) => {
    if (Array.isArray(each)) {
      const runs = each.filter(
        (member): member is { value: string } =>
          isRecord(member) && member['type'] === 'text' && typeof member['value'] === 'string',
      );
      if (runs.length > 0) sequences.push(runs.map((run) => run.value).join(''));
      each.forEach((member) => {
        if (!(isRecord(member) && member['type'] === 'text')) walk(member);
      });
    } else if (isRecord(each) && each['type'] === 'indexMarker') {
      // An index marker's words are printed in the index (the IX plan, IX-F), so they are probed too.
      const { term, sub, see, seeAlso } = each as Partial<IndexMarkerNode>;
      for (const words of [term, sub, see, ...(seeAlso ?? [])]) {
        if (words !== undefined) sequences.push(words);
      }
    } else if (isRecord(each)) Object.values(each).forEach(walk);
  };
  walk(value);
  return sequences.join(' ').replace(/\s+/g, ' ').trim();
}

/** Every identifier a value holds at any depth: what a reference into it could have named. */
function identifiersIn(value: unknown, into: string[]): void {
  if (Array.isArray(value)) value.forEach((each) => identifiersIn(each, into));
  else if (isRecord(value)) {
    if (typeof value['id'] === 'string' && typeof value['type'] === 'string')
      into.push(value['id']);
    Object.values(value).forEach((each) => identifiersIn(each, into));
  }
}

const isRun = (
  value: unknown,
): value is { type: 'text'; value: string; marks: readonly unknown[] } =>
  isRecord(value) && value['type'] === 'text' && Array.isArray(value['marks']);

/**
 * **Content as a profile selects it** (REU-021, REU-024; R6-C): a text run is kept where, for every
 * condition mark on it, the profile's values on that axis meet the mark's, and kept without them; an
 * axis the profile does not name selects nothing, and is reported. A paragraph its conditions empty
 * is removed where its sequence keeps another block. `excluded` holds each passage taken out, adjacent
 * runs joined, for the scan (REU-048).
 */
export function applyConditions(
  content: ContentDocument,
  profile: Profile,
): {
  readonly content: ContentDocument;
  readonly excluded: readonly string[];
  readonly unset: readonly UnsetAxis[];
  /** Each block the conditions took out, by its identifier: a reference to it fails by name (R11-D). */
  readonly removed: readonly string[];
} {
  const excluded: string[] = [];
  const removed: string[] = [];
  const unset: UnsetAxis[] = [];
  const said = new Set<string>();
  const selects = (mark: ConditionMark, block: string | null): boolean => {
    // Its own keys alone: an axis named `constructor` is unset, never an inherited member.
    const taken = Object.hasOwn(profile, mark.axis) ? profile[mark.axis] : undefined;
    if (taken === undefined) {
      const seen = `${mark.axis}\u0000${block ?? ''}`;
      if (!said.has(seen)) {
        said.add(seen);
        unset.push({ axis: mark.axis, block });
      }
      return false;
    }
    return mark.values.some((value) => taken.includes(value));
  };

  const walk = (value: unknown, block: string | null): unknown => {
    if (Array.isArray(value)) {
      let passage: string | null = null;
      const close = () => {
        if (passage !== null && passage !== '') excluded.push(passage);
        passage = null;
      };
      const kept: unknown[] = [];
      // What each kept member was before it was walked, so an emptied paragraph is judged by its own.
      const was: unknown[] = [];
      for (const member of value) {
        // A numbered block's own conditions (R11-B): selected as a mark's are, else taken out whole.
        if (isRecord(member) && Array.isArray(member['conditions'])) {
          const id = member['id'] as string;
          const asked = member['conditions'] as readonly { axis: string; values: string[] }[];
          const answers = asked.map((each) => selects({ type: 'condition', ...each }, id));
          if (answers.every(Boolean)) {
            close();
            const { conditions: dropped, ...rest } = member;
            void dropped;
            kept.push(walk(rest, block));
            was.push(member);
          } else {
            close();
            identifiersIn(member, removed);
            const words = wordsOf(member);
            if (words !== '') excluded.push(words);
          }
          continue;
        }
        // A marker inside an excluded passage goes with it (the IX plan, IX-F): its entry would
        // locate words that are not there, and print its term from them.
        if (passage !== null && isRecord(member) && member['type'] === 'indexMarker') continue;
        if (isRun(member) && member.marks.some(isCondition)) {
          // Each asked, so every unset axis on the run is reported, not the first alone (REU-053).
          const answers = member.marks.filter(isCondition).map((mark) => selects(mark, block));
          if (answers.every(Boolean)) {
            close();
            kept.push({ ...member, marks: member.marks.filter((mark) => !isCondition(mark)) });
            was.push(member);
          } else {
            passage = (passage ?? '') + member.value;
          }
          continue;
        }
        close();
        kept.push(walk(member, block));
        was.push(member);
      }
      close();
      const emptied = (member: unknown, index: number) =>
        isRecord(member) &&
        member['type'] === 'paragraph' &&
        Array.isArray(member['content']) &&
        member['content'].length === 0 &&
        isRecord(was[index]) &&
        Array.isArray((was[index] as Record<string, unknown>)['content']) &&
        ((was[index] as Record<string, unknown>)['content'] as unknown[]).length > 0;
      const remaining = kept.filter((member, index) => !emptied(member, index));
      if (remaining.length === 0) return kept;
      for (const [index, member] of kept.entries()) {
        if (emptied(member, index))
          removed.push((member as Record<string, unknown>)['id'] as string);
      }
      return remaining;
    }
    if (isRecord(value)) {
      const here =
        typeof value['id'] === 'string' && typeof value['type'] === 'string'
          ? (value['id'] as string)
          : block;
      return Object.fromEntries(
        Object.entries(value).map(([name, member]) => [name, walk(member, here)]),
      );
    }
    return value;
  };

  const blocks = walk(content.content, null) as ContentDocument['content'];
  return { content: { ...content, content: blocks }, excluded, unset, removed };
}

/** Whether `conditions` select under `profile`, naming each axis it does not set (R6-C, REU-024). */
export function selected(
  conditions: Conditions,
  profile: Profile,
  unset: (axis: string) => void,
): boolean {
  // Each asked, so every unset axis is reported, not the first alone (REU-053).
  const answers = conditions.map((condition) => {
    // Its own keys alone: an axis named `constructor` is unset, never an inherited member.
    const taken = Object.hasOwn(profile, condition.axis) ? profile[condition.axis] : undefined;
    if (taken === undefined) {
      unset(condition.axis);
      return false;
    }
    return condition.values.some((value) => taken.includes(value));
  });
  return answers.every(Boolean);
}

/**
 * **An outline as a profile selects it** (REU-021, REU-024; the R11 plan, R11-A, R11-C): a node is
 * kept where its conditions select it, and taken out with its whole subtree where they do not; what is
 * kept is returned without its conditions. `excluded` is every node taken out, in document order;
 * `passages` each section title among them, for the scan (REU-048); `unset` each axis a node asked
 * that the profile does not name, by the node. A node under one taken out is never asked.
 */
export function selectOutline(
  outline: OutlineDocument,
  profile: Profile,
): {
  readonly outline: OutlineDocument;
  readonly excluded: readonly string[];
  readonly passages: readonly string[];
  readonly unset: readonly { readonly axis: string; readonly node: string }[];
} {
  const excluded: string[] = [];
  const passages: string[] = [];
  const unset: { axis: string; node: string }[] = [];
  const takeOut = (node: OutlineNode) => {
    excluded.push(node.id);
    if (node.type === 'section') {
      passages.push(node.title.map((each) => (each.type === 'text' ? each.value : '')).join(''));
    }
    node.children.forEach(takeOut);
  };
  const keep = (nodes: readonly OutlineNode[]): OutlineNode[] =>
    nodes.flatMap((node) => {
      if (
        node.conditions !== undefined &&
        !selected(node.conditions, profile, (axis) => unset.push({ axis, node: node.id }))
      ) {
        takeOut(node);
        return [];
      }
      const { conditions: dropped, ...rest } = node;
      void dropped;
      return [{ ...rest, children: keep(node.children) } as OutlineNode];
    });
  const nodes = keep(outline.nodes);
  return { outline: { ...outline, nodes }, excluded, passages, unset };
}

/**
 * **What a profile leaves unset** (LIF-065, REU-053; the R11 plan, R11-G): each axis the outline it
 * keeps, and each kept occurrence's content, is conditioned on that the profile does not name, once
 * each, in order. Accepting exclusion by unset sets nothing, so it is not asked here.
 */
export function unsetAxes(
  outline: OutlineDocument,
  contents: ReadonlyMap<string, ContentDocument>,
  profile: Profile,
): string[] {
  const selection = selectOutline(outline, profile);
  const excluded = new Set(selection.excluded);
  const axes = new Set(selection.unset.map((each) => each.axis));
  for (const [node, content] of contents) {
    if (excluded.has(node)) continue;
    for (const each of applyConditions(content, profile).unset) axes.add(each.axis);
  }
  return [...axes].sort((a, b) => a.localeCompare(b));
}
