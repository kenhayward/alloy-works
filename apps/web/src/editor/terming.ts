import type { createApiClient } from '@alloy-works/api-client';
import {
  setTermIndex,
  setTermStandings,
  termIndexOf,
  termsIn,
  termStandingsOf,
  type EditorView,
  type TermOffered,
  type TermStandings,
} from '@alloy-works/editor';
import { useCallback, useEffect, useMemo, useState } from 'react';

type Client = ReturnType<typeof createApiClient>;

/** The most terms a space's index holds for one editing session (the TM plan, TM-L). */
export const TERMS_HELD_MOST = 5000;

/** A space's term as the Term dialog offers it and the suggestions match it. */
export interface TermChoice extends TermOffered {
  readonly standing: 'approved' | 'draft' | 'deprecated';
  readonly replacedBy: string | null;
}

interface Listed {
  readonly id: string;
  readonly label: string;
  readonly abbreviation: string | null;
  readonly term: {
    readonly labels: readonly {
      readonly preferred: string;
      readonly alternatives: readonly string[];
      readonly abbreviation?: string;
    }[];
    readonly replacedBy?: string;
  };
  readonly state: { readonly key: string; readonly approved: boolean } | null;
}

const choiceOf = (listed: Listed): TermChoice => ({
  id: listed.id,
  label: listed.label,
  abbreviation: listed.abbreviation,
  forms: listed.term.labels.flatMap((each) => [
    each.preferred,
    ...each.alternatives,
    ...(each.abbreviation === undefined ? [] : [each.abbreviation]),
  ]),
  standing:
    listed.state?.key === 'deprecated'
      ? 'deprecated'
      : listed.state?.approved === true
        ? 'approved'
        : 'draft',
  replacedBy: listed.term.replacedBy ?? null,
});

/** A space's index as read: its terms, and whether the space held more than are held. */
export interface TermIndexRead {
  readonly terms: readonly TermChoice[];
  readonly truncated: boolean;
}

/** The space's terms the reader may read, page by page up to the most held; null where unread. */
export async function spaceTerms(client: Client, space: string): Promise<TermIndexRead | null> {
  const found: TermChoice[] = [];
  let cursor: string | undefined;
  let more = false;
  while (found.length < TERMS_HELD_MOST) {
    const { data } = await client.GET('/v1/spaces/{space}/terms', {
      params: {
        path: { space },
        query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) },
      },
    });
    if (!data) return null;
    found.push(...(data.items as readonly Listed[]).map(choiceOf));
    more = typeof data.next === 'string';
    if (!more) break;
    cursor = data.next as string;
  }
  return {
    terms: found.slice(0, TERMS_HELD_MOST),
    truncated: more || found.length > TERMS_HELD_MOST,
  };
}

/**
 * **The term indexes of one document's editing session**, by space: each read once, by whichever
 * editor of the document asks first, and shared by every other; read again only when asked to be,
 * as the Term dialog opens. One that could not be read is read again by the next to ask.
 */
export class TermIndexes {
  private readonly held = new Map<string, Promise<TermIndexRead | null>>();

  read(client: Client, space: string, again = false): Promise<TermIndexRead | null> {
    const held = this.held.get(space);
    if (held !== undefined && !again) return held;
    const forget = () => {
      if (this.held.get(space) === reading) this.held.delete(space);
    };
    const reading: Promise<TermIndexRead | null> = spaceTerms(client, space).then(
      (read) => {
        if (read === null) forget();
        return read;
      },
      () => {
        forget();
        return null;
      },
    );
    this.held.set(space, reading);
    return reading;
  }
}

/**
 * **The space's terms, read once a document's editing session** (TM-L) through `indexes`, which every
 * editor of the document shares, and handed to the surface for its suggestions, approved terms alone;
 * `refresh` reads them again, as the Term dialog does on opening. Without `indexes`, as on a
 * component's own page, the editor keeps its own.
 */
export function useTermIndex(
  client: Client,
  space: string | null,
  surface: EditorView | null,
  indexes?: TermIndexes,
): {
  readonly terms: readonly TermChoice[] | 'unread' | null;
  readonly truncated: boolean;
  readonly refresh: () => void;
} {
  const [own] = useState(() => new TermIndexes());
  const shared = indexes ?? own;
  const [read, setRead] = useState<TermIndexRead | 'unread' | null>(null);
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    if (space === null) return;
    let live = true;
    void shared.read(client, space, asked > 0).then((found) => {
      if (live) setRead(found ?? 'unread');
    });
    return () => {
      live = false;
    };
  }, [client, space, shared, asked]);

  const offered = useMemo<readonly TermOffered[] | null>(
    () =>
      read === null || read === 'unread'
        ? null
        : read.terms.filter((each) => each.standing === 'approved'),
    [read],
  );

  // On every render, so a fresh state after a version is cut is handed the index again.
  useEffect(() => {
    if (surface === null || surface.isDestroyed || offered === null) return;
    if (termIndexOf(surface.state) !== offered) setTermIndex(surface, offered);
  });

  const refresh = useCallback(() => setAsked((at) => at + 1), []);
  return {
    terms: read === null || read === 'unread' ? read : read.terms,
    truncated: read !== null && read !== 'unread' && read.truncated,
    refresh,
  };
}

/** The preview route's limits: terms a request, and an id's length. */
const MOST_ASKED = 500;
const MOST_ID = 200;

/**
 * **Each used term's standing** (LIB-018), asked again whenever the terms the surface uses change, as
 * citations' forms are, and handed to the surface, which flags a deprecated or unreadable one.
 */
export function useTermStandings(
  client: Client,
  componentId: string,
  surface: EditorView | null,
): void {
  const used = surface === null || surface.isDestroyed ? [] : termsIn(surface.state.doc);
  const asked = JSON.stringify(used);
  const [standings, setStandings] = useState<TermStandings | null>(null);

  useEffect(() => {
    if (surface === null || used.length === 0) return;
    let live = true;
    const askable = used.filter((each) => each.length <= MOST_ID).slice(0, MOST_ASKED);
    client
      .POST('/v1/components/{id}/terms/preview', {
        params: { path: { id: componentId } },
        body: { terms: askable },
      })
      .then(({ data }) => {
        if (!live || data === undefined) return;
        setStandings(new Map(askable.map((term, at) => [term, data.terms[at]!])));
      })
      .catch(() => {
        // Unheard, nothing is flagged; the next change asks again.
      });
    return () => {
      live = false;
    };
    // `used` is `asked` spelt out: the effect runs when the set changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, componentId, surface, asked]);

  // On every render, as the index is, so a fresh state is told them again.
  useEffect(() => {
    if (surface === null || surface.isDestroyed || standings === null) return;
    if (termStandingsOf(surface.state) !== standings) setTermStandings(surface, standings);
  });
}
