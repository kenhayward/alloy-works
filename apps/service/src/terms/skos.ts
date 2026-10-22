import { isLanguageTag, type Term, type TermLabel } from '@alloy-works/domain';
import type { ImportConcept } from '@alloy-works/db';
import { Parser } from 'n3';

/**
 * SKOS (LIB-028, LIB-029, IMP-015; the TM plan, TM-J; terms.md, "Interchange"): terms written as
 * JSON-LD in one documented compact form, and read from that form or from Turtle, by `n3`. Read text
 * is data: no identity in it is ever fetched, and what a term cannot hold is reported, never dropped.
 */

const SKOS = 'http://www.w3.org/2004/02/skos/core#';
const DCT = 'http://purl.org/dc/terms/';
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const CONCEPT = `${SKOS}Concept`;

/** The compact form's context: every name it writes, and all it reads. */
export const SKOS_CONTEXT = {
  skos: SKOS,
  dct: DCT,
  prefLabel: { '@id': 'skos:prefLabel', '@container': '@language' },
  altLabel: { '@id': 'skos:altLabel', '@container': '@language' },
  notation: { '@id': 'skos:notation' },
  definition: { '@id': 'skos:definition', '@container': '@language' },
  broader: { '@id': 'skos:broader', '@type': '@id' },
  narrower: { '@id': 'skos:narrower', '@type': '@id' },
  related: { '@id': 'skos:related', '@type': '@id' },
  isReplacedBy: { '@id': 'dct:isReplacedBy', '@type': '@id' },
} as const;

/** Each compact name's predicate. */
const PREDICATE_OF: Readonly<Record<string, string>> = {
  prefLabel: `${SKOS}prefLabel`,
  altLabel: `${SKOS}altLabel`,
  notation: `${SKOS}notation`,
  definition: `${SKOS}definition`,
  broader: `${SKOS}broader`,
  narrower: `${SKOS}narrower`,
  related: `${SKOS}related`,
  isReplacedBy: `${DCT}isReplacedBy`,
};

/** A term's identity in a file: a URN of its id, so an export imports into any space. */
const identityOf = (id: string) => `urn:uuid:${id}`;

export interface SkosExport {
  readonly '@context': typeof SKOS_CONTEXT;
  readonly '@graph': readonly Record<string, unknown>[];
}

/** Terms as the compact form: an abbreviation is a `skos:notation` in its label's language. */
export function exportSkos(
  terms: readonly { readonly id: string; readonly term: Term }[],
): SkosExport {
  return {
    '@context': SKOS_CONTEXT,
    '@graph': terms.map(({ id, term }) => {
      const alternatives = term.labels.filter((each) => each.alternatives.length > 0);
      const notations = term.labels.filter((each) => each.abbreviation !== undefined);
      return {
        '@id': identityOf(id),
        '@type': 'skos:Concept',
        prefLabel: Object.fromEntries(term.labels.map((each) => [each.language, each.preferred])),
        ...(alternatives.length === 0
          ? {}
          : {
              altLabel: Object.fromEntries(
                alternatives.map((each) => [each.language, [...each.alternatives]]),
              ),
            }),
        ...(notations.length === 0
          ? {}
          : {
              notation: notations.map((each) => ({
                '@value': each.abbreviation,
                '@language': each.language,
              })),
            }),
        ...(term.definition.length === 0
          ? {}
          : {
              definition: Object.fromEntries(
                term.definition.map((each) => [each.language, each.text]),
              ),
            }),
        ...Object.fromEntries(
          (['broader', 'narrower', 'related'] as const)
            .filter((list) => term[list].length > 0)
            .map((list) => [list, term[list].map(identityOf)]),
        ),
        ...(term.replacedBy === undefined ? {} : { isReplacedBy: identityOf(term.replacedBy) }),
      };
    }),
  };
}

/** One value a statement gives: a literal, in a language or none, or an identity. */
type Value =
  | { readonly kind: 'literal'; readonly value: string; readonly language: string | null }
  | { readonly kind: 'identity'; readonly value: string };

/** A subject's statements, in the order the text gives them. */
interface Subject {
  readonly key: string;
  readonly statements: { readonly predicate: string; readonly value: Value }[];
}

/** What a term could not hold (LIB-029): where, what kind of thing, and the thing itself. */
export interface Unrepresented {
  readonly concept: string | null;
  readonly what: 'subject' | 'predicate' | 'label' | 'language' | 'relation' | 'value';
  readonly detail: string;
}

