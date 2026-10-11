import { followStream, type createApiClient, type FollowOptions } from '@alloy-works/api-client';
import { useEffect, useMemo, useRef, useState } from 'react';

type Client = ReturnType<typeof createApiClient>;

/** A held lock as the stream says it (COL-007). */
export interface LiveLock {
  readonly holder: { readonly id: string; readonly name: string | null } | null;
  readonly expectedRelease: string | null;
}

/** Somebody's window in the document, as the stream says it (COL-001 to COL-003). */
export interface LivePresence {
  readonly viewer: string;
  readonly person: { readonly id: string; readonly name: string | null };
  readonly component: string | null;
  readonly mode: 'read' | 'review' | 'author' | null;
  readonly beatAt: string;
  /** How long before it was sent it beat, by the service's clock. */
  readonly ageMs?: number;
}

/** A presence as held here: when it beat by this window's own clock, from its age when it came. */
type Held = LivePresence & { readonly beatHere: number };

const heldAt = (each: LivePresence, now: number): Held => ({
  ...each,
  beatHere: now - (each.ageMs ?? 0),
});

/** How fresh a window's beat is (COL-055; the PL plan, PL-C). */
export type Freshness = 'live' | 'stale' | 'absent';

/**
 * Live under 30 seconds since the beat, stale to 60, absent after - the beat by this window's own
 * clock, from the age the service sent, so a clock ahead or behind ages nobody wrongly (the PL final
 * review, finding 5).
 */
export function freshnessOf(beatHere: number, now: number): Freshness {
  const age = now - beatHere;
  return age < 30_000 ? 'live' : age < 60_000 ? 'stale' : 'absent';
}

/** How often a window beats, and how often what it holds is aged. */
export const BEAT_MS = 20_000;
const AGE_MS = 5_000;

export interface LiveDocument {
  /** Each component's lock, as last heard; a component never heard of is absent. */
  readonly locks: ReadonlyMap<string, LiveLock>;
  /** Everybody else in the document, live or stale; none absent. */
  readonly people: readonly (LivePresence & { readonly freshness: Freshness })[];
  /** Whether the stream is connected: when not, nothing here is current. */
  readonly connected: boolean;
  /** Counts each change to the outline heard, for whoever reads it again (STR-066). */
  readonly outlineChanges: number;
}

/**
 * **A document as it happens** (the PL plan, PL2): its stream followed - who holds each component and
 * until when, who else is in it, where and doing what - and this window's own presence beaten every 20
 * seconds and whenever where it is or what it is doing changes, and taken away when it leaves. A
 * dropped connection is absence, never an old picture (COL-004): everybody goes until it is back.
 */
export function useLiveDocument({
  client,
  document,
  principalId,
  component,
  mode,
  follow = followStream,
  now = () => Date.now(),
}: {
  client: Client;
  /** None while the page has no document open. */
  document: string | null;
  /** The reader, whose own windows are not shown to them. */
  principalId: string | undefined;
  /** Where this window is: the component open or focused, or none. */
  component: string | null;
  mode: 'read' | 'review' | 'author';
  /** Given in tests. */
  follow?: (options: FollowOptions) => () => void;
  now?: () => number;
}): LiveDocument {
  const viewer = useMemo(() => crypto.randomUUID(), []);
  const [locks, setLocks] = useState<ReadonlyMap<string, LiveLock>>(new Map());
  const [presence, setPresence] = useState<ReadonlyMap<string, Held>>(new Map());
  // This window's beat, set by the effect that beats it, said again on every new connection.
  const beatNow = useRef<() => void>(() => undefined);
  // The clock presence is aged by, read where each event arrives.
  const clock = useRef(now);
  clock.current = now;
  const [connected, setConnected] = useState(false);
  const [outlineChanges, setOutlineChanges] = useState(0);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (document === null) return undefined;
    setLocks(new Map());
    setPresence(new Map());
    const stop = follow({
      url: `${window.location.origin}/v1/stream?document=${document}&viewer=${viewer}`,
      onEvent: (event, data) => {
        if (event === 'snapshot') {
          const snapshot = data as {
            locks?: ({ component: string } & LiveLock)[];
            presence?: LivePresence[];
          };
          setLocks(new Map((snapshot.locks ?? []).map((lock) => [lock.component, lock])));
          setPresence(
            new Map(
              (snapshot.presence ?? []).map((each) => [each.viewer, heldAt(each, clock.current())]),
            ),
          );
          setConnected(true);
          // Back: say where this window is at once, not at the next beat (finding 2).
          beatNow.current();
        } else if (event === 'lock') {
          const lock = data as { component: string } & LiveLock;
          setLocks((was) => new Map(was).set(lock.component, lock));
        } else if (event === 'presence') {
          const each = data as LivePresence;
          setPresence((was) => new Map(was).set(each.viewer, heldAt(each, clock.current())));
        } else if (event === 'presence_left') {
          const { viewer: left } = data as { viewer: string };
          setPresence((was) => {
            const next = new Map(was);
            next.delete(left);
            return next;
          });
        } else if (event === 'outline') {
          setOutlineChanges((count) => count + 1);
        } else if (event === 'permissions') {
          setConnected(false);
        }
      },
      onDropped: () => {
        setConnected(false);
        setPresence(new Map());
      },
    });
    const ageing = setInterval(() => setTick((tick) => tick + 1), AGE_MS);
    return () => {
      stop();
      clearInterval(ageing);
    };
  }, [document, follow, viewer]);

  // This window's own beat: now, on every change of where it is or what it is doing, and every 20
  // seconds; and its leaving when it goes.
  const said = useRef({ component, mode });
  said.current = { component, mode };
  useEffect(() => {
    if (document === null) return undefined;
    const beat = () => {
      void client
        .PUT('/v1/presence', {
          body: { viewer, document, component: said.current.component, mode: said.current.mode },
        })
        .catch(() => undefined);
    };
    beatNow.current = beat;
    beat();
    const beating = setInterval(beat, BEAT_MS);
    return () => clearInterval(beating);
  }, [client, document, viewer, component, mode]);
  useEffect(() => {
    if (document === null) return undefined;
    return () => {
      void client
        .DELETE('/v1/presence/{viewer}', { params: { path: { viewer } } })
        .catch(() => undefined);
    };
  }, [client, document, viewer]);

  const at = now();
  const people = [...presence.values()]
    .filter((each) => each.viewer !== viewer && each.person.id !== principalId)
    .map(({ beatHere, ...each }) => ({ ...each, freshness: freshnessOf(beatHere, at) }))
    .filter((each) => each.freshness !== 'absent');
  return { locks, people, connected, outlineChanges };
}
