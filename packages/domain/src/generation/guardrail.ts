import { z } from 'zod';

import { CONTROL, characters, storable } from '../data/primitives.js';

/**
 * A tenant's guardrail (generation.md, "Guardrails"; the G5 plan, G5-F; GEN-049): a phrase forbidden
 * in what a model is sent, in what it returns, or in both, with the reason a refusal says. A phrase
 * alone, matched as words are read, never a pattern, so no tenant expression runs in the service.
 * The product's floor is no rule: content as data, tools as the requester and writes as proposals are
 * code, and nothing here reaches them.
 */

export const GUARDRAIL_SIDES = ['sent', 'returned', 'both'] as const;
export type GuardrailSide = (typeof GUARDRAIL_SIDES)[number];

const words = (what: string, most: number) =>
  storable(what)
    .refine((value) => value.trim() !== '' && characters(value) <= most, {
      message: `${what} is 1 to ${most.toLocaleString('en-GB')} characters, not all space`,
    })
    .refine((value) => !CONTROL.test(value), { message: `${what} holds no control character` });

export const guardrailSchema = z.strictObject({
  phrase: words('A phrase', 200),
  applies: z.enum(GUARDRAIL_SIDES),
  reason: words('A reason', 500),
});
export type Guardrail = z.infer<typeof guardrailSchema>;

/** A rule in force, as a run checks it. */
export interface GuardrailRule extends Guardrail {
  readonly id: string;
}

/** Text as a phrase is matched in it: composed, lower case, every run of space one space. */
export function matchable(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

/** The first rule watching `side` whose phrase the text holds, or undefined where none does. */
export function guardrailMatch(
  rules: readonly GuardrailRule[],
  side: 'sent' | 'returned',
  text: string,
): GuardrailRule | undefined {
  const held = matchable(text);
  return rules.find(
    (rule) =>
      (rule.applies === side || rule.applies === 'both') && held.includes(matchable(rule.phrase)),
  );
}

/** Whether any rule watches what returns, so a reply is held until it is checked. */
export const watchesReplies = (rules: readonly GuardrailRule[]) =>
  rules.some((rule) => rule.applies !== 'sent');
