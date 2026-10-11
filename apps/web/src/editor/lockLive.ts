import { followStream, type FollowOptions } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

/** A component's lock as its stream says it (COL-007), with any ask to take it over (COL-047). */
export interface HeardLock {
  readonly holder: { readonly id: string; readonly name: string | null } | null;
  readonly expectedRelease: string | null;
  readonly taking: {
    readonly by: { readonly id: string; readonly name: string | null };
    readonly until: string;
  } | null;
}

/**
 * **A component's lock as it happens** (the PL plan, PL4): its own stream followed while it is open, so
 * a holder hears at once that somebody has asked to take it over, and that they have (COL-045,
 * COL-047). Undefined until the stream has said.
 */
export function useHeardLock(
  componentId: string,
  follow: (options: FollowOptions) => () => void = followStream,
): HeardLock | undefined {
  const [heard, setHeard] = useState<HeardLock | undefined>(undefined);
  useEffect(() => {
    setHeard(undefined);
    return follow({
      url: `${window.location.origin}/v1/stream?component=${componentId}`,
      onEvent: (event, data) => {
        if (event === 'snapshot') {
          const [lock] = (data as { locks?: ({ component: string } & HeardLock)[] }).locks ?? [];
          setHeard(lock ?? { holder: null, expectedRelease: null, taking: null });
        } else if (event === 'lock') {
          setHeard(data as HeardLock);
        }
      },
      onDropped: () => setHeard(undefined),
    });
  }, [componentId, follow]);
  return heard;
}
