import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useRef } from 'react';

type Client = ReturnType<typeof createApiClient>;

/** How long after asking for a publish or a preview it is first asked about. One takes a second or two. */
export const FOLLOW_MS = 1000;

/** The longest wait between two asks about one request, however long it has waited. */
export const FOLLOW_CAP_MS = 30_000;

/**
 * The wait before the next ask, after an answer that it is still queued or an ask that failed: twice
 * the last, up to the cap - so a request no worker takes is asked about less and less often, and never
 * stops being asked about while the page is open (a stop is the design's open question, not built).
 */
export function nextFollow(wait: number): number {
  return Math.min(wait * 2, FOLLOW_CAP_MS);
}

/**
 * Following a publish's or a preview's request (publishing.md, "Preview": a preview is followed as a
 * publish is). `follow` asks about the request after `first` ms, hands each answer's body to `settle`,
 * and asks again, twice as long after, until `settle` says it is settled; an ask that fails is waited
 * out the same way. **One ask at a time, and none once the page has closed**: each ask is scheduled
 * only after the last has been answered, and unmounting clears the waiting timer and drops an answer
 * still on its way. `mounted` is for the caller's own awaits, which the same closing must drop.
 */
export function useFollowing(client: Client) {
  const waiting = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (waiting.current !== null) clearTimeout(waiting.current);
      waiting.current = null;
    };
  }, []);

  const follow = useCallback(
    (request: string, first: number, settle: (answer: unknown) => boolean) => {
      const ask = (wait: number) => {
        // One timer at a time: one left waiting would ask again unseen, and outlive the page.
        if (waiting.current !== null) clearTimeout(waiting.current);
        waiting.current = setTimeout(() => {
          waiting.current = null;
          client.GET('/v1/publication-requests/{id}', { params: { path: { id: request } } }).then(
            ({ data }) => {
              if (mounted.current && !settle(data)) ask(nextFollow(wait));
            },
            () => {
              if (mounted.current) ask(nextFollow(wait));
            },
          );
        }, wait);
      };
      ask(first);
    },
    [client],
  );

  return { follow, mounted };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** What each act is called in the sentences that refuse it. */
const ACTS = {
  publish: { again: 'publish again', subject: 'The publish' },
  preview: { again: 'preview it again', subject: 'The preview' },
} as const;

/**
 * The words a publish or a preview refused at the door is answered in - one set for both, since a
 * preview is refused exactly as a publish is (publishing.md, "Preview"; PV-B). A refusal at the door
 * (400) carries its own words - what format the layout does not make, or what language it and the
 * document are in - which say more than a fixed sentence could. `status` is null where the service
 * never answered.
 */
export function refusedWords(
  act: keyof typeof ACTS,
  status: number | null,
  error: unknown,
): string {
  if (status === 409) {
    return `This document has changed since the page opened. Reload it and ${ACTS[act].again}.`;
  }
  // A preview needs `read` alone, which a document the page holds is: only a publish meets this.
  if (status === 403) return 'You may read this document but not publish it.';
  if (status === 404) return 'This document is no longer open to you.';
  if (status === 400 && isRecord(error) && typeof error.message === 'string') return error.message;
  return `${ACTS[act].subject} could not be asked for. Try again.`;
}
