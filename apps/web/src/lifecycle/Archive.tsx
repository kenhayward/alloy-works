import type { createApiClient } from '@alloy-works/api-client';
import { useState } from 'react';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

export type Archivable = 'component' | 'document';

/**
 * Archives or unarchives one (lifecycle.md), answering what it now is, or undefined where the service
 * refused or did not answer.
 */
export async function setArchived(
  client: Client,
  kind: Archivable,
  id: string,
  archived: boolean,
): Promise<boolean | undefined> {
  const params = { params: { path: { id } } };
  try {
    const { data } =
      kind === 'component'
        ? archived
          ? await client.POST('/v1/components/{id}/archive', params)
          : await client.POST('/v1/components/{id}/unarchive', params)
        : archived
          ? await client.POST('/v1/documents/{id}/archive', params)
          : await client.POST('/v1/documents/{id}/unarchive', params);
    const now = (data as { archived?: unknown } | undefined)?.archived;
    return typeof now === 'boolean' ? now : undefined;
  } catch {
    return undefined;
  }
}

/** What an archival act says once done, or that it was not. */
export function archivalSaid(title: string, archived: boolean | undefined, asked: boolean): string {
  if (archived === undefined) {
    return words('lifecycle.could-not-be-try-again', {
      title,
      value2: asked ? 'archived' : 'unarchived',
    });
  }
  return `${archived ? words('lifecycle.archived') : words('lifecycle.unarchived')} ${title}.`;
}

/**
 * **Archive** or **Unarchive**, offered on a component's or a document's own page only to whoever its
 * view says may retire it (AH-I), as `mayEdit` offers editing; the route decides again. Told what it
 * now is, and what to say.
 */
export function ArchiveButton({
  client,
  kind,
  id,
  title,
  archived,
  mayRetire,
  onChanged,
  className,
}: {
  client: Client;
  kind: Archivable;
  id: string;
  title: string;
  archived: boolean;
  mayRetire: boolean;
  onChanged: (archived: boolean, said: string) => void;
  className?: string | undefined;
}) {
  const [busy, setBusy] = useState(false);
  if (!mayRetire) return null;
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const now = await setArchived(client, kind, id, !archived);
        setBusy(false);
        onChanged(now ?? archived, archivalSaid(title, now, !archived));
      }}
    >
      {archived ? words('lifecycle.unarchive') : words('lifecycle.archive')}
    </button>
  );
}
