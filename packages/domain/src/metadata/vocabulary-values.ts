import type { Vocabulary } from '../library/vocabulary.js';
import { failure, type MetadataFailure } from './failure.js';
import type { EffectiveField } from './resolve.js';
import { hasMember, type MetadataValues } from './values.js';

/**
 * The service's lookup over the environment's vocabularies at their latest versions (the VO plan,
 * VO-D). Synchronous, as `PrincipalLookup` is: the caller loads what `vocabularyIdsIn` names first.
 */
export type VocabularyLookup = (id: string) => Vocabulary | undefined;

const drawsOn = (each: EffectiveField): string | undefined =>
  each.field.dataType === 'text' ? each.field.validation.vocabulary : undefined;

/** The text values a field holds, each with its place; anything else is `validate`'s to refuse. */
function textElements(each: EffectiveField, values: MetadataValues) {
  if (!hasMember(values, each.field.id)) return [];
  const value = values[each.field.id];
  const list = each.field.multiplicity === 'many' && Array.isArray(value) ? value : [value];
  return list.flatMap((element: unknown, index) =>
    typeof element === 'string' ? [{ value: element, index }] : [],
  );
}

/** Every vocabulary the effective fields draw on, once each, in order. */
export function vocabularyIdsIn(effective: readonly EffectiveField[]): string[] {
  return [...new Set(effective.flatMap((each) => drawsOn(each) ?? []))];
}

/**
 * Every value of a field drawing on a vocabulary that the vocabulary does not hold fails
 * `metadata.vocabulary` (MET-003), checked against what the environment holds and never a source
 * (MET-032). **A retired value passes where the version before held it in the same field** (LIB-023):
 * it stays valid where used and is refused anew. A deprecated value passes: it is still offered.
 *
 * Not part of `validate`, as `checkUserValues` is not: it runs where a value is saved, and publishing,
 * promotion, restore and suggestions, which keep only `fixed` failures, never refuse a held value.
 */
export function checkVocabularyValues(
  values: MetadataValues,
  previous: MetadataValues,
  effective: readonly EffectiveField[],
  vocabularies: VocabularyLookup,
): MetadataFailure[] {
  const failures: MetadataFailure[] = [];
  for (const each of effective) {
    const id = drawsOn(each);
    if (id === undefined) continue;
    const elements = textElements(each, values);
    if (elements.length === 0) continue;
    const vocabulary = vocabularies(id);
    if (vocabulary === undefined) {
      failures.push(
        failure(each.field.id, 'vocabulary', 'The vocabulary this field draws on is not there'),
      );
      continue;
    }
    const held = new Set(textElements(each, previous).map((element) => element.value));
    const many = each.field.multiplicity === 'many';
    for (const { value, index } of elements) {
      const which = many ? `Value ${index + 1}, ${value},` : value;
      const found = vocabulary.values.find((candidate) => candidate.id === value);
      if (found === undefined) {
        failures.push(
          failure(each.field.id, 'vocabulary', `${which} is no value of the vocabulary`),
        );
      } else if (found.state === 'retired' && !held.has(value)) {
        failures.push(
          failure(each.field.id, 'vocabulary', `${which} is retired: choose another value`),
        );
      }
    }
  }
  return failures;
}
