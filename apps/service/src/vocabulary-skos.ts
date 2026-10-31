import {
  holdsVocabularyText,
  isLanguageTag,
  isVocabularyKey,
  VOCABULARY_LIMITS,
  type Vocabulary,
  type VocabularyValue,
} from '@alloy-works/domain';
import {
  canonicalTag,
  CONCEPT,
  DCT,
  RDF_TYPE,
  readSubjects,
  SKOS,
  TOO_MANY,
  type Subject,
  type Value,
} from './terms/skos.js';

/**
 * A vocabulary as SKOS (the VO plan, VO-I; LIB-061, IMP-051): one concept scheme, its notation the
 * key and its preferred label the name; each value a concept, its notation the id, `prefLabel` and
 * `definition` by language, deprecated as `owl:deprecated` with `dct:isReplacedBy`. What SKOS has no
 * word for is said in Alloy Works' own namespace, `AW`: a retired value (`aw:retired`, deprecated
 * too, so a reader knowing only SKOS sees it withdrawn), the scheme's order (`aw:order`, `declared`
 * or `label`) and a value's place in it (`aw:position`). The terms' reader reads the text, so it is
 * data alike: nothing named is fetched, and what a value cannot hold is reported, never dropped.
 */

const OWL = 'http://www.w3.org/2002/07/owl#';
/** Alloy Works' namespace: a URN, so nothing reading a file ever looks it up. */
export const AW = 'urn:alloy-works:skos:';
const SCHEME = `${SKOS}ConceptScheme`;

export const VOCABULARY_SKOS_CONTEXT = {
  skos: SKOS,
  dct: DCT,
  owl: OWL,
  aw: AW,
  prefLabel: { '@id': 'skos:prefLabel', '@container': '@language' },
  definition: { '@id': 'skos:definition', '@container': '@language' },
  notation: { '@id': 'skos:notation' },
  inScheme: { '@id': 'skos:inScheme', '@type': '@id' },
  isReplacedBy: { '@id': 'dct:isReplacedBy', '@type': '@id' },
  deprecated: { '@id': 'owl:deprecated' },
  retired: { '@id': 'aw:retired' },
  order: { '@id': 'aw:order' },
  position: { '@id': 'aw:position' },
} as const;

/** By key, so an export reads into any environment as the vocabulary of that key. */
const schemeIdentity = (key: string) => `urn:alloy-works:vocabulary:${key}`;
const conceptIdentity = (key: string, id: string) => `${schemeIdentity(key)}:${id}`;

const byLanguage = (items: readonly { language: string; text: string }[]) =>
  Object.fromEntries(items.map((each) => [each.language, each.text]));

export interface VocabularySkos {
  readonly '@context': typeof VOCABULARY_SKOS_CONTEXT;
  readonly '@graph': readonly Record<string, unknown>[];
}

/** The vocabulary as the compact form: the scheme first, then its values as declared. */
export function exportVocabulary(vocabulary: Vocabulary): VocabularySkos {
  const scheme = schemeIdentity(vocabulary.key);
  return {
    '@context': VOCABULARY_SKOS_CONTEXT,
    '@graph': [
      {
        '@id': scheme,
        '@type': 'skos:ConceptScheme',
        notation: vocabulary.key,
        prefLabel: { [vocabulary.base]: vocabulary.name },
        order: vocabulary.order,
      },
      ...vocabulary.values.map((value, at) => ({
        '@id': conceptIdentity(vocabulary.key, value.id),
        '@type': 'skos:Concept',
        inScheme: scheme,
        notation: value.id,
        prefLabel: byLanguage(value.labels),
        ...(value.descriptions.length === 0 ? {} : { definition: byLanguage(value.descriptions) }),
        position: at + 1,
        ...(value.state === 'active' ? {} : { deprecated: true }),
        ...(value.replacedBy === undefined
          ? {}
          : { isReplacedBy: conceptIdentity(vocabulary.key, value.replacedBy) }),
        ...(value.state === 'retired' ? { retired: true } : {}),
      })),
    ],
  };
}

