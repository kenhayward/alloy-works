import { z } from 'zod';

import type { ContentDocument } from '../content/model/document.js';
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
} {
  const excluded: string[] = [];
  const unset: UnsetAxis[] = [];
  const said = new Set<string>();
  const selects = (mark: ConditionMark, block: string | null): boolean => {
    const taken = profile[mark.axis];
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
      for (const member of value) {
        if (isRun(member) && member.marks.some(isCondition)) {
          if (member.marks.filter(isCondition).every((mark) => selects(mark, block))) {
            close();
            kept.push({ ...member, marks: member.marks.filter((mark) => !isCondition(mark)) });
          } else {
            passage = (passage ?? '') + member.value;
          }
          continue;
        }
        close();
        kept.push(walk(member, block));
      }
      close();
      const emptied = (member: unknown, index: number) =>
        isRecord(member) &&
        member['type'] === 'paragraph' &&
        Array.isArray(member['content']) &&
        member['content'].length === 0 &&
        isRecord(value[index]) &&
        Array.isArray((value[index] as Record<string, unknown>)['content']) &&
        ((value[index] as Record<string, unknown>)['content'] as unknown[]).length > 0;
      const remaining = kept.filter((member, index) => !emptied(member, index));
      return remaining.length > 0 ? remaining : kept;
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
  return { content: { ...content, content: blocks }, excluded, unset };
}