export interface ReadSkos {
  readonly concepts: ImportConcept[];
  readonly unrepresented: Unrepresented[];
}

export type SkosFormat = 'json-ld' | 'turtle';

/** A tag in BCP 47's conventional case, which Turtle need not keep: `en-gb` is `en-GB`. */
function canonicalTag(tag: string): string {
  return tag
    .split('-')
    .map((part, at) =>
      at === 0
        ? part.toLowerCase()
        : part.length === 4 && /^[a-z]+$/iu.test(part)
          ? part[0]!.toUpperCase() + part.slice(1).toLowerCase()
          : part.length === 2
            ? part.toUpperCase()
            : part.toLowerCase(),
    )
    .join('-');
}

function subjectsOfTurtle(text: string): Subject[] | undefined {
  let quads;
  try {
    quads = new Parser({ format: 'text/turtle' }).parse(text);
  } catch {
    return undefined;
  }
  const subjects = new Map<string, Subject>();
  for (const quad of quads) {
    const key =
      quad.subject.termType === 'BlankNode' ? `_:${quad.subject.value}` : quad.subject.value;
    const subject = subjects.get(key) ?? { key, statements: [] };
    subjects.set(key, subject);
    const object = quad.object;
    subject.statements.push({
      predicate: quad.predicate.value,
      value:
        object.termType === 'Literal'
          ? { kind: 'literal', value: object.value, language: object.language || null }
          : {
              kind: 'identity',
              value: object.termType === 'BlankNode' ? `_:${object.value}` : object.value,
            },
    });
  }
  return [...subjects.values()];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);

/** The compact form's nodes as subjects; a name it does not hold is a predicate of that name. */
function subjectsOfJsonLd(text: string): Subject[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const graph = isObject(parsed) ? parsed['@graph'] : undefined;
  if (!Array.isArray(graph) || !graph.every(isObject)) return undefined;
  return graph.map((node, at) => {
    const key = typeof node['@id'] === 'string' ? node['@id'] : `_:node${at}`;
    const statements: Subject['statements'] = [];
    const push = (predicate: string, value: Value) => statements.push({ predicate, value });
    for (const [name, held] of Object.entries(node)) {
      if (name === '@id' || name === '@context') continue;
      if (name === '@type') {
        for (const type of listOf(held)) {
          if (typeof type === 'string') {
            push(RDF_TYPE, {
              kind: 'identity',
              value: type.startsWith('skos:') ? `${SKOS}${type.slice(5)}` : type,
            });
          }
        }
        continue;
      }
      const predicate = PREDICATE_OF[name] ?? name;
      const container = SKOS_CONTEXT[name as keyof typeof SKOS_CONTEXT];
      if (isObject(container) && '@container' in container && isObject(held)) {
        for (const [language, values] of Object.entries(held)) {
          for (const value of listOf(values)) {
            if (typeof value === 'string') push(predicate, { kind: 'literal', value, language });
          }
        }
      } else if (isObject(container) && '@type' in container) {
        for (const value of listOf(held)) {
          if (typeof value === 'string') push(predicate, { kind: 'identity', value });
        }
      } else {
        for (const value of listOf(held)) {
          if (typeof value === 'string') {
            push(predicate, { kind: 'literal', value, language: null });
          } else if (isObject(value) && typeof value['@value'] === 'string') {
            const language = value['@language'];
            push(predicate, {
              kind: 'literal',
              value: value['@value'],
              language: typeof language === 'string' ? language : null,
            });
          } else {
            push(predicate, { kind: 'literal', value: JSON.stringify(value), language: null });
          }
        }
      }
    }
    return { key, statements };
  });
}

/**
 * The concepts the text holds, each as a term without its relations and with its relations by the
 * file's identities, and what no term could hold; undefined where the text is not the format. A
 * concept's base language is `base` where it has a preferred label in it, else its first one's.
 */
