import type { createApiClient } from '@alloy-works/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';

/** A space somebody may create in, as `GET /v1/spaces` answers it. */
export interface Space {
  readonly id: string;
  readonly name: string;
}

/**
 * The spaces the service says the caller may create in (`mayCreate`), from a body that is checked
 * rather than trusted: the client's bodies are `any`. `undefined` is a body that is not a listing at
 * all; an entry that is malformed, or one the caller may not create in, is left out. Shared by **New
 * component** and **New document** (the plan's decision 8), so the two forms cannot disagree about
 * where a person may create.
 */
export function creatableSpacesIn(data: unknown): Space[] | undefined {
  if (typeof data !== 'object' || data === null || !('items' in data)) return undefined;
  const items = (data as { items: unknown }).items;
  if (!Array.isArray(items)) return undefined;
  return items.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const { id, name, mayCreate } = item as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string' || mayCreate !== true) return [];
    return [{ id, name }];
  });
}

type Client = ReturnType<typeof createApiClient>;

export interface CreatableSpaces {
  /** `null` until the first read answers. */
  readonly spaces: readonly Space[] | null;
  /**
   * A read that failed is not a read that came back empty, and signed out is neither: the first says
   * something, the second is silent by design (nobody is offered a form that could only refuse them),
   * and the third is not something Try again fixes by itself.
   */
  readonly problem: 'signedOut' | 'failed' | null;
  readonly where: string;
  readonly setWhere: (space: string) => void;
  /** Reads the spaces afresh - on Try again, and after a refusal that may mean one has gone. */
  readonly reload: () => Promise<void>;
}

/**
 * The spaces a create form offers, and the one chosen, read once on mount and again on demand. One
 * loader for **New component** and **New document**, so the two cannot drift apart in how they read,
 * retry or keep a choice.
 *
 * A generation counter rather than a mount-scoped flag, because `reload` is also called imperatively,
 * after a 403 or a 404, so a read that is no longer the latest still has to be told apart from one
 * that is. The effect leaves its generation behind on the way out, so a read still in flight when the
 * form goes sets no state into a component that is no longer there.
 */
export function useCreatableSpaces(client: Client): CreatableSpaces {
  const [spaces, setSpaces] = useState<readonly Space[] | null>(null);
  const [problem, setProblem] = useState<'signedOut' | 'failed' | null>(null);
  const [where, setWhere] = useState('');
  const request = useRef(0);

  const reload = useCallback(async () => {
    const generation = ++request.current;
    setProblem(null);
    try {
      const { data, response } = await client.GET('/v1/spaces');
      if (request.current !== generation) return;
      const open = creatableSpacesIn(data);
      if (open === undefined) {
        setProblem(response.status === 401 ? 'signedOut' : 'failed');
        return;
      }
      setSpaces(open);
      // The author's own choice survives a read that did not take it away: a retry, or the re-read a
      // 404 asks for, is not a reason to move them back to the first space in the list. Only a space
      // that is no longer offered gives way, and then to whatever is first.
      setWhere((chosen) =>
        open.some((space) => space.id === chosen) ? chosen : (open[0]?.id ?? ''),
      );
    } catch {
      if (request.current === generation) setProblem('failed');
    }
  }, [client]);

  useEffect(() => {
    void reload();
    return () => {
      request.current += 1;
    };
  }, [reload]);

  return { spaces, problem, where, setWhere, reload };
}
