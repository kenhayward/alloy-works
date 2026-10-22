import type { createApiClient } from '@alloy-works/api-client';
import type { ExtensionManifest, SourceManifest } from '@alloy-works/domain';
import { useEffect, useState } from 'react';

import { everyPage } from '../paging.js';

type Client = ReturnType<typeof createApiClient>;

/** An installed extension as a connection is made against it (the EX plan, EX-D). */
export interface InstalledExtension {
  readonly id: string;
  readonly digest: string;
  readonly manifest: SourceManifest;
  readonly removedAt: string | null;
}

/**
 * The source extensions installed, read for a connection to one: null until read, `refused` where the
 * caller does not administer the environment, which listing them needs, and `failed` otherwise. A
 * reference extension is no source of rows (the XR plan, XR-J), so is never among them.
 */
export type Extensions = readonly InstalledExtension[] | 'refused' | 'failed' | null;

export function useInstalledExtensions(client: Client, wanted: boolean): Extensions {
  const [read, setRead] = useState<Extensions>(null);
  useEffect(() => {
    if (!wanted) return undefined;
    let current = true;
    everyPage<InstalledExtension | { readonly manifest: ExtensionManifest }>((cursor) =>
      client.GET('/v1/extensions', { params: { query: cursor ? { cursor } : {} } }),
    )
      .then((answer) => {
        if (!current) return;
        if ('items' in answer) {
          setRead(
            answer.items.filter(
              (each): each is InstalledExtension => each.manifest.kind === 'source',
            ),
          );
        } else setRead(answer.status === 403 ? 'refused' : 'failed');
      })
      .catch(() => current && setRead('failed'));
    return () => {
      current = false;
    };
  }, [client, wanted]);
  return read;
}

/** Those a connection may be made to: not removed, and taking a secret, as the service requires. */
export const connectable = (extensions: readonly InstalledExtension[]) =>
  extensions.filter((each) => each.removedAt === null && each.manifest.authentication !== 'none');