export function readSkos(format: SkosFormat, text: string, base = 'en'): ReadSkos | undefined {
  const subjects = format === 'turtle' ? subjectsOfTurtle(text) : subjectsOfJsonLd(text);
  if (subjects === undefined) return undefined;
  const unrepresented: Unrepresented[] = [];
  const isConcept = (subject: Subject) =>
    subject.statements.some((each) => each.predicate === RDF_TYPE && each.value.value === CONCEPT);
  for (const subject of subjects) {
    if (!isConcept(subject)) {
      unrepresented.push({ concept: null, what: 'subject', detail: subject.key });
    }
  }
  const held = subjects.filter(isConcept);
  const keys = new Set(held.map((each) => each.key));
  const concepts: ImportConcept[] = [];
  for (const subject of held) {
    const report = (what: Unrepresented['what'], detail: string) =>
      unrepresented.push({ concept: subject.key, what, detail });
    const tagOf = (value: Value) => {
      if (value.kind !== 'literal' || value.language === null) return null;
      const tag = canonicalTag(value.language);
      return isLanguageTag(tag) ? tag : undefined;
    };
    // The preferred labels first, so an alternative is placed whatever the order.
    const labels: TermLabel[] = [];
    for (const { predicate, value } of subject.statements) {
      if (predicate !== `${SKOS}prefLabel` || value.kind !== 'literal') continue;
      const language = tagOf(value);
      if (language === null || language === undefined) continue;
      if (labels.some((each) => each.language === language)) continue;
      labels.push({ language, preferred: value.value, alternatives: [] });
    }
    const baseLanguage = labels.some((each) => each.language === base) ? base : labels[0]?.language;
    const definition: { language: string; text: string }[] = [];
    const lists = { broader: [] as string[], narrower: [] as string[], related: [] as string[] };
    let replacedBy: string | undefined;
    const placed = new Set<string>();
    for (const { predicate, value } of subject.statements) {
      const name = Object.entries(PREDICATE_OF).find(([, iri]) => iri === predicate)?.[0];
      if (predicate === RDF_TYPE) {
        if (value.value !== CONCEPT) report('predicate', `${RDF_TYPE} ${value.value}`);
        continue;
      }
      if (name === undefined) {
        // Each predicate named once for its concept, however often it is stated.
        if (!placed.has(predicate)) report('predicate', predicate);
        placed.add(predicate);
        continue;
      }
      if (
        name === 'broader' ||
        name === 'narrower' ||
        name === 'related' ||
        name === 'isReplacedBy'
      ) {
        if (value.kind !== 'identity') {
          report('value', `${name} ${value.value}, not an identity`);
        } else if (!keys.has(value.value)) {
          report('relation', `${name} ${value.value}, a term outside the file`);
        } else if (name === 'isReplacedBy') {
          if (replacedBy === undefined) replacedBy = value.value;
          else report('value', `isReplacedBy ${value.value}, a second replacement`);
        } else if (!lists[name].includes(value.value)) {
          lists[name].push(value.value);
        }
        continue;
      }
      if (value.kind !== 'literal') {
        report('value', `${name} ${value.value}, not text`);
        continue;
      }
      const language = name === 'notation' && value.language === null ? baseLanguage : tagOf(value);
      if (language === undefined || language === null) {
        report(
          'language',
          value.language === null
            ? `A ${name} with no language tag: ${value.value}`
            : `A label in ${value.language}, no language tag the product reads: ${value.value}`,
        );
        continue;
      }
      const label = labels.find((each) => each.language === language);
      if (name === 'prefLabel') {
        if (label?.preferred !== value.value) {
          report('label', `A second preferred label in ${language}: ${value.value}`);
        }
      } else if (name === 'altLabel') {
        if (label === undefined) {
          report(
            'label',
            `An alternative label in ${language}, which has no preferred label: ${value.value}`,
          );
        } else if (!label.alternatives.includes(value.value)) {
          label.alternatives.push(value.value);
        }
      } else if (name === 'notation') {
        const at = labels.indexOf(label!);
        if (label === undefined) {
          report(
            'label',
            `An abbreviation in ${language}, which has no preferred label: ${value.value}`,
          );
        } else if (label.abbreviation !== undefined) {
          report('label', `A second abbreviation in ${language}: ${value.value}`);
        } else {
          labels[at] = { ...label, abbreviation: value.value };
        }
      } else if (name === 'definition') {
        if (definition.some((each) => each.language === language)) {
          report('value', `A second definition in ${language}`);
        } else {
          definition.push({ language, text: value.value });
        }
      }
    }
    if (baseLanguage === undefined) {
      report('label', 'No preferred label in a language the product reads, so no term');
      continue;
    }
    concepts.push({
      key: subject.key,
      term: { base: baseLanguage, labels, definition },
      ...lists,
      ...(replacedBy === undefined ? {} : { replacedBy }),
    });
  }
  return { concepts, unrepresented };
}
