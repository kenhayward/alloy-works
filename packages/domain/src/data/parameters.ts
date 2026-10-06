import { storableText } from '../stored/storable.js';
import { compareCanonical, valueProblem, type CanonicalValue } from './canonical.js';
import type { Parameter } from './definition.js';

/** A run's parameter values, by name: each canonical, or a list of canonical values (D2-R). */
export type ParameterValues = Readonly<
  Record<string, CanonicalValue | readonly CanonicalValue[] | undefined>
>;

/** Why a value fails its declaration (D2-R). */
export type ParameterRule =
  | 'required'
  | 'type'
  | 'permitted'
  | 'range'
  | 'list'
  | 'precision'
  | 'scale'
  | 'zone'
  | 'variation'
  // A value its HTTP position cannot carry (DAT-081; the D6 plan, D6-E).
  | 'position';

/** A value refused by its declaration, named with its parameter, the rule and the value (DAT-020). */
export interface ParameterProblem {
  readonly parameter: string;
  readonly rule: ParameterRule;
  readonly value: string;
}

/** The longest text value, in characters, and the most items a list may hold (D2-R). */
export const MAX_TEXT_VALUE = 1000;
export const MAX_LIST_ITEMS = 50;

const INT8_MIN = -(2n ** 63n);
const INT8_MAX = 2n ** 63n - 1n;

/** A value as a problem names it: text as it is, anything else as JSON, cut to 1,000 characters. */
function shown(value: unknown): string {
  const text = value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  const points = [...text];
  return points.length > MAX_TEXT_VALUE ? points.slice(0, MAX_TEXT_VALUE).join('') : text;
}

/** One value's rule broken, or null: its canonical form, then text's bounds, then the declaration's. */
function itemRule(parameter: Parameter, value: unknown): ParameterRule | null {
  if (parameter.variation !== undefined) {
    return parameter.variation.some((each) => each.key === value) ? null : 'variation';
  }
  const { type } = parameter;
  const problem = valueProblem(type, value);
  if (problem !== null) return problem;
  if (type.base === 'text') {
    const text = value as string;
    if (!storableText(text)) return 'type';
    if ([...text].length > MAX_TEXT_VALUE) return 'range';
  }
  if (type.base === 'integer') {
    const number = BigInt(value as string);
    if (number < INT8_MIN || number > INT8_MAX) return 'range';
  }
  const { permitted } = parameter;
  if (permitted !== undefined) {
    const canonical = value as CanonicalValue;
    if ('values' in permitted) {
      if (!permitted.values.some((each) => each === canonical)) return 'permitted';
    } else {
      const { minimum, maximum } = permitted;
      if (minimum !== undefined && compareCanonical(type, canonical, minimum) < 0) return 'range';
      if (maximum !== undefined && compareCanonical(type, canonical, maximum) > 0) return 'range';
    }
  }
  return null;
}

/**
 * Each value checked against its declaration before anything runs (DAT-020, D2-R): present where
 * required; a list exactly where declared one, at most 50 items, none null or a list; each value in
 * its type's canonical form exactly, since what is validated is what is bound; text at most 1,000
 * characters with no U+0000 and no lone surrogate; an integer within 64 bits; within the permitted
 * values or range; a variation's value one of its keys. One problem for each parameter that fails,
 * naming the rule and the value; a value for a parameter not declared fails `type`, having none.
 */
export function checkParameterValues(
  parameters: readonly Parameter[],
  values: ParameterValues,
): ParameterProblem[] {
  const problems: ParameterProblem[] = [];
  const declared = new Set(parameters.map((parameter) => parameter.name));
  for (const [name, value] of Object.entries(values)) {
    if (!declared.has(name)) problems.push({ parameter: name, rule: 'type', value: shown(value) });
  }
  for (const parameter of parameters) {
    const value = Object.hasOwn(values, parameter.name) ? values[parameter.name] : undefined;
    const refuse = (rule: ParameterRule) =>
      problems.push({ parameter: parameter.name, rule, value: shown(value) });
    if (value === undefined || value === null) {
      if (parameter.required) refuse('required');
      continue;
    }
    if (Array.isArray(value) !== parameter.list) {
      refuse('list');
      continue;
    }
    if (Array.isArray(value)) {
      const items = value as readonly unknown[];
      if (
        items.length > MAX_LIST_ITEMS ||
        items.some((item) => item === null || item === undefined || Array.isArray(item))
      ) {
        refuse('list');
        continue;
      }
      const rule = items.map((item) => itemRule(parameter, item)).find((each) => each !== null);
      if (rule) refuse(rule);
      continue;
    }
    const rule = itemRule(parameter, value);
    if (rule) refuse(rule);
  }
  return problems;
}
