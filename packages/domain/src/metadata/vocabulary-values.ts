import { valueLabel, type Vocabulary } from '../library/vocabulary.js';
import { failure, type MetadataFailure } from './failure.js';
import type { FieldDefinition } from './field.js';
import type { EffectiveField } from './resolve.js';
import { hasMember, type MetadataValues } from './values.js';

/**
 * The service's lookup over the environment's vocabularies at their latest versions (the VO plan,
 * VO-D). Synchronous, as `PrincipalLookup` is: the caller loads what `vocabularyIdsIn` names first.
 */
export type VocabularyLookup = (id: string) => Vocabulary | undefined;

const vocabularyOf = (field: FieldDefinition): string | undefined =>
  field.dataType === 'text' ? field.validation.vocabulary : undefined;
const drawsOn = (each: EffectiveField): string | undefined => vocabularyOf(each.field);

/** The text values a field holds, each with its place; anything else is `validate`'s to refuse. */
function textElements(each: { readonly field: FieldDefinition }, values: MetadataValues) {
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

/** A value held in a field drawing on a vocabulary (the VO plan, VO-D, VO-H). */
export interface HeldVocabularyValue {
  readonly field: string;
  readonly vocabulary: string;
  readonly value: string;
}

/** Every text value these fields hold where the field draws on a vocabulary, in field order. */
export function heldVocabularyValues(
  values: MetadataValues,
  fields: readonly FieldDefinition[],
): HeldVocabularyValue[] {
  return fields.flatMap((field) => {
    const vocabulary = vocabularyOf(field);
    return vocabulary === undefined
      ? []
      : textElements({ field }, values).map(({ value }) => ({
          field: field.id,
          vocabulary,
          value,
        }));
  });
}

/**
 * The values as a publish prints them (LIB-004, LIB-024; the VO plan, VO-H): each id a field drawing
 * on a vocabulary holds, its label in `language`, the base language's where it has none. An id the
 * vocabulary does not hold, and a vocabulary not read, print as held.
 */
export function valuesLabelled(
  values: MetadataValues,
  fields: readonly FieldDefinition[],
  vocabularies: VocabularyLookup,
  language: string,
): MetadataValues {
  const labelled: Record<string, unknown> = { ...values };
  for (const field of fields) {
    const id = vocabularyOf(field);
    const vocabulary = id === undefined ? undefined : vocabularies(id);
    if (vocabulary === undefined || !hasMember(values, field.id)) continue;
    const label = (element: unknown) => {
      const found =
        typeof element === 'string'
          ? vocabulary.values.find((each) => each.id === element)
          : undefined;
      return found === undefined ? element : valueLabel(vocabulary, found, language);
    };
    const value = values[field.id];
    labelled[field.id] = Array.isArray(value) ? value.map(label) : label(value);
  }
  return labelled;
}

/**
 * A deprecated or retired value a publish found held, by the node holding it (null for the document's
 * own), which never stops it (LIB-023; the VO plan, VO-D): its label in the publish's language, and a
 * deprecated one's replacement.
 */
export interface VocabularyValueWarning {
  readonly code: 'vocabulary_value';
  readonly node: string | null;
  readonly field: string;
  readonly value: string;
  readonly label: string;
  readonly state: 'deprecated' | 'retired';
  readonly replacedBy?: string;
}

/** A warning for each value held that its vocabulary holds deprecated or retired. */
export function vocabularyValueWarnings(
  held: readonly HeldVocabularyValue[],
  node: string | null,
  vocabularies: VocabularyLookup,
  language: string,
): VocabularyValueWarning[] {
  return held.flatMap(({ field, vocabulary: id, value }) => {
    const vocabulary = vocabularies(id);
    const found = vocabulary?.values.find((each) => each.id === value);
    if (vocabulary === undefined || found === undefined || found.state === 'active') return [];
    return [
      {
        code: 'vocabulary_value' as const,
        node,
        field,
        value,
        label: valueLabel(vocabulary, found, language),
        state: found.state,
        ...(found.replacedBy === undefined ? {} : { replacedBy: found.replacedBy }),
      },
    ];
  });
}
