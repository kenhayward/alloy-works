import type { createApiClient } from '@alloy-works/api-client';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** A pending result as followed: done, with the act's own result for its binding (D8-E), or not yet. */
interface PendingResultView {
  readonly state: 'pending' | 'done';
  readonly result: Record<string, unknown> | null;
}

/** What a pending result came to: done with its binding's result, or why it was not followed through. */
export type Followed = { readonly done: Record<string, unknown> } | { readonly sentence: string };

/** Said while a result's images are admitted, to the page's one live region. */
export const WAITING_ON_IMAGES = (): string => words('document.waiting-on-images');

const TOO_SLOW = (): string => words('document.checking-the-images-is-taking');
const LOST = (): string => words('document.the-value-could-not-be-3');

/** How often a pending result is followed, and for how long: as an upload is (figures 2, ruling R4). */
const FOLLOW_EVERY_MS = 500;
const FOLLOW_TIMES = 60;

/**
 * A result a resolve or a check answered as pending, its images being admitted (the D8 plan, D8-F),
 * followed until it is done, as an upload is: the act's own result for the binding, or a sentence.
 * `wait` is the pause between asks, which a test replaces.
 */
export async function followPending(
  client: Client,
  id: string,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<Followed> {
  try {
    for (let asked = 0; asked < FOLLOW_TIMES; asked += 1) {
      const { data } = await client.GET('/v1/datasets/pending/{id}', {
        params: { path: { id } },
      });
      const followed = data as PendingResultView | undefined;
      if (followed === undefined) return { sentence: LOST() };
      if (followed.state === 'done' && followed.result !== null) return { done: followed.result };
      await wait(FOLLOW_EVERY_MS);
    }
    return { sentence: TOO_SLOW() };
  } catch {
    return { sentence: LOST() };
  }
}