/** What an import read: the scheme, its values in their order, and what no value could hold. */
export type ReadVocabularySkos =
  | {
      readonly read: 'ok';
      readonly scheme: {
        readonly key: string;
        readonly names: { language: string; text: string }[];
        readonly order?: 'declared' | 'label';
      };
      readonly values: VocabularyValue[];
      /** The first 1,000, by subject; `notRepresentedTotal` counts them all. */
      readonly notRepresented: string[];
      readonly notRepresentedTotal: number;
    }
  | { readonly read: 'unreadable' }
  | { readonly read: 'too many' }
  /** Not one concept scheme, or one with no key as its notation. */
  | { readonly read: 'scheme'; readonly message: string };

/** The most things not represented an answer names. */
const NOT_REPRESENTED_MOST = 1000;
/** Predicates a scheme or a concept states that place it, and that a vocabulary needs no word for. */
const PLACING = new Set([
  RDF_TYPE,
  `${SKOS}inScheme`,
  `${SKOS}topConceptOf`,
  `${SKOS}hasTopConcept`,
]);

const typed = (subject: Subject, type: string) =>
  subject.statements.some((each) => each.predicate === RDF_TYPE && each.value.value === type);
const literals = (subject: Subject, predicate: string) =>
  subject.statements
    .filter((each) => each.predicate === predicate && each.value.kind === 'literal')
    .map((each) => each.value as Extract<Value, { kind: 'literal' }>);
const isTrue = (subject: Subject, predicate: string) =>
  literals(subject, predicate).some((each) => each.value === 'true');

/**
 * The vocabulary the text holds, read by the terms' reader (TM-J): one concept scheme, keyed by its
 * notation, and its concepts as values, in `aw:position` order and then the text's. A concept with no
 * notation, or one not in a value id's form, or one another concept took first, is not a value.
 */
