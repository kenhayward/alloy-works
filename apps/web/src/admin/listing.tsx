import { useEffect, useState } from 'react';

import { Notice } from '../states/Notice.js';
import { Waiting } from '../states/Waiting.js';

/** The access page's sentence, for the same refusal. */
export const NOT_YOURS = 'You may not manage access here.';

/** What a section read: its rows, refused, or failed; null while it is being read. */
export type Read<T> = { readonly rows: readonly T[] } | 'refused' | 'failed' | null;

/**
 * Reads a listing to its end, answering 403 as refused and anything else that fails as failed. A new
 * `generation` reads it again, keeping what was shown until the new read answers.
 */
export function useListing<T>(
  load: () => Promise<{ readonly items: T[] } | { readonly status: number }>,
  active: boolean,
  generation = 0,
): Read<T> {
  const [read, setRead] = useState<Read<T>>(null);
  const [readAt, setReadAt] = useState(-1);
  useEffect(() => {
    if (!active || (read !== null && readAt === generation)) return undefined;
    let current = true;
    load()
      .then((answer) => {
        if (!current) return;
        setReadAt(generation);
        if ('items' in answer) setRead({ rows: answer.items });
        else setRead(answer.status === 403 ? 'refused' : 'failed');
      })
      .catch(() => {
        if (!current) return;
        setReadAt(generation);
        setRead('failed');
      });
    return () => {
      current = false;
    };
  }, [active, load, read, readAt, generation]);
  return read;
}

export function Shown<T>({
  read,
  failed,
  children,
}: {
  read: Read<T>;
  failed: string;
  children: (rows: readonly T[]) => React.ReactNode;
}) {
  if (read === null) return <Waiting>Loading...</Waiting>;
  if (read === 'refused') {
    return (
      <Notice tone="refused">
        <p>{NOT_YOURS}</p>
      </Notice>
    );
  }
  if (read === 'failed') {
    return (
      <Notice tone="failed">
        <p>{failed}</p>
      </Notice>
    );
  }
  return <>{children(read.rows)}</>;
}
