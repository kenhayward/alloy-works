import type { createApiClient } from '@alloy-works/api-client';
import {
  citationFormsOf,
  citationKey,
  citationsIn,
  setCitationForms,
  type CitationForms,
  type EditorView,
} from '@alloy-works/editor';
import { useEffect, useState } from 'react';

import { entryName, type EntryOffered } from '../bibliography/entries.js';
import type { ReferenceOption } from './referenceChoices.js';

type Client = ReturnType<typeof createApiClient>;

/** The preview route's limits (`CitationPreviewBody`): citations a request, and an id's length. */
const MOST_ASKED = 500;
const MOST_ID = 200;

/**
 * **Each citation's in-text form, as the service renders it** (the CI plan, CId): asked again whenever
 * the citations the surface holds change, in the style of the document it is edited in or else the
 * environment's, and handed to the surface, which draws each from them. citeproc never reaches the
 * browser. Answers the forms last heard, which the Reference dialog says an entry will show as.
 */
export function useCitationForms(
  client: Client,
  componentId: string,
  document: string | undefined,
  surface: EditorView | null,
): CitationForms | null {
  const cited = surface === null || surface.isDestroyed ? [] : citationsIn(surface.state.doc);
  // One request per distinct set, in order: a keystroke elsewhere asks nothing.
  const asked = JSON.stringify(cited.map(({ entry, locator }) => [entry, locator]));
  const [forms, setForms] = useState<CitationForms | null>(null);

  useEffect(() => {
    if (surface === null || cited.length === 0) return;
    let live = true;
    // Only what the route takes is asked, at most its limit at a time; anything else, or a failed
    // ask, is drawn 'Citation unavailable' (null).
    const askable = cited.filter(
      ({ entry, locator }) => entry.length <= MOST_ID && (locator ?? '').length <= MOST_ID,
    );
    const batches = Array.from({ length: Math.ceil(askable.length / MOST_ASKED) }, (_, at) =>
      askable.slice(at * MOST_ASKED, (at + 1) * MOST_ASKED),
    );
    void Promise.all(
      batches.map((batch) =>
        client
          .POST('/v1/components/{id}/citations/preview', {
            params: { path: { id: componentId } },
            body: {
              citations: batch.map(({ entry, locator }) =>
                locator === null ? { entry } : { entry, locator },
              ),
              ...(document === undefined ? {} : { document }),
            },
          })
          .then(({ data }) => data?.forms ?? batch.map(() => null))
          .catch(() => batch.map(() => null)),
      ),
    ).then((answered) => {
      if (!live || surface.isDestroyed) return;
      const formed = answered.flat();
      const next = new Map<string, string | null>();
      askable.forEach(({ entry, locator }, at) => {
        const key = citationKey(entry, locator);
        if (!next.has(key)) next.set(key, formed[at] ?? null);
      });
      for (const { entry, locator } of cited) {
        const key = citationKey(entry, locator);
        if (!next.has(key)) next.set(key, null);
      }
      if (citationFormsOf(surface.state) !== next) setCitationForms(surface, next);
      setForms(next);
    });
    return () => {
      live = false;
    };
    // `cited` is `asked` spelt out: the effect runs when the set changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, componentId, document, surface, asked]);

  return forms;
}

/**
 * The space's entries as the Reference dialog offers them (STR-069): each by its name, in its one
 * form, the in-text form its style prints, said where the service has rendered it.
 */
export function entryOptions(
  entries: readonly EntryOffered[],
  forms: CitationForms | null,
): readonly ReferenceOption[] {
  return entries.map((entry) => {
    const name = `Entry ${entryName(entry)}`;
    return {
      key: `entry\u{0}${entry.id}`,
      target: { kind: 'entry', entry: entry.id },
      name,
      forms: ['number'],
      // Rendered for this component alone: the document numbers and tells apart its citations.
      shows: () => {
        const form = forms?.get(citationKey(entry.id, null));
        return form == null
          ? 'Its in-text form, as the document sets it at publish'
          : `${form}, until the document sets it at publish`;
      },
    };
  });
}