export async function readVocabularySkos(
  format: 'json-ld' | 'turtle',
  text: string,
): Promise<ReadVocabularySkos> {
  const subjects = await readSubjects(
    format,
    text,
    VOCABULARY_SKOS_CONTEXT,
    VOCABULARY_LIMITS.values,
  );
  if (subjects === undefined) return { read: 'unreadable' };
  if (subjects === TOO_MANY) return { read: 'too many' };
  const schemes = subjects.filter((each) => typed(each, SCHEME));
  if (schemes.length !== 1) {
    return {
      read: 'scheme',
      message: `The text holds ${schemes.length === 0 ? 'no concept scheme' : 'more than one concept scheme'}; a vocabulary is one.`,
    };
  }
  const scheme = schemes[0]!;
  const key = literals(scheme, `${SKOS}notation`)[0]?.value;
  if (key === undefined || !isVocabularyKey(key)) {
    return {
      read: 'scheme',
      message:
        "The concept scheme's notation is the vocabulary's key: a lower-case letter, then letters, digits or underscores.",
    };
  }
  const notRepresented: string[] = [];
  let notRepresentedTotal = 0;
  const report = (subject: Subject, what: string) => {
    notRepresentedTotal += 1;
    if (notRepresented.length < NOT_REPRESENTED_MOST)
      notRepresented.push(`${subject.key}: ${what}`);
  };
  const languaged = (subject: Subject, predicate: string, what: 'label' | 'description') => {
    const held: { language: string; text: string }[] = [];
    for (const each of literals(subject, predicate)) {
      const language = each.language === null ? undefined : canonicalTag(each.language);
      if (language === undefined || !isLanguageTag(language)) {
        report(subject, `a ${what} with no language tag the product reads: ${each.value}`);
      } else if (held.length >= VOCABULARY_LIMITS.languages) {
        report(subject, `a ${what} in ${language}, past ${VOCABULARY_LIMITS.languages} languages`);
      } else if (held.some((other) => other.language === language)) {
        report(subject, `a second ${what} in ${language}`);
      } else if (!holdsVocabularyText(what, each.value)) {
        report(subject, `a ${what} in ${language} longer than a value holds`);
      } else {
        held.push({ language, text: each.value });
      }
    }
    return held;
  };
  for (const subject of subjects) {
    if (subject !== scheme && !typed(subject, CONCEPT)) {
      report(subject, 'not a concept of the scheme');
    }
  }
  const schemeWords = new Set([`${SKOS}notation`, `${SKOS}prefLabel`, `${AW}order`, ...PLACING]);
  for (const predicate of new Set(scheme.statements.map((each) => each.predicate))) {
    if (!schemeWords.has(predicate))
      report(scheme, `${predicate}, which a vocabulary does not hold`);
  }
  const order = literals(scheme, `${AW}order`)[0]?.value;
  const read: {
    subject: Subject;
    value: VocabularyValue;
    position: number;
    replacedBy?: string;
  }[] = [];
  const held = new Set<string>();
  const words: Record<string, true> = {
    [`${SKOS}notation`]: true,
    [`${SKOS}prefLabel`]: true,
    [`${SKOS}definition`]: true,
    [`${OWL}deprecated`]: true,
    [`${DCT}isReplacedBy`]: true,
    [`${AW}retired`]: true,
    [`${AW}position`]: true,
  };
  for (const subject of subjects.filter((each) => typed(each, CONCEPT))) {
    const notation = literals(subject, `${SKOS}notation`)[0]?.value;
    if (notation === undefined) {
      report(subject, 'no notation, which a value takes as its id');
      continue;
    }
    if (!isVocabularyKey(notation)) {
      report(
        subject,
        `the notation ${notation}, not a value id (a lower-case letter, then letters, digits or underscores)`,
      );
      continue;
    }
    if (held.has(notation)) {
      report(subject, `the notation ${notation}, another concept's already`);
      continue;
    }
    held.add(notation);
    const labels = languaged(subject, `${SKOS}prefLabel`, 'label');
    const descriptions = languaged(subject, `${SKOS}definition`, 'description');
    // Each predicate named once for its concept, however often it is stated.
    const unheld = new Set(
      subject.statements
        .map((each) => each.predicate)
        .filter((predicate) => !PLACING.has(predicate) && words[predicate] === undefined),
    );
    for (const predicate of unheld) report(subject, `${predicate}, which a value does not hold`);
    const retired = isTrue(subject, `${AW}retired`);
    const deprecated = !retired && isTrue(subject, `${OWL}deprecated`);
    const replacement = subject.statements.find(
      (each) => each.predicate === `${DCT}isReplacedBy` && each.value.kind === 'identity',
    )?.value.value;
    const position = Number(literals(subject, `${AW}position`)[0]?.value);
    read.push({
      subject,
      value: {
        id: notation,
        labels,
        descriptions,
        state: retired ? 'retired' : deprecated ? 'deprecated' : 'active',
      },
      position: Number.isFinite(position) ? position : Number.POSITIVE_INFINITY,
      ...(deprecated && replacement !== undefined ? { replacedBy: replacement } : {}),
    });
  }
  // A replacement is a concept the import holds, named by its notation.
  const idOf = new Map(read.map((each) => [each.subject.key, each.value.id]));
  const values = read
    .map((each, at) => ({ each, at }))
    .sort((a, b) => a.each.position - b.each.position || a.at - b.at)
    .map(({ each }) => {
      if (each.replacedBy === undefined) return each.value;
      const id = idOf.get(each.replacedBy);
      if (id === undefined) {
        report(each.subject, `a replacement, ${each.replacedBy}, that is no value of the import`);
        return each.value;
      }
      return { ...each.value, replacedBy: id };
    });
  return {
    read: 'ok',
    scheme: {
      key,
      names: languaged(scheme, `${SKOS}prefLabel`, 'label'),
      ...(order === 'declared' || order === 'label' ? { order } : {}),
    },
    values,
    notRepresented,
    notRepresentedTotal,
  };
}
