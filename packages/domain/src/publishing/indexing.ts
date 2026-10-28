import type { IndexMarkerNode } from '../content/model/inline.js';

import type { PublishFailure } from './failures.js';
import type { IndexWords } from './layout.js';
import type {
  PublishedIndex,
  PublishedIndexEntry,
  PublishedIndexHeading,
  PublishedIndexLocator,
} from './published.js';
import { collatorFor } from './terms.js';

/** A marker the published document holds, in reading order (IX-I), and its locator where it is set. */
export interface IndexMarked {
  readonly node: string;
  /** The block a failure in it names: a footnote's own for its text, as a citation's does. */
  readonly block: string;
  readonly marker: IndexMarkerNode;
  readonly locator: PublishedIndexLocator | null;
}

/** An entry's or a sub-entry's key: the NFC strings it merges on, which the model holds already. */
const keyOf = (term: string, sub: string | undefined) => `${term}\u{0}${sub ?? ''}`;

interface Heading {
  readonly locators: PublishedIndexLocator[];
  readonly see: Set<string>;
  readonly seeAlso: Set<string>;
}

const heading = (): Heading => ({ locators: [], see: new Set(), seeAlso: new Set() });

/**
 * **The index** (STR-043, PUB-041; the IX plan, IX-B and IX-I): entries merged on the term, sub-entries
 * on the term and sub-entry, each collated in the document's language with its "see"s and "see also"s,
 * a term's own locators before its sub-entries; null where no marker stands. A "see" or "see also"
 * naming a term no marker carries fails `index_reference_unresolved`, and a "see" redirecting an entry
 * a marker locates `index_see_located`, each naming the marker, never its words.
 */
export function assembleIndex(
  marked: readonly IndexMarked[],
  words: IndexWords,
  language: string,
): { readonly index: PublishedIndex | null; readonly failures: readonly PublishFailure[] } {
  const failures: PublishFailure[] = [];
  const fail = (each: IndexMarked, code: PublishFailure['code'], detail: string | null) =>
    failures.push({ stage: 'compose', code, node: each.node, block: each.block, detail });
  const carried = new Set(marked.map((each) => each.marker.term));
  const located = new Set(
    marked
      .filter((each) => each.marker.see === undefined)
      .map((each) => keyOf(each.marker.term, each.marker.sub)),
  );
  for (const each of marked) {
    const { see, seeAlso, term, sub } = each.marker;
    if (see !== undefined && !carried.has(see)) fail(each, 'index_reference_unresolved', 'see');
    if (seeAlso?.some((target) => !carried.has(target)) === true) {
      fail(each, 'index_reference_unresolved', 'seeAlso');
    }
    if (see !== undefined && located.has(keyOf(term, sub))) fail(each, 'index_see_located', null);
  }
  if (marked.length === 0) return { index: null, failures };

  const terms = new Map<string, { own: Heading; subs: Map<string, Heading> }>();
  for (const { marker, locator } of marked) {
    const entry = terms.get(marker.term) ?? { own: heading(), subs: new Map() };
    terms.set(marker.term, entry);
    const at =
      marker.sub === undefined
        ? entry.own
        : (entry.subs.get(marker.sub) ?? entry.subs.set(marker.sub, heading()).get(marker.sub)!);
    if (locator !== null) at.locators.push(locator);
    if (marker.see !== undefined) at.see.add(marker.see);
    for (const target of marker.seeAlso ?? []) at.seeAlso.add(target);
  }
  const collator = collatorFor(language);
  const sorted = (values: Iterable<string>) => [...values].sort(collator.compare);
  const published = (each: Heading): PublishedIndexHeading => ({
    locators: each.locators,
    see: sorted(each.see),
    seeAlso: sorted(each.seeAlso),
  });
  const entries: PublishedIndexEntry[] = sorted(terms.keys()).map((term) => {
    const { own, subs } = terms.get(term)!;
    return {
      term,
      ...published(own),
      subEntries: sorted(subs.keys()).map((sub) => ({ sub, ...published(subs.get(sub)!) })),
    };
  });
  return { index: { ...words, entries }, failures };
}
