import { useCallback, useEffect, useRef, useState } from 'react';

/** A page as a listing answers it (service-foundations.md, "Listings and idempotency, in T1"). */
export interface ListingPage<Item, Facets> {
  readonly items: readonly Item[];
  readonly next: string | null;
  readonly total: number;
  readonly facets: Facets;
}

export interface PagedListing<Item, Facets> {
  /** What has been shown so far, every page asked for; null until the first arrives. */
  readonly items: readonly Item[] | null;
  readonly next: string | null;
  readonly total: number;
  readonly facets: Facets | null;
  /**
   * Undefined when nothing has failed; otherwise the cursor whose page did not arrive - null for the
   * first - so Try again asks for exactly that page rather than starting over.
   */
  readonly failed: string | null | undefined;
  readonly signedOut: boolean;
  readonly loading: boolean;
  /** Asks for the page after `cursor`, or the first again for null. */
  readonly load: (cursor: string | null) => Promise<void>;
}

/**
 * A listing read a page at a time (LI-G), the first again whenever `fetchPage` changes - a new sort
 * or filter - and each further page appended by Show more. A second Show more while one is on its way
 * asks for nothing, checked before any await; an answer to a sort or filter since changed is dropped.
 */
export function usePagedListing<Item, Facets>(
  fetchPage: (
    cursor: string | null,
  ) => Promise<{ readonly data?: ListingPage<Item, Facets>; readonly response: Response }>,
): PagedListing<Item, Facets> {
  const [items, setItems] = useState<readonly Item[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [failed, setFailed] = useState<string | null | undefined>(undefined);
  const [signedOut, setSignedOut] = useState(false);
  const [loading, setLoading] = useState(false);
  const pending = useRef(false);
  const asking = useRef(0);

  const load = useCallback(
    async (cursor: string | null) => {
      if (cursor !== null && pending.current) return;
      pending.current = true;
      const generation = cursor === null ? ++asking.current : asking.current;
      setLoading(true);
      try {
        const { data, response } = await fetchPage(cursor);
        if (generation !== asking.current) return;
        if (!data) {
          setSignedOut(response.status === 401);
          setFailed(cursor);
          return;
        }
        setFailed(undefined);
        setSignedOut(false);
        setItems((held) => [...(cursor === null ? [] : (held ?? [])), ...data.items]);
        setNext(data.next);
        setTotal(data.total);
        setFacets(data.facets);
      } catch {
        if (generation === asking.current) setFailed(cursor);
      } finally {
        if (generation === asking.current) {
          pending.current = false;
          setLoading(false);
        }
      }
    },
    [fetchPage],
  );

  useEffect(() => {
    void load(null);
    return () => {
      asking.current += 1;
      pending.current = false;
    };
  }, [load]);

  return { items, next, total, facets, failed, signedOut, loading, load };
}
