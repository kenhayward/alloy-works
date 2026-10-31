import type { createApiClient } from '@alloy-works/api-client';
import type { Vocabulary } from '@alloy-works/domain';
import { createContext, useContext, useEffect, useState } from 'react';

import { formats } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** A vocabulary by its definition id, or nothing where it cannot be read. */
export type VocabularyLookup = (id: string) => Promise<Vocabulary | undefined>;

/** The reader's language as a vocabulary labels by it: the interface's, by its base subtag. */
export const readerLanguage = (): string => formats().language.formats.split('-')[0]!;

interface Held {
  readonly asked: Promise<Vocabulary | undefined>;
  value?: Vocabulary;
}

const lookups = new WeakMap<Client, VocabularyLookup>();
const known = new WeakMap<VocabularyLookup, Map<string, Held>>();

/**
 * A page's vocabularies (the VO plan, VO-F): each read once through `/v1/vocabularies/{id}`, however
 * many fields draw on it, and kept for the page's client; one that cannot be read is asked again.
 */
export function vocabulariesFrom(client: Client): VocabularyLookup {
  const made = lookups.get(client);
  if (made !== undefined) return made;
  const held = new Map<string, Held>();
  const lookup: VocabularyLookup = (id) => {
    const was = held.get(id);
    if (was !== undefined) return was.asked;
    const asked = client
      .GET('/v1/vocabularies/{id}', { params: { path: { id } } })
      .then(({ data }) => (data ? (data.vocabulary as Vocabulary) : undefined))
      .catch(() => undefined)
      .then((vocabulary) => {
        if (vocabulary === undefined) held.delete(id);
        else entry.value = vocabulary;
        return vocabulary;
      });
    const entry: Held = { asked };
    held.set(id, entry);
    return asked;
  };
  lookups.set(client, lookup);
  known.set(lookup, held);
  return lookup;
}

/** Where a field form finds its vocabularies: a page with a client gives them; nothing else does. */
export const VocabulariesContext = createContext<VocabularyLookup | null>(null);

/**
 * The vocabulary a field draws on: `undefined` where it draws on none, `'reading'` until it arrives,
 * `'unread'` where there is no reading it here; one already read is had at once, so nothing flickers.
 */
export function useVocabulary(
  id: string | undefined,
): Vocabulary | 'reading' | 'unread' | undefined {
  const lookup = useContext(VocabulariesContext);
  const now = () =>
    id === undefined
      ? undefined
      : lookup === null
        ? ('unread' as const)
        : (known.get(lookup)?.get(id)?.value ?? ('reading' as const));
  const [state, setState] = useState(now);
  useEffect(() => {
    setState(now());
    if (id === undefined || lookup === null) return;
    let current = true;
    void lookup(id).then((vocabulary) => {
      if (current) setState(vocabulary ?? 'unread');
    });
    return () => {
      current = false;
    };
    // `now` reads only these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, lookup]);
  return state;
}

/** The vocabulary a field's `validation` names, if any (the VO plan, VO-C). */
export const vocabularyOf = (field: {
  readonly dataType: string;
  readonly validation: Readonly<Record<string, unknown>>;
}): string | undefined =>
  field.dataType === 'text' && typeof field.validation['vocabulary'] === 'string'
    ? field.validation['vocabulary']
    : undefined;
